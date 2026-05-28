import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { getAuthProvider } from "./authRuntime";
import { checkAndHandleAllowList } from "./auth/allowList";
import { tryDevAuthBypass, tryPhase2dTestAuth } from "./auth/commonAuth";
import { appRedirectPath, redirectToAppPath } from "./appRedirect";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!,
    );
  },
  { maxAge: 3600 * 1000 },
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  const isProd = process.env.NODE_ENV === "production";
  const cookieSecure =
    process.env.SESSION_COOKIE_SECURE === "1" ||
    (isProd && process.env.SESSION_COOKIE_SECURE !== "0");

  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      maxAge: sessionTtl,
      sameSite: "lax",
    },
  });
}

function updateUserSession(
  user: Record<string, unknown>,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = (user.claims as { exp?: number })?.exp;
}

async function upsertUser(claims: Record<string, unknown>) {
  const sub = claims.sub as string;
  await storage.upsertUser({
    id: sub,
    replitUserId: sub,
    authUserId: sub,
    authProvider: getAuthProvider() === "clerk" ? "clerk" : "replit",
    email: claims.email as string | undefined,
    firstName: claims.first_name as string | undefined,
    lastName: claims.last_name as string | undefined,
    profileImageUrl: claims.profile_image_url as string | undefined,
  } as Parameters<typeof storage.upsertUser>[0]);
}

const getOrCreateStrategy = memoize(
  async (domain: string) => {
    const config = await getOidcConfig();
    const verify: VerifyFunction = async (tokens, verified) => {
      const user: Record<string, unknown> = {};
      updateUserSession(user, tokens);
      await upsertUser(tokens.claims() as Record<string, unknown>);
      verified(null, user);
    };

    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
    return strategy;
  },
  { maxAge: 3600 * 1000 },
);

export async function setupReplitAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  if (process.env.REPLIT_DOMAINS) {
    for (const domain of process.env.REPLIT_DOMAINS.split(",")) {
      await getOrCreateStrategy(domain);
    }
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", async (req, res, next) => {
    await getOrCreateStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", async (req, res, next) => {
    await getOrCreateStrategy(req.hostname);
    passport.authenticate(
      `replitauth:${req.hostname}`,
      async (err: Error | null, user: Express.User | false, _info: unknown) => {
      if (err) {
        console.error("[Auth] Callback error:", err);
        redirectToAppPath(res, "/sign-in");
        return;
      }
      if (!user) {
        redirectToAppPath(res, "/sign-in");
        return;
      }

      const claims = (user as { claims: Record<string, unknown> }).claims;
      const allowListStatus = await checkAndHandleAllowList({
        sub: claims.sub as string,
        email: claims.email as string | null,
        first_name: claims.first_name as string | null,
        last_name: claims.last_name as string | null,
        profile_image_url: claims.profile_image_url as string | null,
      });

      const sessionUser = user as {
        isOwner?: boolean;
        isAllowed?: boolean;
        isPending?: boolean;
        role?: string;
        orgId?: string | null;
      };
      sessionUser.isOwner = allowListStatus.isOwner;
      sessionUser.isAllowed = allowListStatus.allowed;
      sessionUser.isPending = allowListStatus.isPending;
      sessionUser.role =
        allowListStatus.role ?? (allowListStatus.isOwner ? "SUPER_ADMIN" : "CASHIER");
      sessionUser.orgId = allowListStatus.orgId ?? null;

      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error("[Auth] Login error:", loginErr);
          redirectToAppPath(res, "/sign-in");
          return;
        }
        if (!allowListStatus.allowed) {
          redirectToAppPath(res, "/pending-approval");
          return;
        }
        redirectToAppPath(res, "/");
        return;
      });
    })(req, res, next);
  });

  app.get("/api/logout", async (req, res) => {
    const config = await getOidcConfig();
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}${appRedirectPath("/")}`,
        }).href,
      );
    });
  });
}

export const replitIsAuthenticated: RequestHandler = async (req, res, next) => {
  if (await tryPhase2dTestAuth(req, res, next)) return;
  if (await tryDevAuthBypass(req, res, next)) return;

  const user = req.user as {
    expires_at?: number;
    isAllowed?: boolean;
    isPending?: boolean;
    refresh_token?: string;
  };

  if (!req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.isAllowed === false) {
    return res.status(403).json({
      message: "Access pending approval",
      isPending: user.isPending,
      code: "PENDING_APPROVAL",
    });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user as Record<string, unknown>, tokenResponse);
    return next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
