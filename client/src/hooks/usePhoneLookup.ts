import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { formatUkPhone, type CustomerMatch } from "@shared/customerView";

export type PhoneLookupState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; matches: CustomerMatch[] }
  | { status: "error"; message: string };

/**
 * Finding a customer by phone (v1.2 Phase 5, PRV-06). Below admin nobody's
 * number is on the device to search, so a whole UK number typed into a
 * customer search is asked of the server: exact match, up to three people,
 * rate-limited per person. Anything shorter is a name search and stays local.
 *
 * Deliberately not a react-query query: the number is never kept in a cache,
 * and the lookup is a POST so it stays out of URLs and the service worker.
 */
export function usePhoneLookup(query: string): PhoneLookupState {
  const formatted = formatUkPhone(query);
  const [state, setState] = useState<PhoneLookupState>({ status: "idle" });

  useEffect(() => {
    if (!formatted) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "searching" });
    // A short pause so each keystroke of the last digit does not spend the rate limit.
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest("POST", "/api/customers/lookup-phone", { phone: formatted });
        const body = (await res.json()) as { matches?: CustomerMatch[] };
        if (!cancelled) setState({ status: "done", matches: body.matches ?? [] });
      } catch (error) {
        if (!cancelled) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Could not look the number up." });
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [formatted]);

  return state;
}
