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
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="metric" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="baseline" name="Baseline" fill="hsl(var(--muted-foreground))" />
        <Bar dataKey="promo" name="During promo" fill="hsl(var(--primary))" />
      </BarChart>
    </ResponsiveContainer>
  );
}
