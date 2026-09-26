import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import {
  customerEditForRole,
  customerForRole,
  rolesAtLeast,
  REPLACE_PHONE_MIN_ROLE,
} from "@shared/accessPolicy";
import { duplicatePrompt, formatUkPhone, isMaskedValue, maskPhone } from "@shared/customerView";
import {
  findCustomersByPhone,
  findPossibleDuplicates,
  getCustomerForRole,
  listCustomersForRole,
  listPossibleDuplicates,
  readSavedAddress,
} from "../services/customerView";
import { perPersonRateLimit } from "../lib/perPersonRateLimit";
import { recordAccessFromRequest } from "../services/customerAccessLog";
import {
  insertLoyaltyTierSchema,
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema,
} from "@shared/schema";
import { handleBulkAction, rowsToCsv } from "../lib/bulkActionHandler";
import { sendServerError } from "../lib/errorScrub";

/** Bounds mirror the customers table column widths in shared/schema.ts. */
const createCustomerBody = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  receiptEmailOptIn: z.boolean().optional(),
  // "Already on the system: Jane S. (••4821), use them?" answered "No, add new".
  confirmNew: z.boolean().optional(),
}).passthrough();

/**
 * Finding a customer by phone (PRV-06): per person, because the tills share
 * one internet address. Generous enough for a busy counter, far too slow to
 * walk the customer list one number at a time.
 */
export const phoneLookupLimit = perPersonRateLimit({ windowMs: 60_000, max: 20, name: "phone_lookup" });

/**
 * The duplicate check on create answers "is this number or email on file,
 * and whose is it?", so it counts against the same per-person limit as the
 * lookup. Skipped when nothing would be looked up (no phone or email, or
 * "No, add new" already answered): creating a customer is not a lookup.
 */
const duplicateCheckLimit: RequestHandler = (req: any, res, next) => {
  const body = req.body ?? {};
  const looksUp =
    !body.confirmNew &&
    ((typeof body.phone === "string" && body.phone.trim() !== "") ||
      (typeof body.email === "string" && body.email.trim() !== ""));
  return looksUp ? phoneLookupLimit(req, res, next) : next();
};

/**
 * "Use saved address" (PRV-05) is for filling in the delivery being keyed in,
 * one customer at a time; it is not a way to read the address book. A till
 * takes a handful of deliveries an hour, so this is never felt at the counter.
 */
export const savedAddressLimit = perPersonRateLimit({ windowMs: 10 * 60_000, max: 10, name: "saved_address" });

/** Contact reads are never stored by a browser, a proxy or the service worker (PRV-07). */
function noStore(res: any) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
}

const mutateRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");
// Lifetime value and order history per customer: manager and above (PRV-02).
// The only caller is the Customers page, which is manager and above already.
const intelligenceRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");
// Creating a brand-new customer is also allowed for CASHIER: the POS's own
// embedded order form (NewCustomerPanel in pos-cart-panel.tsx) lets any till
// user add a walk-in customer inline, and posts straight to this route with
// no client-side role gate. That's a distinct, narrower risk than editing or
// deleting an existing customer record (ARC-005's PUT/DELETE restriction,
// which stays MANAGER+ only via mutateRoles above).
const createRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER");

export function registerCustomerRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/customers/intelligence", ...scoped, intelligenceRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Org context required for customer intelligence" });
      }
      const { listCustomerIntelligence } = await import("../services/customerIntelligence");
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 200);
      const items = await listCustomerIntelligence(ctx.orgId, limit);
      res.json({ items });
    } catch (error) {
      console.error("Error listing customer intelligence:", error);
      res.status(500).json({ message: "Failed to list customer intelligence" });
    }
  });

  app.get("/api/customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      // Contact details are admin only (Q13a). The till's picker and its
      // offline cache read this list, so below admin the query itself never
      // selects them: the hints and masks are made in the database (PRV-03).
      const list = await listCustomersForRole(ctx.orgId, ctx.role);
      // Never kept by the browser or the service worker, whoever asked
      // (PRV-07): the till's offline copy is the cashier view the app writes
      // to IndexedDB itself.
      noStore(res);
      res.json(list);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  /**
   * Finding a customer by phone at the till (PRV-06). POST so the number stays
   * out of URLs and access logs. The formatted (+44) number, exact match only,
   * at most three people, each as "Jane S." and ••4821.
   */
  app.post(
    "/api/customers/lookup-phone",
    ...scoped,
    requireRole(...rolesAtLeast("CASHIER")),
    phoneLookupLimit,
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        noStore(res);
        const raw = typeof req.body?.phone === "string" ? req.body.phone : "";
        if (isMaskedValue(raw)) return res.status(400).json({ message: "Type the whole number." });
        const formatted = formatUkPhone(raw);
        if (!formatted) {
          return res.status(400).json({ message: "Type the whole UK number, for example 07700 900123.", code: "PHONE_UNREADABLE" });
        }
        const matches = await findCustomersByPhone(ctx.orgId, raw);
        res.json({ matches });
      } catch (error) {
        console.error("Error looking up a customer by phone:", error);
        res.status(500).json({ message: "Failed to look up the number" });
      }
    },
  );

  /** Admin's merge list: website orders that half-matched someone (v1.2 Phase 5). */
  app.get("/api/customers/possible-duplicates", ...scoped, requireRole(...rolesAtLeast("ADMIN")), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      res.json(await listPossibleDuplicates(ctx.orgId));
    } catch (error) {
      console.error("Error listing possible duplicates:", error);
      res.status(500).json({ message: "Failed to list possible duplicates" });
    }
  });

  app.get("/api/customers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const customer = await getCustomerForRole(ctx.orgId, req.params.id, ctx.role);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      noStore(res);
      res.json(customer);
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.get("/api/customers/:id/intelligence", ...scoped, intelligenceRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Org context required for customer intelligence" });
      }
      const { computeCustomerIntelligence } = await import("../services/customerIntelligence");
      const intel = await computeCustomerIntelligence(ctx.orgId, req.params.id);
      if (!intel) return res.status(404).json({ message: "Customer not found" });
      res.json(intel);
    } catch (error) {
      console.error("Error fetching customer intelligence:", error);
      res.status(500).json({ message: "Failed to fetch customer intelligence" });
    }
  });

  app.post("/api/customers", ...scoped, createRoles, duplicateCheckLimit, async (req: any, res) => {
    try {
      // No schema here previously: req.body went straight to the engine, so an
      // empty body or an oversized field failed at the database as a 500.
      const parsed = createCustomerBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid customer",
          errors: parsed.error.errors,
        });
      }
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      // Each role writes its own set of fields (PRV-08). A CASHIER may create
      // a brand-new customer (see createRoles above) but not self-assign a
      // loyalty tier — `category` is not in the cashier's set and falls
      // through to engine.createCustomer's own 'Bronze' default. Points and
      // total spent are in nobody's set, and a masked value is never saved.
      const fields = customerEditForRole(parsed.data as Record<string, unknown>, ctx.role);
      if (typeof fields.name !== "string" || !fields.name.trim()) {
        return res.status(400).json({ message: "Invalid customer", errors: [{ path: ["name"], message: "Name is required" }] });
      }
      // Cashiers can type in details they cannot read back; so before a
      // second record is made for someone, say who is already there (PRV-06).
      if (!parsed.data.confirmNew) {
        const matches = await findPossibleDuplicates(ctx.orgId, {
          phone: typeof fields.phone === "string" ? fields.phone : null,
          email: typeof fields.email === "string" ? fields.email : null,
        });
        if (matches.length > 0) {
          return res.status(409).json({
            code: "CUSTOMER_POSSIBLE_DUPLICATE",
            message: duplicatePrompt(matches[0]),
            matches,
          });
        }
      }
      const { engine } = await import('../../apps/server/src/engine.wiring');
      const created = await engine.createCustomer({
        ...fields,
        orgId: ctx.orgId,
        // Who made it, for the staff report (v1.2 Phase 5).
        createdByUserId: req.user?.id ?? null,
      });
      // Read back through the view: the till's offline cache stores this
      // response, and it must hold the cashier view only (PRV-07).
      const customer = await getCustomerForRole(ctx.orgId, created.id, ctx.role);
      res.json(customer ?? customerForRole(created, ctx.role));
    } catch (error) {
      console.error("Error creating customer:", error);
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.put("/api/customers/:id", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await getCustomerForRole(ctx.orgId, req.params.id, "CASHIER");
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      const { engine } = await import('../../apps/server/src/engine.wiring');
      // Edit without reading (PRV-08): only this role's fields; points and
      // total spent are never typed in; masked values and, below admin,
      // blanks over hidden contact fields are dropped. A manager's phone
      // change goes through "Replace number" instead, which is logged.
      const body = customerEditForRole({ ...(req.body ?? {}) }, ctx.role);
      if (typeof body.name === "string" && !body.name.trim()) delete body.name;
      if (Object.keys(body).length > 0) {
        await engine.updateCustomer(req.params.id, body, ctx.orgId);
      }
      res.json(await getCustomerForRole(ctx.orgId, req.params.id, ctx.role));
    } catch (error: any) {
      console.error("Error updating customer:", error);
      if (error?.message === 'Customer not found') return res.status(404).json({ message: "Customer not found" });
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  /**
   * "Replace number" (PRV-08): a manager types the customer's new phone
   * without ever seeing the old one, and gets back only the masked result.
   * Logged, because it is the one contact write a manager makes.
   */
  app.post(
    "/api/customers/:id/replace-phone",
    ...scoped,
    requireRole(...rolesAtLeast(REPLACE_PHONE_MIN_ROLE)),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string; role: string };
        noStore(res);
        const raw = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
        if (!raw || isMaskedValue(raw) || !formatUkPhone(raw)) {
          return res.status(400).json({ message: "Type the whole new number, for example 07700 900123.", code: "PHONE_UNREADABLE" });
        }
        if (raw.length > 20) return res.status(400).json({ message: "That number is too long.", code: "PHONE_TOO_LONG" });
        const existing = await getCustomerForRole(ctx.orgId, req.params.id, "CASHIER");
        if (!existing) return res.status(404).json({ message: "Customer not found" });
        const { engine } = await import('../../apps/server/src/engine.wiring');
        // Logged first, in the customer data access log (v1.2 Phase 6,
        // PRV-10): a replaced number that cannot be logged is not replaced.
        // The old number was never read; the new one is logged masked.
        try {
          await recordAccessFromRequest(req, {
            orgId: ctx.orgId,
            customerId: req.params.id,
            action: "phone_replaced",
            field: "phone",
            metadata: { phoneMasked: maskPhone(raw) },
          });
        } catch (error) {
          console.error("Replace number log failed; not replacing:", error);
          return res.status(503).json({ message: "This could not be logged, so the number was not changed. Try again.", code: "LOG_FAILED" });
        }
        await engine.updateCustomer(req.params.id, { phone: raw }, ctx.orgId);
        res.json(await getCustomerForRole(ctx.orgId, req.params.id, ctx.role));
      } catch (error) {
        console.error("Error replacing a customer's phone:", error);
        res.status(500).json({ message: "Failed to replace the number" });
      }
    },
  );

  /**
   * "Use saved address" at the till (PRV-05): copies the customer's saved
   * address onto a delivery. Every member of staff sees a live delivery's
   * address anyway (Q8a); this read is still logged, and never cached.
   */
  app.post(
    "/api/customers/:id/saved-address",
    ...scoped,
    requireRole(...rolesAtLeast("CASHIER")),
    savedAddressLimit,
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string; role: string };
        noStore(res);
        const saved = await readSavedAddress(ctx.orgId, req.params.id);
        if (!saved.found) return res.status(404).json({ message: "Customer not found" });
        // In the customer data access log (v1.2 Phase 6); no log, no address.
        await recordAccessFromRequest(req, {
          orgId: ctx.orgId,
          customerId: req.params.id,
          action: "saved_address",
          field: "address",
          metadata: { found: saved.address != null },
        });
        res.json({ address: saved.address });
      } catch (error) {
        console.error("Error reading a saved address:", error);
        res.status(500).json({ message: "Failed to read the saved address" });
      }
    },
  );

  app.delete("/api/customers/:id", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await getCustomerForRole(ctx.orgId, req.params.id, "CASHIER");
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      const { engine } = await import('../../apps/server/src/engine.wiring');
      await engine.deleteCustomer(req.params.id, ctx.orgId);
      res.json({ message: "Customer deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting customer:", error);
      if (error?.message === 'Customer not found') return res.status(404).json({ message: "Customer not found" });
      if ((error as any)?.code === '23503') return res.status(409).json({ message: "Cannot delete this customer: it is still referenced by orders, invoices, gift cards, or loyalty history. Archive or deactivate it instead." });
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });

  app.post("/api/customers/bulk", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: Role };
      const outcome = await handleBulkAction(req, "customers", {
        orgId: ctx.orgId,
        role: ctx.role,
        userId: req.user?.id,
      });
      if (!outcome.ok) return res.status(outcome.status).json({ message: outcome.message });
      const result = outcome.result as { format?: string; rows?: Record<string, unknown>[] };
      if (result.format === "csv" && result.rows) {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="customers-export.csv"');
        res.setHeader("Cache-Control", "no-store, private");
        return res.send(rowsToCsv(result.rows));
      }
      res.json(outcome.result);
    } catch (error: any) {
      console.error("Error in customer bulk action:", error);
      sendServerError(res, error, "Bulk action failed");
    }
  });

}
