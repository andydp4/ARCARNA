/**
 * The till's own per-person, per-trading-day shift id — kept in
 * localStorage so a reload does not lose track of it.
 *
 * Relocated from `pages/pos/shift-open.tsx` (Phase N, N6): that file's
 * `ShiftOpenModal` is gone (dead since the shift auto-opens on first sale,
 * migration 058) but these two functions are still exactly what
 * `OpsShiftControls` and `pos/shift-close.tsx` need to track which shift the
 * "Z-report so far" / "Close shift" controls act on.
 */
import {
  migrateStorageKey,
  STORAGE_SHIFT_ID,
  STORAGE_SHIFT_ID_LEGACY,
} from "@shared/storageKeys";

export function getStoredShiftId(): string | null {
  try {
    return migrateStorageKey(STORAGE_SHIFT_ID_LEGACY, STORAGE_SHIFT_ID);
  } catch {
    return null;
  }
}

export function setStoredShiftId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_SHIFT_ID, id);
    else localStorage.removeItem(STORAGE_SHIFT_ID);
  } catch {
    /* ignore */
  }
}
