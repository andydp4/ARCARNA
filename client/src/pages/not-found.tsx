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
