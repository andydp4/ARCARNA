/**
 * Keys for one-time UI remembered per account (table user_ui_seen, migration
 * 069). Namespaced "<thing>:<version>" so shipping a new version of a tour or
 * release note shows it once more — and only once — to everyone.
 */
export const UI_SEEN_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*:[A-Za-z0-9._-]{1,100}$/;

export function isUiSeenKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && UI_SEEN_KEY_PATTERN.test(value);
}

/** Account-level keys. The per-device localStorage keys these replace live beside each feature. */
export const whatsNewAccountKey = (version: string) => `whatsNew:${version}`;
export const opsTourAccountKey = (version: string) => `opsTour:${version}`;

/**
 * Each Centre's short tour (v1.2 Phase 3), e.g. "centreTour:stock-1.2.0".
 * Bump the version when a Centre's layout changes enough to show it again.
 */
export const CENTRE_TOUR_VERSION = "1.2.0";
export const centreTourAccountKey = (centre: string, version: string = CENTRE_TOUR_VERSION) =>
  `centreTour:${centre}-${version}`;

/** The Centres that have their own short tour; the Operations Centre keeps its board tour (opsTour). */
export const CENTRE_TOUR_CENTRES = ["control", "stock", "truths", "customer", "finance", "settings"] as const;

/**
 * The per-device flag for a Centre tour (useSeenOnce's legacyLocalKey). Test
 * harnesses seed it so the auto-starting overlay never sits over a journey.
 */
export const centreTourLocalKey = (centre: string, version: string = CENTRE_TOUR_VERSION) =>
  `arcarna.${centreTourAccountKey(centre, version)}`;
