import { describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  isChunkLoadError,
  makeReferenceCode,
  reloadOnceForStaleChunk,
} from "../crashReporting";

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe("isChunkLoadError", () => {
  it("recognises the stale-chunk failures browsers raise after a deploy", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/pos-abc.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(
      isChunkLoadError(new TypeError("'text/html' is not a valid JavaScript MIME type.")),
    ).toBe(true);
    expect(isChunkLoadError({ name: "ChunkLoadError", message: "Loading chunk 7 failed" })).toBe(true);
  });

  it("does not treat ordinary bugs as stale chunks", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("reloadOnceForStaleChunk", () => {
  it("reloads the first time and records when", () => {
    const store = memoryStore();
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk(store, reload, 1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(store.data[CHUNK_RELOAD_KEY]).toBe("1000000");
  });

  it("does not loop: a second failure right after the reload shows the crash card", () => {
    const store = memoryStore({ [CHUNK_RELOAD_KEY]: "1000000" });
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk(store, reload, 1_000_000 + 5_000)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("can recover again after a later deploy", () => {
    const store = memoryStore({ [CHUNK_RELOAD_KEY]: "1000000" });
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk(store, reload, 1_000_000 + CHUNK_RELOAD_WINDOW_MS + 1)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("never reloads without storage to guard against a loop", () => {
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk(null, reload)).toBe(false);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
    expect(reloadOnceForStaleChunk(throwing, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("makeReferenceCode", () => {
  it("is short, readable and unambiguous", () => {
    const code = makeReferenceCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});
