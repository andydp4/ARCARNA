/**
 * API Routes — composition root (M2).
 * Domain handlers live in server/routes/<domain>.ts.
 */
import type { Express } from "express";
import { setupAuth, isAuthenticated, requireOrgContext, requireOrgScope, requireCustomerOrgScope } from "./auth";
import { registerChannelAuthenticatedRoutes } from "./routes/channels";
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
import { registerUiSeenRoutes } from "./routes/uiSeen";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerProductRoutes } from "./routes/products";
import { registerPriceExceptionRoutes } from "./routes/priceExceptions";
import { registerCustomerRoutes } from "./routes/customers";
import { registerOrderRoutes } from "./routes/orders";
import { registerOrderTransitionRoutes } from "./routes/orderTransitions";
import { registerOperationsRoutes } from "./routes/operations";
import { registerOpsAlertRoutes } from "./routes/opsAlerts";
import { registerOpsStreamRoutes } from "./routes/opsStream";
import { registerInventoryRoutes } from "./routes/inventory";
import { registerReportRoutes } from "./routes/reports";
import { registerReportCaptureRoutes } from "./routes/reportCapture";
import { registerLocationRoutes } from "./routes/locations";
import { registerLoyaltyRoutes } from "./routes/loyalty";
import { registerPromotionRoutes } from "./routes/promotions";
import { registerExpenseRoutes } from "./routes/expenses";
import { registerInvoiceRoutes } from "./routes/invoices";
import { registerTickCustomerRoutes } from "./routes/tickCustomers";
import { registerCreditRoutes } from "./routes/credit";
import { registerSettingsOrgRoutes } from "./routes/settingsOrg";
import { registerAdminRoutes } from "./routes/admin";
import { registerWorkerAdminRoutes } from "./routes/workers";
import { registerReceiptRoutes } from "./routes/receipts";
import { registerShiftRoutes } from "./routes/shifts";
import { registerCashierRoutes } from "./routes/cashiers";
import { registerCashierAnalyticsRoutes } from "./routes/cashierAnalytics";
import { registerRefundRoutes } from "./routes/refunds";
import { registerSaleIssueRoutes } from "./routes/saleIssues";
import { registerGiftCardRoutes } from "./routes/giftCards";
import { registerSavedViewRoutes } from "./routes/savedViews";
import { registerTruthsLayoutRoutes } from "./routes/truthsLayout";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerV1Routes } from "./routes/v1";
import { registerWhatsappPublicRoutes, registerWhatsappRoutes } from "./routes/whatsapp";
import { registerAssistantRoutes } from "./routes/assistant";
import { registerWebsitePublicRoutes, registerWebsiteAdminRoutes } from "./routes/website";
import { registerPrivacyNoticeRoutes } from "./routes/privacyNotice";

export async function registerRoutes(app: Express): Promise<void> {
  registerHealthRoutes(app);
  registerV1Routes(app);
  registerWhatsappPublicRoutes(app);
  // Readable signed out: shop customers see it before signing in / ordering.
  registerPrivacyNoticeRoutes(app);

  await setupAuth(app);

  registerAuthRoutes(app);
  registerUiSeenRoutes(app);

  const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
  // Shop accounts (CUSTOMER) are refused by requireOrgScope; these four shop
  // routes are the only org-scoped ones they may call.
  const websiteCustomerScoped = [isAuthenticated, requireOrgContext, requireCustomerOrgScope];
  registerWebsitePublicRoutes(app, websiteCustomerScoped);

  registerChannelAuthenticatedRoutes(app, scoped);
  registerAnalyticsRoutes(app, scoped);
  registerProductRoutes(app, scoped);
  registerPriceExceptionRoutes(app, scoped);

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
  registerSaleIssueRoutes(app, scoped);
  registerOrderTransitionRoutes(app, scoped);
  registerOperationsRoutes(app, scoped);
  registerOpsAlertRoutes(app, scoped);
  registerOpsStreamRoutes(app, scoped);
  registerShiftRoutes(app, scoped);
  registerCashierRoutes(app, scoped);
  registerCashierAnalyticsRoutes(app, scoped);
  registerRefundRoutes(app, scoped);
  registerGiftCardRoutes(app, scoped);
  registerSavedViewRoutes(app, scoped);
  registerTruthsLayoutRoutes(app, scoped);
  registerOnboardingRoutes(app, scoped);
  registerWhatsappRoutes(app, scoped);
  registerAssistantRoutes(app, scoped);
  registerInventoryRoutes(app, scoped);
  registerReportRoutes(app, scoped);
  registerReportCaptureRoutes(app, scoped);
  registerLocationRoutes(app, scoped);
  registerLoyaltyRoutes(app, scoped);
  registerPromotionRoutes(app, scoped);
  registerExpenseRoutes(app, scoped);
  registerInvoiceRoutes(app, scoped);
  registerTickCustomerRoutes(app, scoped);
  registerCreditRoutes(app, scoped);
  registerSettingsOrgRoutes(app, scoped);
  registerReceiptRoutes(app, scoped);
  registerFeatureFlagRoutes(app, scoped);
  registerWebsiteAdminRoutes(app, scoped);

  registerAdminRoutes(app);
  registerWorkerAdminRoutes(app);
}
