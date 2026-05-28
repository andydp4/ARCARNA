/**
 * API Routes — composition root (M2).
 * Domain handlers live in server/routes/<domain>.ts.
 */
import type { Express } from "express";
import { setupAuth, isAuthenticated, requireOrgContext, requireOrgScope } from "./auth";
import {
  registerChannelPublicRoutes,
  registerChannelAuthenticatedRoutes,
} from "./routes/channels";
import { registerSetupAndImportRoutes } from "./routes/setupImports";
import { registerOperationalRoutes } from "./routes/operational";
import { registerAutomationRoutes } from "./routes/automation";
import { registerScheduledReportRoutes } from "./routes/scheduledReports";
import { registerInventoryTransferRoutes } from "./routes/inventoryTransfers";
import { registerSupplierRoutes } from "./routes/suppliers";
import { registerReplenishmentRoutes } from "./routes/replenishment";
import { registerPurchaseDraftRoutes } from "./routes/purchaseDrafts";
import { registerGoodsReceiptRoutes } from "./routes/goodsReceipts";
import { registerFeatureFlagRoutes } from "./routes/featureFlags";
import { registerHealthRoutes } from "./routes/health";
import { registerAuthRoutes } from "./routes/auth";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerProductRoutes } from "./routes/products";
import { registerCustomerRoutes } from "./routes/customers";
import { registerOrderRoutes } from "./routes/orders";
import { registerInventoryRoutes } from "./routes/inventory";
import { registerReportRoutes } from "./routes/reports";
import { registerLocationRoutes } from "./routes/locations";
import { registerLoyaltyRoutes } from "./routes/loyalty";
import { registerPromotionRoutes } from "./routes/promotions";
import { registerExpenseRoutes } from "./routes/expenses";
import { registerInvoiceRoutes } from "./routes/invoices";
import { registerTickCustomerRoutes } from "./routes/tickCustomers";
import { registerSettingsOrgRoutes } from "./routes/settingsOrg";
import { registerAdminRoutes } from "./routes/admin";
import { registerWorkerAdminRoutes } from "./routes/workers";

export async function registerRoutes(app: Express): Promise<void> {
  registerHealthRoutes(app);
  registerChannelPublicRoutes(app);

  await setupAuth(app);

  registerAuthRoutes(app);

  const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];

  registerChannelAuthenticatedRoutes(app, scoped);
  registerAnalyticsRoutes(app, scoped);
  registerProductRoutes(app, scoped);

  registerSetupAndImportRoutes(app);
  registerOperationalRoutes(app);
  registerAutomationRoutes(app);
  registerScheduledReportRoutes(app);
  registerInventoryTransferRoutes(app);
  registerSupplierRoutes(app);
  registerReplenishmentRoutes(app);
  registerPurchaseDraftRoutes(app);
  registerGoodsReceiptRoutes(app);

  registerCustomerRoutes(app, scoped);
  registerOrderRoutes(app, scoped);
  registerInventoryRoutes(app, scoped);
  registerReportRoutes(app, scoped);
  registerLocationRoutes(app, scoped);
  registerLoyaltyRoutes(app, scoped);
  registerPromotionRoutes(app, scoped);
  registerExpenseRoutes(app, scoped);
  registerInvoiceRoutes(app, scoped);
  registerTickCustomerRoutes(app, scoped);
  registerSettingsOrgRoutes(app, scoped);
  registerFeatureFlagRoutes(app, scoped);

  registerAdminRoutes(app);
  registerWorkerAdminRoutes(app);
}
