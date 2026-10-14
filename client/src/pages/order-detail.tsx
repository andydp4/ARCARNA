/**
 * One past order, opened from the till's customer history.
 * Read only. Creating or paying still happens on the order form.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { getJson } from "@/lib/queryClient";

type OrderDetail = {
  id?: string;
  status?: string | null;
  total?: string | number | null;
  createdAt?: string | null;
  customerName?: string | null;
  reference?: string | null;
  invoiceNumber?: string | null;
  items?: Array<{
    id: string;
    productName?: string | null;
    quantity?: string | number | null;
    total?: string | number | null;
  }>;
};

function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? `£${n.toFixed(2)}` : "";
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const query = useQuery({
    queryKey: ["/api/orders", id],
    enabled: Boolean(id),
    queryFn: () => getJson<OrderDetail>(`/api/orders/${id}`),
  });
  const order = query.data;
  const created = order?.createdAt ?? null;
  const when = created
    ? new Date(created).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "";
  const reference = order?.reference || (id ? id.slice(0, 8) : "");

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4" data-testid="order-detail">
      <Link href="/operations?pane=order" className="text-sm underline">
        Back to the order
      </Link>
      {query.isLoading && <p>Loading this order…</p>}
      {query.isError && (
        <p className="text-destructive">
          Could not open this order.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {order && (
        <>
          <header>
            <h1 className="text-2xl font-semibold">Order {reference}</h1>
            <p className="text-sm text-muted-foreground">
              {when}
              {order.status ? ` · ${order.status}` : ""}
              {order.customerName ? ` · ${order.customerName}` : ""}
            </p>
            <p className="mt-2 text-xl tabular-nums">{money(order.total)}</p>
            <p className="text-sm text-muted-foreground">
              Invoice {order.invoiceNumber || "Not issued"}
            </p>
          </header>
          <ul className="divide-y divide-border rounded-lg border">
            {(order.items ?? []).map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {item.productName || "Item"}
                  <span className="text-muted-foreground"> × {item.quantity}</span>
                </span>
                <span className="tabular-nums">{money(item.total)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">This is the past order. It is not the sale you were building.</p>
        </>
      )}
    </main>
  );
}
