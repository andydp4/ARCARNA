import { z } from "zod";
import { BUSINESS_TYPES, type Organization } from "./schema";

export { BUSINESS_TYPES, type BusinessType } from "./schema";
export type { Organization };

/** Org profile + setup fields returned by GET/PATCH /api/org/setup */
export type OrgSetup = Organization;

export const SETUP_WIZARD_STEPS = [
  "business",
  "business-type",
  "import-products",
  "import-customers",
  "branding",
  "review",
] as const;

export type SetupWizardStep = (typeof SETUP_WIZARD_STEPS)[number];

export const setupWizardStateSchema = z.object({
  currentStep: z.string().optional(),
  completedSteps: z.array(z.string()).optional(),
  draft: z.record(z.unknown()).optional(),
});

export type SetupWizardState = z.infer<typeof setupWizardStateSchema>;

export const orgProfilePatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  tradingName: z.string().max(255).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(1024).optional().nullable(),
  vatNumber: z.string().max(50).optional().nullable(),
  companyNumber: z.string().max(50).optional().nullable(),
  currency: z.string().max(10).optional(),
  timezone: z.string().max(64).optional(),
  businessType: z.enum(BUSINESS_TYPES).optional().nullable(),
  logoUrl: z.string().max(2048).optional().nullable(),
  invoiceTemplate: z.string().max(64).optional(),
  invoicePrefix: z.string().max(20).optional(),
  invoiceStartNumber: z.number().int().positive().optional(),
  paymentTerms: z.string().max(255).optional().nullable(),
  defaultTaxRate: z.union([z.string(), z.number()]).optional(),
  receiptFooter: z.string().max(1024).optional().nullable(),
  receiptStyle: z.string().max(32).optional(),
  accentStyle: z.string().max(32).optional(),
  businessColors: z.record(z.string()).optional().nullable(),
  setupWizardState: setupWizardStateSchema.optional(),
});

export type OrgProfilePatch = z.infer<typeof orgProfilePatchSchema>;

export const productImportRowSchema = z.object({
  name: z.string().min(1),
  productId: z.string().optional(),
  barcode: z.string().optional().nullable(),
  defaultSalePrice: z.union([z.string(), z.number()]),
  costPrice: z.union([z.string(), z.number()]).optional(),
  stock: z.union([z.string(), z.number()]).optional(),
  stockLimit: z.union([z.string(), z.number()]).optional(),
});

export const customerImportRowSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
});

export const DUPLICATE_MODES_PRODUCT = ["skip", "overwrite"] as const;
export const DUPLICATE_MODES_CUSTOMER = ["skip", "merge", "overwrite"] as const;
