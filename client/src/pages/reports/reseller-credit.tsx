/** ARC-T2-004 Reseller Credit & Payment Report. */
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { money, int, screenDate } from "@/lib/reportBrand";
import type { FlagLevel } from "@/lib/reportBrand";

interface Row {
  partner: string;
  partnerCode: string;
  stockSuppliedMtd: number;
  paymentsReceivedMtd: number;
  currentBalance: number;
  oldestUnpaidDays: number;
  accountStatus: "CLEAR" | "OUTSTANDING" | "OVERDUE" | "SUPPLY HOLD";
  lastPaymentDate: string | null;
  lastSupplyDate: string | null;
}

const STATUS_FLAG: Record<Row["accountStatus"], FlagLevel> = {
  CLEAR: "green",
  OUTSTANDING: "blue",
  OVERDUE: "amber",
  "SUPPLY HOLD": "red",
};

export default function ResellerCreditReport() {
  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T2-004",
        periodLabel: () => "Partner balances, ageing and supply holds",
        tableHeading: "Reseller Partners (highest balance first)",
        emptyText: "No reseller partners set up yet.",
        flagLegend: [
          { level: "red", meaning: "Supply hold (14+ days)" },
          { level: "amber", meaning: "Overdue (8–13 days)" },
          { level: "green", meaning: "Clear" },
        ],
        rowFlag: (r) => (r.accountStatus === "SUPPLY HOLD" ? "red" : undefined),
        kpis: (s) => [
          { label: "Partners", value: int(s.partners), keyInfo: true },
          { label: "Total Outstanding", value: money(s.totalOutstanding), keyInfo: true },
          { label: "Supply Holds", value: int(s.supplyHolds), flag: s.supplyHolds ? "red" : undefined },
        ],
        columns: [
          { header: "Partner", cell: (r) => r.partner },
          { header: "Code", cell: (r) => r.partnerCode },
          { header: "Supplied MTD", cell: (r) => money(r.stockSuppliedMtd), align: "right" },
          { header: "Paid MTD", cell: (r) => money(r.paymentsReceivedMtd), align: "right" },
          { header: "Balance", cell: (r) => money(r.currentBalance), keyInfo: true, align: "right" },
          { header: "Oldest Unpaid", cell: (r) => `${int(r.oldestUnpaidDays)}d`, keyInfo: true, align: "right" },
          {
            header: "Status",
            cell: (r) => <FlagBadge level={STATUS_FLAG[r.accountStatus]}>{r.accountStatus}</FlagBadge>,
            align: "center",
          },
        ],
        csvColumns: [
          { header: "Partner Name", value: (r) => r.partner },
          { header: "Partner Code", value: (r) => r.partnerCode },
          { header: "Stock Supplied MTD GBP", value: (r) => r.stockSuppliedMtd.toFixed(2) },
          { header: "Payments Received MTD GBP", value: (r) => r.paymentsReceivedMtd.toFixed(2) },
          { header: "Current Balance GBP", value: (r) => r.currentBalance.toFixed(2) },
          { header: "Oldest Unpaid Days", value: (r) => r.oldestUnpaidDays },
          { header: "Account Status", value: (r) => r.accountStatus },
          { header: "Last Payment Date", value: (r) => (r.lastPaymentDate ? screenDate(r.lastPaymentDate) : "") },
          { header: "Last Supply Date", value: (r) => (r.lastSupplyDate ? screenDate(r.lastSupplyDate) : "") },
        ],
      }}
    />
  );
}
