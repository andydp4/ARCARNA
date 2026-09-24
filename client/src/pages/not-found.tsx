import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/AuthShell";
import { BRAND_PRODUCT_NAME } from "@shared/brand";

export default function NotFound() {
  return (
    <AuthShell title="Page not found" subtitle="404" showBrand={false}>
      <AlertCircle className="mx-auto h-12 w-12 text-[hsl(38,92%,50%)] mb-4" aria-hidden />
      <p className="text-sm text-center text-metal-muted mb-6">
        This route does not exist in {BRAND_PRODUCT_NAME}. Check the URL or return to the dashboard.
      </p>
      <Button className="w-full min-h-[44px] lm-btn-metal" asChild>
        <Link href="/">Back to dashboard</Link>
      </Button>
    </AuthShell>
  );
}

/**
 * The same answer inside the app (v1.2.1 UI-08): a signed-in member of staff
 * who follows a dead link keeps the header and menu, and is told plainly the
 * page does not exist rather than shown an empty page.
 */
export function InAppNotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center" data-testid="page-not-found">
      <AlertCircle className="mx-auto mb-4 h-12 w-12 text-[hsl(38,92%,50%)]" aria-hidden />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 mb-6 text-sm text-muted-foreground">
        This page does not exist in {BRAND_PRODUCT_NAME}. Check the address, or go back to the dashboard.
      </p>
      <Button className="min-h-[44px] lm-btn-metal" asChild>
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
