/** Client-side persistence keys (ARCARNA rebrand). Legacy midnight.* keys migrated on read. */

export const STORAGE_ORG_ID = "arcarna.selectedOrgId";
export const STORAGE_ORG_ID_LEGACY = "midnight.selectedOrgId";

export const STORAGE_NOTIFICATIONS_DISMISSED = "arcarna.notifications.dismissed";
export const STORAGE_NOTIFICATIONS_DISMISSED_LEGACY = "midnight.notifications.dismissed";

export const STORAGE_COMMAND_PALETTE_RECENT = "arcarna-command-palette-recent";
export const STORAGE_COMMAND_PALETTE_RECENT_LEGACY = "midnight-command-palette-recent";

export const STORAGE_SHIFT_ID = "arcarna_currentShiftId";
export const STORAGE_SHIFT_ID_LEGACY = "midnight_currentShiftId";

export const STORAGE_WHATSAPP_DRAFT = "arcarna.whatsapp.draftOrder";
export const STORAGE_WHATSAPP_DRAFT_LEGACY = "midnight.whatsapp.draftOrder";

/** A Needs attention sale opened in the till for a manager to edit (v1.2 Phase 1A). */
export const STORAGE_SALE_ISSUE_DRAFT = "arcarna.saleIssue.draft";

export const STORAGE_WHATSAPP_SOUND = "arcarna.whatsapp.sound";
export const STORAGE_WHATSAPP_SOUND_LEGACY = "midnight.whatsapp.sound";

export const STORAGE_VOICE_STYLE = "arcarna.voice.style";

// Operations Centre — per-device preferences (docs/briefs/PHASE_N_OPERATIONS_CENTRE.md).
// Station is also stored server-side (ops_staff) so other people can see it;
// this local copy is only for an instant filter default before the first
// board fetch returns.
export const STORAGE_OPS_SOUND = "arcarna.ops.sound";
export const STORAGE_OPS_FILTER = "arcarna.ops.filter";
export const STORAGE_OPS_STATION = "arcarna.ops.station";
export const STORAGE_OPS_TAB = "arcarna.ops.tab";
export const STORAGE_OPS_CHIMED = "arcarna.ops.chimed";

export const OFFLINE_DB_PREFIX = "arcarna-epos-db";
export const OFFLINE_DB_PREFIX_LEGACY = "midnight-epos-db";

export function offlineDbNameForOrg(orgId: string): string {
  return `${OFFLINE_DB_PREFIX}--${orgId}`;
}

export function legacyOfflineDbNameForOrg(orgId: string): string {
  return `${OFFLINE_DB_PREFIX_LEGACY}--${orgId}`;
}

/** Copy legacy localStorage value to new key once, then return new value. */
export function migrateStorageKey(legacyKey: string, newKey: string): string | null {
  if (typeof localStorage === "undefined") return null;
  const current = localStorage.getItem(newKey);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) {
    localStorage.setItem(newKey, legacy);
    localStorage.removeItem(legacyKey);
    return legacy;
  }
  return null;
}

/** The sidebar pin (v1.2 Phase 3): remembered per device, like the other shell preferences. */
export const STORAGE_SIDEBAR_PINNED = "arcarna.sidebar.pinned";

/**
 * Price guard at the till (v1.2 Phase 4), per device: the switch and the
 * managers a cashier can name, kept so the till can check and confirm with no
 * connection; and each person's last reason, offered again next time.
 */
export const STORAGE_PRICE_GUARD = "arcarna.priceGuard";

/** This device's name from the fixed list (v1.2 Phase 8A): Till 1–6, Counter tablet, Phone 1–6. */
export const STORAGE_DEVICE_NAME = "arcarna.device.name";
/** "Problem?" reports kept on this device until it is back online (v1.2 Phase 8A). */
export const STORAGE_PROBLEM_QUEUE = "arcarna.problem.queue";
/** Usage events waiting to be sent from this device (v1.2 Phase 8B); never names anyone. */
export const STORAGE_USAGE_QUEUE = "arcarna.usage.queue";
/** A random id this browser made for itself, for the per-device usage limit (v1.2 Phase 8B). */
export const STORAGE_USAGE_DEVICE_KEY = "arcarna.usage.deviceKey";
/** When this device went offline, so a reload while offline still counts the gap (v1.2 Phase 8B). */
export const STORAGE_USAGE_OFFLINE_SINCE = "arcarna.usage.offlineSince";
