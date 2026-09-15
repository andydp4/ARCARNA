import type { APIRequestContext, Page } from "@playwright/test";
import { ONBOARDING_STEPS } from "../../shared/onboarding";
import { STORAGE_ORG_ID } from "../../shared/storageKeys";
import { LATEST_WHATS_NEW_VERSION } from "../../shared/whatsNew";

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

  return orgId;
}
