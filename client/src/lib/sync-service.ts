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

      if (unsyncedOrders.length === 0) {
        console.log('[Sync] No orders to sync');
        return;
      }

      console.log(`[Sync] Syncing ${unsyncedOrders.length} orders...`);

      for (const order of unsyncedOrders) {
        try {
          await apiRequest('POST', '/api/orders', order.data);
          
          if (order.id) {
            await offlineStorage.markOrderSynced(order.id);
          }
          
          console.log('[Sync] Successfully synced order:', order.id);
        } catch (error) {
          console.error('[Sync] Failed to sync order:', order.id, error);
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
