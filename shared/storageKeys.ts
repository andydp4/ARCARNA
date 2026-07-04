/** Client-side persistence keys (ARCARNA rebrand). Legacy midnight.* keys migrated on read. */

export const STORAGE_ORG_ID = "arcarna.selectedOrgId";
export const STORAGE_ORG_ID_LEGACY = "midnight.selectedOrgId";

export const STORAGE_NOTIFICATIONS_DISMISSED = "arcarna.notifications.dismissed";
export const STORAGE_NOTIFICATIONS_DISMISSED_LEGACY = "midnight.notifications.dismissed";

export const STORAGE_COMMAND_PALETTE_RECENT = "arcarna-command-palette-recent";
export const STORAGE_COMMAND_PALETTE_RECENT_LEGACY = "midnight-command-palette-recent";

export const STORAGE_SHIFT_ID = "arcarna_currentShiftId";
export const STORAGE_SHIFT_ID_LEGACY = "midnight_currentShiftId";

export const STORAGE_CASHIER_ID = "arcarna_activeCashierId";
export const STORAGE_CASHIER_SHIFT_ID = "arcarna_activeCashierShiftId";
export const STORAGE_CASHIER_SHIFT_REPLAY_TOKEN = "arcarna_activeCashierShiftReplayToken";

export const STORAGE_WHATSAPP_DRAFT = "arcarna.whatsapp.draftOrder";
export const STORAGE_WHATSAPP_DRAFT_LEGACY = "midnight.whatsapp.draftOrder";

export const STORAGE_WHATSAPP_SOUND = "arcarna.whatsapp.sound";
export const STORAGE_WHATSAPP_SOUND_LEGACY = "midnight.whatsapp.sound";

export const STORAGE_VOICE_ENABLED = "arcarna.voice.enabled";
export const STORAGE_VOICE_STYLE = "arcarna.voice.style";

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
