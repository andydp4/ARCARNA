import { offlineStorage, type QueuedMutation } from './offline-storage';
import { apiRequest, queryClient } from './queryClient';
import {
  afterFailedSend,
  countSaleQueue,
  isSaleDue,
  isSaleMine,
  newClientOrderId,
  referenceFor,
  replayPayload,
  reportSaleIssue,
  sendSale,
} from './saleQueue';
import { nextSaleRetryDelayMs } from '@shared/orders/saleReference';

/**
 * Sends what the till kept while it could not reach arcarna.
 *
 * Sales (ORDER_CREATE) follow v1.2 Phase 1A: each goes with its own reference,
 * so a sale that did land earlier comes back as the original order rather than
 * a second one; a failed send waits longer each time, up to 15 minutes; a sale
 * the server refuses is handed to Needs attention and only then removed here.
 * Nothing is removed from the till until the server holds it in one form or
 * the other.
 */
export class SyncService {
  private syncing: Promise<void> | null = null;
  private syncInterval: number | null = null;
  private boundSyncOnline = () => void this.syncOnline();

  start() {
    if (this.syncInterval) return;

    void this.syncOnline();

    window.addEventListener('online', this.boundSyncOnline);

    // Each sale keeps its own next-attempt time; this only decides how soon
    // after that time comes round the till notices.
    this.syncInterval = window.setInterval(() => {
      if (navigator.onLine) {
        void this.syncOnline();
      }
    }, 30000);
  }

  stop() {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    window.removeEventListener('online', this.boundSyncOnline);
  }

  /** `force` sends every kept sale now, ignoring its wait (a person pressed "Send now"). */
  syncOnline(opts: { force?: boolean } = {}): Promise<void> {
    if (this.syncing) return this.syncing;
    if (!navigator.onLine || !offlineStorage.getActiveOrgId()) return Promise.resolve();
    this.syncing = this.runSync(!!opts.force).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  /** Waiting and failed sales on this till right now. */
  async counts(): Promise<{ waiting: number; failed: number }> {
    if (!offlineStorage.getActiveOrgId()) return { waiting: 0, failed: 0 };
    try {
      return countSaleQueue(await offlineStorage.getUnsyncedMutations());
    } catch {
      return { waiting: 0, failed: 0 };
    }
  }

  private async runSync(force: boolean) {
    try {
      await this.moveLegacyOrders();
      const unsyncedMutations = await offlineStorage.getUnsyncedMutations();
      if (unsyncedMutations.length === 0) return;

      for (const mutation of unsyncedMutations) {
        if (mutation.type === "ORDER_UPDATE") {
          // Open Orders — the only screen that ever queued this mutation type —
          // was removed in the Operations Centre work (N4b). A browser that
          // queued one before the upgrade could still be carrying it; replaying
          // it now would resubmit a stale status write against today's
          // completion path (re-settlement on repeat, N3b) rather than the one
          // it was queued against, so it is discarded instead of replayed.
          console.warn('[Sync] Discarding stale ORDER_UPDATE mutation (Open Orders removed):', mutation.id);
          if (mutation.id) {
            await offlineStorage.deleteMutation(mutation.id);
          }
          continue;
        }
        if (mutation.type === "ORDER_CREATE") {
          await this.syncSale(mutation, force);
          continue;
        }
        await this.syncOther(mutation, force);
      }

      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SYNC_COMPLETE',
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[Sync] Sync failed:', error);
    }
  }

  /**
   * Sales kept by a till from before the mutation queue (the old
   * `offline-orders` store) move onto it, keeping when they were rung, so they
   * get a reference and the same retry and refusal handling.
   */
  private async moveLegacyOrders() {
    const legacy = await offlineStorage.getUnsyncedOrders();
    for (const order of legacy) {
      const clientOrderId = referenceFor(order.data) ?? newClientOrderId();
      await offlineStorage.queueMutation({
        type: 'ORDER_CREATE',
        method: 'POST',
        endpoint: '/api/orders',
        data: { ...order.data, clientOrderId },
        clientOrderId,
        timestamp: order.timestamp,
      });
      if (order.id) await offlineStorage.deleteOrder(order.id);
    }
  }

  private async syncSale(mutation: QueuedMutation, force: boolean) {
    const id = mutation.id;
    if (!id) return;
    const now = Date.now();
    if (!isSaleMine(mutation, offlineStorage.getActiveUserId())) return;
    if (!isSaleDue(mutation, now, force)) return;

    // A sale queued before references existed gets one now, stored before it
    // is first sent — so every later attempt carries the same one.
    let clientOrderId = referenceFor(mutation.data, mutation.clientOrderId);
    if (!clientOrderId) {
      clientOrderId = newClientOrderId();
      await offlineStorage.updateMutation(id, {
        clientOrderId,
        data: { ...mutation.data, clientOrderId },
      });
    }

    if (mutation.state !== "refused") {
      const outcome = await sendSale(replayPayload(mutation.data, mutation.timestamp, clientOrderId));
      if (outcome.ok) {
        await offlineStorage.deleteMutation(id);
        return;
      }
      const patch = afterFailedSend(mutation, outcome.status, outcome.message, Date.now());
      await offlineStorage.updateMutation(id, patch);
      if (patch.state !== "refused") {
        console.warn('[Sync] Sale not sent; will try again:', clientOrderId, outcome.message);
        return;
      }
      mutation = { ...mutation, ...patch };
    }

    // Refused: hand it to a manager. It stays on the till, counted as failed,
    // until the server confirms it holds it.
    const reported = await reportSaleIssue({
      clientOrderId,
      payload: { ...mutation.data, clientOrderId },
      reason: mutation.lastError ?? "Refused",
      httpStatus: mutation.httpStatus ?? null,
      queuedAt: mutation.timestamp,
      source: "refused",
      rungByUserId: mutation.queuedByUserId,
    });
    if (reported) {
      await offlineStorage.deleteMutation(id);
      void queryClient.invalidateQueries({ queryKey: ["/api/sale-issues/summary"] });
    }
  }

  /** Customers, expenses and stock edits kept offline: as before, but with the same growing wait. */
  private async syncOther(mutation: QueuedMutation, force: boolean) {
    if (!mutation.id) return;
    if (!force && mutation.nextAttemptAt && mutation.nextAttemptAt > Date.now()) return;
    try {
      await apiRequest(mutation.method, mutation.endpoint, mutation.data);
      await offlineStorage.markMutationSynced(mutation.id);
    } catch (error: any) {
      console.error(`[Sync] Failed to sync mutation ${mutation.type}:`, mutation.id, error);
      const attempts = (mutation.attempts ?? 0) + 1;
      await offlineStorage.updateMutation(mutation.id, {
        attempts,
        nextAttemptAt: Date.now() + nextSaleRetryDelayMs(attempts),
        error: error?.message || 'Unknown error',
      });
    }
  }

  /**
   * A manager signing the till out with sales unsent (v1.2 Phase 1A): try
   * once more, then hand whatever is left to Needs attention so nothing is
   * lost with the till's storage. Returns the references handed over, or
   * throws if any could not be — the till must not sign out then.
   */
  async handOverForSignOut(): Promise<{ references: string[]; waiting: number; failed: number }> {
    await this.syncOnline({ force: true });
    const remaining = (await offlineStorage.getUnsyncedMutations()).filter((m) => m.type === "ORDER_CREATE");
    const before = countSaleQueue(remaining);
    const references: string[] = [];
    let stuck = 0;
    for (const m of remaining) {
      const clientOrderId = referenceFor(m.data, m.clientOrderId) ?? newClientOrderId();
      const ok = await reportSaleIssue({
        clientOrderId,
        payload: { ...m.data, clientOrderId },
        reason: m.lastError ?? (m.state === "refused" ? "Refused" : "Never reached arcarna"),
        httpStatus: m.httpStatus ?? null,
        queuedAt: m.timestamp,
        source: m.state === "refused" ? "refused" : "signed_out",
        rungByUserId: m.queuedByUserId,
      });
      if (ok && m.id) {
        await offlineStorage.deleteMutation(m.id);
        references.push(clientOrderId);
      } else {
        stuck += 1;
      }
    }
    if (stuck > 0) {
      throw new Error(
        `${stuck} sale${stuck === 1 ? "" : "s"} could not be handed to Needs attention. Check the connection and try again.`,
      );
    }
    return { references, ...before };
  }

  async cacheData(products: any[], customers: any[]) {
    try {
      await offlineStorage.cacheProducts(products);
      await offlineStorage.cacheCustomers(customers);
      console.log('[Sync] Cached products and customers');
    } catch (error) {
      console.error('[Sync] Failed to cache data:', error);
    }
  }
}

export const syncService = new SyncService();
