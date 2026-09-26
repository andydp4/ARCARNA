import { useQuery } from '@tanstack/react-query'
import { getJson } from '@/lib/queryClient'
import { Skeleton } from '@/components/Skeleton'

type PriceHistoryEntry = {
  id: string
  field: 'sale' | 'min' | 'cost' | string
  oldValue: string | null
  newValue: string | null
  source: string
  changedBy: string | null
  changedByName: string | null
  createdAt: string
}

const FIELD_LABEL: Record<string, string> = {
  sale: 'Sale price',
  min: 'Minimum price',
  cost: 'Cost',
}

const SOURCE_LABEL: Record<string, string> = {
  form: 'Product form',
  import: 'Import',
  create: 'Product created',
  bulk: 'Bulk "Set minimum price"',
}

/** An empty figure means something different per field; never show it as £0. */
function figure(field: string, value: string | null): string {
  if (value == null) {
    if (field === 'min') return 'follows sale price'
    if (field === 'cost') return 'no cost set'
    return '—'
  }
  return `£${Number(value).toFixed(2)}`
}

/** Sale, minimum and cost changes for one product, newest first (PRC-07). */
export function PriceHistoryPanel({ productId }: { productId: string }) {
  const url = `/api/products/${productId}/price-history`
  const { data = [], isLoading, isError } = useQuery<PriceHistoryEntry[]>({
    queryKey: [url],
    queryFn: () => getJson<PriceHistoryEntry[]>(url),
  })

  if (isLoading) return <Skeleton count={3} variant="row" />
  if (isError) return <p className="text-sm text-destructive">Price history could not be loaded.</p>
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="price-history-empty">
        No price changes recorded yet. Changes to the sale price, minimum price and cost appear here.
      </p>
    )
  }
  return (
    <ul className="divide-y rounded-md border" data-testid="price-history-list">
      {data.map((h) => (
        <li key={h.id} className="p-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="font-medium">{FIELD_LABEL[h.field] ?? h.field}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(h.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
          <div>
            {figure(h.field, h.oldValue)} → {figure(h.field, h.newValue)}
          </div>
          <div className="text-xs text-muted-foreground">
            {h.changedByName ?? (h.changedBy ? 'Unknown user' : 'System')} · {SOURCE_LABEL[h.source] ?? h.source}
          </div>
        </li>
      ))}
    </ul>
  )
}
