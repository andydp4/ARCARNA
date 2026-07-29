# Proposed sidebar structure — 6 groups (R-P0-04)

**For review before it lands.** Built from the approved table in
`docs/specs/ARCARNA_LANGUAGE_SPECIFICATION.md` §3, cross-checked against every
route actually registered in `client/src/App.tsx`.

Legend: **bold** = label changes from what's on screen today · 🆕 = new route with
no spec row yet (my placement, needs your nod) · ⚠️ = decision needed

---

## 1 · Control Centre

| Route | Today | Proposed |
|---|---|---|
| `/` | Dashboard | **Control Centre** |

## 2 · Sell

| Route | Today | Proposed |
|---|---|---|
| `/create-order` | Create Order | Create Order |
| `/open-orders` | Open Orders | Open Orders |
| `/shifts` | Shifts | Shifts |
| `/invoices` | Invoices | Invoices |
| `/tick-list` | Tick List | Tick List |
| `/gift-cards` | Gift cards | **Gift Cards** — ⚠️ spec puts this in *Operate*; it reads as a Sell action to me. Your call. |

## 3 · Stock

| Route | Today | Proposed |
|---|---|---|
| `/products` | Products | Products |
| `/inventory` | Inventory | Inventory |
| `/purchase-drafts` | Purchase Drafts | Purchase Drafts |

## 4 · Understand

| Route | Today | Proposed |
|---|---|---|
| `/insights` | Business Insights | **Truths** ⚠️ *(see decision 1)* |
| `/reports` | — | 🆕 **Reports** — the 15-report hub built this week |
| `/analytics/rfm` | RFM Segments | **Customer Segments (RFM)** |
| `/analytics/hour-of-day` | Hour of day | **Busiest Hours** |
| `/analytics/channels` | Channels | **Order Channels** |
| `/analytics/stock-turn` | Stock turn | **Stock Turn** |
| `/expense-reports` | Profit Analysis | Profit Analysis |
| `/scheduled-reports` | Scheduled reports | **Scheduled Evidence** ⚠️ *(see decision 2)* |

## 5 · Operate

| Route | Today | Proposed |
|---|---|---|
| `/customers` | Customers | Customers |
| `/loyalty` | Loyalty | Loyalty |
| `/promotions` | Promotions | Promotions |
| `/locations` | Locations | Locations |
| `/expenses` | Expenses | Expenses |
| `/reseller-partners` | — | 🆕 **Reseller Partners** — capture screen for the reseller report |
| `/cashier-payroll` | Cashier Payroll | 🆕 Cashier Payroll — no spec row; Operate fits |

## 6 · Administer

| Route | Today | Proposed |
|---|---|---|
| `/settings` | Settings | Settings |
| `/user-access` | User Access | User Access |
| `/settings/developer` | Developer | Developer |
| `/audit-logs` | — | **Audit Log** |
| `/worker-logs` | — | **System Activity** |
| `/rules` | — | Rules |

---

## Decisions I need from you

**1 · "Truths" vs "Truths Hub"** — the spec §3 says the `/insights` label is
**Truths**. The `vocabulary.ts` we shipped earlier uses **Truths Hub**, and that
string is already live on the page header and in the command palette. They must
agree. Which wins?

**2 · "Scheduled Evidence"** — the spec is firm that the noun is *Evidence, not
report*. But this sits directly above a group item literally called **Reports**,
which may read as two names for one idea. Options: keep both as specced, rename
to "Scheduled Reports" for plainness, or move the Reports hub up next to Truths.

**3 · Gift Cards placement** — spec says Operate, I've drafted it under Sell.

**4 · Group count** — Understand has 8 items and Operate 7. If the sidebar feels
long, the honest fix is fewer top-level entries, not smaller text. Worth a look
on a real screen before we commit.

## Not in the sidebar (deliberately)

`/reports/*` (15 report pages — reached from the hub) · `/settings/receipts`,
`/settings/loyalty` (sub-pages of Settings) · `/sign-in`, `/sign-out`,
`/onboarding*`, `/setup-wizard`, `/setup-blocked`, `/no-access`,
`/pending-approval` (flow routes) · `/pos`, `/orders`, `/analytics` (redirects).

## What this changes for your staff

Every nav item moves group. Muscle memory breaks for one shift. The routes
themselves are unchanged, so bookmarks and deep links keep working — this is
copy and grouping only.
