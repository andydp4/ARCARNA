# Cloudflare edge — viger.cloud / Midnight EPOS

Operator runbook for DNS, TLS, caching, and common failures when Cloudflare sits in front of the VPS nginx → Node stack.

**Related:** [`deploy/nginx-viger.cloud.conf.example`](../../deploy/nginx-viger.cloud.conf.example), [`DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md).

---

## Topology

```
Browser → Cloudflare (DNS, proxy, WAF) → VPS nginx :443 → Node :5000
                                              ├── /           portal
                                              └── /midnight   EPOS app + /midnight/api/*
```

Clerk auth and API calls must see correct `Host`, `X-Forwarded-Proto`, and must **not** be served from stale CDN cache.

---

## DNS

| Record | Type | Target | Proxy |
|--------|------|--------|-------|
| `viger.cloud` | A | VPS public IP | Proxied (orange cloud) |
| `www` | CNAME → apex or A | same | Proxied |

**SSL/TLS mode (Cloudflare dashboard):** **Full (strict)** once origin has a valid cert (Certbot on nginx). Use **Full** only during first cert issuance if needed; avoid **Flexible** in production (breaks secure cookies and confuses Clerk).

---

## What must NOT be cached

Create a **Cache Rule** (or Page Rule legacy) with **Bypass cache** for:

- `/midnight/api/*` — all JSON, auth, webhooks, health
- `/midnight/*` when responses include `Set-Cookie` (default for authenticated SPA)
- Clerk-related paths if routed on same host (follow Clerk docs for allowed origins)

**Do cache (optional):** static assets under `/midnight/assets/*` with long TTL **only if** filenames are content-hashed (Vite build does this). When in doubt, bypass cache for the whole `/midnight` path until you verify `Cache-Control` headers from origin.

Origin should send for API routes:

```
Cache-Control: no-store, private
```

Node/Express API routes should not emit `public` cache headers.

---

## Cache bust / stale API symptoms

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Old dashboard numbers after deploy | CDN cached HTML/JS | Purge cache for `viger.cloud/midnight*` or disable cache on HTML |
| 401/403 after login on some regions only | Mixed Flexible/Full SSL | Set SSL to Full (strict); ensure origin cert valid |
| Webhook or channel ingest failures | Cached POST response | Bypass cache for `/midnight/api/*` |
| Sign-out loops or stale session | Cached auth responses | Bypass cache; check `Cache-Control` on API |

**Purge:** Cloudflare → Caching → Configuration → **Purge Everything** (incident) or custom purge for `/midnight/*`.

---

## Common errors

### 403 on sign-out or Clerk redirect

- Confirm **Allowed redirect URLs** in Clerk dashboard include `https://viger.cloud/midnight/*`.
- Cloudflare **Bot Fight Mode** or WAF may block Clerk callbacks — add skip rule for Clerk IP ranges or path patterns per Clerk support docs.
- Ensure origin receives `X-Forwarded-Proto: https` (nginx sets this; see example config).

### 522 / 523 origin errors

- VPS down or firewall blocked 443 — check `pm2 status`, nginx, UFW allows 80/443.
- Origin cert expired — renew Certbot on VPS.

### WebSocket / realtime (if enabled later)

- Cloudflare **Network** → WebSockets: On.
- nginx `proxy_set_header Upgrade` / `Connection` as in example config.

---

## Security headers

Prefer setting **HSTS** on origin nginx (`add_header Strict-Transport-Security` in HTTPS server block). Cloudflare **SSL/TLS → Edge Certificates → Always Use HTTPS** should be On.

Optional Cloudflare WAF managed rules for production; test POS checkout after enabling.

---

## Deploy checklist (after code on VPS)

1. `git pull` + `npm ci && npm run build` on VPS (see wave briefs).
2. `pm2 delete arcarna-epos && pm2 start ecosystem.config.cjs && pm2 save` (re-reads `.env`; `pm2 restart` does not)
3. If users report stale UI: purge Cloudflare cache for `/midnight` paths.
4. Smoke: `curl -sI https://viger.cloud/midnight/api/health` — expect `200`, `Cache-Control` no-store.

---

## Out of scope

- Terraform / Cloudflare API automation
- Multi-region Workers
