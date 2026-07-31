/**
 * Per-organisation branding for generated documents.
 *
 * Shared by invoice and receipt PDFs so both read as the same business. Kept in
 * one place deliberately: duplicated branding logic is how one document ends up
 * branded and another silently doesn't.
 */
import { fetchInvoiceLogo } from "./invoiceLogo";

export type CompanyInfo = {
  name: string;
  address?: string;
  companyNumber?: string;
  vatNumber?: string;
  email?: string;
  logo?: Buffer;
  bankName?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  paymentLink?: string;
  currency?: string;
};

type OrgBrandingFields = {
  name: string;
  tradingName: string | null;
  address: string | null;
  companyNumber: string | null;
  vatNumber: string | null;
  email: string | null;
  currency: string | null;
  invoiceBankName: string | null;
  invoiceBankSortCode: string | null;
  invoiceBankAccountNumber: string | null;
  invoicePaymentLink: string | null;
};

/**
 * Fetches the org's logo bytes, if a logo is configured and enabled for
 * documents. Never throws — a missing logo must not fail a document.
 */
export async function loadOrgLogo(org: {
  invoiceLogoEnabled: boolean;
  logoUrl: string | null;
}): Promise<Buffer | undefined> {
  if (!org.invoiceLogoEnabled || !org.logoUrl) return undefined;
  try {
    return await fetchInvoiceLogo(org.logoUrl);
  } catch (error) {
    console.error("[CompanyBranding] Failed to fetch logo:", error);
    return undefined;
  }
}

export function buildCompanyInfo(org: OrgBrandingFields, logo: Buffer | undefined): CompanyInfo {
  return {
    name: org.tradingName || org.name,
    address: org.address || undefined,
    companyNumber: org.companyNumber || undefined,
    vatNumber: org.vatNumber || undefined,
    email: org.email || undefined,
    logo,
    bankName: org.invoiceBankName || undefined,
    bankSortCode: org.invoiceBankSortCode || undefined,
    bankAccountNumber: org.invoiceBankAccountNumber || undefined,
    paymentLink: org.invoicePaymentLink || undefined,
    currency: org.currency || "GBP",
  };
}

/** Loads and builds the company block for an org, logo included. */
export async function loadCompanyInfo(orgId: string | null): Promise<CompanyInfo> {
  if (!orgId) return { name: "Your business" };
  const { organizations } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../db");

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return { name: "Your business" };
  const logo = await loadOrgLogo(org);
  return buildCompanyInfo(org, logo);
}
