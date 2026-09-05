import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, FileBarChart } from "lucide-react";
import { CONTROL_CENTRE_QUERY_KEY, type ControlCentreSnapshot } from "@/lib/controlCentre";
import { REPORT_CATALOG } from "@/lib/reportCatalog";

/**
 * Two or three links into Evidence, picked by what is actually happening
 * today rather than a fixed shortlist — a shop with low stock is pointed at
 * the report that explains it, one without is pointed at the weekly trend
 * instead. Always resolved against REPORT_CATALOG so a report renamed or
 * moved there does not silently break a hardcoded link here.
 */

function reportByRef(title: string) {
  return REPORT_CATALOG.find((r) => r.title === title);
}

export function BestReports() {
  const { data } = useQuery<ControlCentreSnapshot>({
    queryKey: CONTROL_CENTRE_QUERY_KEY,
    refetchInterval: 60_000,
  });

  const picks = [reportByRef("Daily Sales Summary")];

  if (data && (data.lowStockCount > 0 || data.highRiskStockCount > 0)) {
    picks.push(reportByRef("Stock Runway & Demand Forecast"));
  } else {
    picks.push(reportByRef("Weekly Sales Summary"));
  }

  if (data && data.creditOutstandingTotal > 0) {
    picks.push(reportByRef("Reseller Credit & Payment Report"));
  } else {
    picks.push(reportByRef("Customer Lifetime Value (CLV) Report"));
  }

  const links = picks.filter((r): r is NonNullable<typeof r> => !!r && r.status === "available");

  if (links.length === 0) return null;

  return (
    <section className="lm-card rounded-xl p-5 sm:p-6" data-testid="best-reports">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-metal-warm-white">
          <FileBarChart className="h-4 w-4 text-metal-stainless" aria-hidden />
          Worth a look
        </h2>
        <Link href="/reports" className="text-sm text-truth hover:underline">
          All evidence
        </Link>
      </div>
      <ul className="space-y-2">
        {links.map((report) => (
          <li key={report.ref}>
            <Link
              href={report.route}
              className="group flex items-center justify-between gap-2 text-sm text-metal-warm-white transition-colors hover:text-truth-bright"
            >
              <span className="underline-offset-4 group-hover:underline">{report.title}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
