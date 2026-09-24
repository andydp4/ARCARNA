/**
 * Every fixed word in the server's /api route paths (v1.2 Phase 8 review).
 *
 * The usage record keeps a call as its route shape. A path segment is kept
 * only when it is one of these words; anything else (a gift card code, a typed
 * SKU, a search) becomes `:value`, so nothing staff type is ever stored.
 * `shared/usage.spec.ts` reads the server's route files and fails when a
 * route word is missing here, so a new route only needs its word added.
 */
export const API_ROUTE_WORDS: ReadonlySet<string> = new Set([
  "ack", "ack-all", "activity", "admin", "alerts", "aliases", "allowed-users", "analytics",
  "answer", "api-keys", "apply", "approval-status", "approve", "ask", "assistant", "attach-order",
  "audit-logs", "auth", "blocks", "board", "bootstrap", "bulk", "business-health", "by-barcode",
  "by-reference", "callback", "cashier-analytics", "cashier-commission", "cashier-shifts",
  "cashiers", "channels", "checks", "close", "complete", "complete-first-sale", "config",
  "control-centre", "conversations", "create-customer", "create-draft-order",
  "create-purchase-draft", "create-purchase-drafts", "create-transfer-draft", "credit", "current",
  "customers", "daily-revenue", "dead-letters", "delivery-fee", "discard", "dismiss", "duplicate", "edit-preview",
  "end", "events", "evidence", "executions", "expense-analytics", "expense-report", "expenses",
  "export", "exports", "failed", "feature-flags", "for-order", "friction-truths", "gift-cards",
  "goods-receipts", "health", "history", "hour-of-day", "import", "imports", "intelligence",
  "intents", "inventory", "invoices", "items", "job-queue", "layout", "lift", "link-customer",
  "locations", "log", "login", "logout", "loyalty", "loyalty-tiers", "managers", "mark-paid", "me",
  "metadata", "metrics", "min-price", "mine", "monthly-summary", "needs-a-look", "notifications",
  "onboarding", "open", "operations", "order-settings", "orders", "org", "org-notifications",
  "orgs", "outstanding", "overhead-expenses", "payments", "pdf", "pending-approvals", "preview",
  "preview-role", "preview-rows", "price-exceptions", "price-guard", "price-history",
  "price-overrides", "privacy-notice", "problem-reports", "product-suppliers", "products",
  "profit-analysis", "promotions", "public", "purchase-drafts", "read", "read-all", "receipts",
  "receiving", "recommendations", "recompute", "redeem-preview", "refund", "refunds", "reject",
  "reopen", "replenishment", "reply", "report", "reports", "reseller-partners",
  "reseller-transactions", "resolve", "retry", "review", "review-rules", "revoke", "rfm", "rules",
  "runs", "runtime", "sale-issues", "satisfaction", "saved-views", "scheduled-reports", "seen",
  "send-template", "set-default", "settings", "setup", "shifts", "sign-out-override",
  "site-config", "smart-stock", "staff", "station", "status", "step", "stock", "stock-levels",
  "stock-turn", "stream", "study-window", "summary", "suppliers", "sync", "templates", "test",
  "test-event", "theme", "tick-customers", "top-customers", "top-sellers", "transfers",
  "transition", "truths", "turn", "unsubscribe", "uploads", "usage", "user", "validate", "void",
  "webhook", "webhooks", "website", "whatsapp", "wm-supplies", "worker-logs", "worker-stats",
  "would-have-flagged", "write-off",
  // Stripe links and Phase 5 routes, merged after Phase 8 was built.
  "stripe", "card-links", "paid", "till", "cancel", "retender", "lookup-phone", "possible-duplicates", "replace-phone", "saved-address", "phone-search", "search", "customer-phone", "delivery",
  // Phase 6, Phase 7 and My run routes, merged after Phase 8 was built.
  "access-history", "contact-access", "contact-requests", "couldnt-deliver", "customer-access-log", "digest", "email", "message", "messaging", "my-performance", "my-run", "order", "order-timing", "reveal", "staff-performance", "staff-targets",
]);
