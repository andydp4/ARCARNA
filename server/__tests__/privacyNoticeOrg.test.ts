/**
 * Which org's privacy notice a link shows (PRV-15). A receipt carries the
 * issuing org as ?orgId=, and that must win over the shop site's env org, or
 * every other org's customers are shown the shop's notice and complaints
 * contact.
 */
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { resolvePrivacyOrgId } from "../routes/privacyNotice";

const reqWith = (query: Record<string, unknown>) => ({ query }) as never;

describe("resolvePrivacyOrgId", () => {
  const saved = { a: process.env.WM_SUPPLIES_ORG_ID, b: process.env.WM_SUPPLIES_WEBSITE_ORG_ID };
  afterEach(() => {
    process.env.WM_SUPPLIES_ORG_ID = saved.a;
    process.env.WM_SUPPLIES_WEBSITE_ORG_ID = saved.b;
    if (saved.a === undefined) delete process.env.WM_SUPPLIES_ORG_ID;
    if (saved.b === undefined) delete process.env.WM_SUPPLIES_WEBSITE_ORG_ID;
  });

  it("a receipt's ?orgId= wins over the shop site's org", () => {
    const shop = randomUUID();
    const other = randomUUID();
    process.env.WM_SUPPLIES_ORG_ID = shop;
    expect(resolvePrivacyOrgId(reqWith({ orgId: other }))).toBe(other);
  });

  it("falls back to the shop site's org when the link names none", () => {
    const shop = randomUUID();
    process.env.WM_SUPPLIES_ORG_ID = shop;
    expect(resolvePrivacyOrgId(reqWith({}))).toBe(shop);
  });

  it("a malformed ?orgId= resolves to nothing, not to the shop's org", () => {
    process.env.WM_SUPPLIES_ORG_ID = randomUUID();
    expect(resolvePrivacyOrgId(reqWith({ orgId: "not-a-uuid" }))).toBeNull();
  });

  it("no org anywhere is nothing", () => {
    delete process.env.WM_SUPPLIES_ORG_ID;
    delete process.env.WM_SUPPLIES_WEBSITE_ORG_ID;
    expect(resolvePrivacyOrgId(reqWith({}))).toBeNull();
  });
});
