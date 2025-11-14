import { offlineStorage } from './offline-storage';
import { apiRequest } from './queryClient';

export class SyncService {
  private syncing = false;
  private syncInterval: number | null = null;

  start() {
    if (this.syncInterval) return;

    this.syncOnline();

    window.addEventListener('online', () => this.syncOnline());

    this.syncInterval = window.setInterval(() => {
      if (navigator.onLine) {
        this.syncOnline();
      }
    }, 30000);
  }

  stop() {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    window.removeEventListener('online', () => this.syncOnline());
  }

  async syncOnline() {
    if (this.syncing || !navigator.onLine) return;

    this.syncing = true;
    console.log('[Sync] Starting sync...');

    try {
      const unsyncedOrders = await offlineStorage.getUnsyncedOrders();
      const unsyncedMutations = await offlineStorage.getUnsyncedMutations();

      if (unsyncedOrders.length === 0 && unsyncedMutations.length === 0) {
        console.log('[Sync] Nothing to sync');
        return;
      }

      console.log(`[Sync] Syncing ${unsyncedOrders.length} legacy orders and ${unsyncedMutations.length} mutations...`);

      for (const order of unsyncedOrders) {
        try {
          await apiRequest('POST', '/api/orders', order.data);
          
          if (order.id) {
            await offlineStorage.markOrderSynced(order.id);
          }
          
          console.log('[Sync] Successfully synced legacy order:', order.id);
        } catch (error) {
          console.error('[Sync] Failed to sync legacy order:', order.id, error);
        }
      }

      for (const mutation of unsyncedMutations) {
        try {
          const response = await apiRequest(mutation.method, mutation.endpoint, mutation.data);
          
          if (mutation.id) {
            await offlineStorage.markMutationSynced(mutation.id);
          }
          
          console.log(`[Sync] Successfully synced mutation ${mutation.type}:`, mutation.id);
        } catch (error: any) {
          console.error(`[Sync] Failed to sync mutation ${mutation.type}:`, mutation.id, error);
          
          if (mutation.id) {
            await offlineStorage.markMutationError(mutation.id, error.message || 'Unknown error');
          }
        }
      }

      console.log('[Sync] Sync complete');

      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SYNC_COMPLETE',
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[Sync] Sync failed:', error);
    } finally {
      this.syncing = false;
    }
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
