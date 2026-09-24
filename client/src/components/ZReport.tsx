import { Fragment } from "react";
import type { ZReportData } from "@shared/reports/zReport";
import { paymentMethodLabel } from "@shared/payments/cardLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

function money(n: number) {
  return `£${n.toFixed(2)}`;
}

/** ISO date to the dd/mm/yy a cashier reads on a docket. */
function formatGivenOn(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year.slice(2)}`;
}

export function ZReportView({ report }: { report: ZReportData }) {
  const inProgress = report.shift.status === "open";
  return (
    <div className="z-report space-y-4 print:text-black print:bg-white">
      <div className="flex items-center justify-between print:hidden">
        <h2 className="text-lg font-semibold">{inProgress ? "Z-Report so far" : "Z-Report"}</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" />
          Print
        </Button>
      </div>

      {inProgress && (
        // Said plainly, because a mid-afternoon figure read as a day's total is
        // the obvious way for this screen to mislead somebody.
        <p className="text-sm text-muted-foreground border-l-2 border-primary pl-3">
          This shift is still running. Figures are as at{" "}
          {new Date(report.generatedAt).toLocaleTimeString("en-GB")} and will keep changing until it closes.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{report.shift.locationName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {report.shift.cashierName} · {new Date(report.shift.openedAt).toLocaleString("en-GB")}
            {report.shift.closedAt &&
              ` – ${new Date(report.shift.closedAt).toLocaleString("en-GB")}`}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <span>Orders</span>
            <span className="text-right font-medium">{report.orderCount}</span>
            <span>Gross sales</span>
            <span className="text-right font-medium">{money(report.grossSales)}</span>
            <span>Refunds</span>
            <span className="text-right font-medium">{money(report.refundsTotal)}</span>
            <span>Net sales</span>
            <span className="text-right font-semibold">{money(report.netSales)}</span>
            {/* Already out of the sales above; shown so a till that took less
                than its list prices explains itself. Older reports have none. */}
            {(report.discountsGiven ?? 0) > 0 && (
              <>
                <span className="text-muted-foreground">Discounts given (included above)</span>
                <span className="text-right text-muted-foreground">{money(report.discountsGiven)}</span>
              </>
            )}
          </div>

          <Separator />

          <div>
            <p className="font-medium mb-1">Sales by payment method</p>
            {report.salesByPaymentMethod.length === 0 ? (
              <p className="text-muted-foreground">No sales</p>
            ) : (
              <ul className="space-y-1">
                {report.salesByPaymentMethod.map((row) => (
                  <li key={row.method} className="flex justify-between">
                    <span>
                      {paymentMethodLabel(row.method)} ({row.count})
                    </span>
                    <span>{money(row.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="font-medium mb-1">Sales by category</p>
            <ul className="space-y-1">
              {report.salesByCategory.map((row) => (
                <li key={row.category} className="flex justify-between">
                  <span>{row.category}</span>
                  <span>{money(row.total)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-medium mb-1">Top SKUs</p>
            <ul className="space-y-1">
              {report.topSkus.map((row) => (
                <li key={row.sku} className="flex justify-between gap-2">
                  <span className="truncate">
                    {row.name} ({row.sku}) ×{row.qty}
                  </span>
                  <span className="shrink-0">{money(row.revenue)}</span>
                </li>
              ))}
            </ul>
          </div>

          <Separator />

          <div>
            <p className="font-medium mb-1">Cash drawer</p>
            <div className="grid grid-cols-2 gap-2">
              <span>Opening float</span>
              <span className="text-right">{money(report.cashSummary.openingFloat)}</span>
              <span>Cash sales</span>
              <span className="text-right">{money(report.cashSummary.cashSales)}</span>
              <span>Cash refunds</span>
              <span className="text-right">{money(report.cashSummary.cashRefunds)}</span>
              {/* Cash taken against tabs into this drawer: in expected cash,
                  not in sales (v1.2 Phase 1C). */}
              {(report.cashSummary.cashTabRepayments ?? 0) > 0 && (
                <>
                  <span>Cash tab repayments</span>
                  <span className="text-right" data-testid="z-cash-tab-repayments">
                    {money(report.cashSummary.cashTabRepayments)}
                  </span>
                </>
              )}
              <span>Expected cash</span>
              <span className="text-right font-medium">
                {money(report.cashSummary.expectedCash)}
              </span>
              {report.cashSummary.closingCount == null && inProgress && (
                <>
                  {/* Not zero — nobody has counted the drawer yet, and showing
                      a zero variance on an uncounted drawer would be a lie. */}
                  <span>Counted cash</span>
                  <span className="text-right text-muted-foreground">Not counted yet</span>
                  <span>Variance</span>
                  <span className="text-right text-muted-foreground">Pending the count</span>
                </>
              )}
              {report.cashSummary.closingCount != null && (
                <>
                  <span>Counted cash</span>
                  <span className="text-right">{money(report.cashSummary.closingCount)}</span>
                  <span>Variance</span>
                  <span
                    className={`text-right font-semibold ${
                      (report.cashSummary.variance ?? 0) !== 0
                        ? "text-destructive"
                        : ""
                    }`}
                  >
                    {money(report.cashSummary.variance ?? 0)}
                  </span>
                </>
              )}
            </div>
          </div>

          {report.cashSummary.expectedCashExcludesTabRepayments && (
            <p className="text-xs text-muted-foreground border-l-2 border-amber-500 pl-3" data-testid="z-old-rule-note">
              This shift was closed before cash tab repayments counted towards expected cash. Any cash
              taken against a tab on it is not in the expected figure, so the variance reads over by
              that amount.
            </p>
          )}

          {(report.awaitingCardPayment ?? 0) > 0 && (
            <>
              <Separator />
              {/* Sold, not yet paid: in no takings figure above until Stripe confirms. */}
              <div className="grid grid-cols-2 gap-2" data-testid="zreport-awaiting-card">
                <span>Awaiting card payment (link)</span>
                <span className="text-right">{money(report.awaitingCardPayment)}</span>
              </div>
            </>
          )}

          {(report.creditGivenOut > 0 || report.creditResolved.length > 0) && (
            <>
              <Separator />
              <div>
                {/* Directly beneath the drawer, because this is where a light
                    drawer gets explained: the sales are real and counted, the
                    cash has not arrived yet. Neither line moves net sales. */}
                <p className="font-medium mb-1">Credit</p>
                <div className="grid grid-cols-2 gap-2">
                  {report.creditGivenOut > 0 && (
                    <>
                      <span>Credit given out today</span>
                      <span className="text-right">{money(report.creditGivenOut)}</span>
                    </>
                  )}
                  {report.creditResolved.map((line) => (
                    <Fragment key={line.givenOn}>
                      <span>Credit resolved from {formatGivenOn(line.givenOn)}</span>
                      <span className="text-right">{money(line.amount)}</span>
                    </Fragment>
                  ))}
                </div>
              </div>
            </>
          )}

          {report.shift.notes && (
            <p className="text-muted-foreground">Notes: {report.shift.notes}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
