import { useQuery } from "@tanstack/react-query";
import { resolveApiUrl, resolveAppPath } from "@/lib/appPaths";
import { EMPTY_SHOP_PRIVACY, privacyNoticeHref, type ShopPrivacyInfo } from "@shared/shopPrivacy";

export type PublicPrivacyNotice = ShopPrivacyInfo & { businessName: string };

/**
 * The shop's published privacy notice + complaints contact, readable signed
 * out (server/routes/privacyNotice.ts). On the shop site the server knows the
 * org; elsewhere pass it (a receipt link carries ?orgId=). A failed or empty
 * answer is treated as "nothing published": every link then stays hidden.
 */
export function usePublicPrivacyNotice(orgId?: string | null) {
  return useQuery<PublicPrivacyNotice>({
    queryKey: ["public-privacy-notice", orgId ?? ""],
    queryFn: async () => {
      const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      const res = await fetch(resolveApiUrl(`/api/public/privacy-notice${qs}`), {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return { ...EMPTY_SHOP_PRIVACY, businessName: "" };
      return (await res.json()) as PublicPrivacyNotice;
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Where a "Privacy notice" link should go, or null to hide it. */
export function privacyLinkFor(info: ShopPrivacyInfo | undefined, orgId?: string | null): string | null {
  if (!info) return null;
  const page = resolveAppPath(orgId ? `/privacy?orgId=${encodeURIComponent(orgId)}` : "/privacy");
  return privacyNoticeHref(info, page);
}
