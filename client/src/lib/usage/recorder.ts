/**
 * The till's side of our own usage record (v1.2 Phase 8B, UXA-07/08).
 *
 * Kept free of React and the browser globals (everything is passed in) so the
 * rules can be unit tested: how active time is measured, what a call or a
 * message leaves behind, and how batches are kept and sent.
 *
 * Never recorded: screen text, what is typed, money amounts or names. A
 * message is its title only (and the server cuts that back again); a call is
 * its method, route shape, time and status; a screen is its route shape.
 * Nothing here knows who is signed in: the server adds the role.
 */
import { screenFor } from "@shared/problemReports";
import {
  ACTIVE_WINDOW_MS,
  apiRouteShape,
  isFrictionCall,
  SLOW_CALL_MS,
  USAGE_BATCH_MAX,
  type CrashKind,
  type CreditNoticeStep,
  type FunnelStep,
  type UsageEventInput,
} from "@shared/usage";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A gap longer than this between ticks is the device asleep, not someone looking at the screen. */
export const SLEEP_GAP_MS = 60_000;
/** A long stay on one screen is sent in parts, so a crash or a flat battery loses at most this much. */
export const VIEW_CHUNK_MS = 15 * 60_000;
/** At most this many events wait on one device; the oldest go first. */
export const USAGE_QUEUE_MAX = 1_000;
/** Script errors counted per page load (one broken extension must not flood the record). */
export const SCRIPT_CRASHES_PER_LOAD = 5;

/**
 * Active and open time on one screen. Open is time with the tab visible;
 * active is the part of that within 30 s of the last input (so a board left
 * on all day is open, not active).
 */
export class ScreenClock {
  activeMs = 0;
  openMs = 0;
  private last: number;
  private lastInput = Number.NEGATIVE_INFINITY;

  constructor(
    now: number,
    private visible = true,
  ) {
    this.last = now;
  }

  advance(now: number): void {
    const gap = now - this.last;
    const dt = gap > 0 && gap <= SLEEP_GAP_MS ? gap : 0;
    if (dt > 0 && this.visible) {
      this.openMs += dt;
      const activeUntil = this.lastInput + ACTIVE_WINDOW_MS;
      this.activeMs += Math.max(0, Math.min(this.last + dt, activeUntil) - this.last);
    }
    this.last = Math.max(this.last, now);
  }

  input(now: number): void {
    this.advance(now);
    this.lastInput = now;
  }

  setVisible(visible: boolean, now: number): void {
    this.advance(now);
    this.visible = visible;
  }

  /** The time so far, and start counting again from now (the input window carries over). */
  take(now: number): { activeMs: number; openMs: number } {
    this.advance(now);
    const out = { activeMs: Math.round(this.activeMs), openMs: Math.round(this.openMs) };
    this.activeMs = 0;
    this.openMs = 0;
    return out;
  }
}

/**
 * An event waiting to be sent, with the shop and the role of whoever was
 * signed in when it happened. The server takes the role from the session that
 * sends the batch, so an event only goes while that same role is signed in:
 * a cashier's offline shift is never sent (and counted) as the next manager's.
 */
type Queued = { orgId: string | null; role: string | null; event: UsageEventInput };
type WithoutAt<T> = T extends unknown ? Omit<T, "at"> : never;

export type UsageBatch = {
  deviceKey: string;
  device: string | null;
  appVersion: string;
  events: UsageEventInput[];
};

export type UsageDeps = {
  now: () => number;
  store: KeyValueStore | null;
  queueKey: string;
  deviceKeyKey: string;
  orgId: () => string | null;
  device: () => string | null;
  appVersion: string;
  random?: () => number;
  /** Sends one batch; resolves with the HTTP status, rejects when there is no answer. */
  send: (orgId: string | null, batch: UsageBatch, opts: { keepalive: boolean }) => Promise<number>;
  online: () => boolean;
};

export class UsageRecorder {
  private enabled = false;
  /** The signed-in role events are recorded under (set with setEnabled). */
  private role: string | null = null;
  private path = "/";
  private search = "";
  /** The Operations Centre says which of its panes is in front (undefined: it has not said). */
  private pane: string | null | undefined = undefined;
  private screen = "/";
  private clock: ScreenClock;
  private viewStarted: number;
  private continued = false;
  private queue: Queued[];
  private retryAt = 0;
  private sending = false;
  private scriptCrashes = 0;
  private listeners = new Set<() => void>();

  constructor(private deps: UsageDeps) {
    const now = deps.now();
    this.clock = new ScreenClock(now);
    this.viewStarted = now;
    this.queue = this.load();
  }

  // -- state ---------------------------------------------------------------

  /** On for a signed-in member of staff, with their role; off for nobody or a role preview. */
  setEnabled(enabled: boolean, role: string | null = null): void {
    const nextRole = enabled ? role : null;
    if (enabled === this.enabled && nextRole === this.role) return;
    const now = this.deps.now();
    // The view so far belongs to whoever was signed in until now.
    if (this.enabled) this.closeView(now);
    this.enabled = enabled;
    this.role = nextRole;
    // Time before being signed in (or during a preview) is nobody's to count.
    this.clock = new ScreenClock(now);
    this.viewStarted = now;
    this.continued = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  currentScreen(): string {
    return this.screen;
  }

  /** Told whenever the screen changes (the study banner follows it). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setPath(path: string, search = ""): void {
    this.path = path;
    this.search = search;
    this.moveTo(this.screenNow());
  }

  /** The Operations Centre's board and till share a URL; it tells us which is in front. */
  setPane(pane: string | null | undefined): void {
    this.pane = pane;
    this.moveTo(this.screenNow());
  }

  private screenNow(): string {
    if (this.pane !== undefined && screenFor(this.path) === "/operations") {
      return this.pane ? `/operations?pane=${this.pane}` : "/operations";
    }
    return screenFor(this.path, this.search);
  }

  private moveTo(screen: string): void {
    if (screen === this.screen) return;
    const now = this.deps.now();
    this.closeView(now);
    this.screen = screen;
    this.viewStarted = now;
    this.continued = false;
    for (const l of this.listeners) l();
  }

  private closeView(now: number): void {
    const t = this.clock.take(now);
    if (!this.enabled || t.openMs <= 0) return;
    this.push({
      kind: "screen",
      at: new Date(now).toISOString(),
      screen: this.screen,
      activeMs: t.activeMs,
      openMs: t.openMs,
      ...(this.continued ? { cont: true } : {}),
    });
  }

  // -- what happens on screen ------------------------------------------------

  input(): void {
    this.clock.input(this.deps.now());
  }

  setVisible(visible: boolean): void {
    this.clock.setVisible(visible, this.deps.now());
  }

  /** Called every few seconds: keeps the clock current and sends a long stay in parts. */
  tick(): void {
    const now = this.deps.now();
    this.clock.advance(now);
    if (now - this.viewStarted >= VIEW_CHUNK_MS) {
      this.closeView(now);
      this.viewStarted = now;
      this.continued = true;
    }
  }

  /** The page is going away: count this view now. */
  endView(): void {
    const now = this.deps.now();
    this.closeView(now);
    this.viewStarted = now;
    this.continued = true;
  }

  message(title: unknown, tone: "error" | "info"): void {
    if (typeof title !== "string" || !title.trim()) return;
    // The title only, and at most 500 characters; the server cuts it back further.
    this.record({ kind: "message", screen: this.screen, title: title.slice(0, 500), tone });
  }

  call(method: string, url: string, ms: number, status: number): void {
    const m = method.toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m)) return;
    const taken = Math.max(0, Math.min(600_000, Math.round(ms)));
    if (!isFrictionCall(taken, status)) return;
    this.record({
      kind: "call",
      screen: this.screen,
      method: m as "GET",
      // The route shape only: no ids, no search terms leave the device.
      route: apiRouteShape(url),
      ms: taken,
      status: Math.max(0, Math.min(599, Math.trunc(status))),
    });
  }

  crash(kind: CrashKind): void {
    if (kind === "script" && ++this.scriptCrashes > SCRIPT_CRASHES_PER_LOAD) return;
    this.record({ kind: "crash", screen: this.screen, crash: kind });
  }

  offline(ms: number): void {
    if (ms <= 0) return;
    this.record({ kind: "offline", screen: this.screen, ms: Math.min(Math.round(ms), 7 * 24 * 3_600_000) });
  }

  funnel(step: FunnelStep): void {
    this.record({ kind: "funnel", screen: this.screen, step });
  }

  /** "Already owes" at order start (v1.2.1): shown, or a payment taken from it. No customer, no amount. */
  creditNotice(step: CreditNoticeStep): void {
    this.record({ kind: "credit", screen: this.screen, step });
  }

  private record(e: WithoutAt<UsageEventInput>): void {
    if (!this.enabled) return;
    this.push({ ...e, at: new Date(this.deps.now()).toISOString() } as UsageEventInput);
  }

  private push(event: UsageEventInput): void {
    this.queue.push({ orgId: this.deps.orgId(), role: this.role, event });
    if (this.queue.length > USAGE_QUEUE_MAX) this.queue = this.queue.slice(-USAGE_QUEUE_MAX);
    this.save();
  }

  // -- keeping and sending -----------------------------------------------------

  pending(): number {
    return this.queue.length;
  }

  private load(): Queued[] {
    try {
      const raw = this.deps.store?.getItem(this.deps.queueKey);
      const parsed = raw ? JSON.parse(raw) : [];
      // An event kept without its role (an older build) cannot be placed: dropped.
      return Array.isArray(parsed)
        ? parsed
            .filter((q) => q && typeof q === "object" && q.event && typeof q.role === "string" && q.role)
            .slice(-USAGE_QUEUE_MAX)
        : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      if (this.queue.length === 0) this.deps.store?.removeItem(this.deps.queueKey);
      else this.deps.store?.setItem(this.deps.queueKey, JSON.stringify(this.queue));
    } catch {
      /* storage full or blocked: the events stay in memory until sent */
    }
  }

  deviceKey(): string {
    try {
      const existing = this.deps.store?.getItem(this.deps.deviceKeyKey);
      if (existing && /^[0-9A-Za-z_-]{8,64}$/.test(existing)) return existing;
    } catch {
      /* fall through */
    }
    const random = this.deps.random ?? Math.random;
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let key = "d";
    for (let i = 0; i < 20; i++) key += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
    try {
      this.deps.store?.setItem(this.deps.deviceKeyKey, key);
    } catch {
      /* not kept: this device gets a new key next load, which only splits its limit */
    }
    return key;
  }

  /**
   * Send one batch of this shop's events. Sent and refused (400) events leave
   * the queue; "slow down" (429) waits 15 minutes; no answer or a server
   * error waits a minute. Another shop's events wait until it is chosen, and
   * another role's until someone with that role is signed in here again.
   */
  async flush(opts: { keepalive?: boolean } = {}): Promise<number> {
    const now = this.deps.now();
    if (this.sending || !this.deps.online() || now < this.retryAt) return 0;
    const orgId = this.deps.orgId();
    const role = this.role;
    if (!this.enabled || !role) return 0;
    const mine = this.queue.filter((q) => q.orgId === orgId && q.role === role).slice(0, USAGE_BATCH_MAX);
    if (mine.length === 0) return 0;
    this.sending = true;
    try {
      const status = await this.deps.send(
        orgId,
        { deviceKey: this.deviceKey(), device: this.deps.device(), appVersion: this.deps.appVersion, events: mine.map((q) => q.event) },
        { keepalive: !!opts.keepalive },
      );
      if (status < 300 || status === 400) {
        const sent = new Set(mine);
        this.queue = this.queue.filter((q) => !sent.has(q));
        this.save();
        return status < 300 ? mine.length : 0;
      }
      this.retryAt = now + (status === 429 ? 15 * 60_000 : 60_000);
      return 0;
    } catch {
      this.retryAt = now + 60_000;
      return 0;
    } finally {
      this.sending = false;
    }
  }
}

/**
 * Wrap fetch so every API call is timed where it passes, including the sale
 * itself (the sale queue, apiRequest, the query client and plain fetch all
 * end here). Only slow or failed calls are kept. The usage batches themselves
 * are left out, or a slow send would record itself.
 */
export function installFetchObserver(
  target: { fetch: typeof fetch },
  onCall: (method: string, url: string, ms: number, status: number) => void,
  clock: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
): () => void {
  const original = target.fetch;
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!url.includes("/api/") || url.includes("/api/usage/")) return original.call(target, input, init);
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET")).toUpperCase();
    const t0 = clock();
    try {
      const res = await original.call(target, input, init);
      try {
        onCall(method, url, clock() - t0, res.status);
      } catch {
        /* recording must never break a call */
      }
      return res;
    } catch (e) {
      // A call the page cancelled quickly (the person moved on) is not a
      // failure. One the page gave up on after waiting past the slow line is:
      // the sale queue aborts its own POST /api/orders when its timeout fires,
      // and that is the worst sale friction there is.
      const taken = clock() - t0;
      if ((e as { name?: string })?.name !== "AbortError" || taken > SLOW_CALL_MS) {
        try {
          onCall(method, url, taken, 0);
        } catch {
          /* ignore */
        }
      }
      throw e;
    }
  };
  target.fetch = wrapped as typeof fetch;
  return () => {
    if (target.fetch === wrapped) target.fetch = original;
  };
}
