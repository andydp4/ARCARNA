import { describe, expect, it } from "vitest";
import { swFailureLevel } from "../swRegistration";

describe("service worker registration failures (v1.2.1 UI-14)", () => {
  const aborted = new TypeError("Failed to fetch");

  it("does not log a probe cut short by a reload as an error", () => {
    expect(swFailureLevel(aborted, { stage: "probe", unloading: true, online: true })).toBe("warn");
  });

  it("treats a network failure of the sw.js probe as a warning (reload in flight, or offline)", () => {
    expect(swFailureLevel(aborted, { stage: "probe", unloading: false, online: true })).toBe("warn");
    expect(swFailureLevel(new Error("x"), { stage: "probe", unloading: false, online: false })).toBe("warn");
  });

  it("still reports a failed registration as an error", () => {
    const bad = new DOMException("The script has an unsupported MIME type", "SecurityError");
    expect(swFailureLevel(bad, { stage: "register", unloading: false, online: true })).toBe("error");
    expect(swFailureLevel(aborted, { stage: "register", unloading: false, online: true })).toBe("error");
  });
});
