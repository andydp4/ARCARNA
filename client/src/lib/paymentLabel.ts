/**
 * How a payment method is written where a person reads it.
 *
 * Lived in `components/orders-row.tsx` until the Operations Centre work
 * (docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "Cleanup — delete list", row N1):
 * the row component is deleted with Open Orders in N4b, and three surfaces
 * that have nothing to do with that row — invoices, insights and now the
 * board's cards — import this function. A label helper living inside a
 * component that is scheduled for deletion is a rename waiting to break three
 * unrelated screens, so it moves here first, on its own, with its own test.
 */

// Tender values that read as something other than their own name — "tick" is
// the one case: the internal payment_method value stayed "tick" (it is a
// stored data value across every historic order, not just a label) after the
// credit rework, but nothing anywhere should show a customer or a member of
// staff the word "tick" any more.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  tick: "Credit",
};

export function formatPaymentLabel(method: string) {
  if (!method) return "—";
  const known = PAYMENT_METHOD_LABELS[method.toLowerCase()];
  if (known) return known;
  const spaced = method.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
