/**
 * Reports hub — all Arcarna exportable reports (ARC-RPT-SPEC-001), grouped by
 * tier. Each card links to the branded report view, which exports to
 * PNG / JPEG / PDF / CSV.
 */
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileBarChart, ArrowRight } from "lucide-react";
import { REPORT_CATALOG, TIER_LABEL, type ReportTier } from "@/lib/reportCatalog";

const TIERS: ReportTier[] = [1, 2, 3, 4];

export default function ReportsHub() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="Reports"
        question="Which report do you need right now?"
        explanation="Every report follows the Arcarna brand on screen and when exported to PNG, JPEG, PDF or CSV."
        icon={FileBarChart}
      />

      <div className="mt-6 space-y-8">
        {TIERS.map((tier) => {
          const reports = REPORT_CATALOG.filter((r) => r.tier === tier);
          return (
            <section key={tier}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {TIER_LABEL[tier]}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {reports.map((r) => {
                  const card = (
                    <Card
                      className={`lm-card group h-full border-0 shadow-none transition ${
                        r.status === "available"
                          ? "cursor-pointer hover:ring-1 hover:ring-primary/40"
                          : "opacity-70"
                      }`}
                    >
                      <CardContent className="flex h-full flex-col p-4">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {r.ref}
                          </Badge>
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {r.frequency}
                          </span>
                        </div>
                        <h3 className="mt-2 flex items-center gap-1 text-base font-semibold text-foreground">
                          {r.title}
                          {r.status === "available" ? (
                            <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                          ) : (
                            <Badge variant="secondary" className="ml-1 text-[9px]">
                              Coming soon
                            </Badge>
                          )}
                        </h3>
                        <p className="mt-1 flex-1 text-xs leading-snug text-muted-foreground">{r.purpose}</p>
                        <div className="mt-3 flex flex-wrap gap-1">
                          {r.formats.map((f) => (
                            <span
                              key={f}
                              className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                  return r.status === "available" ? (
                    <Link key={r.ref} href={r.route}>
                      {card}
                    </Link>
                  ) : (
                    <div key={r.ref}>{card}</div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
