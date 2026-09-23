/**
 * ARC-T2-002 Staff KPI Performance — hidden while it is rebuilt (STF-FN1).
 *
 * The old report built its staff list from cashier codes and counted orders
 * by `completed_cashier_id`. No shift has carried a code since the lazy-shift
 * change, so on current data it told the owner every member of staff did
 * nothing, under a heading that said "for bonus calculation". A wrong report
 * is worse than none, so the page says so plainly instead of showing figures.
 * The rebuild (STF-01) keys staff by login. The server also keeps this ref to
 * admins (it rates managers too: Q12).
 */
import { Link } from "wouter";
import { ChevronLeft, Wrench } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function StaffKpiReport() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/reports" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> All Evidence
      </Link>
      <PageHeader title="Staff KPI Performance" question="Being rebuilt" explanation="This Evidence is switched off for now." />
      <Card className="lm-card mt-4 border-0 shadow-none" data-testid="staff-kpi-being-rebuilt">
        <CardContent className="flex gap-3 p-5 text-sm">
          <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-2">
            <p>
              Staff are now tracked by their own login, not by cashier code. This report still counted cashier codes,
              so it showed everyone on zero. It is being rebuilt to count each person's own orders.
            </p>
            <p className="text-muted-foreground">
              Until then, pick a person on Daily Sales, Weekly Sales or Weekly Margin to see what they completed.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
