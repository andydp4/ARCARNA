import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DELAY_CAUSES } from "./delayCauses";

/**
 * This list was duplicated as an identical array literal in the server route and
 * the client dialog. The server copy feeds a Zod enum validating the request, so
 * drift failed asymmetrically and silently: a cause added client-side only gave
 * the operator a dropdown option the API rejected, and one added server-side
 * only could never be selected.
 *
 * Asserting the constant's contents alone would not catch a reintroduced copy —
 * a second literal elsewhere passes every test that only looks at this file. So
 * this reads the two consumers and fails if either grows its own list again.
 */
describe("DELAY_CAUSES", () => {
  it("is the list the API validates against and the dialog offers", () => {
    expect(DELAY_CAUSES).toEqual([
      "Stock unavailable",
      "Queue overload",
      "System issue",
      "Prep error",
      "Other",
    ]);
  });

  it.each([
    ["server/routes/reportCapture.ts", "the Zod enum that validates delayCause"],
    ["client/src/components/reports/OrderOpsDialog.tsx", "the operator's dropdown"],
  ])("%s imports the shared list rather than declaring its own (%s)", (file) => {
    const src = readFileSync(file, "utf8");
    expect(
      src,
      `${file} must import DELAY_CAUSES from @shared/delayCauses`,
    ).toContain('from "@shared/delayCauses"');
    expect(
      src.includes("const DELAY_CAUSES = ["),
      `${file} declares its own DELAY_CAUSES array — that is the duplication this ` +
        `constant exists to remove, and the two copies drift silently`,
    ).toBe(false);
  });
});
