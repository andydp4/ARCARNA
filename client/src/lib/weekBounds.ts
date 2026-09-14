import { isoDate } from "@/lib/reportBrand";

/**
 * ARC-045: five different places on the client each hand-rolled the same
 * Monday-start week calculation (daily-sales/weekly-sales/weekly-margin/
 * staff-kpi/satisfaction report pages) — except Profit Truths
 * (`expense-reports.tsx`), which used `now.getDate() - now.getDay()`, landing
 * on SUNDAY instead. Same org, same week, two different "week" boundaries
 * depending which page you were on. One shared helper, Monday-start, used
 * everywhere a "week of" control exists.
 */
export function mondayWeekBounds(d: Date): { from: string; to: string } {
  const start = new Date(d);
  const day = (start.getDay() + 6) % 7; // days since Monday (0 = Monday)
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: isoDate(start), to: isoDate(end) };
}
