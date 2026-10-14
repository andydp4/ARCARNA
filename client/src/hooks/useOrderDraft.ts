import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/appPaths";
import { queryClient } from "@/lib/queryClient";
import { orderDraftPayloadSchema, type OrderDraftPayload } from "@shared/orders/orderDraft";

export type DraftSaveStatus = "idle" | "saving" | "saved" | "waiting" | "error" | "conflict";

const statusText: Record<DraftSaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  waiting: "Waiting to sync",
  error: "Could not save",
  conflict: "Changed on another till",
};

export function draftStatusLabel(status: DraftSaveStatus): string {
  return statusText[status];
}

export function orderDraftLocalKey(orgId: string, userId: string) {
  return `arcarna.orderDraft.local.${orgId}.${userId}`;
}

export type LocalOrderDraft = { id: string | null; revision: number; payload: OrderDraftPayload };

/** The last copy this browser tried to save, for this person in this shop. */
export function readLocalOrderDraft(orgId: string, userId: string): LocalOrderDraft | null {
  try {
    const raw = localStorage.getItem(orderDraftLocalKey(orgId, userId));
    if (!raw) return null;
    const data = JSON.parse(raw) as { id?: unknown; revision?: unknown; payload?: unknown };
    const payload = orderDraftPayloadSchema.safeParse(data.payload);
    if (!payload.success) return null;
    const revision = typeof data.revision === "number" && data.revision > 0 ? data.revision : 1;
    const id = typeof data.id === "string" && data.id ? data.id : null;
    return { id, revision, payload: payload.data };
  } catch {
    return null;
  }
}

function writeLocal(orgId: string, userId: string, blob: LocalOrderDraft) {
  try {
    localStorage.setItem(orderDraftLocalKey(orgId, userId), JSON.stringify(blob));
  } catch {
    // The server save is the one that counts.
  }
}

function clearLocal(orgId: string, userId: string) {
  try {
    localStorage.removeItem(orderDraftLocalKey(orgId, userId));
  } catch {
    // already gone
  }
}

/**
 * Saves the open order for this person. A draft is not a sale: nothing is
 * paid, stock does not move, and no invoice is issued until Create order.
 */
export function useOrderDraft(
  orgId: string | null,
  userId: string | null,
  payload: OrderDraftPayload | null,
  enabled: boolean,
) {
  const idRef = useRef<string | null>(null);
  const revRef = useRef(1);
  const epoch = useRef(0);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const [status, setStatus] = useState<DraftSaveStatus>("idle");
  const statusRef = useRef<DraftSaveStatus>("idle");
  const [serverCopy, setServerCopy] = useState<OrderDraftPayload | null>(null);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signature = enabled && payload ? JSON.stringify(payload) : "";

  const setSaveStatus = (next: DraftSaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const saveNow = useCallback(async () => {
    const ticket = epoch.current;
    const current = payloadRef.current;
    if (!current || !orgId || !userId) return;
    if (statusRef.current === "conflict") return;
    writeLocal(orgId, userId, { id: idRef.current, revision: revRef.current, payload: current });
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (ticket !== epoch.current) return;
      setSaveStatus("waiting");
      return;
    }
    setSaveStatus("saving");
    try {
      if (!idRef.current) {
        const res = await apiFetch("/api/order-drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: current }),
        });
        if (ticket !== epoch.current) return;
        if (!res.ok) throw new Error("save");
        const body = (await res.json()) as { id: string; revision: number };
        idRef.current = body.id;
        revRef.current = body.revision;
        writeLocal(orgId, userId, { id: body.id, revision: body.revision, payload: current });
        void queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
      } else {
        const res = await apiFetch(`/api/order-drafts/${idRef.current}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: revRef.current, payload: current }),
        });
        if (ticket !== epoch.current) return;
        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as { payload?: unknown; revision?: number };
          let nextPayload = orderDraftPayloadSchema.safeParse(body.payload).success
            ? orderDraftPayloadSchema.parse(body.payload)
            : null;
          let nextRevision = typeof body.revision === "number" ? body.revision : null;
          if ((!nextPayload || nextRevision == null) && idRef.current) {
            const again = await apiFetch(`/api/order-drafts/${idRef.current}`);
            if (ticket !== epoch.current) return;
            if (again.ok) {
              const row = (await again.json()) as { payload?: unknown; revision?: number };
              const parsed = orderDraftPayloadSchema.safeParse(row.payload);
              if (parsed.success) nextPayload = parsed.data;
              if (typeof row.revision === "number") nextRevision = row.revision;
            }
          }
          if (nextPayload) setServerCopy(nextPayload);
          setConflictRevision(nextRevision);
          setSaveStatus("conflict");
          return;
        }
        if (res.status === 404) {
          idRef.current = null;
          setSaveStatus("error");
          return;
        }
        if (!res.ok) throw new Error("save");
        const body = (await res.json()) as { revision: number };
        revRef.current = body.revision;
        writeLocal(orgId, userId, { id: idRef.current, revision: body.revision, payload: current });
      }
      setServerCopy(null);
      setConflictRevision(null);
      setSaveStatus("saved");
    } catch {
      if (ticket !== epoch.current) return;
      setSaveStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "waiting" : "error");
    }
  }, [orgId, userId]);

  useEffect(() => {
    if (!enabled || !signature || !orgId || !userId) return;
    if (statusRef.current === "conflict") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, signature, orgId, userId, saveNow]);

  useEffect(() => {
    const onOnline = () => {
      if (statusRef.current === "waiting") void saveNow();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [saveNow]);

  const suspend = useCallback(() => {
    epoch.current += 1;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const adopt = useCallback((id: string, revision: number) => {
    idRef.current = id;
    revRef.current = revision;
    setConflictRevision(null);
    setServerCopy(null);
    setSaveStatus("saved");
  }, []);

  const close = useCallback(
    async (outcome: "submitted" | "discarded") => {
      suspend();
      const id = idRef.current;
      idRef.current = null;
      revRef.current = 1;
      setServerCopy(null);
      setConflictRevision(null);
      setSaveStatus("idle");
      if (orgId && userId) clearLocal(orgId, userId);
      if (!id) return;
      await apiFetch(`/api/order-drafts/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      }).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
    },
    [orgId, userId, suspend],
  );

  const keepMine = useCallback(() => {
    if (conflictRevision != null) revRef.current = conflictRevision;
    setConflictRevision(null);
    setServerCopy(null);
    setSaveStatus("saving");
    void saveNow();
  }, [conflictRevision, saveNow]);

  return {
    status,
    serverCopy,
    conflictRevision,
    retry: saveNow,
    adopt,
    close,
    suspend,
    keepMine,
    draftId: () => idRef.current,
  };
}
