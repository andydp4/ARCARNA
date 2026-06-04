import { apiFetch } from "@/lib/appPaths";
import type { BulkActionId, BulkEntity } from "@shared/bulkActions";

export async function executeBulkAction(
  entity: BulkEntity,
  ids: string[],
  action: BulkActionId,
  payload?: Record<string, unknown>,
): Promise<{ kind: "json"; data: unknown } | { kind: "csv"; blob: Blob; filename: string }> {
  const res = await apiFetch(`/api/${entity}/bulk`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, action, payload }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Bulk action failed");
  }

  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("text/csv")) {
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    return { kind: "csv", blob, filename: match?.[1] ?? `${entity}-export.csv` };
  }

  return { kind: "json", data: await res.json() };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
