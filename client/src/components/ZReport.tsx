import type { ZReportData } from "@shared/reports/zReport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

function money(n: number) {
  return `£${n.toFixed(2)}`;
}

export function ZReportView({ report }: { report: ZReportData }) {
  return (
    <div className="z-report space-y-4 print:text-black print:bg-white">
      <div className="flex items-center justify-between print:hidden">
        <h2 className="text-lg font-semibold">Z-Report</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" />
          Print
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{report.shift.locationName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {report.shift.cashierName} · {new Date(report.shift.openedAt).toLocaleString()}
            {report.shift.closedAt &&
              ` – ${new Date(report.shift.closedAt).toLocaleString()}`}
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
                      {row.method} ({row.count})
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
              <span>Expected cash</span>
              <span className="text-right font-medium">
                {money(report.cashSummary.expectedCash)}
              </span>
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

          {report.shift.notes && (
            <p className="text-muted-foreground">Notes: {report.shift.notes}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
