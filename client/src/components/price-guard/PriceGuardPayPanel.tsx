import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatQuantity } from "@shared/quantity";
import { PRICE_GUARD_REASONS, PRICE_GUARD_REASON_LABELS } from "@shared/pricing/priceGuard";
import type { GuardChoice, GuardManager, TillFlaggedLine } from "@/lib/priceGuard";

/**
 * At Pay, in the page (no pop-up): each flagged line with its price, the
 * lowest price, the quantity and £ under; one reason for the sale; then
 * "Confirm and take payment" on the step's own button (v1.2 Phase 4, PRC-02).
 * "Manager agreed" names the manager, who is then asked (CMP-05).
 */
export function PriceGuardPayPanel({
  lines,
  choice,
  onChange,
  managers,
  disabled,
}: {
  lines: TillFlaggedLine[];
  choice: GuardChoice;
  onChange: (next: GuardChoice) => void;
  managers: GuardManager[];
  disabled?: boolean;
}) {
  if (lines.length === 0) return null;
  const totalUnder = lines.reduce((s, l) => s + l.under, 0);
  const chip = (active: boolean) =>
    cn(
      "min-h-[44px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "border-amber-500 bg-amber-500/15 text-metal-warm-white"
        : "border-metal-edge text-metal-muted hover:text-metal-warm-white",
    );

  return (
    <section
      className="rounded-lg border border-amber-500/60 p-3"
      style={{ backgroundColor: "color-mix(in srgb, var(--warning, #f59e0b) 8%, var(--card))" }}
      aria-labelledby="price-guard-heading"
      data-testid="price-guard-panel"
    >
      <h3 id="price-guard-heading" className="flex items-center gap-2 text-sm font-medium text-metal-warm-white">
        <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
        {lines.length === 1 ? "1 line is" : `${lines.length} lines are`} below the lowest price · £{totalUnder.toFixed(2)} under
      </h3>
      <ul className="mt-2 space-y-1 text-xs" data-testid="price-guard-lines">
        {lines.map((l) => (
          <li key={l.productId} className="flex flex-wrap justify-between gap-x-3 text-metal-muted">
            <span className="min-w-0 truncate text-metal-warm-white">{l.name}</span>
            <span className="tabular-nums">
              £{l.unitPrice.toFixed(2)} · lowest £{l.floor.toFixed(2)} · qty {formatQuantity(l.quantity)} · £{l.under.toFixed(2)} under
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm text-metal-warm-white" id="price-guard-reason-label">
        Why this price?
      </p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="price-guard-reason-label">
        {PRICE_GUARD_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            role="radio"
            aria-checked={choice.reason === reason}
            className={chip(choice.reason === reason)}
            disabled={disabled}
            onClick={() => onChange({ ...choice, reason })}
            data-testid={`price-guard-reason-${reason}`}
          >
            {PRICE_GUARD_REASON_LABELS[reason]}
          </button>
        ))}
      </div>

      {choice.reason === "manager_agreed" && (
        <div className="mt-3">
          <p className="text-xs text-metal-muted" id="price-guard-manager-label">
            Which manager? They will be asked to confirm. The sale goes through either way.
          </p>
          {managers.length === 0 ? (
            <p className="mt-1 text-xs text-amber-500" data-testid="price-guard-no-managers">
              No managers are listed on this till. Pick another reason.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="price-guard-manager-label">
              {managers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={choice.managerUserId === m.id}
                  className={chip(choice.managerUserId === m.id)}
                  disabled={disabled}
                  onClick={() => onChange({ ...choice, managerUserId: m.id })}
                  data-testid={`price-guard-manager-${m.id}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {choice.reason === "other" && (
        <Input
          className="mt-3"
          placeholder="Say what the reason is"
          aria-label="The reason for this price"
          value={choice.note}
          maxLength={500}
          disabled={disabled}
          onChange={(e) => onChange({ ...choice, note: e.target.value })}
          data-testid="price-guard-note"
        />
      )}
    </section>
  );
}
