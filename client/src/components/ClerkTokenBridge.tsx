import { useEffect } from "react";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { registerClerkTokenGetter } from "@/lib/clerkApiAuth";

/** Attach Clerk session JWT to API requests (required for Account Portal on a separate subdomain). */
export function ClerkTokenBridge() {
  const { getToken, isLoaded } = useClerkAuth();

  useEffect(() => {
    if (!isLoaded) return;
    registerClerkTokenGetter(() => getToken());
    return () => registerClerkTokenGetter(null);
  }, [getToken, isLoaded]);

  return null;
}
