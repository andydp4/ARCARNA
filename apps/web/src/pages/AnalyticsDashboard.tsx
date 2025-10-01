import { useEffect, useState } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function AnalyticsDashboard() {
  const [topCustomers, setTopCustomers] = useState<any[]>([])
  const [daily, setDaily] = useState<any[]>([])
  const [monthly, setMonthly] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/analytics/top-customers?limit=5').then(r=>r.json()).then(setTopCustomers)
    fetch('/api/analytics/daily-revenue').then(r=>r.json()).then(setDaily)
    fetch('/api/analytics/monthly-summary').then(r=>r.json()).then(setMonthly)
  }, [])

  return (
    <div className="p-6 space-y-10 text-white bg-gradient-to-br from-[#0f172a] to-[#1e3a8a] min-h-screen">
      <h1 className="text-3xl font-bold mb-6">Analytics Dashboard</h1>

      {/* Top Customers */}
      <section>
        <h2 className="text-xl mb-2">Top Customers (by CLV)</h2>
        <div className="bg-black/40 p-4 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>Customer</th>
                <th>Orders</th>
                <th>Spent (£)</th>
                <th>RFM</th>
                <th>CLV (£)</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.map(c=>(
                <tr key={c.customer_id}>
                  <td>{c.customer_id}</td>
                  <td className="text-center">{c.order_count}</td>
                  <td className="text-center">{c.total_spent}</td>
                  <td className="text-center">{c.rfm_score}</td>
                  <td className="text-center">{c.clv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Daily Revenue */}
      <section>
        <h2 className="text-xl mb-2">Daily Revenue (last 30 days)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={daily}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="total_revenue" stroke="#38bdf8" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Monthly Summary */}
      <section>
        <h2 className="text-xl mb-2">Monthly Orders</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="total_orders" fill="#6366f1" />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  )
}