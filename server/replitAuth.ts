import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

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

async function checkAndHandleAllowList(claims: any): Promise<{ allowed: boolean; isOwner: boolean; isPending: boolean }> {
  const replitUserId = claims["sub"];
  const email = claims["email"];
  const name = `${claims["first_name"] || ''} ${claims["last_name"] || ''}`.trim() || email;
  const profileImageUrl = claims["profile_image_url"];
  
  // Check if user is already on allow list
  const isAllowed = await storage.isUserAllowed(replitUserId);
  if (isAllowed) {
    const owner = await storage.getOwner();
    return { allowed: true, isOwner: owner?.replitUserId === replitUserId, isPending: false };
  }
  
  // Check if there's an owner already
  const owner = await storage.getOwner();
  
  if (!owner) {
    // No owner exists - first user becomes owner automatically
    await storage.addAllowedUser({
      replitUserId,
      email,
      name,
      isOwner: 1,
    });
    return { allowed: true, isOwner: true, isPending: false };
  }
  
  // User is not on allow list and not owner - check pending status
  const existingRequest = await storage.getApprovalRequest(replitUserId);
  
  if (existingRequest) {
    if (existingRequest.status === 'approved') {
      // User was approved, add to allow list
      await storage.addAllowedUser({
        replitUserId,
        email,
        name,
        isOwner: 0,
      });
      return { allowed: true, isOwner: false, isPending: false };
    } else if (existingRequest.status === 'rejected') {
      return { allowed: false, isOwner: false, isPending: false };
    }
    // Status is pending
    return { allowed: false, isOwner: false, isPending: true };
  }
  
  // Create new pending approval request
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
      
      // Store allow list status in user session
      user.isOwner = allowListStatus.isOwner;
      user.isAllowed = allowListStatus.allowed;
      user.isPending = allowListStatus.isPending;
      
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
  // In development mode, bypass authentication
  if (process.env.NODE_ENV === 'development') {
    // Set a mock user for development (as owner)
    req.user = req.user || {
      id: 'dev-user',
      username: 'Developer',
      email: 'dev@example.com',
      isAnonymous: false,
      isOwner: true,
      isAllowed: true,
      isPending: false,
      claims: {
        sub: 'dev-user',
        email: 'dev@example.com',
        name: 'Developer'
      },
      expires_at: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
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

// Owner-only middleware for admin routes
export const isOwner: RequestHandler = async (req, res, next) => {
  // In development mode, allow access
  if (process.env.NODE_ENV === 'development') {
    return next();
  }

  const user = req.user as any;
  
  if (!user || !user.isOwner) {
    return res.status(403).json({ message: "Access denied. Owner only." });
  }
  
  return next();
};
