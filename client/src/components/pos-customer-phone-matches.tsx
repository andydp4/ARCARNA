import { apiFetch } from "@/lib/appPaths";
import { usePhoneLookup } from "@/hooks/usePhoneLookup";
import { useToast } from "@/hooks/use-toast";
import type { CustomerMatch } from "@shared/customerView";
import type { PosCustomer } from "./pos-cart-panel";

/**
 * The till picker's "found by phone" rows (v1.2 Phase 5, PRV-06). A cashier
 * cannot read anyone's number, so the list on the till cannot be searched by
 * one; a whole UK number typed into the search asks the server instead, and
 * Jane comes back as "Jane S. (••4821)". Picking her fetches her cashier view.
 */
export function PosCustomerPhoneMatches({
  query,
  excludeIds,
  onPick,
}: {
  query: string;
  /** Already listed by the name search; not shown twice. */
  excludeIds: ReadonlySet<string>;
  onPick: (customer: PosCustomer) => void;
}) {
  const lookup = usePhoneLookup(query);
  const { toast } = useToast();

  const pick = async (match: CustomerMatch) => {
    try {
      const res = await apiFetch(`/api/customers/${match.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      onPick((await res.json()) as PosCustomer);
    } catch {
      toast({ title: "Could not select the customer", description: "Search for them by name instead.", variant: "destructive" });
    }
  };

  if (lookup.status === "idle") return null;
  if (lookup.status === "searching") {
    return (
      <li role="presentation" className="px-3 py-2 text-xs text-muted-foreground" data-testid="phone-lookup-searching">
        Looking up the number…
      </li>
    );
  }
  if (lookup.status === "error") {
    return (
      <li role="presentation" className="px-3 py-2 text-xs text-destructive" data-testid="phone-lookup-error">
        {lookup.message}
      </li>
    );
  }
  const matches = lookup.matches.filter((m) => !excludeIds.has(m.id));
  if (lookup.matches.length === 0) {
    return (
      <li role="presentation" className="px-3 py-2 text-xs text-muted-foreground" data-testid="phone-lookup-none">
        Nobody on the system has that number.
      </li>
    );
  }
  return (
    <>
      {matches.map((match) => (
        <li
          key={match.id}
          role="option"
          aria-selected={false}
          data-testid={`phone-match-${match.id}`}
          className="flex min-h-[44px] cursor-pointer flex-col justify-center px-3 py-2 text-sm hover:bg-metal-surface/60"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => void pick(match)}
        >
          <div>{match.displayName}</div>
          <div className="text-xs text-muted-foreground">
            Found by phone{match.phoneMasked ? ` · ${match.phoneMasked}` : ""}
          </div>
        </li>
      ))}
    </>
  );
}
