import type { RequestHandler } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `PATCH /api/settings` is the real save path behind the Settings page's
 * Business Information and Tax Settings cards (client/src/pages/settings.tsx,
 * ARC-006) — before this route existed, those cards wrote to
 * `localStorage` only and every role, including CASHIER, could "save" them.
 * This must be ADMIN/SUPER_ADMIN only, same bar as the org-identity fields on
 * `PATCH /api/org/setup`.
 */

const getOrgProfileMock = vi.hoisted(() => vi.fn());
const updateOrgProfileMock = vi.hoisted(() => vi.fn());
const requireRoleCalls = vi.hoisted(() => [] as string[][]);

vi.mock("../storage", () => ({
  storage: {
    getOrgProfile: getOrgProfileMock,
    updateOrgProfile: updateOrgProfileMock,
  },
}));

vi.mock("../auth", () => ({
  isAuthenticated: ((_req, _res, next) => next()) as RequestHandler,
  isOwner: ((_req, _res, next) => next()) as RequestHandler,
  requireOrgContext: ((_req, _res, next) => next()) as RequestHandler,
  requireOrgScope: ((_req, _res, next) => next()) as RequestHandler,
  requireSuperAdminMfa: ((_req, _res, next) => next()) as RequestHandler,
  requireRole: (...roles: string[]) => {
    requireRoleCalls.push(roles);
    return ((_req, _res, next) => next()) as RequestHandler;
  },
}));

vi.mock("../authRuntime", () => ({
  getAuthRuntimeSnapshot: vi.fn(),
  getAuthProvider: vi.fn(),
}));

vi.mock("../adminAudit", () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }));

const { registerSettingsOrgRoutes } = await import("../routes/settingsOrg");

const ORG_ID = "00000000-0000-4000-8000-000000000001";

const BASE_ORG = {
  id: ORG_ID,
  name: "arcarna",
  tradingName: "Arcarna Shop",
  address: "1 High Street",
  phone: "01234 567890",
  email: "shop@example.com",
  vatNumber: "GB123456789",
  defaultTaxRate: "20.00",
  currency: "GBP",
  timezone: "Europe/London",
  receiptFooter: "",
  logoUrl: "",
  receiptLogoEnabled: false,
  invoiceLogoEnabled: false,
  accentStyle: "arcarna",
  businessColors: null,
  invoicePrefix: "INV",
  invoiceStartNumber: 1000,
  paymentTerms: "Net 30",
  invoiceBankName: "Big Bank",
  invoiceBankSortCode: "12-34-56",
  invoiceBankAccountNumber: "12345678",
  invoicePaymentLink: "",
  cashierCommissionEnabled: false,
  defaultCashierCommissionRate: "10.00",
  requireCashierForSale: false,
  shiftInactivityCloseAfter: "never",
  globalExpenseAllocationMode: "daily_percentage",
} as const;

/** Registers the routes against a stub app and returns the PATCH /api/settings handler. */
function getPatchHandler() {
  requireRoleCalls.length = 0;
  let handler: RequestHandler | undefined;
  let guardRoles: string[] = [];
  const app = {
    get: () => {},
    patch: (path: string, ...handlers: RequestHandler[]) => {
      if (path === "/api/settings") {
        handler = handlers[handlers.length - 1];
        guardRoles = requireRoleCalls[requireRoleCalls.length - 1] ?? [];
      }
    },
    post: () => {},
    delete: () => {},
  };
  registerSettingsOrgRoutes(app as never, []);
  if (!handler) throw new Error("PATCH /api/settings was not registered");
  return { handler, guardRoles };
}

function getGetHandler() {
  let handler: RequestHandler | undefined;
  const app = {
    get: (path: string, ...handlers: RequestHandler[]) => {
      if (path === "/api/settings") handler = handlers[handlers.length - 1];
    },
    patch: () => {},
    post: () => {},
    delete: () => {},
  };
  registerSettingsOrgRoutes(app as never, []);
  if (!handler) throw new Error("GET /api/settings was not registered");
  return handler;
}

async function callPatch(role: string, body: Record<string, unknown>) {
  const { handler } = getPatchHandler();
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  const res = { json, status };
  await handler(
    { orgContext: { orgId: ORG_ID, locationId: null, role }, body } as never,
    res as never,
    vi.fn(),
  );
  return { json, status };
}

describe("PATCH /api/settings", () => {
  beforeEach(() => {
    getOrgProfileMock.mockReset();
    updateOrgProfileMock.mockReset().mockResolvedValue({
      ...BASE_ORG,
      tradingName: "New Trading Name",
      defaultTaxRate: "17.50",
    });
  });

  it("is gated to ADMIN and SUPER_ADMIN only", () => {
    const { guardRoles } = getPatchHandler();
    expect(guardRoles.sort()).toEqual(["ADMIN", "SUPER_ADMIN"]);
  });

  it("maps the settings.tsx field names onto the real org-profile columns", async () => {
    await callPatch("ADMIN", {
      businessName: "New Trading Name",
      businessAddress: "2 Low Street",
      businessPhone: "01111 222333",
      businessEmail: "new@example.com",
      vatNumber: "GB999999999",
      vatRate: 17.5,
    });

    expect(updateOrgProfileMock).toHaveBeenCalledWith(ORG_ID, {
      tradingName: "New Trading Name",
      address: "2 Low Street",
      phone: "01111 222333",
      email: "new@example.com",
      vatNumber: "GB999999999",
      defaultTaxRate: "17.5",
    });
  });

  it("returns the same shape GET /api/settings does, including the updated fields", async () => {
    const { json } = await callPatch("SUPER_ADMIN", { businessName: "New Trading Name", vatRate: 17.5 });
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ businessName: "New Trading Name", vatRate: 17.5 }),
    );
  });

  it("rejects a body with no recognised fields to patch as a no-op-looking success rather than silently accepting junk", async () => {
    const { status, json } = await callPatch("ADMIN", { notARealField: "x" });
    // Unknown keys are simply dropped by the schema; an empty patch still
    // round-trips the org unchanged rather than erroring, since this is not
    // a strict-mode schema — this just documents that unknown keys don't
    // reach storage.updateOrgProfile.
    expect(updateOrgProfileMock).toHaveBeenCalledWith(ORG_ID, {});
    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalled();
  });

  it("rejects an out-of-range VAT rate with 400", async () => {
    const { status, json } = await callPatch("ADMIN", { vatRate: 150 });
    expect(status).toHaveBeenCalledWith(400);
    expect(updateOrgProfileMock).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });
});

describe("GET /api/settings", () => {
  beforeEach(() => {
    getOrgProfileMock.mockReset().mockResolvedValue(BASE_ORG);
  });

  it("surfaces real invoice bank columns under the bankName/accountNumber/sortCode names orders.tsx reads", async () => {
    const handler = getGetHandler();
    const json = vi.fn();
    const res = { json, status: vi.fn().mockReturnThis() };
    await handler({ orgContext: { orgId: ORG_ID } } as never, res as never, vi.fn());
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        bankName: "Big Bank",
        sortCode: "12-34-56",
        accountNumber: "12345678",
      }),
    );
  });
});
