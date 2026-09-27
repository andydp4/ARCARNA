/**
 * Arcarna Assistant orchestration — wires the pure QuickEntryEngine to
 * product and customer lookup. Called directly by Ask arcarna's draft_order
 * tool (server/ask/tools.ts); the standalone typed/mic command bar this used
 * to serve over HTTP is gone (v1.2.1: Ask arcarna replaced it entirely).
 *
 * v1.2 Phase 1B (owner Q19): the assistant never saves an order. A resolved
 * draft goes back to the app, which opens it in the till; the till prices it
 * and takes payment, so an order started this way is charged by the same
 * rules as any other sale. The Siri Shortcut route is gone.
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
  opts: { customer?: { id: string; name: string } } = {},
): Promise<AssistantTurnResult> {
  const products = await getProductsForAssistant(orgId);
  const turn = processQuickEntryTurn(draft, text, products);
  // A customer already picked by id (Ask arcarna, after "which one?"): used
  // as-is, whatever name the text carried, so two customers with the same
  // name, or a name the parser cannot read, can still be ordered for.
  if (opts.customer && turn.draft && turn.draft.items.length > 0) {
    return applyCustomerMatches(
      { ...turn.draft, customerName: opts.customer.name, customerResolved: false, customerCandidates: undefined },
      [opts.customer],
    );
  }
  if (!needsCustomerLookup(turn.draft)) return turn;
  const candidates = await findCustomerCandidatesByName(orgId, turn.draft.customerName ?? "", 5);
  return applyCustomerMatches(
    turn.draft,
    candidates.map((c) => ({ id: c.id, name: c.name })),
  );
}
