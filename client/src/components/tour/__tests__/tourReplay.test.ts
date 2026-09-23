import { afterEach, describe, expect, it, vi } from "vitest";
import { PENDING_REPLAY_TTL_MS, clearPendingReplay, hasPendingReplay, requestTourReplay } from "../tourReplay";

const EVENT = "test:tour:start";

describe("tour replay requests", () => {
  afterEach(() => {
    clearPendingReplay(EVENT);
    vi.unstubAllGlobals();
  });

  it("parks a replay until the tour mounts and takes it up", () => {
    requestTourReplay(EVENT, 1_000);
    expect(hasPendingReplay(EVENT, 1_500)).toBe(true);
    expect(hasPendingReplay("other:event", 1_500)).toBe(false);
    clearPendingReplay(EVENT);
    expect(hasPendingReplay(EVENT, 1_600)).toBe(false);
  });

  it("drops a request nobody took up in time", () => {
    requestTourReplay(EVENT, 1_000);
    expect(hasPendingReplay(EVENT, 1_000 + PENDING_REPLAY_TTL_MS + 1)).toBe(false);
    // Dropped for good, not just reported stale.
    expect(hasPendingReplay(EVENT, 1_000)).toBe(false);
  });

  it("also tells a tour that is already listening", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("Event", class { constructor(public type: string) {} });
    requestTourReplay(EVENT);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0].type).toBe(EVENT);
  });
});
