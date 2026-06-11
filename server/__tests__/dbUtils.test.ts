import { describe, expect, it } from "vitest";
import { isTransientPostgresError } from "../lib/dbUtils";

describe("isTransientPostgresError", () => {
  it("detects Neon admin shutdown 57P01", () => {
    expect(
      isTransientPostgresError({
        code: "57P01",
        message: "terminating connection due to administrator command",
      }),
    ).toBe(true);
  });

  it("detects connection reset messages", () => {
    expect(isTransientPostgresError(new Error("Connection terminated unexpectedly"))).toBe(
      true,
    );
  });

  it("does not retry constraint violations", () => {
    expect(isTransientPostgresError({ code: "23505", message: "duplicate key" })).toBe(false);
  });
});
