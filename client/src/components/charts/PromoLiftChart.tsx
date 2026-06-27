import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PromoWindowMetrics } from "@shared/analytics/promoLift";

type Props = {
  promoWindow: PromoWindowMetrics;
  baselineWindow: PromoWindowMetrics;
};

export function PromoLiftChart({ promoWindow, baselineWindow }: Props) {
  const data = [
    {
      metric: "Revenue",
      baseline: baselineWindow.revenue,
      promo: promoWindow.revenue,
    },
    {
      metric: "AOV",
      baseline: baselineWindow.aov,
      promo: promoWindow.aov,
    },
    {
      metric: "New cust. %",
      baseline: Math.round(baselineWindow.newCustomerShare * 1000) / 10,
      promo: Math.round(promoWindow.newCustomerShare * 1000) / 10,
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="metric" tick={{ fill: "var(--muted-foreground)" }} tickLine={false} />
        <YAxis tick={{ fill: "var(--muted-foreground)" }} tickLine={false} />
        <Tooltip
          cursor={{ fill: "var(--accent)" }}
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--popover-foreground)",
          }}
        />
        <Legend wrapperStyle={{ color: "var(--muted-foreground)" }} />
        {/* Baseline = neutral; "during promo" = Truth Blue (the insight). */}
        <Bar dataKey="baseline" name="Baseline" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="promo" name="During promo" fill="var(--truth-blue-bright)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
