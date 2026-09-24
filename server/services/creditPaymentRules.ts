/**
 * The checks every credit payment passes before it reaches the ledger, and
 * the Signal it may raise afterwards (v1.2 Phase 0B, FIX-12 / FIX-13).
 *
 * Both credit routes (per order, and per customer account) record payments,
 * so both go through here rather than each deciding for itself.
 */
import {
  checkCreditPaidOn,
  creditPaymentNeedsSignal,
  parseCreditPaymentMethod,
  requireCreditPaymentMethod,
  type CreditPaymentMethod,
  type CreditRuleFailure,
} from "@shared/creditPolicy";
import { tradingDayTodayForOrg } from "./creditLedger";
import { findOpenShiftForUser } from "../middleware/requireOpenShift";
import { notify } from "./signals";
import { resolveUserName } from "./userDisplayName";

export type CreditPaymentTerms = { method: CreditPaymentMethod; paidOn: string | undefined };

/** Method and date, validated. `paidOn` is undefined for today (the ledger stamps it). */
export async function creditPaymentTerms(
  orgId: string,
  body: { method?: unknown; paidOn?: unknown } | undefined,
  recorderRole: string | null | undefined,
  options: { methodRequired?: boolean } = {},
): Promise<{ ok: true; terms: CreditPaymentTerms } | CreditRuleFailure> {
  const method = options.methodRequired
    ? requireCreditPaymentMethod(body?.method)
    : parseCreditPaymentMethod(body?.method);
  if (!method.ok) return method;
  const hasDate = body?.paidOn !== undefined && body?.paidOn !== null && body?.paidOn !== "";
  // Only a dated payment needs the org's today, so the ordinary case costs nothing extra.
  const today = hasDate ? await tradingDayTodayForOrg(orgId) : "";
  const date = hasDate ? checkCreditPaidOn(body?.paidOn, today, recorderRole) : ({ ok: true, paidOn: null } as const);
  if (!date.ok) return date;
  return { ok: true, terms: { method: method.method, paidOn: date.paidOn ?? undefined } };
}

/**
 * The till drawer a payment taken today goes against: the recorder's own open
 * shift, the same rule a desk refund follows (ARC-015). Nobody with a till
 * open means no drawer — never a phantom shift opened as a side effect.
 * A backdated payment has none: that day's drawer has already been counted.
 */
export async function drawerForCreditPayment(
  orgId: string,
  recorderUserId: string | null | undefined,
  terms: CreditPaymentTerms,
): Promise<string | null> {
  if (terms.paidOn || !recorderUserId) return null;
  const shift = await findOpenShiftForUser(orgId, recorderUserId);
  return shift?.id ?? null;
}

/**
 * A card or transfer payment recorded below admin tells the people above the
 * person who recorded it. The recorder is the Signal's subject, so it never
 * reaches them or their peers (shared/signals.ts).
 */
export async function signalCreditPayment(input: {
  orgId: string;
  recorderUserId: string | null | undefined;
  recorderRole: string | null | undefined;
  method: CreditPaymentMethod;
  amount: number;
  customerName?: string | null;
  orderIds: string[];
  paidOn?: string | null;
  /** Taken with Take a payment at the till (v1.2.1), not from the Credit List. */
  atTill?: boolean;
}): Promise<void> {
  if (!creditPaymentNeedsSignal(input.method, input.recorderRole)) return;
  const who = input.recorderUserId ? await resolveUserName(input.recorderUserId) : "Someone";
  const methodLabel = input.method === "card" ? "card" : "bank transfer";
  const forWhom = input.customerName ? ` from ${input.customerName}` : "";
  const dated = input.paidOn ? ` dated ${input.paidOn}` : "";
  await notify({
    orgId: input.orgId,
    title: "Credit payment by " + methodLabel,
    message: input.atTill
      ? `${who} took £${input.amount.toFixed(2)}${forWhom} by ${methodLabel} at the till against their credit. It is not part of a sale, so check it is in the card takings.`
      : `${who} recorded £${input.amount.toFixed(2)}${forWhom} by ${methodLabel}${dated}. It did not go through the till, so check it arrived.`,
    severity: "info",
    source: "credit_payment",
    subjectUserId: input.recorderUserId ?? null,
    metadata: {
      method: input.method,
      amount: input.amount,
      orderIds: input.orderIds,
      recordedByUserId: input.recorderUserId ?? null,
      paidOn: input.paidOn ?? null,
    },
  });
}
