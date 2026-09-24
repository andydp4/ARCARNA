/**
 * v1.2 Phase 0B, Evidence (Q20b, STF-FN1, PRV-02): the client side of the
 * Evidence lock-down that has no page test of its own.
 */
import { describe, expect, it } from "vitest";
import { navItems } from "@/components/nav-items";
import { reportByRef, REPORT_CATALOG } from "@/lib/reportCatalog";
import { customerPaletteSubtext } from "@/lib/commandPaletteIndex";

describe("Evidence lock-down, client side", () => {
  it("the menu says Evidence, not Reports (Q20b), and stays manager and above", () => {
    const hub = navItems.find((i) => i.key === "reports-hub")!;
    expect(hub.label).toBe("Evidence");
    expect(hub.roles).not.toContain("CASHIER");
    expect(navItems.map((i) => i.label)).not.toContain("Reports");
  });

  it("Staff Performance replaces Staff KPI at the same reference, and nothing is left \"Being rebuilt\" (v1.2 Phase 7B)", () => {
    const perf = reportByRef("ARC-T2-002")!;
    expect(perf.title).toBe("Staff Performance");
    expect(perf.status).toBe("available");
    expect(perf.route).toBe("/reports/staff-performance");
    expect(REPORT_CATALOG.filter((r) => r.statusLabel === "Being rebuilt")).toEqual([]);
    // Never a bonus: Q16 removed the £50/£100/£150 tiers.
    expect(perf.purpose).not.toMatch(/bonus/i);
  });

  it("Staff Performance sits in the Truths Centre and the Finance Centre, manager and above", () => {
    const hits = navItems.filter((i) => i.href === "/reports/staff-performance");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const h of hits) expect(h.roles).not.toContain("CASHIER");
  });

  it("the command palette shows a customer's tier and points, never contact details (PRV-02)", () => {
    expect(customerPaletteSubtext({ category: "Gold", loyaltyPoints: 1250 } as never)).toBe("Gold · 1,250 points");
    expect(customerPaletteSubtext({ category: null, loyaltyPoints: 1 } as never)).toBe("Bronze · 1 point");
  });
});
