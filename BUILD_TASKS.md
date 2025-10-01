# Midnight EPOS - Replit Agent 3 Build Tasks

This document provides the **step-by-step build order** for the Replit Agent to follow.

---

## 1. Project Setup
- Create a monorepo with `apps/server` and `apps/web`.
- Install dependencies:
```bash
npm install express express-session connect-pg-simple pg drizzle-orm zod bcrypt jsonwebtoken puppeteer tailwindcss react react-dom recharts shadcn/ui vite typescript ts-node
```

---

## 2. Backend (apps/server)

### 2.1 Core Setup
- Use Node.js + Express + TypeScript.
- Enable strict mode in tsconfig.json.

### 2.2 Database (Postgres + Drizzle)
- Create tables: customers, products, orders, order_items, invoices, overhead_costs, order_expenses, invoice_templates, audit_logs.
- Add analytics tables: analytics_daily, analytics_weekly, analytics_monthly, customer_metrics.
- Add `user_sessions` table (migration file provided).

### 2.3 Worker Engine
- Worker consumes domain_outbox events.
- On `OrderAggregatesRequested`:
  - Update inventory stock.
  - Update analytics (daily/weekly/monthly).
  - Update customer_metrics (order_count, total_spent, last_order_date).
  - Compute RFM score + CLV.
  - Mark outbox row processed.

### 2.4 API Endpoints
- CRUD:
  - /api/customers
  - /api/products
  - /api/orders
  - /api/invoices
- Analytics:
  - /api/analytics/top-customers
  - /api/analytics/daily-revenue
  - /api/analytics/monthly-summary
- Auth:
  - /api/auth/login
  - /api/auth/callback
  - /api/auth/session
  - /api/auth/logout

### 2.5 Security
- Role-based access (Admin, Manager, Supervisor, Cashier).
- Middleware `requireAuth` for protected routes.
- CSRF protection, SQL injection prevention, input validation (Zod).
- Audit logging for critical actions.

### 2.6 Sessions
- Use express-session + connect-pg-simple.
- Store sessions in user_sessions table.
- Secure cookies in production (httpOnly, secure).

---

## 3. Frontend (apps/web)

### 3.1 Setup
- React + Vite + TailwindCSS + TypeScript.
- Use shadcn/ui components.

### 3.2 Authentication
- AuthGate.tsx calls /api/auth/session.
- If unauthenticated: show "Login with Replit" button (redirects to /api/auth/login).
- If authenticated: show dashboard + "Logout" button.

### 3.3 Analytics Dashboard
- AnalyticsDashboard.tsx displays:
  - Top customers table (RFM + CLV).
  - Daily revenue (line chart).
  - Monthly orders (bar chart).
- Styled with Midnight Standard branding (deep navy + neon).

---

## 4. Testing
- Unit tests for business logic (profit, loyalty, RFM).
- Integration tests for API endpoints.
- E2E: Place order → check inventory, analytics, customer metrics update.
- Test login + logout flows.

---

## 5. Deployment
- Environment variables:
```
DATABASE_URL=postgresql://...
SESSION_SECRET=super_secure
NODE_ENV=production
```
- Run migrations (including user_sessions table).
- Start server, worker, and web app.

---

## 6. Deliverables
- Complete monorepo with apps/server and apps/web.
- Fully functional EPOS with analytics, auth, and dashboard.
- Midnight branding applied.

---