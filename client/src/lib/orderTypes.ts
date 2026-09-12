/**
 * The order shapes the client reads, in one place that no page owns.
 *
 * Two types live here for two different reasons:
 *
 * `ApiOrderRow` is exactly what `GET /api/orders` projects today. It used to
 * be `OrdersListOrder`, declared inside `components/orders-row.tsx`, which
 * made every consumer of the *type* a consumer of that *component* — the
 * command palette imported a React row just to describe a cached array (see
 * docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, finding G24 and the N1 row of the
 * delete list). The row is deleted with Open Orders in N4b; the type is not.
 *
 * `BoardOrder` is the Operations Centre's card shape — the payload
 * `GET /api/orders/board` will return from N3a. It is declared now, in the
 * client, so the board is written against the real contract from its first
 * commit: v0 fills the stage fields the current orders table has no columns
 * for with `null` (see `toBoardOrder` in hooks/useOpsBoard.ts), and N3a swaps
 * the data source underneath without the cards changing at all.
 */
import type { DateKind, FulfilmentMethod } from "@shared/orders/opsState";

/** One row of `GET /api/orders` as it is projected today. */
export interface ApiOrderRow {
  id: string;
  customerId?: string | null;
  customerName?: string | null;
  total: string;
  paymentMethod: string;
  channel?: string | null;
  status: string;
  /** Added by migration 061; every row has one, defaulted to "collection". */
  fulfilmentMethod?: string | null;
  createdAt: string;
  /** live | backdated | preorder — whether createdAt is when it was keyed in or the day it is for. */
  dateKind?: string | null;
  /** When it was actually keyed in. Null on rows that predate migration 062. */
  enteredAt?: string | null;
  /** Who loaded it — this is where the inputter's 10% goes. */
  inputUserId?: string | null;
  inputUserName?: string | null;
  /** Already on the order and never shown on the old list: what is holding it up. */
  delayFlag?: boolean;
  delayReason?: string | null;
  revisedEta?: string | null;
  etaGiven?: string | null;
}

/**
 * One card on the board. Mirrors the `BoardOrder` shape in the brief's API
 * section; fields the v0 data source cannot supply are nullable rather than
 * optional so the adapter has to state, explicitly, that it does not have
 * them yet.
 */
export interface BoardOrder {
  id: string;
  /** First 8 characters of the id — what staff say out loud and search for. */
  shortCode: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  total: string;
  paymentMethod: string;
  channel: string;
  status: string;
  fulfilmentMethod: FulfilmentMethod;
  dateKind: DateKind;
  createdAt: string;
  enteredAt: string | null;
  etaGiven: string | null;
  revisedEta: string | null;
  delayFlag: boolean;
  delayReason: string | null;
  /** N3b: who is dealing with it. Always null until the column exists (N2). */
  assignedUserId: string | null;
  assignedUserName: string | null;
  /** N2 stage stamps. Null in v0 — nothing can write them yet. */
  heldAt: string | null;
  readyAt: string | null;
  customerArrivedAt: string | null;
  outForDeliveryAt: string | null;
  settledAt: string | null;
  inputUserId: string | null;
  inputUserName: string | null;
}

/** Which lane a card belongs in. The board has exactly two. */
export type BoardLane = FulfilmentMethod;

export const BOARD_LANES: readonly BoardLane[] = ["collection", "delivery"] as const;

export function laneLabel(lane: BoardLane): string {
  return lane === "collection" ? "Collection" : "Delivery";
}
