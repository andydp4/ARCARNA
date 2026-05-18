import { db } from "../db";
import { suppliers, productSuppliers, products } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export class SupplierError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function supplierErrorPayload(err: unknown) {
  if (err instanceof SupplierError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  return { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Unknown error" };
}

export async function listSuppliers(orgId: string, includeInactive = false) {
  const rows = await db
    .select()
    .from(suppliers)
    .where(
      includeInactive
        ? eq(suppliers.orgId, orgId)
        : and(eq(suppliers.orgId, orgId), eq(suppliers.isActive, 1)),
    )
    .orderBy(desc(suppliers.updatedAt));
  return rows;
}

export async function createSupplier(
  orgId: string,
  body: {
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    leadTimeDays?: number;
    minOrderValue?: string | number;
    minOrderQuantity?: number;
  },
) {
  if (!body.name?.trim()) {
    throw new SupplierError("VALIDATION_ERROR", "name is required");
  }
  const leadTimeDays = body.leadTimeDays ?? 0;
  if (leadTimeDays < 0) throw new SupplierError("VALIDATION_ERROR", "leadTimeDays must be >= 0");

  const [row] = await db
    .insert(suppliers)
    .values({
      orgId,
      name: body.name.trim(),
      contactName: body.contactName,
      email: body.email,
      phone: body.phone,
      leadTimeDays,
      minOrderValue: body.minOrderValue != null ? String(body.minOrderValue) : "0",
      minOrderQuantity: body.minOrderQuantity ?? 0,
      isActive: 1,
    })
    .returning();
  return row;
}

export async function updateSupplier(
  orgId: string,
  id: string,
  patch: Partial<{
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    leadTimeDays: number;
    minOrderValue: string | number;
    minOrderQuantity: number;
    isActive: number;
  }>,
) {
  const [existing] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.orgId, orgId)))
    .limit(1);
  if (!existing) throw new SupplierError("NOT_FOUND", "Supplier not found");

  if (patch.name !== undefined && !patch.name.trim()) {
    throw new SupplierError("VALIDATION_ERROR", "name is required");
  }
  if (patch.leadTimeDays !== undefined && patch.leadTimeDays < 0) {
    throw new SupplierError("VALIDATION_ERROR", "leadTimeDays must be >= 0");
  }
  if (patch.minOrderValue !== undefined && Number(patch.minOrderValue) < 0) {
    throw new SupplierError("VALIDATION_ERROR", "minOrderValue must be >= 0");
  }

  const [row] = await db
    .update(suppliers)
    .set({
      ...patch,
      name: patch.name?.trim() ?? existing.name,
      minOrderValue:
        patch.minOrderValue !== undefined ? String(patch.minOrderValue) : existing.minOrderValue,
      updatedAt: new Date(),
    })
    .where(and(eq(suppliers.id, id), eq(suppliers.orgId, orgId)))
    .returning();
  return row;
}

export async function softDeleteSupplier(orgId: string, id: string) {
  return updateSupplier(orgId, id, { isActive: 0 });
}

export async function listProductSuppliers(orgId: string, productId?: string, supplierId?: string) {
  const conditions = [eq(productSuppliers.orgId, orgId)];
  if (productId) conditions.push(eq(productSuppliers.productId, productId));
  if (supplierId) conditions.push(eq(productSuppliers.supplierId, supplierId));

  return db
    .select({
      id: productSuppliers.id,
      orgId: productSuppliers.orgId,
      productId: productSuppliers.productId,
      supplierId: productSuppliers.supplierId,
      supplierSku: productSuppliers.supplierSku,
      costPrice: productSuppliers.costPrice,
      packSize: productSuppliers.packSize,
      minOrderQty: productSuppliers.minOrderQty,
      leadTimeOverrideDays: productSuppliers.leadTimeOverrideDays,
      isPreferred: productSuppliers.isPreferred,
      createdAt: productSuppliers.createdAt,
      updatedAt: productSuppliers.updatedAt,
      productName: products.name,
      supplierName: suppliers.name,
    })
    .from(productSuppliers)
    .innerJoin(products, eq(productSuppliers.productId, products.id))
    .innerJoin(suppliers, eq(productSuppliers.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(desc(productSuppliers.updatedAt));
}

async function assertProductInOrg(orgId: string, productId: string) {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.orgId, orgId)))
    .limit(1);
  if (!p) throw new SupplierError("PRODUCT_NOT_FOUND", "Product not found in org");
}

async function assertSupplierInOrg(orgId: string, supplierId: string) {
  const [s] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.orgId, orgId), eq(suppliers.isActive, 1)))
    .limit(1);
  if (!s) throw new SupplierError("SUPPLIER_NOT_FOUND", "Supplier not found or inactive in org");
}

export async function createProductSupplier(
  orgId: string,
  body: {
    productId: string;
    supplierId: string;
    supplierSku?: string;
    costPrice?: string | number;
    packSize?: number;
    minOrderQty?: number;
    leadTimeOverrideDays?: number | null;
    isPreferred?: boolean;
  },
) {
  await assertProductInOrg(orgId, body.productId);
  await assertSupplierInOrg(orgId, body.supplierId);

  const packSize = body.packSize ?? 1;
  if (packSize < 1) throw new SupplierError("VALIDATION_ERROR", "packSize must be >= 1");
  if (body.minOrderQty != null && body.minOrderQty < 1) {
    throw new SupplierError("VALIDATION_ERROR", "minOrderQty must be >= 1 when present");
  }
  if (body.costPrice != null && Number(body.costPrice) < 0) {
    throw new SupplierError("VALIDATION_ERROR", "costPrice must be >= 0 when present");
  }

  const isPreferred = body.isPreferred ? 1 : 0;

  return db.transaction(async (tx) => {
    if (isPreferred) {
      await tx
        .update(productSuppliers)
        .set({ isPreferred: 0, updatedAt: new Date() })
        .where(
          and(eq(productSuppliers.orgId, orgId), eq(productSuppliers.productId, body.productId)),
        );
    }

    const [row] = await tx
      .insert(productSuppliers)
      .values({
        orgId,
        productId: body.productId,
        supplierId: body.supplierId,
        supplierSku: body.supplierSku,
        costPrice: body.costPrice != null ? String(body.costPrice) : null,
        packSize,
        minOrderQty: body.minOrderQty ?? 1,
        leadTimeOverrideDays: body.leadTimeOverrideDays ?? null,
        isPreferred,
      })
      .returning();
    return row;
  });
}

export async function updateProductSupplier(
  orgId: string,
  id: string,
  patch: Partial<{
    supplierSku: string | null;
    costPrice: string | number | null;
    packSize: number;
    minOrderQty: number;
    leadTimeOverrideDays: number | null;
    isPreferred: boolean;
  }>,
) {
  const [existing] = await db
    .select()
    .from(productSuppliers)
    .where(and(eq(productSuppliers.id, id), eq(productSuppliers.orgId, orgId)))
    .limit(1);
  if (!existing) throw new SupplierError("NOT_FOUND", "Product-supplier mapping not found");

  if (patch.packSize !== undefined && patch.packSize < 1) {
    throw new SupplierError("VALIDATION_ERROR", "packSize must be >= 1");
  }
  if (patch.minOrderQty !== undefined && patch.minOrderQty < 1) {
    throw new SupplierError("VALIDATION_ERROR", "minOrderQty must be >= 1 when present");
  }
  if (patch.costPrice != null && Number(patch.costPrice) < 0) {
    throw new SupplierError("VALIDATION_ERROR", "costPrice must be >= 0 when present");
  }

  const isPreferred = patch.isPreferred === true ? 1 : patch.isPreferred === false ? 0 : undefined;

  return db.transaction(async (tx) => {
    if (isPreferred === 1) {
      await tx
        .update(productSuppliers)
        .set({ isPreferred: 0, updatedAt: new Date() })
        .where(
          and(
            eq(productSuppliers.orgId, orgId),
            eq(productSuppliers.productId, existing.productId),
          ),
        );
    }

    const [row] = await tx
      .update(productSuppliers)
      .set({
        supplierSku: patch.supplierSku ?? existing.supplierSku,
        costPrice:
          patch.costPrice !== undefined
            ? patch.costPrice == null
              ? null
              : String(patch.costPrice)
            : existing.costPrice,
        packSize: patch.packSize ?? existing.packSize,
        minOrderQty: patch.minOrderQty ?? existing.minOrderQty,
        leadTimeOverrideDays:
          patch.leadTimeOverrideDays !== undefined
            ? patch.leadTimeOverrideDays
            : existing.leadTimeOverrideDays,
        isPreferred: isPreferred ?? existing.isPreferred,
        updatedAt: new Date(),
      })
      .where(and(eq(productSuppliers.id, id), eq(productSuppliers.orgId, orgId)))
      .returning();
    return row;
  });
}

export async function deleteProductSupplier(orgId: string, id: string) {
  const [row] = await db
    .delete(productSuppliers)
    .where(and(eq(productSuppliers.id, id), eq(productSuppliers.orgId, orgId)))
    .returning();
  if (!row) throw new SupplierError("NOT_FOUND", "Product-supplier mapping not found");
  return row;
}
