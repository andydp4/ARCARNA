import type { Request } from "express";
import { isLoopbackPeer } from "../lib/trustProxy";
import { clerkClient, getAuth } from "@clerk/express";
import { getAuthProvider, isDevAuthBypassEnabled } from "../authRuntime";

export type ResolvedIdentity = {
  subjectId: string;
  email?: string | null;
  name?: string | null;
};

/**
 * Resolves the signed-in user's subject id without enforcing the allow-list.
 * Used by /api/auth/approval-status so pending Clerk users can poll status.
 */
export async function resolveRequestIdentity(req: Request): Promise<ResolvedIdentity | null> {
  if (isDevAuthBypassEnabled()) {
    const subjectId = process.env.DEV_AUTH_USER_ID || "dev-user";
    return { subjectId, email: "dev@example.com", name: "Developer" };
  }

  const testUserId = (req.headers["x-test-replit-user-id"] as string) || null;
  const isTestMode = process.env.PHASE2D_TEST === "1" && process.env.NODE_ENV !== "production";
  // The socket, not req.ip: X-Forwarded-For sets req.ip (SEC-XFF).
  const isLocalhost = isLoopbackPeer(req);
  const testSecret = process.env.PHASE2D_TEST_SECRET;
  const secretMatch = !!testSecret && req.headers["x-test-secret"] === testSecret;
  if (isTestMode && testUserId && isLocalhost && secretMatch) {
    return { subjectId: testUserId };
  }

  if (getAuthProvider() === "clerk") {
    const { userId } = getAuth(req);
    if (!userId) return null;
    try {
      const user = await clerkClient.users.getUser(userId);
      const email =
        user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
        user.emailAddresses[0]?.emailAddress ??
        null;
      const name =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || email || userId;
      return { subjectId: userId, email, name };
    } catch {
      return { subjectId: userId };
    }
  }

  const sessionUser = req.user as {
    claims?: { sub?: string; email?: string; name?: string; first_name?: string };
  } | undefined;
  const subjectId = sessionUser?.claims?.sub;
  if (!subjectId) return null;
  return {
    subjectId,
    email: sessionUser.claims?.email ?? null,
    name:
      sessionUser.claims?.name ??
      sessionUser.claims?.first_name ??
      null,
  };
}
