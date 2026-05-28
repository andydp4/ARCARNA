import { KNOWN_FEATURE_FLAGS, isKnownFeatureFlag } from "@shared/featureFlags";
import { storage } from "./storage";

type CacheEntry = { enabled: boolean; expiresAt: number };

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(orgId: string, flag: string): string {
  return `${orgId}:${flag}`;
}

export function invalidateFeatureFlagCache(orgId: string, flag?: string): void {
  if (flag) {
    cache.delete(cacheKey(orgId, flag));
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${orgId}:`)) cache.delete(key);
  }
}

export async function isFlagEnabled(orgId: string, flag: string): Promise<boolean> {
  const key = cacheKey(orgId, flag);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.enabled;
  }
  const row = await storage.getFeatureFlag(orgId, flag);
  const known = KNOWN_FEATURE_FLAGS.find((f) => f.key === flag);
  const enabled = row?.enabled ?? known?.defaultEnabled ?? false;
  cache.set(key, { enabled, expiresAt: Date.now() + CACHE_TTL_MS });
  return enabled;
}

export function assertKnownFlag(flag: string): void {
  if (!isKnownFeatureFlag(flag)) {
    throw new Error(`Unknown feature flag: ${flag}`);
  }
}
