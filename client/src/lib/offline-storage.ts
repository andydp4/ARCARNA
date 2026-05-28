export const LEGACY_OFFLINE_DB_NAME = "midnight-epos-db";
const DB_VERSION = 2;

export function offlineDbNameForOrg(orgId: string): string {
  return `midnight-epos-db--${orgId}`;
}

export interface OfflineOrder {
  id?: number;
  data: any;
  timestamp: number;
  synced: number;
}

export interface QueuedMutation {
  id?: number;
  type: 'ORDER_CREATE' | 'ORDER_UPDATE' | 'ORDER_DELETE' | 'PRODUCT_UPDATE' | 'CUSTOMER_CREATE' | 'CUSTOMER_UPDATE' | 'EXPENSE_CREATE';
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  data: any;
  timestamp: number;
  synced: number;
  error?: string;
}

class OfflineStorage {
  private orgId: string | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  setActiveOrg(orgId: string | null): void {
    if (this.orgId === orgId) return;
    this.orgId = orgId;
    this.dbPromise = null;
  }

  getActiveOrgId(): string | null {
    return this.orgId;
  }

  private requireOrgId(): string {
    if (!this.orgId) {
      throw new Error("Offline storage requires an active organization");
    }
    return this.orgId;
  }

  private openDB(): Promise<IDBDatabase> {
    const orgId = this.requireOrgId();
    if (this.dbPromise) {
      return this.dbPromise;
    }

    const dbName = offlineDbNameForOrg(orgId);
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('offline-orders')) {
          const orderStore = db.createObjectStore('offline-orders', { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          orderStore.createIndex('synced', 'synced', { unique: false });
          orderStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('mutations-queue')) {
          const mutationsStore = db.createObjectStore('mutations-queue', { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          mutationsStore.createIndex('synced', 'synced', { unique: false });
          mutationsStore.createIndex('timestamp', 'timestamp', { unique: false });
          mutationsStore.createIndex('type', 'type', { unique: false });
        }

        if (!db.objectStoreNames.contains('products-cache')) {
          db.createObjectStore('products-cache', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('customers-cache')) {
          db.createObjectStore('customers-cache', { keyPath: 'id' });
        }
      };
    });

    return this.dbPromise;
  }

  async saveOfflineOrder(orderData: any): Promise<number> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readwrite');
    const store = tx.objectStore('offline-orders');

    const order: OfflineOrder = {
      data: orderData,
      timestamp: Date.now(),
      synced: 0
    };

    return new Promise((resolve, reject) => {
      const request = store.add(order);
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(request.error);
    });
  }

  async getOfflineOrders(): Promise<OfflineOrder[]> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readonly');
    const store = tx.objectStore('offline-orders');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getUnsyncedOrders(): Promise<OfflineOrder[]> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readonly');
    const store = tx.objectStore('offline-orders');
    const index = store.index('synced');

    return new Promise((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only(0));
      request.onsuccess = () => {
        const orders = request.result;
        orders.sort((a, b) => a.timestamp - b.timestamp);
        resolve(orders);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async markOrderSynced(id: number): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readwrite');
    const store = tx.objectStore('offline-orders');

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const order = getRequest.result;
        if (order) {
          order.synced = 1;
          const updateRequest = store.put(order);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async deleteOrder(id: number): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readwrite');
    const store = tx.objectStore('offline-orders');

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async cacheProducts(products: any[]): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('products-cache', 'readwrite');
    const store = tx.objectStore('products-cache');

    await store.clear();

    for (const product of products) {
      await store.put(product);
    }
  }

  async getCachedProducts(): Promise<any[]> {
    const db = await this.openDB();
    const tx = db.transaction('products-cache', 'readonly');
    const store = tx.objectStore('products-cache');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async cacheCustomers(customers: any[]): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('customers-cache', 'readwrite');
    const store = tx.objectStore('customers-cache');

    await store.clear();

    for (const customer of customers) {
      await store.put(customer);
    }
  }

  async getCachedCustomers(): Promise<any[]> {
    const db = await this.openDB();
    const tx = db.transaction('customers-cache', 'readonly');
    const store = tx.objectStore('customers-cache');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async queueMutation(mutation: Omit<QueuedMutation, 'id' | 'timestamp' | 'synced'>): Promise<number> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');

    const queuedMutation: QueuedMutation = {
      ...mutation,
      timestamp: Date.now(),
      synced: 0
    };

    return new Promise((resolve, reject) => {
      const request = store.add(queuedMutation);
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(request.error);
    });
  }

  async getUnsyncedMutations(): Promise<QueuedMutation[]> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readonly');
    const store = tx.objectStore('mutations-queue');
    const index = store.index('synced');

    return new Promise((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only(0));
      request.onsuccess = () => {
        const mutations = request.result;
        mutations.sort((a, b) => a.timestamp - b.timestamp);
        resolve(mutations);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async markMutationSynced(id: number): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const mutation = getRequest.result;
        if (mutation) {
          mutation.synced = 1;
          const updateRequest = store.put(mutation);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async markMutationError(id: number, error: string): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const mutation = getRequest.result;
        if (mutation) {
          mutation.error = error;
          const updateRequest = store.put(mutation);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async deleteMutation(id: number): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingMutationsCount(): Promise<number> {
    const mutations = await this.getUnsyncedMutations();
    return mutations.length;
  }
}

export const offlineStorage = new OfflineStorage();
