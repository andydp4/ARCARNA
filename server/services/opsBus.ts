/**
 * The in-process Operations Centre event bus.
 *
 * One `EventEmitter` per org, so a tablet's SSE connection (server/routes/
 * opsStream.ts) only ever hears events for the org it authenticated into —
 * org scoping is the emitter KEY, not a filter applied after the fact, which
 * is what makes an org-B event reaching an org-A stream structurally
 * impossible rather than merely untested (see opsStream.test.ts).
 *
 * Every publish is kept for five minutes in a per-org ring buffer, numbered
 * with a per-org sequence id. A reconnecting tablet sends back the last id it
 * saw (`Last-Event-ID`); `replaySince` returns everything after it, or says
 * `gap: true` when that id has already scrolled out of the buffer (or never
 * existed — a server restart resets every org's sequence), which tells the
 * route to ask the client to reload the board instead of trusting a partial
 * replay.
 *
 * This assumes one server process (`ecosystem.config.cjs` runs one PM2 fork
 * for exactly this reason — see the brief's "Live data" row). If that ever
 * changes, this module is the one thing to swap for Postgres LISTEN/NOTIFY;
 * nothing outside it knows the bus is in-process.
 */
import { EventEmitter } from "node:events";
import type { BoardOrderPayload } from "./opsBoard";

export type OpsBusEvent =
  | { type: "order"; order: BoardOrderPayload }
  | { type: "order_removed"; id: string }
  | { type: "alert"; alert: unknown }
  | { type: "staff"; staff: unknown }
  | { type: "summary"; summary: unknown };

export interface OpsBusEntry {
  /** Per-org, monotonically increasing from 1. Never reused within a process lifetime. */
  id: number;
  event: OpsBusEvent;
  at: number;
}

export type OpsBusReplay =
  | { gap: false; entries: OpsBusEntry[] }
  /** The requested id has aged out of the ring (or never existed here) — reload, don't trust a partial replay. */
  | { gap: true; entries: [] };

/** How long a published event stays replayable. Matches the brief's "5-minute ring buffer". */
export const RING_WINDOW_MS = 5 * 60 * 1000;

interface OrgBus {
  emitter: EventEmitter;
  ring: OpsBusEntry[];
  nextId: number;
}

const buses = new Map<string, OrgBus>();

function busFor(orgId: string): OrgBus {
  let bus = buses.get(orgId);
  if (!bus) {
    const emitter = new EventEmitter();
    // Many tablets, one bus: the default of 10 would print an EventEmitter
    // "possible memory leak" warning on the fifth or sixth idle tablet, which
    // is exactly the shop this phase is for (owner, Q10: "about four
    // dashboards", occasionally more).
    emitter.setMaxListeners(64);
    bus = { emitter, ring: [], nextId: 1 };
    buses.set(orgId, bus);
  }
  return bus;
}

function pruneRing(ring: OpsBusEntry[], now: number): void {
  const cutoff = now - RING_WINDOW_MS;
  let dropFrom = 0;
  while (dropFrom < ring.length && ring[dropFrom].at < cutoff) dropFrom++;
  if (dropFrom > 0) ring.splice(0, dropFrom);
}

/**
 * Publishes one delta to every tablet currently connected to this org's
 * stream. Callers publish AFTER their transaction commits (brief: "emits a
 * delta after every committed transition, create, delay edit and alert
 * sweep") — never from inside the transaction, where a later rollback would
 * make the push a lie.
 */
export function publishOpsEvent(orgId: string, event: OpsBusEvent): OpsBusEntry {
  const bus = busFor(orgId);
  const entry: OpsBusEntry = { id: bus.nextId++, event, at: Date.now() };
  bus.ring.push(entry);
  pruneRing(bus.ring, entry.at);
  bus.emitter.emit("event", entry);
  return entry;
}

/**
 * Subscribes to every future event for one org. Returns an unsubscribe
 * function; the route calls it when the connection closes so a dropped
 * tablet does not keep its listener (and the presence throttle entry it
 * closed over) alive forever.
 */
export function subscribeOpsEvents(orgId: string, onEvent: (entry: OpsBusEntry) => void): () => void {
  const bus = busFor(orgId);
  bus.emitter.on("event", onEvent);
  return () => bus.emitter.off("event", onEvent);
}

/**
 * Everything published after `lastEventId`, or `gap: true` when that id can
 * no longer be answered for (aged out of the 5-minute ring, or the id came
 * from a process that has since restarted and re-started its own count at 1).
 * `lastEventId <= 0` is treated as "nothing to replay" rather than a gap —
 * that is the ordinary first connection, which already has a fresh board from
 * the GET the client made before opening the stream.
 */
export function replaySince(orgId: string, lastEventId: number): OpsBusReplay {
  if (!Number.isFinite(lastEventId) || lastEventId <= 0) return { gap: false, entries: [] };
  const bus = busFor(orgId);
  pruneRing(bus.ring, Date.now());
  if (bus.ring.length === 0) {
    // Nothing retained at all: either nothing has happened in five minutes
    // (no gap — there is simply nothing to replay) or the process restarted
    // and `lastEventId` refers to a sequence that no longer exists. The two
    // are indistinguishable from an empty ring alone, so prefer the safe
    // default of no-gap; a reconciliation poll within `reconcilePollSeconds`
    // catches anything a false negative here would miss, whereas a false
    // "gap" here would force every quiet tablet to reload for nothing.
    return { gap: false, entries: [] };
  }
  const oldest = bus.ring[0];
  if (lastEventId < oldest.id - 1) {
    // There is a hole between what the client last saw and what we can still
    // produce — replaying from here would silently skip events.
    return { gap: true, entries: [] };
  }
  const entries = bus.ring.filter((entry) => entry.id > lastEventId);
  return { gap: false, entries };
}

/** Test-only: drops every org's bus and ring so specs start from nothing. */
export function __resetOpsBusForTests(): void {
  buses.clear();
}
