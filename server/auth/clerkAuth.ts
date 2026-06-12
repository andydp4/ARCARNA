import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { getAuthProvider } from "../authRuntime";
import {
  buildSessionUser,
  checkAndHandleAllowList,
  type AllowListClaims,
} from "./allowList";
import { tryDevAuthBypass, tryPhase2dTestAuth } from "./commonAuth";
import { appRedirectPath, redirectToAppPath } from "../appRedirect";
import { appUrlFromRequest } from "../appUrl";

/** Paths that must not pass Clerk session validation (no publishable key check). */
const CLERK_PUBLIC_PATHS = new Set(["/api/health", "/api/health/metrics", "/api/auth/runtime"]);

function clerkPublishableKey(): string | undefined {
  const key =
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  return key || undefined;
}

function createClerkRequestMiddleware(): RequestHandler {
  const key = clerkPublishableKey();
  if (!key) {
    return (_req, _res, next) => next();
  }
  return clerkMiddleware({ publishableKey: key });
}

const clerkRequestMiddleware = createClerkRequestMiddleware();

async function clerkClaimsForUser(userId: string): Promise<AllowListClaims> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const email =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      null;
    return {
      sub: userId,
      email,
      first_name: user.firstName,
      last_name: user.lastName,
      profile_image_url: user.imageUrl,
    };
  } catch (err) {
    console.error("[Auth] Clerk user lookup failed:", err);
    return { sub: userId };
  }
}

/**
 * Clerk session middleware for AUTH_PROVIDER=clerk only.
 * Skips public health/runtime routes to avoid publishable-key errors on probes.
 */
export async function setupClerkAuth(app: Express) {
  if (getAuthProvider() !== "clerk") {
    return;
  }

  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    if (
      CLERK_PUBLIC_PATHS.has(req.path) ||
      req.path.startsWith("/v1/")
    ) {
      return next();
    }
    return clerkRequestMiddleware(req, res, (err?: unknown) => {
      if (!err) return next();
      // A malformed/unverifiable Authorization header must behave like a missing
      // one (401), not bubble to the 500 handler (was: "Unexpected end of data").
      console.warn(
        "[Auth] Clerk middleware rejected request:",
        err instanceof Error ? err.message : err,
      );
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      return next(err);
    });
  });

  app.get("/api/login", (_req, res) => {
    redirectToAppPath(res, "/sign-in");
  });

  app.get("/api/logout", (req, res) => {
    const accountsUrl =
      process.env.CLERK_ACCOUNTS_URL?.trim() ||
      process.env.VITE_CLERK_ACCOUNTS_URL?.trim();
    if (accountsUrl) {
      const base = accountsUrl.replace(/\/$/, "");
      const redirect = encodeURIComponent(appUrlFromRequest(req, appRedirectPath("/sign-out?done=1")));
      return res.redirect(302, `${base}/sign-out?redirect_url=${redirect}`);
    }
    redirectToAppPath(res, "/sign-in");
  });
}

export const clerkIsAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    if (await tryPhase2dTestAuth(req, res, next)) return;
    if (await tryDevAuthBypass(req, res, next)) return;

    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const claims = await clerkClaimsForUser(userId);
    await storage.upsertUser({
      id: userId,
      replitUserId: userId,
      authUserId: userId,
      authProvider: "clerk",
      email: claims.email ?? undefined,
      firstName: claims.first_name ?? undefined,
      lastName: claims.last_name ?? undefined,
      profileImageUrl: claims.profile_image_url ?? undefined,
    } as Parameters<typeof storage.upsertUser>[0]);

    const allowListStatus = await checkAndHandleAllowList(claims);

    if (!allowListStatus.allowed) {
      if (allowListStatus.isPending) {
        return res.status(403).json({
          message: "Access pending approval",
          isPending: true,
          code: "PENDING_APPROVAL",
        });
      }
      return res.status(403).json({ message: "Access denied", code: "NO_ACCESS" });
    }

    req.user = buildSessionUser(userId, claims, allowListStatus);
    return next();
  } catch (err) {
    console.error("[Auth] clerkIsAuthenticated failed:", err);
    return next(err);
  }
};
