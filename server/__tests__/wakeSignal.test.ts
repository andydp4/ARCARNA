import { afterEach, describe, expect, it, vi } from "vitest";
import { setWorkerWaker, wakeWorkers } from "../workers/wakeSignal";

afterEach(() => {
  setWorkerWaker(null);
});

describe("worker wake signal", () => {
  it("invokes the registered waker", () => {
    const waker = vi.fn();
    setWorkerWaker(waker);
    wakeWorkers();
    expect(waker).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when no waker is registered", () => {
    setWorkerWaker(null);
    expect(() => wakeWorkers()).not.toThrow();
  });

  it("never lets a throwing waker break the caller", () => {
    setWorkerWaker(() => {
      throw new Error("boom");
    });
    // publishEvent must never fail because a wake nudge threw.
    expect(() => wakeWorkers()).not.toThrow();
  });

  it("uses the most recently registered waker and can be cleared", () => {
    const first = vi.fn();
    const second = vi.fn();
    setWorkerWaker(first);
    setWorkerWaker(second);
    wakeWorkers();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    setWorkerWaker(null);
    wakeWorkers();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
