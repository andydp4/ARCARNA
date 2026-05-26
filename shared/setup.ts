import { z } from "zod";
import { BUSINESS_TYPES, type Organization } from "./schema";
import { parseImportInteger, parseImportNumber } from "./importValues";

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

const zImportPriceRequired = z.preprocess(
  (v) => parseImportNumber(v),
  z
    .number({ required_error: "Sale price is required", invalid_type_error: "Invalid sale price" })
    .min(0, "Sale price cannot be negative"),
);

const zImportPriceOptional = z.preprocess(
  (v) => parseImportNumber(v),
  z.number({ invalid_type_error: "Invalid cost price" }).min(0, "Cost price cannot be negative").optional(),
);

const zImportIntOptional = z.preprocess(
  (v) => parseImportInteger(v),
  z
    .number({ invalid_type_error: "Invalid whole number" })
    .int("Must be a whole number")
    .min(0)
    .optional(),
);

export const productImportRowSchema = z.object({
  name: z.string().min(1, "Name is required"),
  productId: z.string().optional(),
  barcode: z.string().optional().nullable(),
  defaultSalePrice: zImportPriceRequired,
  costPrice: zImportPriceOptional,
  stock: zImportIntOptional,
  stockLimit: zImportIntOptional,
});

/** CSV header row — keep identical to TEMPLATES.products in setupImports.ts */
export const PRODUCT_IMPORT_CSV_HEADERS =
  "name,productId,barcode,defaultSalePrice,costPrice,stock,stockLimit";

export const PRODUCT_IMPORT_CSV_SAMPLE =
  `${PRODUCT_IMPORT_CSV_HEADERS}\nExample Product,SKU-001,1234567890123,9.99,5.00,10,100\n`;

const zImportEmail = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim();
}, z.string().email("Invalid email address").nullable().optional());

const zImportPhone = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim();
}, z.string().min(3, "Invalid phone number").nullable().optional());

export const customerImportRowSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: zImportEmail,
    phone: zImportPhone,
    address: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (!data.phone && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Phone or email is required",
        path: ["phone"],
      });
    }
  });

/** CSV header row for customer / contacts fallback import */
export const CUSTOMER_IMPORT_CSV_HEADERS = "name,email,phone,address,category";

export const CUSTOMER_IMPORT_CSV_SAMPLE =
  `${CUSTOMER_IMPORT_CSV_HEADERS}\nJane Smith,jane@example.com,07700900123,1 High Street,Bronze\n`;

export const DUPLICATE_MODES_PRODUCT = ["skip", "overwrite"] as const;
export const DUPLICATE_MODES_CUSTOMER = ["skip", "merge", "overwrite"] as const;
