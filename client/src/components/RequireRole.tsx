import type { ReactNode } from "react";
import { Link } from "wouter";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { rolesForHref } from "@/components/nav-items";
import type { Role } from "@shared/rbac";

/**
 * Route-level access gate (ARC-008). Before this existed, every page below
 * `Layout` self-gated individually (inconsistently) or not at all, so a role
 * that lacked access still got the full route — a working form that only
 * failed once they tried to save. This renders a plain, honest "no access"
 * state instead, using the SAME role list `nav-items.ts` already declares for
 * the route (via `rolesForHref`) so nav visibility and route access can never
 * drift apart into two hand-maintained lists.
 *
 * `href` must match the route's nav-item href, or an entry in nav-items.ts's
 * `EXTRA_ROUTE_ROLES` for a page that isn't in the sidebar. A route left out
 * of both lookups is treated as open to every role, same as an explicit
 * `undefined` — so a genuinely public route needs no wrapper at all.
 */
export function RequireRole({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const roles = rolesForHref(href);

  if (!roles || (user?.role && roles.includes(user.role as Role))) {
    return <>{children}</>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Alert data-testid="alert-no-role-access">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>You don't have access to this</AlertTitle>
        <AlertDescription className="space-y-4">
          <p>
            This page is restricted to {formatRoles(roles)}. Your account is
            {user?.role ? ` a ${formatRole(user.role)}` : " signed in"}, which
            doesn't include it.
          </p>
          <Button asChild variant="outline" size="sm" data-testid="button-no-access-home">
            <Link href="/">Back to Control Centre</Link>
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function formatRole(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function formatRoles(roles: readonly Role[]): string {
  const names = roles.map(formatRole);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
