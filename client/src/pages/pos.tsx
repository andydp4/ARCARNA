/**
 * The order form.
 *
 * Two steps, no pop-ups. Step 1 builds the order on the line editor: type a
 * code or name, scan a barcode, or tap a top seller, and fix quantity and
 * price on the line. Step 2 takes the payment on a full-screen step that
 * replaces the lines rather than floating over them.
 *
 * It used to be a tile grid, a cart in a slide-over sheet, and a checkout
 * dialog stacked on top of the sheet. On Android the stacked layers fought
 * over focus and scroll lock, the dialog was sized in vh so the keyboard
 * pushed its buttons off screen, and sometimes the dialog did not render at
 * all. Everything here is in normal page flow — no dialog at all, not even
 * the small "Redeem loyalty points" one this file used to keep: since N6
 * embeds this form in the Operations Centre's phone Order tab, that dialog
 * became reachable from a screen whose own DoD is zero `role="dialog"`
 * mounts, so it is now an inline expanding panel in `PosCartPanel` instead
 * (same shape as `OpsDelayInline`/`OpsCardActions`'s panels), triggered and
 * driven from state that still lives here.
 *
 * Since N6 this also embeds beside the Operations Centre board
 * (`operations.tsx`'s form pane, and the phone's "New order" tab): pass
 * `embedded` and the shell fills its container (`h-full`) instead of the
 * standalone `.pos-viewport`, drops its own page header, and calls
 * `onPlaced` after every sale so the board can find and flash the new card.
 * `usePosNarrow` reads the form's OWN rendered width via a `@container` root
 * — not the browser viewport (`useIsMobile`, finding G18) — so the same
 * five structural branches and the same `@[640px]:` layout classes give the
 * phone structure to a ~460 px form pane on a 1194 px tablet exactly as they
 * do to a genuinely narrow phone screen. Standalone behaviour (`embedded`
 * omitted) is unchanged, because a standalone form's container is the
 * viewport.
 */
import { deliveryOrderFields, EMPTY_POS_DELIVERY, type PosDeliveryState } from "@/components/pos-delivery-details";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DEFAULT_TAX_RATE_PERCENT } from "@shared/tax";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiFetch } from "@/lib/appPaths";
import { offlineStorage } from "@/lib/offline-storage";
import { invalidateAfterPosCheckout } from "@/lib/query-invalidation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { PosOrderLines } from "@/components/pos-order-lines";
import { PosTopSellers } from "@/components/pos-top-sellers";
import { PosCheckoutStep, type OrderExpense, type TenderLeg } from "@/components/pos-checkout-step";
import { freshSplitLegs, hasUnchosenMethod } from "@/lib/splitTender";
import { classifyOrderDate, localIsoDate } from "@shared/orders/orderDate";
import { posPrice, type PosProduct, type PosChannel } from "@/components/pos-types";
import { PosCartPanel, type PosCartPanelProps, type PosCartItem, type PosCustomer } from "@/components/pos-cart-panel";
import { ActionLoader } from "@/components/action-loader";
import { computeTierProgress } from "@shared/loyalty/progress";
import { PricingError, priceOrder, tierForPoints, type PricingPromotion, type PricingTier } from "@shared/pricing/priceOrder";
import { consumeWhatsappDraft } from "@/lib/whatsappDraft";
import { consumeSaleIssueDraft, readSaleIssuePayload, type SaleIssueDraft } from "@/lib/saleIssueDraft";
import {
  checkSaleLanded,
  newClientOrderId,
  referenceForAttempt,
  saleFingerprint,
  sendLeftSaleUncertain,
  sendSale,
  type SentSale,
} from "@/lib/saleQueue";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { playScanFailBeep, playScanSuccessBeep } from "@/lib/posAudio";
import { useAuth } from "@/hooks/useAuth";
import { usePosNarrow } from "@/hooks/usePosNarrow";
import type { LocationPickerOption } from "@shared/schema";
import type { GiftCardPaymentState } from "@/pages/pos/payments/GiftCardPayment";
import type { OpsBoardStaffRow } from "@/hooks/useOpsBoard";
import { cn } from "@/lib/utils";
import { usePriceGuard } from "@/hooks/usePriceGuard";
import { buildConfirmation, choiceProblem, flaggedCartLines } from "@/lib/priceGuard";
import { PriceGuardLineNote } from "@/components/price-guard/PriceGuardLineNote";
import { PriceGuardPayPanel } from "@/components/price-guard/PriceGuardPayPanel";
import { ShiftPriceOverrideCount } from "@/components/price-guard/ShiftPriceOverrideCount";

/** "Confirm and take payment" (v1.2 Phase 4); the same verbs as the step's own button. */
function confirmVerb(paymentMethod: string): string {
  return paymentMethod === "tick" ? "place order" : "take payment";
}

type Product = PosProduct;
type Customer = PosCustomer;

/**
 * Whether the customer has an email on file. Below admin the address itself
 * is not sent (Q13a), only `hasEmail`; the receipt worker looks it up.
 */
function customerHasEmail(customer: Customer | null | undefined): boolean {
  return !!customer && (!!customer.email || customer.hasEmail === true);
}
type CartItem = PosCartItem;

export interface PosEmbeddedProps {
  /** Called after a sale places successfully, with the new order's id, so the
   *  board can scroll to and flash the card that just landed on it. */
  onPlaced: (orderId: string) => void;
}

/** "4h 20m" for a live shift, matching the Shifts page's own duration format. */
function shiftDuration(openedAtIso: string): string {
  const openedAt = new Date(openedAtIso).getTime();
  if (!Number.isFinite(openedAt)) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - openedAt) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * ARC-012: cashiers had no way to see their own shift while it was running —
 * "Cashier Payroll" is (rightly) MANAGER+ only, and there was nothing in its
 * place. This is a small live readout of the CURRENT USER's own open cashier
 * shift: how long they've been on, what they've sold, and commission accrued
 * so far — resolved by user id (`/api/cashier-shifts/mine`), not a cashier
 * code, so it works for a shift opened lazily on first sale (058) exactly as
 * it would for a legacy coded one. Renders nothing when there is no open
 * shift to show (including when the org has cashier commission tracking
 * turned off, since none is ever opened then) — this is a bonus readout, not
 * something worth a loading skeleton or an empty state of its own.
 */
function MyShiftSummary() {
  const { data: mine } = useQuery<{ shift: { id: string } | null }>({
    queryKey: ["/api/cashier-shifts/mine"],
    queryFn: async () => {
      const res = await apiFetch("/api/cashier-shifts/mine", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load current shift");
      return res.json();
    },
    // A live figure a cashier might glance at mid-shift; a minute stale is fine.
    refetchInterval: 60_000,
  });

  const shiftId = mine?.shift?.id ?? null;

  const { data: summaryData } = useQuery<{
    shift: { openedAt: string };
    summary: { grossSales: string | number; commissionAmount: string | number } | null;
    priceOverrideCount?: number;
  }>({
    queryKey: ["/api/cashier-shifts", shiftId, "summary"],
    queryFn: async () => {
      const res = await apiFetch(`/api/cashier-shifts/${shiftId}/summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load shift summary");
      return res.json();
    },
    enabled: !!shiftId,
    refetchInterval: 60_000,
  });

  if (!shiftId || !summaryData?.summary) return null;

  const grossSales = Number(summaryData.summary.grossSales ?? 0);
  const commission = Number(summaryData.summary.commissionAmount ?? 0);

  return (
    <p className="mt-1 text-xs text-metal-muted" data-testid="pos-my-shift-summary">
      My shift so far: <span className="font-medium text-foreground">{shiftDuration(summaryData.shift.openedAt)}</span>
      {" · sold "}
      <span className="font-medium text-foreground">£{grossSales.toFixed(2)}</span>
      {" · commission "}
      <span className="font-medium text-foreground">£{commission.toFixed(2)}</span>
      <ShiftPriceOverrideCount count={summaryData.priceOverrideCount} />
    </p>
  );
}

export default function POS({ embedded }: { embedded?: PosEmbeddedProps } = {}) {
  const { toast } = useToast();
  const [narrowRef, narrow] = usePosNarrow();
  const [cart, setCart] = useState<CartItem[]>([]);
  /** Which step is on screen. "pay" replaces the lines with the payment step. */
  const [view, setView] = useState<"build" | "pay">("build");

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [personalUseReason, setPersonalUseReason] = useState("");
  // Split tender: a £100 sale taken as £50 cash and £50 on tick. Off by
  // default, because most sales are one tender and the extra controls would
  // just slow the till down.
  const [splitPayment, setSplitPayment] = useState(false);
  const [tenderLegs, setTenderLegs] = useState<TenderLeg[]>(() => freshSplitLegs());
  // Switching Split on starts clean rows, seeded from the method already
  // picked — never a stale row from the last sale or a pre-filled "Card".
  const toggleSplitPayment = (on: boolean) => {
    if (on) setTenderLegs(freshSplitLegs(paymentMethod));
    setSplitPayment(on);
  };
  // The day the order is for. Today unless the cashier says otherwise — a
  // missed day being keyed in afterwards, or a pre-order. Sent only when it is
  // not today, so an ordinary sale is dated by the server, in the org's zone.
  const [orderDate, setOrderDate] = useState<string>(() => localIsoDate());
  // Defaults to collection: the overwhelming majority of till sales are handed
  // over at the counter, so the common path stays a single tap.
  const [fulfilmentMethod, setFulfilmentMethod] = useState<"collection" | "delivery">("collection");
  const [delivery, setDelivery] = useState<PosDeliveryState>(EMPTY_POS_DELIVERY);
  const [giftCardPayment, setGiftCardPayment] = useState<GiftCardPaymentState | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<PricingPromotion | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [pointsRedemptionAmount, setPointsRedemptionAmount] = useState(0);
  const [redeemPanelOpen, setRedeemPanelOpen] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  const [orderExpenses, setOrderExpenses] = useState<OrderExpense[]>([]);
  const [expenseCategory, setExpenseCategory] = useState("shipping");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [emailReceipt, setEmailReceipt] = useState(false);

  // Fulfilment channel, the promise made to the customer, and who is dealing
  // with it — the board needs all three and, until N6, the form collected
  // none of them (brief, "Form embedding"; G20).
  const [channel, setChannel] = useState<PosChannel>("pos");
  const [dueMinutes, setDueMinutes] = useState<number | null>(null);
  const [dueTime, setDueTime] = useState("");
  // Once the cashier has picked (or explicitly cleared) a due time
  // themselves, the fulfilment/channel defaults below stop overwriting it.
  const [dueTouched, setDueTouched] = useState(false);
  // "" defers to the server's default-owner rule (inputter-if-on-station →
  // least-loaded present station member → Unassigned); a specific id is the
  // inputter's explicit override, sent as `assignedUserId`.
  const [assigneeUserId, setAssigneeUserId] = useState("");
  // The sale's reference (v1.2 Phase 1A), made when the sale starts and sent
  // on every attempt at it — a retry after a timeout, a double tap, an offline
  // replay — so the server records it once. A new one only once this sale has
  // landed or been kept on the till; a refused attempt keeps it, because that
  // attempt recorded nothing.
  const [saleRef, setSaleRef] = useState<string>(() => newClientOrderId());
  // What was last sent under saleRef, so a changed cart is never sent under a
  // reference an earlier (possibly recorded) attempt already used.
  const lastSentRef = useRef<SentSale | null>(null);
  // A refused sale a manager opened from Needs attention to fix. It keeps the
  // sale's own reference and is sent as a resend of that sale.
  const [editingIssue, setEditingIssue] = useState<SaleIssueDraft | null>(null);

  const { data: currentShiftData } = useQuery<{
    shift: { id: string; status: string; locationId?: string } | null;
  }>({
    queryKey: ["/api/shifts/current"],
    queryFn: async () => {
      const res = await apiFetch("/api/shifts/current", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load shift");
      return res.json();
    },
  });

  // Which location a sale actually lands in — mirrors requireOrgContext's own
  // fallback chain (open shift, then this user's default, then the org's
  // default active location) so the cashier sees it before hitting "Take
  // payment" rather than after, from a 400. No new endpoint: this is the same
  // /api/auth/user and /api/locations data other pages already fetch.
  const { user: authUser } = useAuth();
  const { data: posLocations = [] } = useQuery<LocationPickerOption[]>({
    queryKey: ["/api/locations"],
  });
  const orgDefaultLocation = posLocations.find((l) => l.isDefault === 1 && l.isActive === 1);
  const sellingLocationId =
    currentShiftData?.shift?.locationId ||
    (authUser as { defaultLocationId?: string | null } | null)?.defaultLocationId ||
    orgDefaultLocation?.id ||
    null;
  const sellingLocation = posLocations.find((l) => l.id === sellingLocationId) ?? null;
  // Only meaningful once locations have actually loaded — an empty list on
  // first render must not flash a false "no location configured" warning.
  const noLocationWillResolve = posLocations.length > 0 && !sellingLocationId;

  // "Looked after by" (brief, "Assignment") — the same staff list the board's
  // header strip uses, so the picker and the default-owner rule agree on who
  // is on shift.
  const { data: staffData } = useQuery<{ staff: OpsBoardStaffRow[] }>({
    queryKey: ["/api/operations/staff"],
  });
  const staff = staffData?.staff ?? [];

  useEffect(() => {
    if (customerHasEmail(selectedCustomer) && selectedCustomer?.receiptEmailOptIn !== false) {
      setEmailReceipt(true);
    } else {
      setEmailReceipt(false);
    }
  }, [selectedCustomer?.id, selectedCustomer?.email, selectedCustomer?.hasEmail, selectedCustomer?.receiptEmailOptIn]);

  // Fetch products
  const { data: products = [], isLoading: productsLoading } = useQuery<PosProduct[]>({
    queryKey: ["/api/products"],
  });

  // Fetch customers
  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Consume a WhatsApp draft-order prefill once products + customers are loaded.
  const [draftConsumed, setDraftConsumed] = useState(false);
  useEffect(() => {
    if (draftConsumed || productsLoading || customersLoading) return;
    const draft = consumeWhatsappDraft();
    if (!draft) {
      setDraftConsumed(true);
      return;
    }
    const matched: CartItem[] = [];
    const unmatched: string[] = [];
    for (const item of draft.items) {
      const product = products.find(
        (p) => (item.sku && p.productId === item.sku) || (item.productId && p.productId === item.productId),
      ) as PosProduct | undefined;
      if (!product) {
        unmatched.push(item.name);
        continue;
      }
      const price = posPrice(product);
      const quantity = Math.max(1, item.quantity || 1);
      matched.push({ product, quantity, customPrice: price, subtotal: price * quantity });
    }
    if (matched.length > 0) setCart(matched);
    let customerPicked = false;
    if (draft.customerId) {
      const customer = customers.find((c) => c.id === draft.customerId);
      if (customer) {
        setSelectedCustomer(customer);
        customerPicked = true;
      }
    }
    const fromVoice = draft.source === "voice";
    // The order came in over WhatsApp regardless of whether every line matched.
    // A voice draft is a till sale like any other.
    if (!fromVoice) setChannel("whatsapp");
    setDraftConsumed(true);
    const itemsPart =
      matched.length > 0
        ? `${matched.length} item(s) added at the till's prices${unmatched.length ? `; ${unmatched.length} not matched` : ""}.`
        : "No catalogue products matched. Add items manually.";
    const customerPart =
      fromVoice && !customerPicked && draft.customerName ? ` Pick the customer for "${draft.customerName}".` : "";
    const notePart = fromVoice && draft.note ? ` ${draft.note}.` : "";
    toast({
      title: fromVoice ? "Voice draft opened" : "WhatsApp draft loaded",
      description: `${itemsPart}${customerPart}${notePart} Review before checkout.`,
    });
  }, [draftConsumed, productsLoading, customersLoading, products, customers, toast]);

  // Edit from Needs attention: put the refused sale back on the till.
  const [issueDraftConsumed, setIssueDraftConsumed] = useState(false);
  useEffect(() => {
    if (issueDraftConsumed || productsLoading || customersLoading) return;
    setIssueDraftConsumed(true);
    const draft = consumeSaleIssueDraft();
    if (!draft) return;
    const sale = readSaleIssuePayload(draft.payload);
    const matched: CartItem[] = [];
    let unmatched = 0;
    for (const line of sale.lines) {
      const product = products.find((p) => p.id === line.productId) as PosProduct | undefined;
      if (!product) {
        unmatched += 1;
        continue;
      }
      matched.push({ product, quantity: line.quantity, customPrice: line.unitPrice, subtotal: line.quantity * line.unitPrice });
    }
    setCart(matched);
    const customer = sale.customerId ? customers.find((c) => c.id === sale.customerId) : undefined;
    setSelectedCustomer(customer ?? null);
    if (sale.paymentMethod && sale.paymentMethod !== "split") setPaymentMethod(sale.paymentMethod);
    if (sale.payments && sale.payments.length > 1) {
      setSplitPayment(true);
      setTenderLegs(sale.payments.map((leg) => ({ method: leg.method, amount: leg.amount.toFixed(2) })));
    }
    setFulfilmentMethod(sale.fulfilmentMethod);
    setDelivery({ ...EMPTY_POS_DELIVERY, ...sale.delivery });
    if (sale.channel === "pos" || sale.channel === "phone" || sale.channel === "whatsapp") setChannel(sale.channel);
    if (sale.personalUseReason) setPersonalUseReason(sale.personalUseReason);
    if (sale.orderDate) setOrderDate(sale.orderDate);
    if (sale.expenses.length > 0) setOrderExpenses(sale.expenses);
    setSaleRef(draft.clientOrderId);
    setEditingIssue(draft);
    const notes = [
      unmatched ? `${unmatched} line(s) are no longer in the catalogue` : "",
      sale.customerId && !customer ? "the customer was not found" : "",
      sale.dropped.length ? `apply the ${sale.dropped.join(" and ")} again if still wanted` : "",
    ].filter(Boolean);
    toast({
      title: "Editing a sale from Needs attention",
      description: notes.length ? `Check it before taking payment: ${notes.join("; ")}.` : "Check it, then take payment.",
    });
  }, [issueDraftConsumed, productsLoading, customersLoading, products, customers, toast]);

  // Tax rate must come from the org, not a constant: the till previously
  // showed 10% while the server charged 20%, so the customer was quoted one
  // total and charged another.
  const { data: orgSettings } = useQuery<{ vatEnabled?: boolean; vatRate?: number; priceGuardEnabled?: boolean }>({
    queryKey: ["/api/settings"],
  });
  // Price guard at the till (v1.2 Phase 4): off, the till shows nothing.
  const priceGuard = usePriceGuard(orgSettings?.priceGuardEnabled);

  const { data: loyaltyTiers = [] } = useQuery<Array<PricingTier & { color?: string | null }>>({
    queryKey: ["/api/loyalty-tiers"],
  });

  const { data: loyaltySettings } = useQuery<{ redemptionRate: number; minRedeemPoints: number }>({
    queryKey: ["/api/loyalty/settings"],
  });

  const tierProgress = useMemo(() => {
    if (!selectedCustomer || loyaltyTiers.length === 0) return null;
    return computeTierProgress(
      selectedCustomer.loyaltyPoints,
      loyaltyTiers.map((t: any) => ({
        name: t.name,
        pointsRequired: t.pointsRequired,
        color: t.color,
      })),
    );
  }, [selectedCustomer, loyaltyTiers]);

  // Filter customers for search. Below admin there is no number here to
  // search (not even the last four: no partial matches, PRV-06); a whole
  // number is looked up on the server by the picker instead.
  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      (!!customer.phone && customer.phone.includes(customerSearch)) ||
      (customer.email && customer.email.toLowerCase().includes(customerSearch.toLowerCase()))
  );

  // Validate promo code mutation
  const validatePromoMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/promotions/validate", { code });
      return response.json();
    },
    onSuccess: (promo) => {
      setAppliedPromo(promo);
      toast({
        title: "Promo Applied",
        description: `${promo.name} applied successfully!`,
      });
    },
    onError: () => {
      toast({
        title: "Invalid Code",
        description: "The promo code is invalid or expired.",
        variant: "destructive",
      });
      setAppliedPromo(null);
    },
  });

  /** A single-tap way to add the promise a sale went out without (toast action below). */
  const setDueFromToastMutation = useMutation({
    mutationFn: async ({ orderId, minutes }: { orderId: string; minutes: number }) => {
      const res = await apiFetch(`/api/orders/${orderId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "set_due", dueInMinutes: minutes }),
      });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Due time set" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not set a due time", description: error.message, variant: "destructive" });
    },
  });

  // Place order mutation
  const placeOrderMutation = useMutation({
    mutationFn: async (orderData: any) => {
      const fingerprint = saleFingerprint(orderData);
      let ref = saleRef;
      // A sale from Needs attention is always a resend of its own reference.
      if (!editingIssue) {
        const decided = await referenceForAttempt(saleRef, lastSentRef.current, fingerprint);
        if (decided.kind === "landed") return { ...decided.body, earlierAttemptRecorded: true };
        if (decided.kind === "unknown") {
          throw new Error(
            "arcarna could not confirm whether the first try of this sale was recorded, so the changed sale was not sent. Check the connection and try again.",
          );
        }
        if (decided.ref !== saleRef) {
          ref = decided.ref;
          setSaleRef(ref);
        }
      }
      lastSentRef.current = { ref, fingerprint };
      const payload = {
        ...orderData,
        clientOrderId: ref,
        ...(editingIssue ? { saleIssueId: editingIssue.issueId, saleIssueMode: "edit" } : {}),
      };
      const keepOnTill = async (why: "offline" | "timeout") => {
        // A manager's edit is a resend of a sale arcarna already holds on
        // Needs attention; keeping a second copy here would only confuse.
        if (editingIssue) {
          throw new Error("No connection, so the edit was not sent. The sale is still on Needs attention — try again when you are back online.");
        }
        await offlineStorage.queueMutation({
          type: 'ORDER_CREATE',
          method: 'POST',
          endpoint: '/api/orders',
          data: payload,
          clientOrderId: ref,
          queuedByUserId: (authUser as { id?: string } | null)?.id,
        });
        return { offline: true, why, orderId: null };
      };

      if (!navigator.onLine) return keepOnTill("offline");

      const outcome = await sendSale(payload);
      if (outcome.ok) return outcome.body;

      if (sendLeftSaleUncertain(outcome)) {
        // No answer, or a 5xx that may have come after the commit. On a slow
        // line the sale may well have been recorded, so ask before saying
        // anything — the cashier should hear the truth. Keeping it would
        // still be safe: the reference makes the replay a repeat.
        if (navigator.onLine) {
          const landed = await checkSaleLanded(ref);
          if (landed.result === "landed") return { ...landed.body, landedAfterTimeout: true };
        }
        if (outcome.status === null) {
          return keepOnTill(navigator.onLine && outcome.timedOut ? "timeout" : "offline");
        }
      }
      throw new Error(outcome.message);
    },
    onSuccess: async (data: any) => {
      const createdOrderId: string | undefined = data?.orderId ?? data?.order?.id;
      const hadNoDueTime = dueMinutes == null && !dueTime;

      if (data?.offline) {
        // It used to say "You're offline" for every failure, including a
        // server that was merely slow while the till was online.
        toast({
          title: "Sale saved on this till",
          description:
            data.why === "timeout"
              ? "arcarna did not answer in time, so this sale is saved on this till and will be sent automatically. It will only be recorded once."
              : "No connection. This sale is saved on this till and will be sent when the connection is back. It will only be recorded once.",
        });
      } else if (data?.earlierAttemptRecorded) {
        // The first try landed after all; the changes made since were not sent.
        const recordedTotal = Number(data?.order?.total);
        toast({
          title: "The first try of this sale was recorded",
          description: `It was recorded${Number.isFinite(recordedTotal) ? ` at £${recordedTotal.toFixed(2)}` : ""}. The changes made after it were not sent — edit that order if the sale changed.`,
          variant: "destructive",
          duration: 10000,
        });
      } else if (data?.duplicate || data?.landedAfterTimeout) {
        toast({
          title: "Order placed",
          description: data?.landedAfterTimeout
            ? "The connection was slow, but the sale reached arcarna."
            : "This sale was already recorded, so nothing was added twice.",
        });
      } else if (data?.warnings && data.warnings.length > 0) {
        // Order was created but with stock warnings
        toast({
          title: "Order On Hold",
          description: data.warnings.join(". ") + ". Order has been placed on hold.",
          variant: "destructive",
          duration: 8000,
        });
      } else {
        toast({
          title: "Order Placed",
          description: "Order has been successfully processed.",
          ...(createdOrderId && hadNoDueTime
            ? {
                action: (
                  <ToastAction
                    altText="Set a due time"
                    onClick={() =>
                      setDueFromToastMutation.mutate({
                        orderId: createdOrderId,
                        minutes: fulfilmentMethod === "delivery" ? 45 : 30,
                      })
                    }
                  >
                    Set a due time?
                  </ToastAction>
                ),
              }
            : {}),
        });
      }

      if (createdOrderId && !data?.offline) {
        embedded?.onPlaced(createdOrderId);
      }

      if (editingIssue) {
        void queryClient.invalidateQueries({ queryKey: ["/api/sale-issues"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/sale-issues/summary"] });
      }
      setEditingIssue(null);
      setSaleRef(newClientOrderId());
      setCart([]);
      setSelectedCustomer(null);
      // One customer's promotion must not follow the next sale.
      setAppliedPromo(null);
      setPromoCode("");
      setView("build");
      // Back to the default, or one delivery quietly marks every later sale on
      // this till as a delivery too.
      setFulfilmentMethod("collection");
      setDelivery(EMPTY_POS_DELIVERY);
      // Same reason: one backdated entry must not quietly date every later
      // sale on this till to last week.
      setOrderDate(localIsoDate());
      setOrderExpenses([]);
      // Nor may one split sale leave its rows and amounts for the next customer.
      setSplitPayment(false);
      setTenderLegs(freshSplitLegs());
      setExpenseDescription("");
      setExpenseAmount("");
      setChannel("pos");
      setDueMinutes(null);
      setDueTime("");
      setDueTouched(false);
      setAssigneeUserId("");
      await invalidateAfterPosCheckout(queryClient);

      // The lines editor is back on screen the instant the mutation settles;
      // give it focus so the next code can be rattled straight in. Retried
      // for a moment rather than one `requestAnimationFrame`: the element is
      // briefly `disabled` (still `submitting` for the render or two this
      // reset and the query invalidation above take to land), and a browser
      // silently refuses to focus a disabled control — the retry is what
      // makes this land once it stops being disabled rather than racing it.
      const focusProductSearch = (attempt: number) => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="line-product-new"]');
        if (input && !input.disabled) {
          input.focus();
          return;
        }
        if (attempt < 10) setTimeout(() => focusProductSearch(attempt + 1), 100);
      };
      focusProductSearch(0);
    },
    onError: (error: any) => {
      toast({
        title: "Order failed",
        description: error.message || "Failed to process the order",
        variant: "destructive",
      });
    },
  });

  // Adds a line, or bumps the quantity of the line the product is already on.
  // No toast: the line appearing in the editor is the confirmation.
  const addToCart = useCallback((product: Product) => {
    if (placeOrderMutation.isPending) return;
    const price = posPrice(product);

    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? {
                ...item,
                quantity: item.quantity + 1,
                subtotal: (item.quantity + 1) * item.customPrice,
              }
            : item
        );
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          customPrice: price,
          subtotal: price,
        },
      ];
    });
  }, [placeOrderMutation.isPending]);

  const addProductByBarcode = useCallback(
    async (code: string) => {
      const localMatch = products.find((product) => product.barcode === code);
      if (localMatch) {
        addToCart(localMatch);
        playScanSuccessBeep();
        return;
      }

      try {
        const res = await apiFetch(`/api/products/by-barcode/${encodeURIComponent(code)}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Product not found");
        const product = (await res.json()) as Product;
        addToCart(product);
        playScanSuccessBeep();
      } catch {
        playScanFailBeep();
        toast({
          title: "Unknown barcode",
          description: `No product matched "${code}". Add it by name or code instead.`,
          variant: "destructive",
        });
      }
    },
    [products, addToCart, toast],
  );

  useBarcodeScanner((code) => {
    // A scan while taking payment is almost always the next customer's first
    // item. Bring the lines back rather than adding to an order being paid.
    if (view === "pay") setView("build");
    void addProductByBarcode(code);
  });

  // The customer's tier, by the same rule priceOrder() prices with.
  const customerTier = useMemo(
    () => (selectedCustomer ? tierForPoints(selectedCustomer.loyaltyPoints ?? 0, loyaltyTiers) : null),
    [selectedCustomer, loyaltyTiers],
  );

  useEffect(() => {
    setRedeemPoints(0);
    setPointsRedemptionAmount(0);
    setRedeemInput("");
  }, [selectedCustomer?.id]);

  // Suggested due time follows fulfilment/channel (brief: delivery pre-selects
  // +45, Phone/WhatsApp pre-select +30) until the cashier picks — or explicitly
  // clears — one themselves.
  useEffect(() => {
    if (dueTouched) return;
    setDueTime("");
    if (fulfilmentMethod === "delivery") {
      setDueMinutes(45);
    } else if (channel === "phone" || channel === "whatsapp") {
      setDueMinutes(30);
    } else {
      setDueMinutes(null);
    }
  }, [fulfilmentMethod, channel, dueTouched]);

  const selectDueMinutes = useCallback((minutes: number) => {
    setDueTouched(true);
    setDueTime("");
    setDueMinutes((current) => (current === minutes ? null : minutes));
  }, []);

  const selectDueTime = useCallback((time: string) => {
    setDueTouched(true);
    setDueMinutes(null);
    setDueTime(time);
  }, []);

  const clearDue = useCallback(() => {
    setDueTouched(true);
    setDueMinutes(null);
    setDueTime("");
  }, []);

  // Mirrors the server: organizations.default_tax_rate, surfaced as vatRate.
  const taxRatePercent =
    orgSettings?.vatEnabled === false ? 0 : (orgSettings?.vatRate ?? DEFAULT_TAX_RATE_PERCENT);

  // One price (v1.2 Phase 1B): the same priceOrder() the server records the
  // sale with, so the total shown here — offline too — is the total charged
  // and every tender is checked against it. A promotion or points the rules
  // refuse are left off and said why, rather than shown and then refused.
  const { pricing, promoProblem, pointsProblemMessage } = useMemo(() => {
    const lines = cart.map((item) => ({ quantity: item.quantity, unitPrice: item.customPrice }));
    const base = {
      lines,
      taxRatePercent,
      customer: selectedCustomer ? { loyaltyPoints: selectedCustomer.loyaltyPoints ?? 0 } : null,
      tiers: loyaltyTiers,
    };
    const points =
      redeemPoints > 0 && selectedCustomer
        ? {
            points: redeemPoints,
            // The preview's own amount when settings have not loaded (offline, first run).
            redemptionRate: loyaltySettings?.redemptionRate ?? pointsRedemptionAmount / redeemPoints,
            minRedeemPoints: loyaltySettings?.minRedeemPoints ?? 0,
            balance: selectedCustomer.loyaltyPoints ?? 0,
          }
        : null;
    let promoProblem: string | null = null;
    let pointsProblemMessage: string | null = null;
    const attempt = (promotion: typeof appliedPromo, pts: typeof points) =>
      priceOrder({ ...base, promotion, points: pts });
    try {
      return { pricing: attempt(appliedPromo, points), promoProblem, pointsProblemMessage };
    } catch (e) {
      if (!(e instanceof PricingError)) throw e;
      if (e.code.startsWith("PROMO_")) promoProblem = e.message;
      else pointsProblemMessage = e.message;
    }
    // Drop the refused part and try again; a second refusal drops both.
    try {
      const pricing = promoProblem ? attempt(null, points) : attempt(appliedPromo, null);
      return { pricing, promoProblem, pointsProblemMessage };
    } catch (e) {
      if (!(e instanceof PricingError)) throw e;
      if (e.code.startsWith("PROMO_")) promoProblem = e.message;
      else pointsProblemMessage = e.message;
      return { pricing: attempt(null, null), promoProblem, pointsProblemMessage };
    }
  }, [cart, taxRatePercent, selectedCustomer, loyaltyTiers, appliedPromo, redeemPoints, loyaltySettings, pointsRedemptionAmount]);
  const subtotal = pricing.subtotal;
  const loyaltyDiscountAmount = pricing.tierDiscount;
  const loyaltyDiscount = pricing.tier?.percent ?? 0;
  const promoDiscountAmount = pricing.promoDiscount;
  const tax = pricing.vatAmount;
  const total = pricing.total;
  // Earned on what is paid — the server's rule, not a tier multiplier it never applied.
  const pointsEarned = pricing.pointsEarned;

  // What is still to be taken on a split payment. Negative means over-tendered.
  const splitRemaining =
    Math.round(
      (total -
        tenderLegs.reduce((sum, leg) => sum + (Number(leg.amount) || 0), 0)) *
        100,
    ) / 100;

  // Total item count (sum of quantities)
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // A pre-order (dated ahead) always needs a promise (brief, "Pre-orders") —
  // recomputed reactively so the payment step's hint and the guard below
  // agree with whatever `orderDate` is showing right now.
  const isPreorderDate = useMemo(() => {
    const verdict = classifyOrderDate(orderDate, localIsoDate());
    return verdict.ok && verdict.dating.kind === "preorder";
  }, [orderDate]);

  // The lines the Pay panel asks about. Personal use keeps its own Signal.
  const guardLines = useMemo(
    () => (priceGuard.enabled && paymentMethod !== "personal_use" ? flaggedCartLines(cart) : []),
    [priceGuard.enabled, paymentMethod, cart],
  );

  // Handle checkout: move to the payment step.
  const handleCheckout = useCallback(() => {
    if (placeOrderMutation.isPending) return;
    if (cart.length === 0) {
      toast({
        title: "Nothing on the order",
        description: "Add at least one line before continuing",
        variant: "destructive",
      });
      return;
    }
    setView("pay");
  }, [cart.length, placeOrderMutation.isPending, toast]);

  // Add expense to order
  const addExpense = () => {
    if (!expenseDescription || !expenseAmount) {
      toast({
        title: "Missing Information",
        description: "Please enter expense description and amount",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(expenseAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    setOrderExpenses([...orderExpenses, {
      category: expenseCategory,
      description: expenseDescription,
      amount
    }]);

    // Reset form
    setExpenseDescription("");
    setExpenseAmount("");

    toast({
      title: "Expense Added",
      description: `Added ${expenseCategory} expense: £${(isNaN(amount) ? 0 : amount).toFixed(2)}`,
    });
  };

  // Remove expense from order
  const removeExpense = (index: number) => {
    setOrderExpenses(orderExpenses.filter((_, i) => i !== index));
  };

  // Process payment
  const processPayment = () => {
    if (cart.length === 0) {
      toast({
        title: "Nothing on the order",
        description: "Add at least one line before continuing",
        variant: "destructive",
      });
      return;
    }
    if (placeOrderMutation.isPending) {
      toast({
        title: "Processing",
        description: "Please wait, order is being processed...",
        variant: "default",
      });
      return;
    }

    // Validate order expenses
    const totalExpenses = orderExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    if (totalExpenses > total) {
      toast({
        title: "Invalid Expenses",
        description: "Order expenses cannot exceed order total",
        variant: "destructive",
      });
      return;
    }

    if (paymentMethod === "gift_card") {
      if (!giftCardPayment?.code || giftCardPayment.amountToApply <= 0) {
        toast({ title: "Gift card required", description: "Look up a gift card and enter an amount to apply", variant: "destructive" });
        return;
      }
      const remainder = Math.round((total - giftCardPayment.amountToApply) * 100) / 100;
      if (remainder > 0.01 && !giftCardPayment.remainderPaymentMethod) {
        toast({ title: "Remainder payment required", description: "Choose how to pay the remaining balance", variant: "destructive" });
        return;
      }
    }

    // Checked here as well as on the server, so a date outside the window is
    // caught before the sale is sent rather than after the cashier thinks it
    // went through.
    const today = localIsoDate();
    const dateVerdict = classifyOrderDate(orderDate, today);
    if (!dateVerdict.ok) {
      toast({ title: "Check the order date", description: dateVerdict.message, variant: "destructive" });
      return;
    }

    // A pre-order with no promise is refused server-side too (every path,
    // including the website) — said here before the round trip rather than
    // after it.
    if (isPreorderDate && dueMinutes == null && !dueTime) {
      toast({
        title: "Set a due time",
        description: "Pre-orders need a due time before payment.",
        variant: "destructive",
      });
      return;
    }

    // A delivery needs somewhere to go (v1.2 Phase 5); the server refuses it too.
    if (fulfilmentMethod === "delivery" && (!delivery.address.trim() || !delivery.postcode.trim())) {
      toast({
        title: "Add the delivery address",
        description: "A delivery needs the address and postcode before payment.",
        variant: "destructive",
      });
      return;
    }

    const orderData: any = {
      ...deliveryOrderFields(fulfilmentMethod, delivery, selectedCustomer?.id ?? null),
      lines: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unitPrice: item.customPrice,
      })),
      paymentMethod: paymentMethod,
      fulfilmentMethod,
      channel,
      // Omitted for today: the server dates a live sale itself, in the org's
      // own timezone, so a till and a server either side of midnight cannot
      // disagree about which day "today" is.
      ...(dateVerdict.dating.kind !== "live" ? { orderDate: dateVerdict.dating.date } : {}),
    };
    if (dueTime) {
      orderData.dueTime = dueTime;
    } else if (dueMinutes != null) {
      orderData.dueInMinutes = dueMinutes;
    }
    if (assigneeUserId) {
      orderData.assignedUserId = assigneeUserId;
    }
    if (orderExpenses.length > 0) {
      orderData.expenses = orderExpenses;
    }
    if (splitPayment) {
      if (hasUnchosenMethod(tenderLegs)) {
        toast({
          title: "Say how each part was paid",
          description: "Pick Cash, Card, Transfer or On credit for every amount in the split.",
          variant: "destructive",
        });
        return;
      }
      const legs = tenderLegs
        .map((leg) => ({ method: leg.method, amount: Number(leg.amount) }))
        .filter((leg) => Number.isFinite(leg.amount) && leg.amount > 0);
      if (legs.length === 0) {
        toast({
          title: "Enter how it was paid",
          description: "A split payment needs at least one amount.",
          variant: "destructive",
        });
        return;
      }
      const legTotal = Math.round(legs.reduce((sum, leg) => sum + leg.amount, 0) * 100) / 100;
      // Checked here as well as on the server: a cashier who is a few pence out
      // should find out at the till, not after the sale is recorded.
      if (Math.abs(legTotal - total) > 0.005) {
        toast({
          title: "The split does not add up",
          description: `Payments come to £${legTotal.toFixed(2)}, the order is £${total.toFixed(2)}.`,
          variant: "destructive",
        });
        return;
      }
      orderData.payments = legs;
    }
    if (paymentMethod === "personal_use") {
      // Guarded here as well as on the server, so the cashier is told before
      // the request rather than after.
      if (personalUseReason.trim().length < 3) {
        toast({
          title: "Say what this is for",
          description: "Personal use needs a reason before it can be recorded.",
          variant: "destructive",
        });
        return;
      }
      orderData.personalUseReason = personalUseReason.trim();
    }
    if (paymentMethod === "gift_card" && giftCardPayment) {
      orderData.giftCardCode = giftCardPayment.code;
      orderData.giftCardAmount = giftCardPayment.amountToApply;
      if (giftCardPayment.remainderPaymentMethod) orderData.remainderPaymentMethod = giftCardPayment.remainderPaymentMethod;
    }

    // Credit needs someone to collect it from. Guarded here as well as on the
    // server, so the cashier finds out before the sale goes through rather
    // than after — a tick sale with no customer used to open a debt that
    // silently dropped off the credit list because that list only ever shows
    // customers, and nobody could see or chase it.
    const usesCredit =
      paymentMethod === "tick" ||
      (Array.isArray(orderData.payments) &&
        orderData.payments.some((leg: { method: string }) => leg.method === "tick"));
    if (usesCredit && !selectedCustomer?.id) {
      toast({
        title: "Select a customer",
        description: "A sale on credit needs a customer to put it against.",
        variant: "destructive",
      });
      return;
    }

    // Only include customerId if a customer is selected (Zod expects optional, not null)
    if (selectedCustomer?.id) {
      orderData.customerId = selectedCustomer.id;
    }
    // Only what the price above actually used, so the server prices the same
    // sale; it re-checks everything inside the sale and refuses a mismatch.
    if (pricing.pointsRedeemed > 0) {
      orderData.redeemPoints = pricing.pointsRedeemed;
    }
    if (pricing.promotion && appliedPromo?.code) {
      orderData.promoCode = appliedPromo.code;
    }
    if (paymentMethod !== "personal_use") {
      orderData.expectedTotal = total;
    }
    orderData.sendEmailReceipt = emailReceipt && customerHasEmail(selectedCustomer);

    // Price guard: one reason for the sale. Kept in the sale itself, so a
    // sale that has to queue offline carries its confirmation with it.
    if (guardLines.length > 0) {
      const problem = choiceProblem(priceGuard.choice);
      if (problem) {
        toast({ title: "Give a reason for the price", description: problem, variant: "destructive" });
        return;
      }
      orderData.priceGuard = buildConfirmation(priceGuard.choice, guardLines);
      if (priceGuard.choice.reason) priceGuard.afterSale(priceGuard.choice.reason);
    }

    placeOrderMutation.mutate(orderData);
  };

  const handleApplyRedeem = async () => {
    const pts = parseInt(redeemInput, 10);
    if (!selectedCustomer?.id || !pts) return;
    try {
      const res = await apiFetch("/api/loyalty/redeem-preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: selectedCustomer.id, points: pts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Redemption failed");
      setRedeemPoints(pts);
      setPointsRedemptionAmount(data.discountAmount);
      setRedeemPanelOpen(false);
      toast({ title: "Points applied", description: `£${data.discountAmount.toFixed(2)} discount` });
    } catch (e: any) {
      toast({ title: "Cannot redeem", description: e.message, variant: "destructive" });
    }
  };

  const cartPanelProps: PosCartPanelProps = {
    cart,
    cartItemCount,
    customers,
    filteredCustomers,
    customerSearch,
    setCustomerSearch,
    selectedCustomer,
    setSelectedCustomer,
    promoCode,
    setPromoCode,
    appliedPromo: appliedPromo as { name?: string } | null,
    setAppliedPromo,
    promoProblem,
    pointsProblem: pointsProblemMessage,
    validatePromoMutation,
    customerTier: customerTier as PosCartPanelProps["customerTier"],
    loyaltyDiscount,
    subtotal,
    loyaltyDiscountAmount,
    promoDiscountAmount,
    tax,
    taxRatePercent,
    total,
    pointsEarned,
    tierProgress,
    minRedeemPoints: loyaltySettings?.minRedeemPoints ?? 100,
    redeemPoints,
    // What the price actually took off — 0 when the points were refused.
    pointsRedemptionAmount: pricing.pointsDiscount,
    redeemPanelOpen,
    redeemInput,
    setRedeemInput,
    onOpenRedeemPanel: () => setRedeemPanelOpen(true),
    onApplyRedeem: handleApplyRedeem,
    onCancelRedeem: () => setRedeemPanelOpen(false),
    handleCheckout,
    orderSubmitting: placeOrderMutation.isPending,
  };

  const submitting = placeOrderMutation.isPending;

  return (
    <div
      ref={narrowRef}
      className={cn(
        "pos-shell @container flex flex-col overflow-hidden @[640px]:flex-row",
        embedded ? "h-full" : "pos-viewport",
      )}
    >
      {view === "pay" ? (
        <div className="min-h-0 flex-1">
          <PosCheckoutStep
            total={total}
            itemCount={cartItemCount}
            customerName={selectedCustomer?.name ?? null}
            customerEmail={
              selectedCustomer?.email ??
              selectedCustomer?.emailMasked ??
              (customerHasEmail(selectedCustomer) ? "the email on file" : null)
            }
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            personalUseReason={personalUseReason}
            setPersonalUseReason={setPersonalUseReason}
            splitPayment={splitPayment}
            setSplitPayment={toggleSplitPayment}
            tenderLegs={tenderLegs}
            setTenderLegs={setTenderLegs}
            splitRemaining={splitRemaining}
            orderDate={orderDate}
            setOrderDate={setOrderDate}
            fulfilmentMethod={fulfilmentMethod}
            setFulfilmentMethod={setFulfilmentMethod}
            delivery={delivery}
            setDelivery={setDelivery}
            customerId={selectedCustomer?.id ?? null}
            giftCardPayment={giftCardPayment}
            setGiftCardPayment={setGiftCardPayment}
            channel={channel}
            setChannel={setChannel}
            dueMinutes={dueMinutes}
            dueTime={dueTime}
            onSelectDueMinutes={selectDueMinutes}
            onSelectDueTime={selectDueTime}
            onClearDue={clearDue}
            duePreorderRequired={isPreorderDate}
            assigneeUserId={assigneeUserId}
            setAssigneeUserId={setAssigneeUserId}
            staff={staff}
            currentUserId={(authUser as { id?: string } | null)?.id ?? null}
            expenses={orderExpenses}
            expenseCategory={expenseCategory}
            setExpenseCategory={setExpenseCategory}
            expenseDescription={expenseDescription}
            setExpenseDescription={setExpenseDescription}
            expenseAmount={expenseAmount}
            setExpenseAmount={setExpenseAmount}
            onAddExpense={addExpense}
            onRemoveExpense={removeExpense}
            emailReceipt={emailReceipt}
            setEmailReceipt={setEmailReceipt}
            submitting={submitting}
            onBack={() => setView("build")}
            onConfirm={processPayment}
            priceGuardPanel={
              <PriceGuardPayPanel
                lines={guardLines}
                choice={priceGuard.choice}
                onChange={priceGuard.setChoice}
                managers={priceGuard.managers}
                disabled={submitting}
              />
            }
            confirmLabel={guardLines.length > 0 ? `Confirm and ${confirmVerb(paymentMethod)}` : undefined}
          />
        </div>
      ) : (
        <>
          {/* Step 1: the order itself. */}
          <div className="pos-products-panel flex min-h-0 flex-1 flex-col @[640px]:max-w-[62%] @[640px]:flex-[1.62]">
            {embedded ? (
              (sellingLocation || noLocationWillResolve) && (
                <div className="shrink-0 px-4 pb-2 pt-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-metal-muted">Step 1 of 2 · Build the order</p>
                  {sellingLocation ? (
                    <p className="mt-1 text-xs text-metal-muted" data-testid="pos-selling-location">
                      Selling at <span className="font-medium text-foreground">{sellingLocation.name}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs font-medium text-destructive" data-testid="pos-no-location-warning">
                      No selling location is set up. Ask an admin to set an organization default
                      location, or a default location for this user, before taking payment.
                    </p>
                  )}
                  <MyShiftSummary />
                </div>
              )
            ) : (
              <div className="pos-section-header shrink-0 px-4 pb-3 pt-3 sm:px-6 sm:pt-5">
                <PageHeader
                  className="mb-0 sm:flex-col sm:items-stretch sm:justify-start 2xl:flex-row 2xl:items-start 2xl:justify-between"
                  eyebrow="Step 1 of 2 · Build the order"
                  title="Create Order"
                  question={narrow ? undefined : "What is this customer buying?"}
                  explanation={narrow ? undefined : "Type a code or name, scan, or tap a top seller. Fix quantity and price on the line."}
                />
                {sellingLocation ? (
                  <p className="mt-2 text-xs text-metal-muted" data-testid="pos-selling-location">
                    Selling at <span className="font-medium text-foreground">{sellingLocation.name}</span>
                  </p>
                ) : noLocationWillResolve ? (
                  <p
                    className="mt-2 text-xs font-medium text-destructive"
                    data-testid="pos-no-location-warning"
                  >
                    No selling location is set up. Ask an admin to set an organization default
                    location, or a default location for this user, before taking payment.
                  </p>
                ) : null}
                <MyShiftSummary />
              </div>
            )}
            {editingIssue && (
              <div
                className="mx-4 mt-2 shrink-0 rounded-lg border border-metal-edge px-3 py-2 text-xs sm:mx-6"
                style={{ backgroundColor: "color-mix(in srgb, var(--warning) 12%, var(--card))" }}
                data-testid="pos-editing-sale-issue"
              >
                <span className="font-medium text-foreground">Editing a sale from Needs attention</span>
                {editingIssue.rungByName ? ` · rung by ${editingIssue.rungByName}` : ""}. It is recorded once, as
                their sale, when you take payment.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setEditingIssue(null);
                    setSaleRef(newClientOrderId());
                    setCart([]);
                  }}
                  data-testid="pos-editing-sale-issue-cancel"
                >
                  Stop editing
                </button>
              </div>
            )}

            {/* Plain overflow scrolling, not a scroll-area widget: touch
                scrolling and the on-screen keyboard both behave with the
                browser's own scroller. */}
            {/* Extra bottom room on phones so the last card can scroll clear of
                the app's floating assistant buttons. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-3 sm:px-6 sm:pb-6">
              {productsLoading ? (
                <p className="py-6 text-sm text-metal-muted" data-testid="pos-products-loading">
                  Loading the catalogue…
                </p>
              ) : (
                <PosOrderLines
                  products={products}
                  lines={cart}
                  onChange={setCart}
                  disabled={submitting}
                  aboveLines={<PosTopSellers products={products} onAdd={addToCart} disabled={submitting} />}
                  renderLineNote={
                    priceGuard.enabled
                      ? (line, index, setPrice) => <PriceGuardLineNote line={line} index={index} onUsePrice={setPrice} />
                      : undefined
                  }
                />
              )}

              {/* On a narrow form — a phone, or the Operations Centre's pane —
                  the customer, discounts and totals sit under the lines
                  rather than beside them. */}
              {narrow && (
                <div className="pos-mobile-summary mt-6 rounded-xl border border-metal-edge p-4" data-testid="pos-mobile-summary">
                  <PosCartPanel {...cartPanelProps} showCheckoutButton={false} />
                </div>
              )}
            </div>

            {narrow && (
              <div
                // Right padding keeps the button clear of the app's floating
                // chat launcher, which sits fixed in the bottom-right corner.
                className="pos-action-bar shrink-0 py-3 pl-4 pr-[4.75rem]"
                style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs text-metal-muted">
                      {cartItemCount} {cartItemCount === 1 ? "item" : "items"}
                      {selectedCustomer ? ` · ${selectedCustomer.name}` : ""}
                    </div>
                    <div className="text-2xl font-bold tabular-nums text-metal-warm-white" data-testid="mobile-order-total">
                      £{total.toFixed(2)}
                    </div>
                  </div>
                  <Button
                    onClick={handleCheckout}
                    size="lg"
                    className="lm-btn-metal min-h-[52px] shrink-0 gap-2 px-5 text-base font-semibold"
                    disabled={cart.length === 0 || submitting}
                    data-testid="mobile-checkout-button"
                  >
                    {submitting ? (
                      <>
                        <ActionLoader className="text-primary-foreground" />
                        Wait…
                      </>
                    ) : (
                      "Continue to payment"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* A wide enough form: customer, discounts and totals in a rail
              beside the lines rather than under them. */}
          {!narrow && (
            <div className="pos-cart-rail flex w-full flex-col overflow-y-auto border-l border-metal-edge p-4 max-w-[38%] flex-1">
              <PosCartPanel {...cartPanelProps} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
