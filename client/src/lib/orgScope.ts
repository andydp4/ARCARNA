import {
  migrateStorageKey,
  STORAGE_ORG_ID,
  STORAGE_ORG_ID_LEGACY,
  STORAGE_CASHIER_ID,
  STORAGE_CASHIER_SHIFT_ID,
  STORAGE_CASHIER_SHIFT_REPLAY_TOKEN,
} from "@shared/storageKeys";

export function getSelectedOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return migrateStorageKey(STORAGE_ORG_ID_LEGACY, STORAGE_ORG_ID);
}

export function setSelectedOrgId(orgId: string | null): void {
  if (typeof window === "undefined") return;
  if (orgId) localStorage.setItem(STORAGE_ORG_ID, orgId);
  else localStorage.removeItem(STORAGE_ORG_ID);
}

/** Active cashier profile id for the current POS session, if cashier commission is enabled. */
export function getActiveCashierId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_CASHIER_ID);
  } catch {
    return null;
  }
}

export function setActiveCashierId(cashierId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (cashierId) localStorage.setItem(STORAGE_CASHIER_ID, cashierId);
    else localStorage.removeItem(STORAGE_CASHIER_ID);
  } catch {
    /* ignore */
  }
}

/** Active cashier shift id, kept in sync alongside the cashier id so offline-queued
 * orders can carry their original cashier/shift context even if the shift later
 * auto-closes before the order syncs. */
export function getActiveCashierShiftId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_CASHIER_SHIFT_ID);
  } catch {
    return null;
  }
}

export function setActiveCashierShiftId(cashierShiftId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (cashierShiftId) localStorage.setItem(STORAGE_CASHIER_SHIFT_ID, cashierShiftId);
    else localStorage.removeItem(STORAGE_CASHIER_SHIFT_ID);
  } catch {
    /* ignore */
  }
}

export function getActiveCashierShiftReplayToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_CASHIER_SHIFT_REPLAY_TOKEN);
  } catch {
    return null;
  }
}

export function setActiveCashierShiftReplayToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) localStorage.setItem(STORAGE_CASHIER_SHIFT_REPLAY_TOKEN, token);
    else localStorage.removeItem(STORAGE_CASHIER_SHIFT_REPLAY_TOKEN);
  } catch {
    /* ignore */
  }
}

export function orgScopeHeaders(): Record<string, string> {
  const orgId = getSelectedOrgId();
  const cashierId = getActiveCashierId();
  return {
    ...(orgId ? { "X-Org-Id": orgId } : {}),
    ...(cashierId ? { "X-Cashier-Id": cashierId } : {}),
  };
}
