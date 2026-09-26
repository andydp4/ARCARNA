// One entry per <!-- SHOT: ... --> in sections/*.html (v1.2 manual).
// capture.mjs runs the entries for one role at a time.
//
// Demo data: fictional only. Staff Sam Carter (seed-cashier), Tom Hughes
// (seed-cashier-2), Jordan Lee (seed-manager), Alex Morgan (seed-admin);
// customers such as Priya Shah with 07700 900xxx numbers and
// @example.invalid emails; a dozen products; about two weeks of orders.
// Tours and What's New are marked seen for these users before capturing,
// except where a shot is of a tour.

const scrollTo = async (page, text) => {
  const loc = page.getByText(text, { exact: false }).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 10000 });
  await page.waitForTimeout(300);
  return loc;
};

/** Scroll the nearest scrolling ancestor so `text` sits `offset` px from the top of the viewport. */
const bringToTop = async (page, text, offset = 90) => {
  const loc = page.getByText(text, { exact: false }).first();
  await loc.waitFor({ timeout: 10000 });
  await loc.evaluate((el, offset) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) break;
      p = p.parentElement;
    }
    const target = p && p !== document.body ? p : document.scrollingElement;
    const top = el.getBoundingClientRect().top;
    const base = target === document.scrollingElement ? 0 : target.getBoundingClientRect().top;
    target.scrollTop += top - base - offset;
  }, offset);
  await page.waitForTimeout(400);
};

const choose = async (page, trigger, option) => {
  await page.locator(trigger).first().click({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.getByRole("option", option instanceof RegExp ? { name: option } : { name: option, exact: true }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
};

/** The row's edit pencil for a product, by name. */
const editProduct = async (page, name) => {
  const row = page.locator("tr", { hasText: name }).first();
  await row.locator('[data-testid^="button-edit-"]').first().click({ timeout: 10000 });
  await page.waitForTimeout(1200);
};

/** Add a product to the New order pane by typing its name and picking it. */
const addProduct = async (page, name, qty = 1) => {
  const input = page.getByPlaceholder("Add a product: code, name or barcode…").first();
  await input.click();
  await input.fill(name);
  await page.waitForTimeout(700);
  await page.locator('[data-testid$="-results"] [data-testid*="-option-"]', { hasText: name }).first().click({ timeout: 10000 });
  await page.waitForTimeout(500);
  if (qty > 1) {
    const idx = (await page.locator('[data-testid^="line-name-"]').count()) - 1;
    await page.locator(`[data-testid="line-qty-${idx}"]`).fill(String(qty));
  }
  await page.waitForTimeout(300);
};

const pickCustomer = async (page, name) => {
  await page.locator('[data-testid="select-customer"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="search-customer"]').first().fill(name);
  await page.waitForTimeout(900);
  await page.getByText(name, { exact: false }).last().click();
  await page.waitForTimeout(600);
};

const toPayment = async (page) => {
  await page.getByRole("button", { name: /Continue to payment/ }).first().click();
  await page.waitForTimeout(1200);
};

/** Open the details sheet from the View button on the board card for `who`. */
const viewCard = async (page, who) => {
  const card = page.locator(`[aria-label^="Order "][aria-label*="${who}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: "View", exact: true }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
};

const openProblem = async (page) => {
  await page.evaluate(() => window.dispatchEvent(new Event("arcarna:problem-open")));
  await page.waitForTimeout(800);
};

export const shots = [
  // -------------------------------------------------------------- cashier
  { name: "v12-01-control-centre.png", role: "cashier", viewport: "desktop", route: "/", waitMs: 2500 },
  {
    name: "v12-01-centres-main-menu.png", role: "cashier", viewport: "desktop", route: "/",
    setup: async (page) => {
      const rail = page.locator('[data-testid="sidebar"]').first();
      const box = await rail.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 300);
      await page.waitForTimeout(1200);
      const back = page.locator('[data-testid="nav-main-menu"]');
      if (await back.isVisible().catch(() => false)) { await back.click(); await page.waitForTimeout(600); }
      const b2 = await rail.boundingBox();
      await page.mouse.move(b2.x + 60, b2.y + 320);
      await page.waitForTimeout(800);
    },
  },
  {
    name: "v12-01-centre-menu-pinned.png", role: "cashier", viewport: "desktop", route: "/my-performance",
    localStorage: { "arcarna.sidebar.pinned": "1" }, waitMs: 2500,
  },
  { name: "v12-01-centre-tour.png", role: "cashier", viewport: "desktop", route: "/shifts", waitMs: 3000 },
  {
    name: "v12-01-problem-sheet.png", role: "cashier", viewport: "phone", route: "/operations",
    localStorage: { "arcarna.device.name": "Phone 1" },
    setup: async (page, h) => {
      await openProblem(page);
      await h.click('[data-testid="problem-chip-too_slow"]');
    },
  },
  { name: "v12-02-ops-shift-strip.png", role: "cashier", viewport: "desktop", route: "/operations?pane=order" },
  {
    name: "v12-02-close-shift-count.png", role: "cashier", viewport: "desktop", route: "/operations",
    setup: async (page, h) => {
      await h.click('[data-testid="button-close-shift"]', { after: 900 });
      const panel = page.locator('[data-testid="shift-close-panel"]');
      const box = async (label, v) => {
        const row = panel.locator("div.flex", { has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) }).first();
        await row.locator("input").fill(String(v));
      };
      await box("£20", 3); await box("£10", 4); await box("£1", 6);
      await panel.scrollIntoViewIfNeeded();
    },
  },
  {
    name: "v12-02-z-report.png", role: "cashier", viewport: "desktop", route: "/shifts", height: 1300,
    setup: async (page) => {
      const row = page.locator('[data-testid^="shift-row-"]', { hasText: "short" }).first();
      await row.getByRole("button", { name: /Z-report/ }).first().click({ timeout: 10000 });
      await page.waitForTimeout(1500);
    },
  },
  { name: "v12-02-shifts-page.png", role: "cashier", viewport: "desktop", route: "/shifts" },
  {
    name: "v12-02-my-performance.png", role: "cashier", viewport: "desktop", route: "/my-performance",
    setup: async (page) => { await choose(page, '[data-testid="select-my-performance-preset"]', "This week"); },
  },
  {
    name: "v12-03-till-desktop.png", role: "cashier", viewport: "desktop", route: "/operations?pane=order", height: 1150,
    setup: async (page) => {
      await addProduct(page, "Latte");
      await addProduct(page, "Croissant");
      await addProduct(page, "Granola 500g");
    },
  },
  {
    name: "v12-03-customer-picker.png", role: "cashier", viewport: "desktop", route: "/operations?pane=order", height: 1150,
    setup: async (page) => {
      await addProduct(page, "Latte");
      await page.locator('[data-testid="select-customer"]').first().click();
      await page.waitForTimeout(900);
    },
  },
  {
    name: "v12-03-pay-split.png", role: "cashier", viewport: "desktop", route: "/operations?pane=order", height: 1300,
    setup: async (page, h) => {
      await addProduct(page, "Olive oil 500ml", 5);
      await addProduct(page, "Smoked salmon 100g", 2);
      await addProduct(page, "Granola 500g");
      await pickCustomer(page, "Priya Shah");
      await toPayment(page);
      await h.click('[data-testid="switch-split-payment"]');
      await choose(page, '[data-testid="select-tender-method-0"]', "Cash").catch(() => {});
      await page.locator('[data-testid="input-tender-amount-0"]').fill("30.00");
      await choose(page, '[data-testid="select-tender-method-1"]', "On credit").catch(() => {});
      const rest = await page.locator('[data-testid="input-tender-amount-1"]').inputValue().catch(() => "");
      if (!rest) {
        const total = Number((await page.locator('[data-testid="checkout-total"]').first().innerText()).replace(/[^0-9.]/g, ""));
        await page.locator('[data-testid="input-tender-amount-1"]').fill((total - 30).toFixed(2));
      }
      await page.waitForTimeout(500);
    },
  },
  {
    name: "v12-03-price-guard.png", role: "cashier", viewport: "desktop", route: "/operations?pane=order",
    setup: async (page, h) => {
      await addProduct(page, "Oat milk 1L");
      await page.locator('[data-testid="line-price-0"]').fill("4.00");
      await page.waitForTimeout(400);
      await toPayment(page);
      await h.click(page.getByText("Price match", { exact: true }));
    },
  },
  {
    name: "v12-03-card-link.png", role: "cashier", viewport: "desktop", route: "/operations?pane=order",
    // Card (link) is shown without Stripe: the till's calls for it are answered
    // in the browser with a placeholder link, so nothing reaches Stripe and no
    // sale is recorded. The dialog itself is the app's own.
    routes: async (context) => {
      const expires = () => new Date(Date.now() + 30 * 60_000 - 5_000).toISOString();
      const view = () => ({
        orderId: "demo-card-link",
        leg: { id: "demo-leg", amount: 9.8, status: "pending", method: "card_link" },
        link: { id: "demo-link", status: "open", url: "https://pay.example.invalid/c/demo-card-link", amount: 9.8, currency: "gbp", expiresAt: expires() },
      });
      await context.route(/\/api\/card-links\/till/, (r) => r.fulfill({ json: { enabled: true, whatsapp: false } }));
      await context.route(/\/api\/card-links\/demo-card-link/, (r) => r.fulfill({ json: view() }));
      await context.route(/\/api\/orders(\?.*)?$/, (r) => {
        if (r.request().method() !== "POST") return r.continue();
        return r.fulfill({ status: 201, json: { orderId: "demo-card-link", warnings: [], order: { id: "demo-card-link", status: "pending", total: "9.80", paymentMethod: "card_link" } } });
      });
    },
    setup: async (page, h) => {
      await addProduct(page, "Latte", 2);
      await addProduct(page, "Croissant");
      await toPayment(page);
      await h.click('[data-testid="payment-method-card_link"]');
      await h.click('[data-testid="button-confirm-payment"]', { after: 2500 });
    },
  },
  { name: "v12-04-board.png", role: "cashier", viewport: "desktop", route: "/operations", height: 1100 },
  {
    name: "v12-04-details.png", role: "cashier", viewport: "desktop", route: "/operations", height: 1150,
    setup: async (page) => { await viewCard(page, "Emma Clarke"); },
  },
  {
    name: "v12-04-refund.png", role: "cashier", viewport: "desktop", route: "/open-orders/{S1}/refund",
    setup: async (page) => {
      await page.getByRole("checkbox").first().click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: "v12-04-label.png", role: "cashier", viewport: "desktop", route: "/operations", height: 1150,
    setup: async (page, h) => {
      await viewCard(page, "Grace Kim");
      await h.click(page.getByRole("button", { name: "Print label" }), { after: 1500 });
      await page.locator('[data-testid="label-preview"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(500);
    },
  },
  {
    name: "v12-05-delivery-address.png", role: "cashier", viewport: "desktop", route: "/operations?pane=order", height: 1350,
    setup: async (page, h) => {
      await addProduct(page, "Olive oil 500ml");
      await addProduct(page, "Free-range eggs (6)");
      await pickCustomer(page, "Priya Shah");
      await toPayment(page);
      await h.click('[data-testid="select-fulfilment-delivery"]');
      await page.locator('[data-testid="input-delivery-address"]').fill("14 Elm Road, Flat 2");
      await page.locator('[data-testid="input-delivery-postcode"]').fill("LS6 1AA");
      await page.locator('[data-testid="input-delivery-notes"]').fill("Side door, ring twice");
      await h.click('[data-testid="chip-due-45"]').catch(() => {});
      await bringToTop(page, "Fulfilment", 80).catch(() => {});
    },
  },
  {
    name: "v12-05-my-run.png", role: "cashier", viewport: "phone", route: "/my-run", fullPage: true,
    setup: async (page) => {
      const boxes = page.locator('[data-testid^="checkbox-run-stop-"]');
      await boxes.nth(0).click(); await boxes.nth(1).click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "v12-05-couldnt-deliver.png", role: "cashier", viewport: "phone", route: "/my-run", fullPage: true,
    setup: async (page, h) => {
      // Start the run first (both stops out for delivery), as the driver would.
      if (!(await page.locator('[data-testid^="button-couldnt-deliver-"]').count())) {
        await h.click('[data-testid="button-select-all-ready"]');
        await h.click('[data-testid="button-start-run"]', { after: 2500 });
      }
      await h.click(page.locator('[data-testid^="button-couldnt-deliver-"]').first());
      await h.click('[data-testid="chip-reason-no_answer"]');
      await page.locator('[data-testid^="form-couldnt-deliver-"] textarea, [data-testid^="form-couldnt-deliver-"] input[type="text"]').first().fill("Rang twice, no lights on");
      await page.waitForTimeout(400);
    },
  },
  { name: "v12-06-stock-levels.png", role: "cashier", viewport: "desktop", route: "/stock-levels", height: 1150 },
  {
    name: "v12-07-till-phone-lookup.png", role: "cashier", viewport: "phone", route: "/operations?pane=order",
    setup: async (page) => {
      await page.locator('[data-testid="select-customer"]').first().click();
      await page.waitForTimeout(500);
      await page.locator('[data-testid="search-customer"]').first().fill("07700 900123");
      await page.waitForTimeout(2000);
      await page.locator('[data-testid="search-customer"]').first().evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(500);
    },
  },
  {
    name: "v12-10-ask-panel.png", role: "cashier", viewport: "desktop", route: "/my-performance",
    // The panel only: at page width the dimmed page beside it says nothing.
    clip: { x: 1440 - 640, y: 0, width: 640, height: 900 },
    setup: async (page) => {
      await page.getByRole("button", { name: "Ask arcarna" }).first().click();
      await page.waitForTimeout(1200);
    },
  },
  // -------------------------------------------------------------- manager
  {
    name: "v12-05-manager-whose-run.png", role: "manager", viewport: "desktop", route: "/my-run",
    setup: async (page) => {
      await page.locator('[data-testid="select-run-driver"]').selectOption({ label: "Sam Carter" });
      await page.waitForTimeout(1800);
    },
  },
  { name: "v12-06-products.png", role: "manager", viewport: "desktop", route: "/products", height: 1250 },
  {
    name: "v12-06-edit-product-min.png", role: "manager", viewport: "desktop", route: "/products", height: 1150,
    setup: async (page) => { await editProduct(page, "Oat milk 1L"); },
  },
  {
    name: "v12-06-price-history.png", role: "manager", viewport: "desktop", route: "/products",
    setup: async (page, h) => { await editProduct(page, "Oat milk 1L"); await h.click('[data-testid="tab-price-history"]', { after: 1200 }); },
  },
  {
    name: "v12-06-suppliers.png", role: "manager", viewport: "desktop", route: "/suppliers", height: 1250,
  },
  { name: "v12-07-customers-list.png", role: "manager", viewport: "desktop", route: "/customers", height: 1250 },
  {
    name: "v12-07-contact-dialog.png", role: "manager", viewport: "desktop", route: "/customers", height: 1000,
    setup: async (page, h) => {
      const row = page.locator('[data-testid^="row-customer-"], [data-testid^="customer-row-"], tr', { hasText: "Priya Shah" }).first();
      await row.locator('[data-testid^="button-contact-"]').first().click({ timeout: 10000 });
      await page.waitForTimeout(1200);
      await choose(page, '[data-testid="select-customer-message"]', /^Payment reminder/);
      await choose(page, '[data-testid="select-contact-reason"]', "Delivery problem");
      await page.locator('[data-testid="input-contact-note"]').fill("Driver could not find the flat on Tuesday; need to check the number.");
      if (!(await page.locator('[data-testid="checkbox-field-phone"]').getAttribute("data-state"))?.includes("checked")) await h.click('[data-testid="checkbox-field-phone"]');
      await bringToTop(page, "Message the customer instead", 20);
    },
  },
  { name: "v12-07-loyalty-tiers.png", role: "manager", viewport: "desktop", route: "/loyalty" },
  { name: "v12-08-credit-list.png", role: "manager", viewport: "desktop", route: "/tick-list" },
  {
    name: "v12-08-record-payment.png", role: "manager", viewport: "desktop", route: "/tick-list",
    setup: async (page, h) => {
      const row = page.locator("tr", { hasText: "Priya Shah" }).first();
      await row.locator('[data-testid^="button-payment-"]').first().click({ timeout: 10000 });
      await page.waitForTimeout(1000);
      await page.locator('[data-testid="input-tick-payment-amount"]').fill("20.00");
      await choose(page, '[data-testid="select-tick-payment-method"]', "Cash");
      await page.waitForTimeout(300);
    },
  },
  {
    name: "v12-08-invoices.png", role: "manager", viewport: "desktop", route: "/invoices",
    setup: async (page, h) => { await h.click(page.locator('[data-testid^="button-pdf-menu-"]').first(), { after: 800 }); },
  },
  { name: "v12-08-cashier-payroll.png", role: "manager", viewport: "desktop", route: "/cashier-payroll" },
  { name: "v12-09-truths-at-a-glance.png", role: "manager", viewport: "desktop", route: "/truths", waitMs: 3000 },
  { name: "v12-09-evidence-hub.png", role: "manager", viewport: "desktop", route: "/reports" },
  { name: "v12-09-needs-a-look.png", role: "manager", viewport: "desktop", route: "/needs-a-look" },
  {
    name: "v12-09-staff-performance.png", role: "manager", viewport: "desktop", route: "/reports/staff-performance", height: 1400,
    setup: async (page) => { await choose(page, '[data-testid="select-performance-preset"]', "Last 4 weeks"); },
  },
  {
    name: "v12-04-order-timing.png", role: "manager", viewport: "desktop", route: "/reports/order-timing",
    setup: async (page) => { await choose(page, '[data-testid="select-timing-preset"]', "Last 4 weeks"); },
  },

  // ---------------------------------------------------------------- admin
  {
    name: "v12-11-user-access.png", role: "admin", viewport: "desktop", route: "/user-access",
    setup: async (page, h) => { await h.click('[data-testid="tab-allowed"]', { after: 1200 }); },
  },
  {
    name: "v12-11-preview-as-cashier.png", role: "admin", viewport: "desktop", route: "/",
    setup: async (page, h) => {
      await h.click('[data-testid="button-preview-role"]');
      await h.click('[data-testid="menu-preview-cashier"]', { after: 2500 });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "v12-11-price-guard.png", role: "admin", viewport: "desktop", route: "/settings?tab=general",
    setup: async (page) => { await bringToTop(page, "Price guard at the till", 110); },
  },
  {
    name: "v12-11-stripe-card-link.png", role: "admin", viewport: "desktop", route: "/settings?tab=payment",
    setup: async (page) => { await bringToTop(page, "Card (link) with Stripe", 110); },
  },
  { name: "v12-11-problem-inbox.png", role: "admin", viewport: "desktop", route: "/problems" },
  { name: "v12-09-would-have-flagged.png", role: "admin", viewport: "desktop", route: "/reports/would-have-flagged" },
  {
    name: "v12-10-ask-settings.png", role: "admin", viewport: "desktop", route: "/settings?tab=integrations",
    setup: async (page, h) => {
      await h.click(page.locator("summary", { hasText: "Recent questions" }));
      await bringToTop(page, "Ask arcarna", 110);
    },
  },
  { name: "v12-07-contact-approve.png", role: "admin", viewport: "desktop", route: "/needs-a-look" },
];
