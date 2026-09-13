import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { offlineStorage } from "./offline-storage";
import { orgScopeHeaders } from "./orgScope";
import { resolveApiUrl } from "./appPaths";
import { withClerkAuthHeaders } from "./clerkApiAuth";

/**
 * Turns a failed API response into a message worth showing a person.
 *
 * The API answers errors with JSON like {"code":"VALIDATION_ERROR",
 * "message":"Invalid body","details":[{"message":"..."}]}, but this used to
 * throw `${status}: ${rawBody}` unconditionally — pages that toast
 * `error.message` directly then showed the user a raw
 * `400: {"code":"VALIDATION_ERROR",...}` string. Pull the human-readable
 * message out of that JSON when there is one; fall back to the raw
 * status+text for a genuine non-JSON failure (an HTML 500 page, a proxy
 * error) where there's nothing better to show.
 */
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    if (res.status === 413) {
      throw new Error(
        "Upload too large for the server (HTTP 413). Ask your admin to set Nginx client_max_body_size to 25m and redeploy the app.",
      );
    }
    let parsedMessage: string | undefined;
    try {
      const body = JSON.parse(text);
      if (body && typeof body === "object") {
        const detailMessage = Array.isArray(body.details) ? body.details[0]?.message : undefined;
        if (typeof detailMessage === "string" && detailMessage) {
          parsedMessage = detailMessage;
        } else if (typeof body.message === "string" && body.message) {
          parsedMessage = body.message;
        }
      }
    } catch {
      // Not JSON — fall through to the raw text below.
    }
    throw new Error(parsedMessage ?? `${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers = await withClerkAuthHeaders({
    ...orgScopeHeaders(),
    ...(data ? { "Content-Type": "application/json" } : {}),
  });
  const res = await fetch(resolveApiUrl(url), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

/** GET a base-path-aware API URL and parse JSON. For custom query keys with query strings. */
export async function getJson<T = unknown>(url: string): Promise<T> {
  const headers = await withClerkAuthHeaders(orgScopeHeaders());
  const res = await fetch(resolveApiUrl(url), { credentials: "include", headers });
  await throwIfResNotOk(res);
  return (await res.json()) as T;
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
      const headers = await withClerkAuthHeaders(orgScopeHeaders());
      const res = await fetch(url, {
        credentials: "include",
        headers,
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
