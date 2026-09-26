import { STORAGE_PRICE_GUARD } from "@shared/storageKeys";
import {
  checkTillPrice,
  confirmationProblem,
  isPriceGuardReason,
  type PriceGuardConfirmation,
  type PriceGuardReason,
} from "@shared/pricing/priceGuard";
import { tillFloorOf } from "@/lib/tillFloor";
import { posPrice, type PosProduct } from "@/components/pos-types";

/**
 * The till's side of the price guard (v1.2 Phase 4, PRC-02). The rules are
 * shared with the server (shared/pricing/priceGuard.ts); this file only holds
 * what the till keeps between sales and how it reads its own cart.
 */

export type GuardManager = { id: string; name: string };

/** One flagged line, as the Pay panel lists it. */
export type TillFlaggedLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  floor: number;
  /** £ under the lowest price across the quantity. */
  under: number;
};

type CartLike = { product: PosProduct & { tillFloor?: unknown; minPrice?: unknown }; quantity: number; customPrice: number };

/** The till's check for one line, on the price it holds (set when the cashier left the price box). */
export function checkCartLine(line: CartLike) {
  return checkTillPrice({
    unitPrice: line.customPrice,
    floor: tillFloorOf(line.product as any),
    listPrice: posPrice(line.product),
  });
}

/** The lines the Pay panel asks about: every line whose price is below the lowest price. */
export function flaggedCartLines(cart: CartLike[]): TillFlaggedLine[] {
  const out: TillFlaggedLine[] = [];
  for (const line of cart) {
    const check = checkCartLine(line);
    if (check?.kind !== "below") continue;
    const under = Math.max(0, Math.round((check.floor - line.customPrice) * 100) * line.quantity) / 100;
    out.push({
      productId: line.product.id,
      name: line.product.name,
      quantity: line.quantity,
      unitPrice: line.customPrice,
      floor: check.floor,
      under: Math.round(under * 100) / 100,
    });
  }
  return out;
}

export type GuardChoice = { reason: PriceGuardReason | null; note: string; managerUserId: string };

/** The confirmation sent with the sale, and kept in it if it has to queue. */
export function buildConfirmation(choice: GuardChoice, lines: TillFlaggedLine[], now = new Date()): PriceGuardConfirmation | null {
  if (!choice.reason) return null;
  const c: PriceGuardConfirmation = {
    reason: choice.reason,
    lines: lines.map((l) => ({ productId: l.productId, unitPrice: l.unitPrice })),
    confirmedAt: now.toISOString(),
  };
  if (choice.note.trim()) c.note = choice.note.trim();
  if (choice.reason === "manager_agreed" && choice.managerUserId) c.managerUserId = choice.managerUserId;
  return c;
}

/** Why "Confirm and take payment" cannot go yet, or null. */
export function choiceProblem(choice: GuardChoice): string | null {
  if (!choice.reason) return "Pick a reason for the price.";
  return confirmationProblem({ reason: choice.reason, note: choice.note, managerUserId: choice.managerUserId || undefined });
}

// ---------------------------------------------------------------------------
// Kept on this device. Every read and write tolerates storage being missing.
// ---------------------------------------------------------------------------

type Stored = {
  enabled?: Record<string, boolean>;
  managers?: Record<string, GuardManager[]>;
  lastReason?: Record<string, PriceGuardReason>;
};

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_PRICE_GUARD);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(update: (s: Stored) => void): void {
  try {
    const s = read();
    update(s);
    localStorage.setItem(STORAGE_PRICE_GUARD, JSON.stringify(s));
  } catch {
    /* storage unavailable: the till still works online */
  }
}

export function cachedEnabled(orgKey: string): boolean {
  return read().enabled?.[orgKey] === true;
}

export function rememberEnabled(orgKey: string, enabled: boolean): void {
  write((s) => {
    s.enabled = { ...(s.enabled ?? {}), [orgKey]: enabled };
  });
}

export function cachedManagers(orgKey: string): GuardManager[] {
  const list = read().managers?.[orgKey];
  return Array.isArray(list) ? list.filter((m) => m && typeof m.id === "string" && typeof m.name === "string") : [];
}

export function rememberManagers(orgKey: string, managers: GuardManager[]): void {
  write((s) => {
    s.managers = { ...(s.managers ?? {}), [orgKey]: managers.map((m) => ({ id: m.id, name: m.name })) };
  });
}

export function lastReason(userKey: string): PriceGuardReason | null {
  const r = read().lastReason?.[userKey];
  return isPriceGuardReason(r) ? r : null;
}

export function rememberReason(userKey: string, reason: PriceGuardReason): void {
  write((s) => {
    s.lastReason = { ...(s.lastReason ?? {}), [userKey]: reason };
  });
}
