/**
 * The payment step of the order form.
 *
 * This used to be a dialog stacked on top of the cart sheet. On Android the
 * two portals fought over focus and scroll lock, the dialog was sized in
 * static vh so the keyboard pushed its footer off screen, and now and then it
 * simply did not appear. It is now a step of the page: the lines slide away,
 * this takes their place, and the confirm bar is pinned to the real bottom of
 * the viewport with the keyboard accounted for (see .pos-viewport).
 *
 * Payment type is a row of tap targets rather than a dropdown, because six
 * options fit on a phone and a dropdown is one more floating layer. The
 * rarer controls (split tender, expenses, gift card) keep their selects; they
 * sit in normal page flow where a select behaves.
 */
import { ArrowLeft, CreditCard, DollarSign, Mail, Plus, Receipt, ShoppingBag, Smartphone, Ticket, Trash2, Truck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActionLoader } from "@/components/action-loader";
import { GiftCardPayment, type GiftCardPaymentState } from "@/pages/pos/payments/GiftCardPayment";
import {
  BACKDATE_LIMIT_DAYS,
  PREORDER_LIMIT_DAYS,
  classifyOrderDate,
  localIsoDate,
  orderDateWindow,
} from "@shared/orders/orderDate";
import { cn } from "@/lib/utils";

export type TenderLeg = { method: string; amount: string };
export type OrderExpense = { category: string; description: string; amount: number };

export const PAYMENT_OPTIONS = [
  { value: "cash", label: "Cash", Icon: DollarSign },
  { value: "card", label: "Card", Icon: CreditCard },
  { value: "transfer", label: "Transfer", Icon: Smartphone },
  { value: "tick", label: "On credit", Icon: Receipt },
  { value: "gift_card", label: "Gift card", Icon: Ticket },
  { value: "personal_use", label: "Personal use", Icon: UserRound },
] as const;

export type PosCheckoutStepProps = {
  total: number;
  itemCount: number;
  customerName: string | null;
  customerEmail: string | null;

  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  personalUseReason: string;
  setPersonalUseReason: (v: string) => void;

  splitPayment: boolean;
  setSplitPayment: (v: boolean) => void;
  tenderLegs: TenderLeg[];
  setTenderLegs: React.Dispatch<React.SetStateAction<TenderLeg[]>>;
  splitRemaining: number;

  orderDate: string;
  setOrderDate: (v: string) => void;
  fulfilmentMethod: "collection" | "delivery";
  setFulfilmentMethod: (v: "collection" | "delivery") => void;

  giftCardPayment: GiftCardPaymentState | null;
  setGiftCardPayment: (v: GiftCardPaymentState | null) => void;

  expenses: OrderExpense[];
  expenseCategory: string;
  setExpenseCategory: (v: string) => void;
  expenseDescription: string;
  setExpenseDescription: (v: string) => void;
  expenseAmount: string;
  setExpenseAmount: (v: string) => void;
  onAddExpense: () => void;
  onRemoveExpense: (index: number) => void;

  emailReceipt: boolean;
  setEmailReceipt: (v: boolean) => void;

  submitting: boolean;
  onBack: () => void;
  onConfirm: () => void;
};

export function PosCheckoutStep(p: PosCheckoutStepProps) {
  const today = localIsoDate();
  const window = orderDateWindow(today);
  const verdict = classifyOrderDate(p.orderDate, today);
  const kind = verdict.ok ? verdict.dating.kind : null;
  const expenseTotal = p.expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="pos-checkout-step flex h-full min-h-0 flex-col" data-testid="pos-checkout-step">
      <div className="flex items-center gap-2 border-b border-metal-edge px-4 py-3 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label="Back to the order"
          onClick={p.onBack}
          disabled={p.submitting}
          data-testid="button-checkout-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-metal-muted">Step 2 of 2 · Take payment</p>
          <h2 className="truncate text-lg font-semibold tracking-tight text-metal-warm-white">
            £{p.total.toFixed(2)} · {p.itemCount} {p.itemCount === 1 ? "item" : "items"}
            {p.customerName ? ` · ${p.customerName}` : ""}
          </h2>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-5">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-metal-warm-white" id="payment-method-label">
                How are they paying?
              </span>
              <label className="flex items-center gap-2 text-xs text-metal-muted">
                Split
                <Switch
                  checked={p.splitPayment}
                  onCheckedChange={p.setSplitPayment}
                  aria-label="Split across payment types"
                  data-testid="switch-split-payment"
                />
              </label>
            </div>

            {p.splitPayment ? (
              <div className="space-y-2">
                {/* Each row is one tender. They have to add up to the order —
                    a split that does not is a sale with money unaccounted for. */}
                {p.tenderLegs.map((leg, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select
                      value={leg.method}
                      onValueChange={(v) =>
                        p.setTenderLegs((legs) => legs.map((l, i) => (i === index ? { ...l, method: v } : l)))
                      }
                    >
                      <SelectTrigger className="min-h-[44px] flex-1" aria-label={`Payment type ${index + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="transfer">Transfer</SelectItem>
                        <SelectItem value="tick">On credit</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className="min-h-[44px] w-28"
                      value={leg.amount}
                      aria-label={`Amount ${index + 1}`}
                      data-testid={`input-tender-amount-${index}`}
                      onChange={(e) =>
                        p.setTenderLegs((legs) => legs.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))
                      }
                    />
                    {p.tenderLegs.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        aria-label={`Remove payment ${index + 1}`}
                        onClick={() => p.setTenderLegs((legs) => legs.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="lm-btn-outline min-h-[44px]"
                    onClick={() => p.setTenderLegs((legs) => [...legs, { method: "cash", amount: "" }])}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add payment
                  </Button>
                  {/* The number a cashier actually needs: what is left to take. */}
                  <span
                    className={cn("text-sm font-medium", p.splitRemaining === 0 ? "text-metal-muted" : "text-warning")}
                    data-testid="text-split-remaining"
                  >
                    {p.splitRemaining === 0
                      ? "Adds up"
                      : p.splitRemaining > 0
                        ? `£${p.splitRemaining.toFixed(2)} left to take`
                        : `£${Math.abs(p.splitRemaining).toFixed(2)} over`}
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="payment-method-label" data-testid="select-payment">
                {PAYMENT_OPTIONS.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={p.paymentMethod === value}
                    onClick={() => p.setPaymentMethod(value)}
                    className="pos-pay-option flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-metal-titanium"
                    data-testid={`payment-method-${value}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                    <span className="leading-tight">{label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {!p.splitPayment && p.paymentMethod === "personal_use" && (
            <section>
              <label className="mb-2 block text-sm font-medium text-metal-warm-white" htmlFor="personal-use-reason">
                What is this for?
              </label>
              <Input
                id="personal-use-reason"
                value={p.personalUseReason}
                onChange={(e) => p.setPersonalUseReason(e.target.value)}
                placeholder="e.g. staff lunch, damaged stock written off to staff"
                data-testid="input-personal-use-reason"
                className="min-h-[44px]"
              />
              {/* Said plainly at the till rather than discovered afterwards:
                  this is recorded, costed, and a manager is told. */}
              <p className="mt-2 text-xs text-metal-muted">
                This is not a sale. The stock comes off, the cost goes on today's expenses, and a manager is notified.
              </p>
            </section>
          )}

          {!p.splitPayment && p.paymentMethod === "gift_card" && (
            <GiftCardPayment orderTotal={p.total} value={p.giftCardPayment} onChange={p.setGiftCardPayment} />
          )}

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="mb-2 block text-sm font-medium text-metal-warm-white" id="fulfilment-label">
                Fulfilment
              </span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="fulfilment-label">
                {(["collection", "delivery"] as const).map((method) => (
                  <Button
                    key={method}
                    type="button"
                    role="radio"
                    aria-checked={p.fulfilmentMethod === method}
                    variant={p.fulfilmentMethod === method ? "default" : "outline"}
                    className="min-h-[44px] capitalize"
                    onClick={() => p.setFulfilmentMethod(method)}
                    data-testid={`select-fulfilment-${method}`}
                  >
                    {method === "collection" ? (
                      <ShoppingBag className="mr-2 h-4 w-4" aria-hidden />
                    ) : (
                      <Truck className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    {method}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-metal-warm-white" htmlFor="order-date">
                Order date
              </label>
              <Input
                id="order-date"
                type="date"
                value={p.orderDate}
                min={window.min}
                max={window.max}
                onChange={(e) => p.setOrderDate(e.target.value || today)}
                className="min-h-[44px]"
                aria-describedby="order-date-hint"
                data-testid="input-order-date"
              />
              {/* Said at the till, before the sale goes through: a dated order
                  lands on that day's figures and is marked as keyed in late or
                  ahead, so nobody mistakes it for a live sale afterwards. */}
              <p id="order-date-hint" className="mt-2 text-xs text-metal-muted" data-testid="text-order-date-hint">
                {!verdict.ok
                  ? verdict.message
                  : kind === "backdated"
                    ? `Backdated: recorded as a sale on ${p.orderDate} and marked as entered late.`
                    : kind === "preorder"
                      ? `Pre-order: recorded against ${p.orderDate} and marked as a pre-order.`
                      : `Today. Up to ${BACKDATE_LIMIT_DAYS} days back for a missed day, or ${PREORDER_LIMIT_DAYS} days ahead for a pre-order.`}
              </p>
            </div>
          </section>

          <details className="lm-card-muted rounded-lg border border-metal-edge" open={p.expenses.length > 0}>
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-metal-warm-white">
              Order expenses{expenseTotal > 0 ? ` · £${expenseTotal.toFixed(2)}` : " (optional)"}
            </summary>
            <div className="space-y-3 px-4 pb-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={p.expenseCategory} onValueChange={p.setExpenseCategory}>
                  <SelectTrigger className="min-h-[44px] w-full sm:w-[130px]" data-testid="select-expense-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shipping">Shipping</SelectItem>
                    <SelectItem value="travel">Travel</SelectItem>
                    <SelectItem value="packaging">Packaging</SelectItem>
                    <SelectItem value="handling">Handling</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Description"
                  value={p.expenseDescription}
                  onChange={(e) => p.setExpenseDescription(e.target.value)}
                  className="min-h-[44px] flex-1"
                  data-testid="input-expense-desc"
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="0.00"
                    type="text"
                    inputMode="decimal"
                    value={p.expenseAmount}
                    onChange={(e) => p.setExpenseAmount(e.target.value)}
                    className="min-h-[44px] w-full sm:w-[100px]"
                    data-testid="input-expense-amt"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={p.onAddExpense}
                    variant="outline"
                    className="lm-btn-outline min-h-[44px] min-w-[44px]"
                    aria-label="Add expense"
                    data-testid="button-add-order-expense"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {p.expenses.length > 0 && (
                <div className="space-y-1">
                  {p.expenses.map((expense, index) => (
                    <div key={index} className="flex items-center justify-between gap-2 py-1 text-sm">
                      <span className="flex-1 break-words text-metal-muted">
                        {expense.category}: {expense.description}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-medium">£{expense.amount.toFixed(2)}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => p.onRemoveExpense(index)}
                          className="h-9 w-9"
                          aria-label={`Remove expense ${expense.description}`}
                          data-testid={`button-remove-expense-${index}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between pt-1 font-medium">
                    <span>Total expenses</span>
                    <span>£{expenseTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
          </details>

          <label className="lm-card-muted flex cursor-pointer items-start gap-3 rounded-lg border border-metal-edge p-3">
            <Checkbox
              id="email-receipt"
              checked={p.emailReceipt}
              disabled={!p.customerEmail}
              onCheckedChange={(v) => p.setEmailReceipt(v === true)}
              data-testid="checkbox-email-receipt"
            />
            <span className="space-y-1">
              <span className="flex items-center gap-2 text-sm font-medium leading-none text-metal-warm-white">
                <Mail className="h-4 w-4" />
                Email receipt
              </span>
              <span className="block text-xs text-metal-muted">
                {p.customerEmail ? `Send to ${p.customerEmail}` : "Pick a customer with an email address to send one"}
              </span>
            </span>
          </label>
        </div>
      </div>

      <div
        // Right padding on phones keeps the button clear of the app's floating
        // chat launcher, fixed in the bottom-right corner.
        className="pos-action-bar shrink-0 py-3 pl-4 pr-[4.75rem] sm:px-6"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs text-metal-muted">
              {p.customerName ?? "Walk-in"} · {p.itemCount} {p.itemCount === 1 ? "item" : "items"}
            </div>
            <div className="text-2xl font-bold tabular-nums text-metal-warm-white" data-testid="checkout-total">
              £{p.total.toFixed(2)}
            </div>
          </div>
          <Button
            type="button"
            onClick={p.onConfirm}
            disabled={p.itemCount === 0 || p.submitting}
            aria-label={p.itemCount === 0 ? "Payment disabled – add items first" : "Confirm payment"}
            data-testid="button-confirm-payment"
            className="lm-btn-metal min-h-[52px] shrink-0 gap-2 px-5 text-base font-semibold"
            size="lg"
          >
            {p.submitting ? (
              <>
                <ActionLoader className="text-primary-foreground" />
                Processing…
              </>
            ) : (
              "Confirm payment"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
