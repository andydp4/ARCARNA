import { ShieldCheck } from "lucide-react";
import { hasComplaintsContact, hasPrivacyNotice } from "@shared/shopPrivacy";
import { usePublicPrivacyNotice } from "@/lib/shopPrivacy";

/**
 * Public page (no sign-in) showing the shop's own privacy notice and data
 * protection complaints contact, as written by the owner in Settings (PRV-15).
 * Linked from the shop site and from receipts.
 */
export default function PrivacyNoticePage() {
  const orgId =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("orgId") : null;
  const { data, isLoading } = usePublicPrivacyNotice(orgId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-foreground">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold">
        <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        {data?.businessName ? `${data.businessName}: privacy notice` : "Privacy notice"}
      </h1>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || (!hasPrivacyNotice(data) && !hasComplaintsContact(data)) ? (
        <p className="text-sm text-muted-foreground" data-testid="text-privacy-empty">
          This business has not published a privacy notice here yet.
        </p>
      ) : (
        <div className="space-y-6">
          {data.privacyNoticeText ? (
            <div className="whitespace-pre-wrap text-sm leading-6" data-testid="text-privacy-notice">
              {data.privacyNoticeText}
            </div>
          ) : null}
          {data.privacyNoticeUrl ? (
            <p className="text-sm">
              <a className="underline" href={data.privacyNoticeUrl} rel="noreferrer">
                Read the full privacy notice
              </a>
            </p>
          ) : null}
          {hasComplaintsContact(data) ? (
            <section className="rounded-md border p-4 text-sm" data-testid="text-complaints-contact">
              <h2 className="mb-1 font-medium">Questions or complaints about your data</h2>
              <p>
                Contact {data.complaintsContactName ? `${data.complaintsContactName} at ` : ""}
                <a className="underline" href={`mailto:${data.complaintsContactEmail}`}>
                  {data.complaintsContactEmail}
                </a>
                .
              </p>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
