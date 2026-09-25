import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version";
import { LATEST_WHATS_NEW_VERSION, WHATS_NEW, whatsNewForRole, type WhatsNewRole } from "./whatsNew";

const ROLES: WhatsNewRole[] = ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"];
const titles = (role: string) => whatsNewForRole("1.2.0", role).map((i) => i.title);

describe("What's New 1.2.0", () => {
  it("is not the version the app ships any more, but keeps its notes", () => {
    expect(APP_VERSION).not.toBe("1.2.0");
    expect(WHATS_NEW["1.2.0"]?.length).toBeGreaterThan(0);
  });

  it("gives every staff role something, and a shop account nothing", () => {
    for (const role of ROLES) expect(whatsNewForRole("1.2.0", role).length, role).toBeGreaterThan(0);
    expect(whatsNewForRole("1.2.0", "CUSTOMER")).toEqual([]);
  });

  it("keeps each note short", () => {
    for (const item of WHATS_NEW["1.2.0"]) {
      expect(item.roles.length).toBeGreaterThan(0);
      expect(item.title.length).toBeLessThanOrEqual(80);
      expect(item.detail.length).toBeLessThanOrEqual(320);
    }
  });

  it("tells a cashier about the till and My run, not managers' or admins' pages", () => {
    const cashier = titles("CASHIER");
    expect(cashier).toContain("My run: your deliveries on your phone");
    expect(cashier).toContain("Customer details stay private");
    expect(cashier).not.toContain("Needs a look");
    expect(cashier).not.toContain("Staff Performance and Order Timing");
    expect(cashier).not.toContain("Approve contact-details requests");
    expect(cashier).not.toContain("Price guard at the till starts off");
  });

  it("tells a manager how to ask for contact details, and an admin how to approve them", () => {
    expect(titles("MANAGER")).toContain("Contact details: message first, or ask");
    expect(titles("MANAGER")).not.toContain("Approve contact-details requests");
    expect(titles("ADMIN")).toContain("Approve contact-details requests");
    expect(titles("ADMIN")).not.toContain("Contact details: message first, or ask");
  });

  it("keeps the owner-only pages to the owner", () => {
    expect(titles("SUPER_ADMIN")).toContain("Customer data access and Friction Truths");
    expect(titles("ADMIN")).not.toContain("Customer data access and Friction Truths");
  });

  it("still keeps the 1.1.0 notes", () => {
    expect(WHATS_NEW["1.1.0"]?.length).toBeGreaterThan(0);
  });
});

describe("What's New 1.2.1", () => {
  const titles121 = (role: string) => whatsNewForRole("1.2.1", role).map((i) => i.title);

  it("is the version the app ships, and has notes for it", () => {
    expect(APP_VERSION).toBe("1.2.1");
    expect(LATEST_WHATS_NEW_VERSION).toBe(APP_VERSION);
    expect(WHATS_NEW[APP_VERSION]?.length).toBeGreaterThan(0);
  });

  it("gives every staff role something, and a shop account nothing", () => {
    for (const role of ROLES) expect(whatsNewForRole("1.2.1", role).length, role).toBeGreaterThan(0);
    expect(whatsNewForRole("1.2.1", "CUSTOMER")).toEqual([]);
  });

  it("keeps each note short", () => {
    for (const item of WHATS_NEW["1.2.1"]) {
      expect(item.roles.length).toBeGreaterThan(0);
      expect(item.title.length).toBeLessThanOrEqual(80);
      expect(item.detail.length).toBeLessThanOrEqual(320);
    }
  });

  it("tells every role about the credit-owed notice and the delivery fee", () => {
    for (const role of ROLES) {
      expect(titles121(role), role).toContain('"This customer already owes" now shows at the till');
      expect(titles121(role), role).toContain("Delivery fee, on its own line");
    }
  });

  it("keeps the security-and-fixes round-up to admins, not cashiers or managers", () => {
    expect(titles121("ADMIN")).toContain("A round of fixes: money, security and every page");
    expect(titles121("CASHIER")).not.toContain("A round of fixes: money, security and every page");
    expect(titles121("MANAGER")).not.toContain("A round of fixes: money, security and every page");
  });

  it("still keeps the 1.2.0 notes", () => {
    expect(WHATS_NEW["1.2.0"]?.length).toBeGreaterThan(0);
  });
});
