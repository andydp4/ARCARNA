import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * ARC-039: a failed API call used to throw `${status}: ${rawBody}` verbatim,
 * so a page that toasted `error.message` directly showed the operator a raw
 * string like `400: {"code":"VALIDATION_ERROR","message":"Invalid
 * body","details":[...]}`. `apiRequest` (and `getJson`) should surface the
 * human-readable message from that JSON body instead, and still fall back to
 * the raw text for a genuinely non-JSON failure.
 */

const originalFetch = global.fetch;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, statusText: "Error" });
}

function textResponse(status: number, text: string, statusText = "Internal Server Error") {
  return new Response(text, { status, statusText });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("apiRequest error messages", () => {
  it("surfaces details[0].message from a VALIDATION_ERROR body", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        code: "VALIDATION_ERROR",
        message: "Invalid body",
        details: [{ message: "name is required" }],
      }),
    ) as unknown as typeof fetch;

    const { apiRequest } = await import("../queryClient");
    await expect(apiRequest("POST", "/api/customers", {})).rejects.toThrow("name is required");
  });

  it("surfaces errors[0].message from a route that caught its own ZodError ({message:'Invalid data', errors:[...]})", async () => {
    // The loyalty tiers, promotions and 19 other routes catch a ZodError
    // directly and reply with this exact shape — the top-level `message` is
    // always the same generic "Invalid data", so a page toasting only that
    // told the person nothing about what was actually wrong (v1.2.1).
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        message: "Invalid data",
        errors: [{ message: "Expected string, received number", path: ["discountPercentage"] }],
      }),
    ) as unknown as typeof fetch;

    const { apiRequest } = await import("../queryClient");
    await expect(apiRequest("POST", "/api/loyalty-tiers", {})).rejects.toThrow("Expected string, received number");
  });

  it("prefers details[0].message over errors[0].message when a body somehow carries both", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        message: "Invalid data",
        details: [{ message: "the real reason" }],
        errors: [{ message: "a different reason" }],
      }),
    ) as unknown as typeof fetch;

    const { apiRequest } = await import("../queryClient");
    await expect(apiRequest("POST", "/api/x", {})).rejects.toThrow("the real reason");
  });

  it("falls back to the top-level message when there is no details[0].message", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(404, { message: "Customer not found" }),
    ) as unknown as typeof fetch;

    const { apiRequest } = await import("../queryClient");
    await expect(apiRequest("DELETE", "/api/customers/x")).rejects.toThrow("Customer not found");
  });

  it("falls back to the raw status+text for a non-JSON failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      textResponse(500, "<html>Internal Server Error</html>"),
    ) as unknown as typeof fetch;

    const { apiRequest } = await import("../queryClient");
    await expect(apiRequest("GET", "/api/whatever")).rejects.toThrow(
      "500: <html>Internal Server Error</html>",
    );
  });

  it("keeps the dedicated 413 message untouched", async () => {
    global.fetch = vi.fn().mockResolvedValue(textResponse(413, "Payload too large")) as unknown as typeof fetch;

    const { apiRequest } = await import("../queryClient");
    await expect(apiRequest("POST", "/api/uploads", {})).rejects.toThrow(/Nginx client_max_body_size/);
  });
});
