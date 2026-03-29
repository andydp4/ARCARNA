# PR5: Reporting Screens Cleanup

**Scope:** Reporting and analytics **client** screens only. No backend, new routes, schema, or RBAC changes.

## Files changed

| File | Summary |
|------|---------|
| `client/src/pages/insights.tsx` | Report period card: labels (quick range, from/to, export format), clearer copy, mobile-friendly layout; summary KPI cards; period caption; tabs spacing; chart min-heights; section headings; `tabular-nums` + bordered tables; per-tab export buttons as outline “Export this tab” |
| `client/src/pages/expense-reports.tsx` | Header + period card copy; tab list full-width on narrow screens; **bottom-line** net-profit hero; grouped revenue / gross / operating cards; separators; overhead vs order expense grouping and descriptions; cost-structure walkthrough styling; chart wrappers; CSV export guard + toast; export button label |
| `client/src/pages/invoices.tsx` | **Date window filter** wired (`useMemo` + `date-fns`); summary cards copy + `tabular-nums`; filter row layout; **PDF** column uses dropdown with labeled actions (open, print, copy link, draft email); destructive-styled bulk PDF generation; table in bordered scroll; clearer dates/total column |
| `client/src/components/analytics-dashboard.tsx` | Intro copy + link to Business Insights; `Separator` before metrics; wider chart gutter |
| `client/src/components/metric-card.tsx` | `tabular-nums` + tracking on main value |
| `client/src/components/daily-revenue-chart.tsx` | `CardDescription`; non-interactive period chips (was inert buttons); responsive chart height |
| `client/src/components/monthly-orders-chart.tsx` | Same pattern as daily chart |
| `client/src/components/top-customers-table.tsx` | `tabular-nums` on numeric columns; responsive header; clearer subtitle |

`client/src/pages/analytics.tsx` unchanged (still renders `AnalyticsDashboard`).

## Analytics / insights

- Dashboard: explains API-sourced metrics and points to **Business Insights** for custom ranges and exports.
- Insights: date controls labeled; export flow explicit; KPIs and tables easier to scan; less cramped charts on small viewports.

## Expense / profit

- Plain-language distinction: **overhead** vs **order expenses**; combined total called out.
- Net profit highlighted at top of profit tab; margins tab keeps progress bars with tighter copy.

## Invoices

- Period filter now affects the list and summary (client-side only).
- PDF actions are one menu with clear labels; bulk PDF regen visually separated.

## Acceptance

- [x] Easier to scan; key numbers use tabular figures where it helps  
- [x] Filters / date controls clearer  
- [x] No API contract changes  
- [x] `npm run check` green  
- [x] `npm run gate` green (check-only without `DATABASE_URL`)

## Screenshots / GIFs

_Add:_ Analytics dashboard header + charts; Insights period + one tab; Expense reports profit + expense tabs; Invoices filters + PDF dropdown.

## Blockers

None.

## Next

- **Hygiene PR** — remove duplicate nested `client/client/` if unused.
