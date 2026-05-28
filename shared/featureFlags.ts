/**
 * Known feature flags — allow-list for settings UI and server validation.
 * Add new in-progress features here before gating code with useFlag / isFlagEnabled.
 */
export const KNOWN_FEATURE_FLAGS = [
  {
    key: "spatialWorkspace",
    label: "Spatial workspace (Aurora)",
    description: "Experimental core-orbit UI preset on Insights (?spatial=1).",
    defaultEnabled: false,
  },
  {
    key: "newCheckout",
    label: "New checkout flow",
    description: "Gated checkout UX experiments (not yet wired).",
    defaultEnabled: false,
  },
] as const;

export type KnownFeatureFlagKey = (typeof KNOWN_FEATURE_FLAGS)[number]["key"];

export const KNOWN_FLAG_KEYS: KnownFeatureFlagKey[] = KNOWN_FEATURE_FLAGS.map((f) => f.key);

export function isKnownFeatureFlag(flag: string): flag is KnownFeatureFlagKey {
  return (KNOWN_FLAG_KEYS as readonly string[]).includes(flag);
}
