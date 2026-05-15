import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { isDevAuthBypassEnabled } from "./authRuntime";

// REPLIT_DOMAINS may not be available in production deployments
// We'll create strategies dynamically based on request hostname

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

async function checkAndHandleAllowList(claims: any): Promise<{ allowed: boolean; isOwner: boolean; isPending: boolean; role?: string; orgId?: string | null }> {
  const replitUserId = claims["sub"];
  const email = claims["email"];
  const name = `${claims["first_name"] || ''} ${claims["last_name"] || ''}`.trim() || email;
  const profileImageUrl = claims["profile_image_url"];
  
  // Check if user is already on allow list
  const isAllowed = await storage.isUserAllowed(replitUserId);
  if (isAllowed) {
    const owner = await storage.getOwner();
    const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
    return {
      allowed: true,
      isOwner: owner?.replitUserId === replitUserId,
      isPending: false,
      role: roleAndOrg?.role ?? (owner?.replitUserId === replitUserId ? 'SUPER_ADMIN' : 'CASHIER'),
      orgId: roleAndOrg?.orgId ?? null,
    };
  }
  
  // Check if there's an owner already
  const owner = await storage.getOwner();
  
  if (!owner) {
    // No owner exists - first user becomes SUPER_ADMIN automatically
    await storage.addAllowedUser({
      replitUserId,
      email,
      name,
      isOwner: 1,
      orgId: null,
      role: 'SUPER_ADMIN',
    });
    return { allowed: true, isOwner: true, isPending: false, role: 'SUPER_ADMIN', orgId: null };
  }
  
  // User is not on allow list and not owner - check pending status
  const existingRequest = await storage.getApprovalRequest(replitUserId);
  
  if (existingRequest) {
    if (existingRequest.status === 'approved') {
      // User was approved, add to allow list (orgId/role set by approver)
      await storage.addAllowedUser({
        replitUserId,
        email,
        name,
        isOwner: 0,
        orgId: null,
        role: 'CASHIER',
      });
      return { allowed: true, isOwner: false, isPending: false, role: 'CASHIER', orgId: null };
    } else if (existingRequest.status === 'rejected') {
      return { allowed: false, isOwner: false, isPending: false };
    }
    return { allowed: false, isOwner: false, isPending: true };
  }
  
  await storage.createApprovalRequest({
    replitUserId,
    email,
    name,
    profileImageUrl,
    status: 'pending',
  });
  
  return { allowed: false, isOwner: false, isPending: true };
}

// Memoized function to get or create strategy for a domain
const getOrCreateStrategy = memoize(
  async (domain: string) => {
    const config = await getOidcConfig();
    const verify: VerifyFunction = async (
      tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
      verified: passport.AuthenticateCallback
    ) => {
      const user = {};
      updateUserSession(user, tokens);
      await upsertUser(tokens.claims());
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
  { maxAge: 3600 * 1000 }
);

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Pre-register strategies for known domains (if available)
  if (process.env.REPLIT_DOMAINS) {
    for (const domain of process.env.REPLIT_DOMAINS.split(",")) {
      await getOrCreateStrategy(domain);
    }
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", async (req, res, next) => {
    // Ensure strategy exists for this domain
    await getOrCreateStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", async (req, res, next) => {
    // Ensure strategy exists for this domain
    await getOrCreateStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, async (err: any, user: any, info: any) => {
      if (err) {
        console.error('[Auth] Callback error:', err);
        return res.redirect('/api/login');
      }
      if (!user) {
        return res.redirect('/api/login');
      }
      
      // Check allow list
      const claims = user.claims;
      const allowListStatus = await checkAndHandleAllowList(claims);
      
      // Store allow list status and RBAC in user session
      user.isOwner = allowListStatus.isOwner;
      user.isAllowed = allowListStatus.allowed;
      user.isPending = allowListStatus.isPending;
      user.role = allowListStatus.role ?? (allowListStatus.isOwner ? 'SUPER_ADMIN' : 'CASHIER');
      user.orgId = allowListStatus.orgId ?? null;
      
      req.logIn(user, (loginErr: any) => {
        if (loginErr) {
          console.error('[Auth] Login error:', loginErr);
          return res.redirect('/api/login');
        }
        
        if (!allowListStatus.allowed) {
          // Redirect to pending approval page
          return res.redirect('/pending-approval');
        }
        
        // Allowed user - redirect to home
        return res.redirect('/');
      });
    })(req, res, next);
  });

  app.get("/api/logout", async (req, res) => {
    const config = await getOidcConfig();
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Phase 2D test-mode impersonation - MUST NEVER be enabled outside test/dev.
  // Belt + braces: PHASE2D_TEST=1, NODE_ENV !== production, localhost AND X-Test-Secret match.
  const testUserId = (req.headers['x-test-replit-user-id'] as string) || null;
  const isTestMode = process.env.PHASE2D_TEST === '1' && process.env.NODE_ENV !== 'production';
  const clientIp = req.ip || (req as any).socket?.remoteAddress || '';
  const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
  const testSecret = process.env.PHASE2D_TEST_SECRET;
  const secretMatch = !!testSecret && req.headers['x-test-secret'] === testSecret;
  const allowImpersonation = isTestMode && testUserId && isLocalhost && secretMatch;
  if (allowImpersonation) {
    try {
      const roleAndOrg = await storage.getUserRoleAndOrg(testUserId);
      if (!roleAndOrg) {
        return res.status(401).json({ message: 'Test user not found in allowed_users' });
      }
      (req as any).user = {
        id: testUserId,
        claims: { sub: testUserId },
        role: roleAndOrg.role,
        orgId: roleAndOrg.orgId,
        isOwner: roleAndOrg.role === 'SUPER_ADMIN',
        isAllowed: true,
        isPending: false,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      return next();
    } catch (err) {
      console.error('[Auth] Phase2D test user lookup failed:', err);
      return res.status(500).json({ message: 'Test user lookup failed' });
    }
  }

  // Explicit dev bypass only when DEV_AUTH_BYPASS=1 and not production
  if (isDevAuthBypassEnabled()) {
    const devUserId = process.env.DEV_AUTH_USER_ID || "dev-user";
    let role = "SUPER_ADMIN";
    let orgId: string | null = null;
    try {
      const roleAndOrg = await storage.getUserRoleAndOrg(devUserId);
      if (roleAndOrg) {
        role = roleAndOrg.role;
        orgId = roleAndOrg.orgId;
      }
    } catch {
      // fall through to SUPER_ADMIN defaults
    }
    req.user = req.user || {
      id: devUserId,
      username: "Developer",
      email: "dev@example.com",
      isAnonymous: false,
      isOwner: role === "SUPER_ADMIN",
      isAllowed: true,
      isPending: false,
      role,
      orgId,
      claims: {
        sub: devUserId,
        email: "dev@example.com",
        name: "Developer",
      },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    return next();
  }

  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Check if user is allowed
  if (user.isAllowed === false) {
    return res.status(403).json({ 
      message: "Access pending approval", 
      isPending: user.isPending,
      code: 'PENDING_APPROVAL'
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
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};

// Owner-only middleware (legacy - maps to SUPER_ADMIN)
export const isOwner: RequestHandler = async (req, res, next) => {
  if (isDevAuthBypassEnabled()) return next();
  const user = req.user as any;
  if (!user || !user.isOwner) {
    return res.status(403).json({ message: "Access denied. Owner only." });
  }
  return next();
};

// Require one of the given roles (SUPER_ADMIN, ADMIN, MANAGER, CASHIER)
export function requireRole(...allowedRoles: string[]): RequestHandler {
  return async (req, res, next) => {
    if (isDevAuthBypassEnabled()) return next();
    const user = req.user as any;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const role = user.role ?? (user.isOwner ? 'SUPER_ADMIN' : 'CASHIER');
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ message: `Access denied. Requires role: ${allowedRoles.join(' or ')}` });
    }
    return next();
  };
}

// Alias for isAuthenticated (clearer naming)
export const requireAuth = isAuthenticated;

// Sets req.orgContext = { orgId, locationId, role }
// MUST run after isAuthenticated.
// Contract:
//   SUPER_ADMIN: has no implicit org; MUST pass X-Org-Id or ?orgId= explicitly.
//   Non-SUPER (ADMIN/MANAGER/CASHIER): orgId from user record (allowed_users.org_id).
//     Do NOT require header/query; requests are auto-scoped to their org.
export const requireOrgContext: RequestHandler = async (req, res, next) => {
  const user = req.user as any;
  if (!user) return next();
  const role = user.role ?? (user.isOwner ? 'SUPER_ADMIN' : 'CASHIER');
  const userOrgId = user.orgId ?? null;
  const headerOrg = req.headers['x-org-id'] as string;
  const queryOrg = req.query?.orgId as string;
  const orgId = role === 'SUPER_ADMIN'
    ? (headerOrg || queryOrg || null)
    : userOrgId;
  const locationId = (req.headers['x-location-id'] as string) || user.defaultLocationId || null;
  (req as any).orgContext = {
    orgId: orgId || null,
    locationId: locationId || null,
    role,
  };
  return next();
};

// Call after requireOrgContext. Rejects if orgId is missing.
// Non-SUPER: orgId comes from user record (no explicit header/query needed).
// SUPER_ADMIN: must pass X-Org-Id or ?orgId=; no unscoped access.
export const requireOrgScope: RequestHandler = async (req, res, next) => {
  const ctx = (req as any).orgContext as { orgId: string | null; role: string } | undefined;
  if (!ctx) return next();
  if (!ctx.orgId) {
    return res.status(403).json({
      message: ctx.role === 'SUPER_ADMIN'
        ? 'Organization required. Pass X-Org-Id or ?orgId= to scope.'
        : 'No organization assigned. Contact an administrator.',
    });
  }
  return next();
};
