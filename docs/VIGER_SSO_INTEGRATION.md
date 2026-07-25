# Viger Cloud — shared login (SSO) integration guide

Copy-paste this to any app that runs on a `*.viger.cloud` subdomain (Mail,
Vault, Sanctum, Receipts, Invoice, Finance, …). It makes that app use the
**same Clerk login** as Arcarna and the portal, and enforce **per-user access**
so people only reach the apps they are allowed to.

---

## The rules (read first)

1. **One Clerk application for everything.** Every Viger app uses the **same**
   Clerk app — the one whose primary domain is `viger.cloud` (Frontend API
   `clerk.viger.cloud`). Because all apps are subdomains of `viger.cloud`, Clerk
   shares the session automatically: sign in once, you're in everywhere.

2. **Do NOT create a new Clerk app, and do NOT enable `isSatellite`.** These are
   subdomains of the primary domain, not separate domains. A new app or a
   satellite config breaks the shared session.

3. **Access is driven by the Clerk user's `publicMetadata`:**
   - `apps`: array of app keys the user may open, e.g. `["arcarna","mail"]`.
   - `role`: `"SUPER_ADMIN"` (or `superAdmin: true`) → may open everything.
   - No `apps` array → user may open everything (access control is opt-in, so
     nobody is locked out until you start assigning `apps`).

4. **Each app enforces its own door.** The portal only *hides* tiles (UX). Every
   app must check access **server-side** before serving data — that is the real
   security boundary.

App keys currently in use: `arcarna`, `vault`, `sanctum`, `mail`, `receipts`,
`invoice`, `finance`. Pick your app's key and keep it stable.

---

## Environment variables (every app)

Set these to the **same values Arcarna uses** (Clerk Dashboard → the viger.cloud
application → API Keys). The secret key is a real secret — put it only in the
server environment, never in client code or git.

```env
# Same Clerk app as Arcarna / the portal (primary domain viger.cloud)
CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsudmlnZXIuY2xvdWQk
CLERK_SECRET_KEY=<the Arcarna Clerk app secret key>    # server-only; never commit
CLERK_ACCOUNTS_URL=https://accounts.viger.cloud        # shared account portal

# This app's identity
APP_KEY=mail                                           # <-- change per app

# Client build (Vite-style apps); must match CLERK_PUBLISHABLE_KEY
VITE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsudmlnZXIuY2xvdWQk
VITE_CLERK_ACCOUNTS_URL=https://accounts.viger.cloud
```

In the Clerk Dashboard, add this app's origin (e.g. `https://mail.viger.cloud`)
to the application's allowed origins.

---

## Backend enforcement — Node / Express (`@clerk/express`)

This matches Arcarna's stack. Install `@clerk/express`, mount `clerkMiddleware()`,
then gate your routes with `requireAppAccess`.

```ts
// viger-access.ts — shared access guard for a Viger subdomain app
import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

/**
 * Require that the signed-in Clerk user may open this app.
 * Access model (from the user's publicMetadata):
 *   - role === "SUPER_ADMIN" (or superAdmin === true) -> full access
 *   - apps: string[] -> must include this app's key
 *   - no apps array   -> allowed (opt-in model; matches the portal)
 *
 * For a stricter, deny-by-default posture, pass { defaultAllow: false }.
 */
export function requireAppAccess(appKey: string, opts: { defaultAllow?: boolean } = {}) {
  const defaultAllow = opts.defaultAllow ?? true;
  return async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "not_signed_in" });

    const user = await clerkClient.users.getUser(userId);
    const meta = (user.publicMetadata ?? {}) as {
      role?: string;
      superAdmin?: boolean;
      apps?: unknown;
    };

    const isSuperAdmin = meta.role === "SUPER_ADMIN" || meta.superAdmin === true;
    const apps = Array.isArray(meta.apps) ? (meta.apps as string[]) : null;
    const allowed = isSuperAdmin || (apps === null ? defaultAllow : apps.includes(appKey));

    if (!allowed) return res.status(403).json({ error: "app_access_denied", app: appKey });
    next();
  };
}
```

Wire it up:

```ts
import express from "express";
import { clerkMiddleware } from "@clerk/express";
import { requireAppAccess } from "./viger-access";

const app = express();
app.use(clerkMiddleware()); // reads the shared viger.cloud session cookie

const APP_KEY = process.env.APP_KEY ?? "mail";

// Protect everything under /api for this app:
app.use("/api", requireAppAccess(APP_KEY), apiRouter);
```

---

## Frontend — React / Vite (`@clerk/clerk-react`)

Same as Arcarna's client. Use the **same** publishable key; do not set
`isSatellite`. Send unauthenticated users to the shared account portal.

```tsx
import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn, UserButton } from "@clerk/clerk-react";

const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY; // pk_live_Y2xlcmsudmlnZXIuY2xvdWQk

export function App() {
  return (
    <ClerkProvider
      publishableKey={pk}
      // Shared account portal on the primary domain; NOT a satellite.
      signInUrl={`${import.meta.env.VITE_CLERK_ACCOUNTS_URL}/sign-in`}
      signInForceRedirectUrl={window.location.href}
    >
      <SignedIn>
        <header><UserButton afterSignOutUrl="https://viger.cloud/" /></header>
        {/* app UI */}
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </ClerkProvider>
  );
}
```

Client checks are for UX only. The `requireAppAccess` guard above is what
actually protects data.

---

## Next.js variant (if an app is built with Next)

```ts
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const APP_KEY = process.env.APP_KEY ?? "mail";
const isProtected = createRouteMatcher(["/(.*)"]); // gate the whole app

export default clerkMiddleware(async (auth, req) => {
  if (!isProtected(req)) return;
  const { userId } = await auth();
  if (!userId) return auth().redirectToSignIn();

  const { clerkClient } = await import("@clerk/nextjs/server");
  const user = await (await clerkClient()).users.getUser(userId);
  const meta = user.publicMetadata as { role?: string; superAdmin?: boolean; apps?: unknown };
  const isSuperAdmin = meta.role === "SUPER_ADMIN" || meta.superAdmin === true;
  const apps = Array.isArray(meta.apps) ? (meta.apps as string[]) : null;
  const allowed = isSuperAdmin || apps === null || apps.includes(APP_KEY);
  if (!allowed) return new Response("app_access_denied", { status: 403 });
});

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
```

Use `@clerk/nextjs`, keep `ClerkProvider` inside `<body>`, and use the same
publishable key. Do not set a satellite domain.

---

## Managing who can access what

Clerk Dashboard → **Users** → pick a user → **Metadata → Public**:

```json
{ "apps": ["arcarna", "mail"], "role": "MANAGER" }
```

- Add/remove app keys to grant/revoke access to specific apps.
- Set `"role": "SUPER_ADMIN"` for full access.
- Leave `apps` unset to grant all apps (opt-in model).

Later this can be managed from an Arcarna admin screen using the Clerk backend
API (`clerkClient.users.updateUser(id, { publicMetadata: { apps: [...] } })`).
