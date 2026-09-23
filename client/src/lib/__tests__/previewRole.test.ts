import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clerkApiAuth", () => ({
  withClerkAuthHeaders: async (h: Record<string, string>) => h,
}));

function memorySession() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("preview role (client)", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", memorySession());
    vi.stubGlobal("localStorage", memorySession());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds X-Preview-Role to every scoped request only while a preview is on", async () => {
    const { orgScopeHeaders, orgOnlyHeaders } = await import("../orgScope");
    const { PREVIEW_ROLE_STORAGE_KEY, clearPreviewRole } = await import("../previewRole");
    expect(orgScopeHeaders()["X-Preview-Role"]).toBeUndefined();
    sessionStorage.setItem(PREVIEW_ROLE_STORAGE_KEY, "CASHIER");
    expect(orgScopeHeaders()["X-Preview-Role"]).toBe("CASHIER");
    expect(orgOnlyHeaders()["X-Preview-Role"]).toBeUndefined();
    clearPreviewRole();
    expect(orgScopeHeaders()["X-Preview-Role"]).toBeUndefined();
  });

  it("ignores anything that is not a previewable role", async () => {
    const { PREVIEW_ROLE_STORAGE_KEY, getPreviewRole } = await import("../previewRole");
    sessionStorage.setItem(PREVIEW_ROLE_STORAGE_KEY, "SUPER_ADMIN");
    expect(getPreviewRole()).toBeNull();
  });

  it("records the start for the audit log, without the preview header, then reloads", async () => {
    const { setPreviewRole, getPreviewRole } = await import("../previewRole");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const reload = vi.fn();
    await setPreviewRole("MANAGER", { "X-Org-Id": "org-1" }, reload, "/arcarna/");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/auth/preview-role");
    expect((init.headers as Record<string, string>)["X-Preview-Role"]).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({ role: "MANAGER" });
    expect(getPreviewRole()).toBe("MANAGER");
    expect(reload).toHaveBeenCalledWith("/arcarna/");
  });

  it("a refused start leaves no preview on; ending always works", async () => {
    const { setPreviewRole, getPreviewRole, PREVIEW_ROLE_STORAGE_KEY } = await import("../previewRole");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "no" }), { status: 403 })));
    const reload = vi.fn();
    await expect(setPreviewRole("CASHIER", {}, reload)).rejects.toThrow("no");
    expect(getPreviewRole()).toBeNull();
    sessionStorage.setItem(PREVIEW_ROLE_STORAGE_KEY, "CASHIER");
    await setPreviewRole(null, {}, reload);
    expect(getPreviewRole()).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });
});
