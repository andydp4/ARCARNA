import type { APIRequestContext, Page } from "@playwright/test";
import { ONBOARDING_STEPS } from "../../shared/onboarding";
import { STORAGE_ORG_ID } from "../../shared/storageKeys";
import { LATEST_WHATS_NEW_VERSION } from "../../shared/whatsNew";
import { LATEST_OPS_TOUR_VERSION, opsTourSeenKey } from "../../shared/opsTour";
import { CENTRE_TOUR_CENTRES, FEATURE_TOURS, centreTourLocalKey, featureTourLocalKey } from "../../shared/uiSeen";

/** Dev bypass SUPER_ADMIN needs org scope + completed onboarding before tenant routes render. */
export async function prepareTenantContext(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const orgsRes = await request.get("/api/orgs");
  if (!orgsRes.ok()) throw new Error(`GET /api/orgs failed: ${orgsRes.status()}`);
  const orgs = (await orgsRes.json()) as { id: string }[];
  const orgId = orgs[0]?.id;
  if (!orgId) throw new Error("No organization available for e2e — seed dev DB first");

  for (const step of ONBOARDING_STEPS) {
    const res = await request.patch("/api/onboarding/step", {
      headers: { "X-Org-Id": orgId },
      data: { step, completed: true },
    });
    if (!res.ok()) {
      throw new Error(`PATCH onboarding step ${step} failed: ${res.status()}`);
    }
  }

  const saleRes = await request.post("/api/onboarding/complete-first-sale", {
    headers: { "X-Org-Id": orgId },
  });
  if (!saleRes.ok()) {
    throw new Error(`POST complete-first-sale failed: ${saleRes.status()}`);
  }

  await page.addInitScript((storageKey, id) => {
    localStorage.setItem(storageKey, id);
  }, STORAGE_ORG_ID, orgId);

  // A fresh Playwright context has never dismissed `WhatsNewModal`, so
  // without this every a11y run would hit its auto-opening dialog — the
  // exact "unrelated dialog on the page" failure mode this suite otherwise
  // has no way to anticipate. Marking the current release seen mirrors any
  // real returning user, not a first-ever-login one, which is the state
  // this suite actually means to test.
  await page.addInitScript((version) => {
    localStorage.setItem(`whatsNew:seen:${version}`, "1");
  }, LATEST_WHATS_NEW_VERSION);

  // Same reasoning, for `OpsTour`'s auto-opening spotlight tour: a fresh
  // context has never dismissed it either.
  await page.addInitScript((key) => {
    localStorage.setItem(key, "1");
  }, opsTourSeenKey(LATEST_OPS_TOUR_VERSION));
  // And each Centre's tour (v1.2 Phase 3): it auto-starts on the first page
  // of every Centre but Operations, and its full-screen overlay would take
  // the journey's first click (or the a11y scan) on those pages.
  await page.addInitScript((keys) => {
    for (const key of keys) localStorage.setItem(key, "1");
  }, [
    ...CENTRE_TOUR_CENTRES.map((centre) => centreTourLocalKey(centre)),
    // And each v1.2 feature tour (Phase 9): it starts on its own the moment
    // its feature is on screen (My run's stops, the label printer card…),
    // mid-journey, not just on arrival.
    ...FEATURE_TOURS.map((feature) => featureTourLocalKey(feature)),
  ]);

  return orgId;
}
