import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { checkMinPrice, effectiveFloor, minPriceBelowCost } from '@shared/pricing/floor'
import { usableCost } from '@shared/purchasing/purchaseLines'

const gbp = (n: number) => `£${n.toFixed(2)}`

/**
 * The minimum price on the product form (v1.2 Phase 2, PRC-01). Empty means
 * "follows the sale price", so the label says what the minimum is right now;
 * a set minimum gets a reset link back to following. A minimum above the
 * sale price is shown as refused (the server refuses it too); one below the
 * known cost gets a gentle warning only.
 */
export function MinPriceField({
  id,
  value,
  onChange,
  salePrice,
  costPrice,
}: {
  id: string
  value: string
  onChange: (next: string) => void
  salePrice: string
  costPrice: string
}) {
  const sale = Number.parseFloat(salePrice)
  const saleKnown = Number.isFinite(sale)
  const floor = effectiveFloor({ minPrice: value, defaultSalePrice: saleKnown ? sale : 0 })
  const refused = saleKnown ? checkMinPrice(value, sale) : null
  const belowCost = !refused && minPriceBelowCost(value, costPrice)
  const cost = usableCost(costPrice)

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Minimum price</Label>
      <Input
        id={id}
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={saleKnown ? `Follows sale price (${gbp(sale)})` : 'Follows sale price'}
        className="min-h-[44px]"
        aria-invalid={refused ? true : undefined}
        data-testid={`${id}-input`}
      />
      {floor.followsSalePrice ? (
        <p className="text-xs text-muted-foreground" data-testid={`${id}-follows`}>
          Minimum price: follows sale price{saleKnown ? ` (${gbp(sale)})` : ''}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Minimum price: {gbp(floor.minimum)}.{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => onChange('')}
            data-testid={`${id}-reset`}
          >
            Reset to follow the sale price
          </Button>
        </p>
      )}
      {refused && (
        <p className="text-xs text-destructive" role="alert" data-testid={`${id}-refused`}>
          {refused.message}
        </p>
      )}
      {belowCost && cost != null && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid={`${id}-below-cost`}>
          This is below the known cost ({gbp(cost)}). A sale at the minimum would lose money.
        </p>
      )}
    </div>
  )
}
