import { db } from "../db";
import {
  productLocationStock,
  productSuppliers,
  suppliers,
  locations,
  products,
  type ReplenishmentActionType,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { getSmartStock } from "./operationalIntelligence";
import { createTransfer } from "./inventoryTransfers";
import { createPurchaseDraft } from "./purchaseDrafts";

export type ReplenishmentRisk = "low" | "medium" | "high" | "critical";

export type TransferSourceSuggestion = {
  locationId: string;
  locationName: string;
  availableQty: number;
  suggestedQty: number;
};

export type SelectedSupplierInfo = {
  supplierId: string;
  supplierName: string;
  supplierSku: string | null;
  costPrice: string | null;
  packSize: number;
  minOrderQty: number;
  leadTimeDays: number;
};

export type ReplenishmentRecommendation = {
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  actionType: ReplenishmentActionType;
  risk: ReplenishmentRisk;
  stock: number;
  stockLimit: number;
  velocityPerDay: number;
  daysToDepletion: number | null;
  targetCoverageDays: number;
  requiredQty: number;
  transferableQty: number;
  buyQty: number;
  roundedBuyQty: number;
  transferSources: TransferSourceSuggestion[];
  selectedSupplier: SelectedSupplierInfo | null;
  explain: {
    whyAction: string;
    packNotes: string[];
    warnings: string[];
  };
};

function roundUpToPack(qty: number, packSize: number) {
  if (packSize <= 1) return qty;
  return Math.ceil(qty / packSize) * packSize;
}

function selectSupplier(
  mappings: {
    supplierId: string;
    supplierName: string;
    supplierSku: string | null;
    costPrice: string | null;
    packSize: number;
    minOrderQty: number | null;
    leadTimeOverrideDays: number | null;
    isPreferred: number;
    supplierLeadTimeDays: number;
  }[],
): SelectedSupplierInfo | null {
  if (!mappings.length) return null;
  const sorted = [...mappings].sort((a, b) => {
    if (b.isPreferred !== a.isPreferred) return b.isPreferred - a.isPreferred;
    const leadA = a.leadTimeOverrideDays ?? a.supplierLeadTimeDays;
    const leadB = b.leadTimeOverrideDays ?? b.supplierLeadTimeDays;
    if (leadA !== leadB) return leadA - leadB;
    const costA = a.costPrice != null ? Number(a.costPrice) : Number.MAX_SAFE_INTEGER;
    const costB = b.costPrice != null ? Number(b.costPrice) : Number.MAX_SAFE_INTEGER;
    if (costA !== costB) return costA - costB;
    if (a.supplierName !== b.supplierName) return a.supplierName.localeCompare(b.supplierName);
    return a.supplierId.localeCompare(b.supplierId);
  });
  const s = sorted[0];
  return {
    supplierId: s.supplierId,
    supplierName: s.supplierName,
    supplierSku: s.supplierSku,
    costPrice: s.costPrice,
    packSize: s.packSize,
    minOrderQty: s.minOrderQty ?? 1,
    leadTimeDays: s.leadTimeOverrideDays ?? s.supplierLeadTimeDays,
  };
}

function computeSurplus(stock: number, stockLimit: number, velocity: number) {
  const coverTarget = Math.ceil(velocity * 14);
  const surplusByVelocity = stock - coverTarget;
  const surplusByLimit = stock - stockLimit;
  return Math.max(0, Math.max(surplusByVelocity, surplusByLimit));
}

export async function getReplenishmentRecommendations(
  orgId: string,
  opts: {
    locationId?: string;
    productId?: string;
    risk?: ReplenishmentRisk;
    actionType?: ReplenishmentActionType;
    targetCoverageDays?: number;
    limit?: number;
    offset?: number;
  },
) {
  const targetCoverageDays = opts.targetCoverageDays ?? 14;
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const smart = await getSmartStock(orgId);
  const smartByProduct = new Map(smart.items.map((i) => [i.productId, i]));

  const plsConditions = [eq(productLocationStock.orgId, orgId)];
  if (opts.locationId) plsConditions.push(eq(productLocationStock.locationId, opts.locationId));
  if (opts.productId) plsConditions.push(eq(productLocationStock.productId, opts.productId));

  const plsRows = await db
    .select({
      productId: productLocationStock.productId,
      locationId: productLocationStock.locationId,
      stock: productLocationStock.stock,
      stockLimit: productLocationStock.stockLimit,
      productName: products.name,
      sku: products.productId,
      locationName: locations.name,
    })
    .from(productLocationStock)
    .innerJoin(products, eq(productLocationStock.productId, products.id))
    .innerJoin(locations, eq(productLocationStock.locationId, locations.id))
    .where(and(...plsConditions));

  const allPls = await db
    .select({
      productId: productLocationStock.productId,
      locationId: productLocationStock.locationId,
      stock: productLocationStock.stock,
      stockLimit: productLocationStock.stockLimit,
      locationName: locations.name,
    })
    .from(productLocationStock)
    .innerJoin(locations, eq(productLocationStock.locationId, locations.id))
    .where(eq(productLocationStock.orgId, orgId));

  const psRows = await db
    .select({
      productId: productSuppliers.productId,
      supplierId: productSuppliers.supplierId,
      supplierName: suppliers.name,
      supplierSku: productSuppliers.supplierSku,
      costPrice: productSuppliers.costPrice,
      packSize: productSuppliers.packSize,
      minOrderQty: productSuppliers.minOrderQty,
      leadTimeOverrideDays: productSuppliers.leadTimeOverrideDays,
      isPreferred: productSuppliers.isPreferred,
      supplierLeadTimeDays: suppliers.leadTimeDays,
      minOrderValue: suppliers.minOrderValue,
    })
    .from(productSuppliers)
    .innerJoin(suppliers, eq(productSuppliers.supplierId, suppliers.id))
    .where(and(eq(productSuppliers.orgId, orgId), eq(suppliers.isActive, 1)));

  const suppliersByProduct = new Map<string, typeof psRows>();
  for (const row of psRows) {
    const list = suppliersByProduct.get(row.productId) ?? [];
    list.push(row);
    suppliersByProduct.set(row.productId, list);
  }

  const recommendations: ReplenishmentRecommendation[] = [];

  for (const row of plsRows) {
    const smartItem = smartByProduct.get(row.productId);
    const velocity = smartItem?.velocityPerDay ?? 0;
    const risk = (smartItem?.riskLevel ?? "low") as ReplenishmentRisk;
    const daysToDepletion = smartItem?.daysToDepletion ?? null;

    const targetStock = Math.ceil(velocity * targetCoverageDays);
    const requiredQty = Math.max(0, targetStock - row.stock);

    const transferSources: TransferSourceSuggestion[] = [];
    let transferableQty = 0;

    if (requiredQty > 0) {
      let remaining = requiredQty;
      const sources = allPls
        .filter((p) => p.productId === row.productId && p.locationId !== row.locationId)
        .map((p) => ({
          ...p,
          surplus: computeSurplus(p.stock, p.stockLimit, velocity),
        }))
        .filter((p) => p.surplus > 0)
        .sort((a, b) => b.surplus - a.surplus);

      for (const src of sources) {
        if (remaining <= 0) break;
        const take = Math.min(src.surplus, remaining);
        transferSources.push({
          locationId: src.locationId,
          locationName: src.locationName,
          availableQty: src.surplus,
          suggestedQty: take,
        });
        transferableQty += take;
        remaining -= take;
      }
    }

    const buyQty = Math.max(0, requiredQty - transferableQty);
    const supplierMappings = suppliersByProduct.get(row.productId) ?? [];
    const selectedSupplier = selectSupplier(supplierMappings);
    const packSize = selectedSupplier?.packSize ?? 1;
    let roundedBuyQty = buyQty > 0 ? roundUpToPack(buyQty, packSize) : 0;

    const packNotes: string[] = [];
    const warnings: string[] = [];

    if (buyQty > 0 && roundedBuyQty > buyQty) {
      packNotes.push(`Rounded up to pack size of ${packSize} (${roundedBuyQty} units)`);
    }

    if (selectedSupplier && roundedBuyQty > 0) {
      const minQty = selectedSupplier.minOrderQty;
      if (roundedBuyQty < minQty) {
        packNotes.push(`Increased to supplier minimum order qty of ${minQty}`);
        roundedBuyQty = minQty;
      }
      const mapping = supplierMappings.find((m) => m.supplierId === selectedSupplier.supplierId);
      if (mapping?.minOrderValue != null && selectedSupplier.costPrice) {
        const lineValue = roundedBuyQty * Number(selectedSupplier.costPrice);
        const minVal = Number(mapping.minOrderValue);
        if (minVal > 0 && lineValue < minVal) {
          warnings.push(
            `Estimated order value £${lineValue.toFixed(2)} is below supplier minimum £${minVal.toFixed(2)}`,
          );
        }
      }
    }

    if (!selectedSupplier && buyQty > 0) {
      warnings.push("No supplier mapping — configure product-supplier in Settings");
    }

    let actionType: ReplenishmentActionType = "NO_ACTION";
    let whyAction = "Stock meets target coverage";

    if (requiredQty <= 0) {
      actionType = "NO_ACTION";
    } else if (transferableQty >= requiredQty && roundedBuyQty === 0) {
      actionType = "TRANSFER";
      whyAction = `Can cover ${requiredQty} units from internal surplus before purchasing`;
    } else if (transferableQty === 0 && roundedBuyQty > 0) {
      actionType = "BUY";
      whyAction = `No transferable surplus; purchase ${roundedBuyQty} units`;
    } else if (transferableQty > 0 && roundedBuyQty > 0) {
      actionType = "TRANSFER_PLUS_BUY";
      whyAction = `Transfer ${transferableQty} units internally, buy remaining ${roundedBuyQty}`;
    } else if (transferableQty > 0) {
      actionType = "TRANSFER";
      whyAction = `Partial internal transfer available (${transferableQty} of ${requiredQty})`;
    }

    if (opts.risk && risk !== opts.risk) continue;
    if (opts.actionType && actionType !== opts.actionType) continue;

    recommendations.push({
      productId: row.productId,
      productName: row.productName,
      sku: row.sku,
      locationId: row.locationId,
      locationName: row.locationName,
      actionType,
      risk,
      stock: row.stock,
      stockLimit: row.stockLimit,
      velocityPerDay: velocity,
      daysToDepletion,
      targetCoverageDays,
      requiredQty,
      transferableQty,
      buyQty,
      roundedBuyQty,
      transferSources,
      selectedSupplier,
      explain: {
        whyAction,
        packNotes,
        warnings,
      },
    });
  }

  recommendations.sort((a, b) => {
    const riskOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    return riskOrder[b.risk] - riskOrder[a.risk];
  });

  const total = recommendations.length;
  const page = recommendations.slice(offset, offset + limit);

  const summary = {
    total,
    noAction: recommendations.filter((r) => r.actionType === "NO_ACTION").length,
    transfer: recommendations.filter((r) => r.actionType === "TRANSFER").length,
    buy: recommendations.filter((r) => r.actionType === "BUY").length,
    transferPlusBuy: recommendations.filter((r) => r.actionType === "TRANSFER_PLUS_BUY").length,
    highRisk: recommendations.filter((r) => r.risk === "high" || r.risk === "critical").length,
  };

  return { targetCoverageDays, summary, items: page, offset, limit };
}

export async function createTransferDraftFromRecommendation(
  orgId: string,
  body: {
    toLocationId: string;
    items: { productId: string; fromLocationId: string; quantity: number }[];
    notes?: string;
    requestedBy?: string;
  },
) {
  if (!body.items.length) {
    throw new Error("At least one transfer line required");
  }

  const bySource = new Map<string, { productId: string; quantity: number }[]>();
  for (const line of body.items) {
    const list = bySource.get(line.fromLocationId) ?? [];
    list.push({ productId: line.productId, quantity: line.quantity });
    bySource.set(line.fromLocationId, list);
  }

  const created = [];
  for (const [fromLocationId, items] of bySource) {
    const transfer = await createTransfer(orgId, {
      fromLocationId,
      toLocationId: body.toLocationId,
      notes: body.notes ?? "Created from replenishment recommendation (draft)",
      requestedBy: body.requestedBy,
      items,
    });
    created.push(transfer);
  }
  return created.length === 1 ? created[0] : { transfers: created };
}

export async function createPurchaseDraftFromRecommendation(
  orgId: string,
  body: {
    supplierId: string;
    locationId: string;
    createdBy?: string;
    sourceRecommendationJson?: unknown;
    items: {
      productId: string;
      quantity: number;
      estimatedCost?: string | number;
      supplierSku?: string;
    }[];
  },
) {
  return createPurchaseDraft(orgId, body);
}
