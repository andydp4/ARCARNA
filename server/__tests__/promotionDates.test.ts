/**
 * v1.2.1 money audit (M17): the Promotions page sends its start and end dates
 * as ISO strings (JSON has no dates), and the API refused every one with
 * "Expected date, received string", so no promotion could be created or
 * edited from the page.
 */
import { describe, expect, it } from "vitest";
import { insertPromotionSchema } from "@shared/schema";

const body = {
  orgId: "00000000-0000-4000-8000-000000000001",
  name: "Autumn ten",
  code: "AUTUMN10",
  type: "percentage",
  value: "10",
  startDate: "2026-09-01T00:00:00.000Z",
  endDate: "2026-09-30T23:59:59.000Z",
  isActive: 1,
};

describe("promotion dates from JSON", () => {
  it("accepts ISO date strings, as the Promotions page sends them", () => {
    const parsed = insertPromotionSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.startDate).toBeInstanceOf(Date);
  });

  it("accepts them on an edit too", () => {
    expect(insertPromotionSchema.partial().safeParse({ endDate: "2026-10-31T23:59:59.000Z" }).success).toBe(true);
  });

  it("still refuses a date that is not a date", () => {
    expect(insertPromotionSchema.safeParse({ ...body, startDate: "next tuesday" }).success).toBe(false);
  });
});
