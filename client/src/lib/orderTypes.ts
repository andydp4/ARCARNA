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
 * `BoardOrder` is the Operations Centre's card shape — exactly the payload
 * `GET /api/orders/board` returns (server/services/opsBoard.ts, N3a) and what
 * the SSE stream's `order` deltas carry. N1 declared it here ahead of the real
 * endpoint and filled the stage fields with `null` from an adapter over
 * `GET /api/orders`; N3a deleted that adapter (`useOpsBoard.ts` now reads the
 * real endpoint) and extended this type to the endpoint's full shape, so the
 * cards did not have to change at all.
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
 * One card on the board — exactly the `BoardOrder` shape
 * `GET /api/orders/board` returns (brief, API section) and what the SSE
 * stream's `{ type: 'order', order }` deltas carry (server/services/
 * opsBoard.ts). Every field the server can supply is here now (N3a); none of
 * this is optional because the real endpoint always sends all of it — a
 * field a future package cannot yet populate belongs on the server as `null`,
 * not as `undefined` here.
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
  originalEta: string | null;
  revisedEta: string | null;
  delayFlag: boolean;
  delayCause: string | null;
  delayReason: string | null;
  delayNotificationSentAt: string | null;
  delayResolution: string | null;
  /** N3b: who is dealing with it. Always null until a claim/assign writes it. */
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedAt: string | null;
  /** N3b: stage stamps. Null until a transition writes them. */
  heldAt: string | null;
  readyAt: string | null;
  customerArrivedAt: string | null;
  outForDeliveryAt: string | null;
  settledAt: string | null;
  /** `completed` event's `meta.actualAt`, else `settledAt` — see opsBoard.ts. */
  handoverAt: string | null;
  inputUserId: string | null;
  inputUserName: string | null;
  completedUserId: string | null;
  completedUserName: string | null;
  locationId: string | null;
  itemCount: number;
  /** First few order lines, formatted "<qty>× <name>" — see opsBoard.ts. */
  itemsPreview: string[];
  updatedAt: string | null;
}

/** Which lane a card belongs in. The board has exactly two. */
export type BoardLane = FulfilmentMethod;

export const BOARD_LANES: readonly BoardLane[] = ["collection", "delivery"] as const;

export function laneLabel(lane: BoardLane): string {
  return lane === "collection" ? "Collection" : "Delivery";
}
