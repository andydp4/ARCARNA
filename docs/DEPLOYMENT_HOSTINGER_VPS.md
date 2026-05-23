# Deploy MidnightEPOS on Hostinger VPS

**One guide. Copy and paste. No DevOps experience needed.**

This guide is written for **Andy** (or any owner). You do **not** need to understand Docker, Linux, or nginx.

---

## Which method we use (and why)

| Method | Good for owners? | Verdict |
|--------|------------------|---------|
| **A. Docker Compose** (this guide) | Yes — one install script starts the app **and** the database together | **Recommended** |
| B. Node + PM2 | No — you must install Node, Postgres, PM2, and wire them yourself | Not recommended |

**We use Option A only.** Follow this page top to bottom.

---

## What you need before starting

| Item | Where to get it |
|------|----------------|
| Hostinger **VPS** plan (not shared web hosting) | [hostinger.com](https://www.hostinger.com) — product name usually **VPS** |
| **Ubuntu 22.04** on the VPS | Selected when creating the VPS |
| **Root password** or SSH key | Hostinger → VPS → Manage → SSH access |
| Your VPS **IP address** | Hostinger → VPS → overview (e.g. `123.45.67.89`) |
| A **domain** (optional for first test) | Hostinger → Domains — you can use `http://IP:5000` first |
| **Clerk login** keys for production | [AUTH_SETUP_CLERK.md](./AUTH_SETUP_CLERK.md) — free Clerk account, copy `pk_` / `sk_` keys |

**Assumptions in this guide**

- VPS OS: **Ubuntu 22.04**
- You can open a **terminal** on the server (Hostinger browser terminal **or** Mac Terminal)
- App runs on port **5000** until you add a custom domain later
- All commands below marked **ON SERVER** are pasted into that server terminal

---

## Overview (4 parts)

1. **On your Mac** — open a terminal to connect to the server  
2. **On the server** — install Docker (one paste)  
3. **On the server** — download the app and fill in a password file  
4. **On the server** — run the install script → open the app in your browser  

---

## Part 1 — Connect to your Hostinger VPS

**Where:** On your **Mac**, open **Terminal** (Applications → Utilities → Terminal).

**Paste** (replace with your real IP and root password when asked):

```bash
ssh root@YOUR-VPS-IP
```

Example:

```bash
ssh root@123.45.67.89
```

**Success looks like:** A prompt like `root@ubuntu:~#`

**If it fails**

- “Connection refused” → Check IP in Hostinger panel; VPS must be **Running**
- “Permission denied” → Reset root password in Hostinger → VPS → SSH access
- Prefer Hostinger’s **Browser terminal** (VPS → Manage → Browser terminal) — same commands, no Mac SSH setup

**From here on, every command is ON THE SERVER** unless we say otherwise.

---

## Part 2 — Install Docker (one-time)

**Where:** **ON THE SERVER** (you should see `root@...#`).

**Paste this whole block** (wait until it finishes — may take 2–5 minutes):

```bash
curl -fsSL https://get.docker.com | sh
```

**Then paste:**

```bash
docker compose version
```

**Success looks like:** A version number, e.g. `Docker Compose version v2.x.x`

**If it fails**

- “curl: command not found” → Run: `apt update && apt install -y curl` then try again
- Still stuck → Use Hostinger live chat and say: “Please help install Docker on my Ubuntu VPS”

---

## Part 3 — Download MidnightEPOS

**Where:** **ON THE SERVER**

**Paste:**

```bash
cd /root
git clone https://github.com/andydp4/MidnightEPOS.git
cd MidnightEPOS
git checkout main
```

**Success looks like:** No red “fatal” errors; folder exists:

```bash
ls
```

You should see folders like `client`, `server`, `docs`, `scripts`.

---

## Part 4 — Create your password file

**Where:** **ON THE SERVER**, inside `/root/MidnightEPOS`

**Paste:**

```bash
cp .env.production.example .env.production
nano .env.production
```

**What to change in nano** (use arrow keys; edit these lines):

| Line | What to put |
|------|-------------|
| `POSTGRES_PASSWORD=` | A long random password (e.g. 20+ letters/numbers) — **write this down** |
| `SESSION_SECRET=` | Another long random string (at least 32 characters) |
| `AUTH_PROVIDER=` | `clerk` (recommended) |
| `CLERK_PUBLISHABLE_KEY=` | From Clerk dashboard → API Keys |
| `CLERK_SECRET_KEY=` | From Clerk dashboard → API Keys (keep private) |
| `REPL_ID=` / `REPLIT_DOMAINS=` | Only if using `AUTH_PROVIDER=replit` rollback |

See **[AUTH_SETUP_CLERK.md](./AUTH_SETUP_CLERK.md)** for redirect URLs and screenshots guidance.

Leave these as-is for first test:

- `SESSION_COOKIE_SECURE=0` (use until you have HTTPS)
- `DEV_AUTH_BYPASS=0`
- `APP_PORT=5000`

**Save in nano:** Press `Ctrl+O`, Enter, then `Ctrl+X`.

**Success looks like:** Back at the `root@...#` prompt with no error.

---

## Part 5 — Open port 5000 on Hostinger (important)

**Where:** **Hostinger website** (in your browser, not terminal)

1. Log in to Hostinger  
2. Go to **VPS** → your server → **Firewall** or **Security**  
3. Add rule: **allow TCP port 5000** from anywhere (or “all”)  

**Success looks like:** Port 5000 listed as allowed.

**If you skip this:** Browser will not load `http://YOUR-IP:5000` even if the app is running.

---

## Part 6 — Run the install script

**Where:** **ON THE SERVER**, inside `/root/MidnightEPOS`

**Paste:**

```bash
chmod +x scripts/hostinger-deploy.sh
./scripts/hostinger-deploy.sh install
```

**This step takes 5–15 minutes the first time** (downloads and builds).

**Success looks like:** At the end you see:

```text
OK: App is responding.
SUCCESS: Install finished.
Open in your browser: http://YOUR-SERVER-IP:5000
```

**Test on your Mac browser:** Open `http://123.45.67.89:5000` (your real IP).

You should see the MidnightEPOS login / landing page.

**If it fails**

| Message | What to do |
|---------|------------|
| `Missing .env.production` | Repeat Part 4 (`cp` and `nano`) |
| `NOT READY YET` | Wait 2 minutes, run: `./scripts/hostinger-deploy.sh status` |
| Still not ready | Run: `./scripts/hostinger-deploy.sh logs` — screenshot last 20 lines for support |
| Browser timeout | Check Part 5 (firewall port 5000) |
| Login redirect errors | Check Clerk redirect URLs in [AUTH_SETUP_CLERK.md](./AUTH_SETUP_CLERK.md), then `./scripts/hostinger-deploy.sh update` |

---

## Part 7 — Check the app is healthy (optional)

**Where:** **ON THE SERVER**

```bash
./scripts/hostinger-deploy.sh status
```

**Success looks like:** `OK: App is responding.` and JSON with `"ok":true`.

---

## Updating the app later (after code changes)

**Where:** **ON THE SERVER**, inside `/root/MidnightEPOS`

```bash
./scripts/hostinger-deploy.sh update
```

**Success looks like:** `Update finished. Refresh your browser.`

---

## Stopping the app (keeps your data)

**Where:** **ON THE SERVER**

```bash
./scripts/hostinger-deploy.sh stop
```

Your database is **not** deleted. Start again with:

```bash
./scripts/hostinger-deploy.sh install
```

---

## Rollback (go back if something breaks)

### A. Stop everything (safe)

**ON THE SERVER:**

```bash
cd /root/MidnightEPOS
./scripts/hostinger-deploy.sh stop
```

### B. Go back to the last known good code version

**ON THE SERVER:**

```bash
cd /root/MidnightEPOS
git fetch origin
git checkout recovery-stable-r7
./scripts/hostinger-deploy.sh install
```

`recovery-stable-r7` is the tagged stable recovery release.

### C. Restore database backup (only if you made one)

If you ran a backup before changing:

```bash
cd /root/MidnightEPOS
docker compose --env-file .env.production exec -T postgres pg_dump -U midnight midnight_epos > backup.sql
```

To restore (destructive — overwrites current data):

```bash
./scripts/hostinger-deploy.sh stop
docker compose --env-file .env.production up -d postgres
sleep 10
docker compose --env-file .env.production exec -T postgres psql -U midnight -d midnight_epos < backup.sql
./scripts/hostinger-deploy.sh install
```

---

## Custom domain (later — optional)

For now, `http://YOUR-IP:5000` is enough to go live internally.

Adding `https://your-domain.com` needs:

1. DNS A-record → your VPS IP (Hostinger → Domains → DNS)  
2. HTTPS setup (Hostinger support or a technician)  
3. Set `SESSION_COOKIE_SECURE=1` in `.env.production`  
4. Run `./scripts/hostinger-deploy.sh update`  

Ask Hostinger: “Point my domain to my VPS and enable HTTPS for port 5000.”

---

## What you should **not** do in production

- Do **not** set `DEV_AUTH_BYPASS=1`  
- Do **not** share `SESSION_SECRET` or database passwords  
- Do **not** delete the Docker volume `pgdata` unless you intend to wipe all data  

---

## Quick reference card

| I want to… | ON SERVER, in `/root/MidnightEPOS` |
|------------|-------------------------------------|
| First install | `./scripts/hostinger-deploy.sh install` |
| Check if running | `./scripts/hostinger-deploy.sh status` |
| View errors | `./scripts/hostinger-deploy.sh logs` |
| Update app | `./scripts/hostinger-deploy.sh update` |
| Stop app | `./scripts/hostinger-deploy.sh stop` |
| Open app | Browser → `http://YOUR-VPS-IP:5000` |

---

## More detail for technicians

- Environment variables: `docs/PRODUCTION_ENV.md`  
- Launch testing checklist: `docs/LAUNCH_CHECKLIST.md`  
- Purchase/receiving workflow: `docs/WORKFLOW_PURCHASE_RECEIVING.md`  
