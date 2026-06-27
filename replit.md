# ARCARNA EPOS

## Overview
ARCARNA EPOS is a full-stack TypeScript monorepo enterprise Point of Sale system. It manages order processing, inventory, customer analytics, invoice generation, and business intelligence. The system employs a domain-driven design with a clean separation between business logic, application, and presentation layers. Key capabilities include multiple payment methods, customer lifetime value (CLV) and RFM scoring, PDF invoice generation, and real-time analytics. A core ambition is to provide robust offline capabilities, ensuring critical operations continue uninterrupted during network outages, with automatic synchronization upon reconnection.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project uses a monorepo with `packages/domain` (pure business logic), `apps/server` (Express.js backend), and `client/` (React frontend with shadcn/ui).

### Domain-Driven Design
The `@midnight/domain` package isolates business rules using defined ports (interfaces) for external dependencies, enabling both in-memory and database-backed operations. It features a `DomainEngine` for orchestrating business operations, port interfaces for repositories and services, an event bus for async processing, and type-safe IDs.

### Backend Architecture
Built with Express.js and TypeScript, the backend supports atomic transaction management. It operates in dual-mode: with a `DATABASE_URL` using Drizzle ORM and PostgreSQL, or in an in-memory mode for development. `engine.wiring.ts` dynamically configures these modes.

### Authentication
Secure authentication is implemented using Replit OIDC for production and mock user sessions for local development. Session management is handled by `express-session` with PostgreSQL storage.

### Analytics Worker
An event-driven architecture with a domain outbox pattern is used. Order placement events are written to a `domain_outbox` table and processed by a separate worker. This worker updates aggregated analytics tables (daily, weekly, monthly, customer metrics, RFM, CLV) and marks events as processed.

### Frontend Architecture
The frontend uses React 18 with Vite, shadcn/ui components, and wouter for routing. TanStack Query manages server state caching. Recharts is used for data visualization. It includes Web Contact Picker integration for customer creation and supports optimistic UI updates.

### Progressive Web App (PWA) Offline Support
The system is designed for offline-first operation. A service worker caches assets and uses a network-first strategy for API calls. An IndexedDB-backed `mutations-queue` stores offline operations (orders, inventory, customers, expenses) sorted by timestamp. A background sync service polls and replays these mutations when online. QueryClient integrates with IndexedDB to auto-cache API responses and fallback to cached data when offline. An offline indicator provides visual status.

### Database Schema
Utilizes Drizzle ORM with PostgreSQL. Core tables include `customers`, `products`, `orders`, `order_items`, `invoices`, and `audit_logs`. Analytics tables (`analytics_daily`, `analytics_weekly`, `analytics_monthly`, `customer_metrics`) store aggregated data. `domain_outbox` supports event sourcing, and `sessions` and `users` tables are used for authentication.

### PDF Invoice Generation & Google Drive Storage
Server-side PDF generation uses PDFKit (`server/services/pdfGenerator.ts`) to create professional invoice documents with Viger Assist branding. The InvoiceWorker automatically:
1. Creates invoice record in database when order is placed
2. Generates PDF with order details, items, and totals
3. Uploads PDF to "ARCARNA EPOS Invoices" folder in Google Drive
4. Sets public read permissions so customers can access links
5. Updates invoice record with `googleDriveFileId` and `googleDriveLink`

Invoice PDF Features:
- Viger Assist Ltd branding (Company #16247814)
- Position-based line descriptions (Services rendered, planning, development, implementation, evaluation, Expenses reclaimed)
- VAT always 0%, GBP currency
- Bank transfer and online payment details included

API endpoints:
- `GET /api/invoices/:id/pdf` - Returns Google Drive link for the invoice PDF
- `POST /api/invoices/:id/regenerate-pdf` - Regenerates and re-uploads PDF to Drive
- `POST /api/invoices/regenerate-all-missing` - Batch regenerates PDFs for invoices missing Drive links

### Event-Driven Workers Architecture
Workers follow day 0 coding principles: clean, modular, well-annotated code with comprehensive JSDoc documentation.

**InventoryWorker** (`server/workers/inventoryWorker.ts`):
- Handles stock adjustments for OrderCreated, OrderUpdated, RefundIssued, OrderCancelled events
- SKU-to-UUID resolution: supports both database UUIDs and SKU string identifiers
- Idempotent processing via eventId tracking in inventory_movements table
- Low stock warnings for items falling below stockLimit threshold

**InvoiceWorker** (`server/workers/invoiceWorker.ts`):
- Single-responsibility helper functions: fetchCustomerInfo, fetchOrderItems, createInvoiceRecord, generateAndUploadPdf
- Concurrent-safe with unique constraint handling
- Non-blocking PDF/Drive failures (invoice record always created)

**GoogleDrive Service** (`server/services/googleDrive.ts`):
- Typed connector interfaces (OAuthCredentials, ConnectorSettings, ConnectorResponse)
- Automatic token refresh via Replit connector
- PDF upload with public read permissions

## External Dependencies

### Database
- **PostgreSQL** via Neon serverless driver (`@neondatabase/serverless`)
- Drizzle ORM for type-safe queries

### Authentication
- **Replit OIDC** for production authentication
- `openid-client` library
- Passport.js strategy

### Frontend Dependencies
- **Radix UI**
- **Tailwind CSS**
- **shadcn/ui**
- **TanStack Query**
- **Recharts**
- **Vite**

### PDF Generation
- **PDFKit** for server-side PDF creation

### Cloud Storage
- **Google Drive API** via Replit connector for invoice PDF storage

### Replit-Specific Integrations
- `@replit/vite-plugin-runtime-error-modal`
- `@replit/vite-plugin-cartographer`
- `@replit/vite-plugin-dev-banner`