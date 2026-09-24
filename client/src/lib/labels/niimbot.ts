/**
 * The label printer connection for this browser tab: connect over Web
 * Bluetooth, remember which printer this device uses, print 1-bit pages.
 *
 * Protocol and print sequencing come from niimbluelib (MIT, by MultiMote —
 * the library behind niimblue, validated on the B1). Niimbot publish no API;
 * that library is reverse-engineered, so hardware behaviour is only as good
 * as its B1 support. It is loaded with a dynamic import the first time a
 * printer is needed, so no till pays for it until someone prints.
 *
 * One connection per tab, held here rather than in React state, so moving
 * between the Ops board and Products does not drop the printer.
 */
import type { MonoBitmap } from "./bitmap";
import { bitmapImageSource } from "./bitmap";
import { describePrintError, heartbeatFault } from "./printerErrors";
import { B1_GEOMETRY, labelGeometry, type LabelGeometry } from "./labelLayout";

type Lib = typeof import("@mmote/niimbluelib");
type Client = InstanceType<Lib["NiimbotBluetoothClient"]>;

export type PrinterStatus = "disconnected" | "connecting" | "connected" | "printing";

export interface PrinterState {
  status: PrinterStatus;
  /** Bluetooth name of the connected (or last used) printer, e.g. "B1-H123456789". */
  deviceName: string | null;
  model: string | null;
  batteryPercent: number | null;
  /** 0–100 while printing. */
  progress: number | null;
  /** Plain sentence for the last failure; cleared by the next attempt. */
  error: string | null;
  /** Non-error note, e.g. "Printed 1 label." */
  notice: string | null;
}

const STORAGE_KEY = "arcarna.labelPrinter.name";

function readRemembered(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRemembered(name: string | null): void {
  try {
    if (name) window.localStorage.setItem(STORAGE_KEY, name);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: the chooser just shows again next time.
  }
}

let state: PrinterState = {
  status: "disconnected",
  deviceName: typeof window === "undefined" ? null : readRemembered(),
  model: null,
  batteryPercent: null,
  progress: null,
  error: null,
  notice: null,
};
const listeners = new Set<() => void>();
let client: Client | null = null;
let libPromise: Promise<Lib> | null = null;
/**
 * Set after a silent reconnect to the remembered printer fails (out of range,
 * switched off), so the next Connect shows the chooser instead of retrying
 * the same device forever.
 */
let skipRememberedOnce = false;

function set(patch: Partial<PrinterState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getPrinterState(): PrinterState {
  return state;
}

export function subscribePrinter(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function loadLib(): Promise<Lib> {
  if (!libPromise) {
    libPromise = import("@mmote/niimbluelib").catch((e) => {
      libPromise = null;
      throw e;
    });
  }
  return libPromise;
}

/** Page size for whatever is connected; the B1's when nothing is. */
export function currentGeometry(): LabelGeometry {
  const meta = client?.isConnected() ? client.getModelMetadata() : undefined;
  return meta ? labelGeometry(meta.dpi, meta.printheadPixels) : B1_GEOMETRY;
}

export function isPrinterConnected(): boolean {
  return Boolean(client?.isConnected());
}

type BluetoothLike = { getDevices?: () => Promise<Array<{ name?: string }>> };
type AuthorizedDevice = NonNullable<NonNullable<Parameters<Client["connect"]>[0]>["authorizedDevice"]>;

/**
 * Fetch the printer library ahead of the click. The Bluetooth chooser only
 * opens while the click's user activation is still fresh, so the library
 * should already be here when Connect is pressed.
 */
export function preloadPrinterLibrary(): void {
  void loadLib().catch(() => undefined);
}

/**
 * Connect. Must run inside a click handler: the browser only shows its
 * Bluetooth chooser in response to a user gesture. Where the browser allows
 * it (Chrome's device permissions), a printer this device has used before is
 * reconnected without the chooser.
 */
export async function connectPrinter(): Promise<void> {
  if (client?.isConnected()) return;
  set({ status: "connecting", error: null, notice: null, progress: null });
  try {
    // The library is normally preloaded (preloadPrinterLibrary), so these
    // awaits are near-instant and the click's user activation survives to
    // the chooser.
    const remembered = skipRememberedOnce ? null : readRemembered();
    skipRememberedOnce = false;
    const bt = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
    const authorizedPromise =
      remembered && typeof bt?.getDevices === "function"
        ? bt.getDevices().then((ds) => ds.find((d) => d.name === remembered)).catch(() => undefined)
        : Promise.resolve(undefined);
    const [lib, authorizedDevice] = await Promise.all([loadLib(), authorizedPromise]);

    const next = new lib.NiimbotBluetoothClient();
    next.on("disconnect", () => {
      if (client !== next) return;
      client = null;
      const wasPrinting = state.status === "printing";
      set({
        status: "disconnected",
        progress: null,
        batteryPercent: null,
        // Our own disconnectPrinter() clears `client` first, so reaching
        // here means the printer went away by itself.
        error: wasPrinting
          ? "The printer disconnected while printing. Turn it on, bring it closer and print again."
          : "The printer disconnected. Tap Connect to reconnect.",
      });
    });
    next.on("heartbeat", (e) => {
      const pct = e.data.batteryPercents ?? null;
      if (pct != null && pct !== state.batteryPercent) set({ batteryPercent: pct });
    });
    let info;
    try {
      info = await next.connect(
        authorizedDevice ? { authorizedDevice: authorizedDevice as unknown as AuthorizedDevice } : undefined,
      );
    } catch (e) {
      if (authorizedDevice) skipRememberedOnce = true;
      throw e;
    }
    if (info.result === lib.ConnectResult.FirmwareErrors || info.result === lib.ConnectResult.Disconnect) {
      await next.disconnect().catch(() => undefined);
      throw new Error("The printer refused the connection");
    }
    client = next;
    const meta = next.getModelMetadata();
    const name = info.deviceName ?? null;
    writeRemembered(name);
    set({ status: "connected", deviceName: name, model: meta?.model ?? null, error: null });
  } catch (e) {
    console.error("[labels] connect failed", e);
    set({ status: "disconnected", error: describePrintError(e) });
    throw e;
  }
}

export async function disconnectPrinter(): Promise<void> {
  const c = client;
  if (!c) return;
  client = null;
  await c.disconnect().catch(() => undefined);
  set({ status: "disconnected", progress: null, batteryPercent: null, notice: null });
}

/** Forget the remembered printer name on this device (and hang up). */
export async function forgetPrinter(): Promise<void> {
  await disconnectPrinter();
  writeRemembered(null);
  set({ deviceName: null, model: null, error: null, notice: null });
}

/**
 * Print `copies` of one page. Connects first if needed (so call it from a
 * click). Resolves when the printer reports the labels done; rejects with the
 * raw error after putting a plain message in `state.error`.
 */
export async function printBitmap(bitmap: MonoBitmap, copies = 1): Promise<void> {
  if (!client?.isConnected()) await connectPrinter();
  const c = client;
  if (!c) throw new Error("Printer is not connected");
  const lib = await loadLib();
  const quantity = Math.max(1, Math.min(99, Math.floor(copies)));

  // Refuse up front when the printer says the lid is open or the roll is
  // empty, instead of sending a page it will reject half-way. Ask afresh
  // rather than trust the cached heartbeat (up to 2 s old): a cashier who
  // has just shut the lid and tapped Print again must not be told it is
  // still open. If the ask fails, skip the check and let the printer's own
  // error report any fault.
  const precheck = heartbeatFault(await c.fetchHeartbeatData().catch(() => undefined));
  if (precheck) {
    set({ error: precheck, notice: null });
    throw new Error(precheck);
  }

  const meta = c.getModelMetadata();
  const taskName = c.getPrintTaskType() ?? "B1";
  const image = lib.ImageEncoder.encode(
    bitmapImageSource(bitmap),
    lib.PageColorType.SingleColor,
    meta?.printDirection ?? "top",
  );
  const task = c.protocol.newPrintTask(taskName, {
    totalPages: quantity,
    labelType: lib.LabelType.WithGaps,
    density: meta?.densityDefault ?? 3,
  });

  const onPacketProgress = (e: { progress: number }) => set({ progress: Math.round(e.progress / 2) });
  const onPrintProgress = (e: { page: number; pagesTotal: number; pagePrintProgress: number }) => {
    const done = (Math.max(0, e.page - 1) + e.pagePrintProgress / 100) / Math.max(1, e.pagesTotal);
    set({ progress: 50 + Math.round(Math.min(1, Math.max(0, done)) * 50) });
  };
  c.on("printpacketprogress", onPacketProgress);
  c.on("printprogress", onPrintProgress);
  c.stopHeartbeat(); // the heartbeat's packets interleave with page data on some firmware
  set({ status: "printing", progress: 0, error: null, notice: null });
  try {
    await task.printInit();
    await task.printPage(image, quantity);
    await task.waitForFinished();
    set({ notice: `Printed ${quantity} label${quantity === 1 ? "" : "s"}.` });
  } catch (e) {
    console.error("[labels] print failed", e);
    set({ error: describePrintError(e) });
    throw e;
  } finally {
    c.off("printpacketprogress", onPacketProgress);
    c.off("printprogress", onPrintProgress);
    await task.printEnd().catch(() => undefined);
    if (client === c && c.isConnected()) {
      c.startHeartbeat();
      set({ status: "connected", progress: null });
    }
  }
}
