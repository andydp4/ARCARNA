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

  it("the Staff KPI Evidence is hidden while it is rebuilt (STF-FN1)", () => {
    const kpi = reportByRef("ARC-T2-002")!;
    expect(kpi.status).toBe("planned");
    expect(kpi.statusLabel).toBe("Being rebuilt");
    // Nothing else was switched off along with it.
    expect(REPORT_CATALOG.filter((r) => r.ref !== "ARC-T2-002" && r.statusLabel === "Being rebuilt")).toEqual([]);
  });

  it("the command palette shows a customer's tier and points, never contact details (PRV-02)", () => {
    expect(customerPaletteSubtext({ category: "Gold", loyaltyPoints: 1250 } as never)).toBe("Gold · 1,250 points");
    expect(customerPaletteSubtext({ category: null, loyaltyPoints: 1 } as never)).toBe("Bronze · 1 point");
  });
});
