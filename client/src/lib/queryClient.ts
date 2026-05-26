import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { offlineStorage } from "./offline-storage";
import { orgScopeHeaders } from "./orgScope";
import { resolveApiUrl } from "./appPaths";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    if (res.status === 413) {
      throw new Error(
        "Upload too large for the server (HTTP 413). Ask your admin to set Nginx client_max_body_size to 25m and redeploy the app.",
      );
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(resolveApiUrl(url), {
    method,
    headers: {
      ...orgScopeHeaders(),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const endpoint = queryKey.join("/") as string;
    const url = resolveApiUrl(endpoint);

    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: orgScopeHeaders(),
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      const data = await res.json();
      
      if (url.includes("/api/products") && Array.isArray(data)) {
        offlineStorage.cacheProducts(data).catch(err => 
          console.warn('[QueryClient] Failed to cache products:', err)
        );
      } else if (url.includes("/api/customers") && Array.isArray(data)) {
        offlineStorage.cacheCustomers(data).catch(err => 
          console.warn('[QueryClient] Failed to cache customers:', err)
        );
      }
      
      return data;
    } catch (error) {
      if (!navigator.onLine || (error as Error).message.includes('Failed to fetch')) {
        if (url.includes("/api/products")) {
          console.log('[QueryClient] Offline: Loading products from cache');
          return await offlineStorage.getCachedProducts();
        } else if (url.includes("/api/customers")) {
          console.log('[QueryClient] Offline: Loading customers from cache');
          return await offlineStorage.getCachedCustomers();
        }
      }
      
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
