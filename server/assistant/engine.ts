/**
 * Arcarna Assistant orchestration — wires the pure QuickEntryEngine to
 * product and customer lookup, for the typed command bar and the mic.
 *
 * v1.2 Phase 1B (owner Q19): the assistant never saves an order. A confirmed
 * draft goes back to the app, which opens it in the till; the till prices it
 * and takes payment, so a spoken order is charged by the same rules as any
 * other sale. The Siri Shortcut route is gone.
 */
import {
  applyCustomerMatches,
  needsCustomerLookup,
  processQuickEntryTurn,
  type QuickEntryDraft,
  type QuickEntryTurnResult,
} from "./quickEntry";
import { findCustomerCandidatesByName, getProductsForAssistant } from "./store";

export type AssistantTurnResult = QuickEntryTurnResult;

/** Advances the conversation by one turn. Reads only; writes nothing. */
export async function runAssistantTurn(
  orgId: string,
  draft: QuickEntryDraft | null | undefined,
  text: string,
): Promise<AssistantTurnResult> {
  const products = await getProductsForAssistant(orgId);
  const turn = processQuickEntryTurn(draft, text, products);
  if (!needsCustomerLookup(turn.draft)) return turn;
  const candidates = await findCustomerCandidatesByName(orgId, turn.draft.customerName ?? "", 5);
  return applyCustomerMatches(
    turn.draft,
    candidates.map((c) => ({ id: c.id, name: c.name })),
  );
}
