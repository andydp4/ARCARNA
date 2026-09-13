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

export const STORAGE_WHATSAPP_SOUND = "arcarna.whatsapp.sound";
export const STORAGE_WHATSAPP_SOUND_LEGACY = "midnight.whatsapp.sound";

export const STORAGE_VOICE_ENABLED = "arcarna.voice.enabled";
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
