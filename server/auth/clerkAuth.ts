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

export async function setupClerkAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(clerkMiddleware());

  app.get("/api/login", (_req, res) => {
    res.redirect("/sign-in");
  });

  app.get("/api/logout", (_req, res) => {
    res.redirect("/sign-in");
  });
}

export const clerkIsAuthenticated: RequestHandler = async (req, res, next) => {
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
    authProvider: getAuthProvider(),
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
};
