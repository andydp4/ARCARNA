# Midnight EPOS

## Overview

Midnight EPOS is an enterprise Point of Sale system built as a full-stack TypeScript monorepo. The system handles order processing, inventory management, customer analytics, invoice generation, and business intelligence. It follows a domain-driven design approach with a clean separation between business logic (domain layer), application layer (server), and presentation layer (web client).

The application supports multiple payment methods (cash, card, transfer, and "tick"/credit), tracks customer lifetime value (CLV) and RFM scores, generates PDF invoices, and provides real-time analytics dashboards for revenue tracking and customer insights.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure

The project uses a monorepo architecture with three main workspaces:

1. **packages/domain** - Pure business logic layer with no external dependencies
2. **apps/server** - Express.js backend application
3. **apps/web** - React frontend application (legacy, being replaced by client/)
4. **client/** - New React frontend with shadcn/ui components

### Domain-Driven Design

**Problem**: Need to isolate business rules from infrastructure concerns and ensure consistent behavior across different runtime environments.

**Solution**: The `@midnight/domain` package contains pure TypeScript business logic with defined ports (interfaces) for external dependencies. This allows the system to run in either in-memory mode (for testing/development) or with full database backing (for production).

**Key Components**:
- `DomainEngine` - Orchestrates business operations (order placement, stock reservation, customer updates)
- Port interfaces - Define contracts for repositories (OrdersRepo, ProductsRepo, CustomersRepo) and external services (InvoicesPort, AnalyticsSink, AuditPort)
- Event bus - Publishes domain events for async processing
- Branded types - Type-safe IDs (OrderId, CustomerId, ProductId) to prevent mixing different entity types

**Pros**: Testable without infrastructure, framework-independent, clear separation of concerns
**Cons**: Requires adapter implementations for each environment (memory vs database)

### Backend Architecture

**Framework**: Express.js with TypeScript in strict mode

**Transaction Management**: The engine uses a higher-order transaction function that wraps all database operations in a single atomic unit. Operations either all succeed or all roll back together.

**Dual-Mode Operation**:
- **With DATABASE_URL**: Uses Drizzle ORM with PostgreSQL, implements full analytics worker, audit logging, and session storage
- **Without DATABASE_URL**: Runs in-memory mode with stub implementations for development/testing

**Engine Wiring**: The `engine.wiring.ts` file dynamically loads either Drizzle-based or in-memory implementations based on environment configuration. This conditional import pattern allows the same codebase to run in different environments.

### Authentication

**Problem**: Need secure authentication that integrates with Replit's identity provider while supporting local development.

**Solution**: Implements Replit OIDC (OpenID Connect) authentication with session-based storage:
- Production: Full OIDC flow with Replit as identity provider
- Development: Bypass mode with mock user sessions for local testing
- Sessions stored in PostgreSQL using `connect-pg-simple` for persistence across server restarts

**Session Management**: Uses express-session with PostgreSQL backing, 7-day cookie lifetime, secure/httpOnly flags in production.

### Analytics Worker

**Problem**: Order processing must be fast and synchronous, but analytics aggregation is computationally expensive.

**Solution**: Event-driven architecture with domain outbox pattern:
1. Order placement writes an event to `domain_outbox` table
2. Separate worker process polls outbox for unprocessed events
3. Worker updates aggregated tables (daily/weekly/monthly analytics, customer metrics, RFM scores)
4. Worker marks events as processed to prevent duplicate processing

**RFM Calculation**: Recency, Frequency, Monetary scoring system (1-5 for each dimension, max score 15) for customer segmentation.

**CLV Calculation**: Customer Lifetime Value computed using historical order data and customer behavior patterns.

### Frontend Architecture

**Framework**: React 18 with Vite build system

**UI Library**: shadcn/ui components (Radix UI primitives + Tailwind CSS)

**State Management**: 
- TanStack Query (React Query) for server state caching and synchronization
- Custom hooks for auth state (`useAuth`)
- No global client state - relies on server as source of truth

**Routing**: wouter (lightweight alternative to react-router)

**Chart Library**: Recharts for analytics visualizations (revenue trends, order volume, customer metrics)

**Web Contact Picker Integration**: Customer creation form supports importing contacts from device phonebook using the Web Contacts API:
- Browser compatibility check with graceful fallback for unsupported browsers
- One-tap import of contact name, email, and phone number
- Imported data pre-fills the form but remains fully editable
- Auto-save functionality preserves imported data
- Mobile-optimized with touch-friendly 44px minimum button height

### Database Schema

**ORM**: Drizzle ORM with PostgreSQL dialect

**Core Tables**:
- `customers` - Customer records with category/tier and loyalty points
- `products` - Inventory with SKU, pricing, and stock levels
- `orders` - Order headers with payment method and status
- `order_items` - Line items linking orders to products
- `invoices` - Invoice metadata
- `audit_logs` - Audit trail for all business actions

**Analytics Tables**:
- `analytics_daily` - Daily revenue and order count aggregates
- `analytics_weekly` - Weekly aggregates (using ISO week calculation)
- `analytics_monthly` - Monthly aggregates
- `customer_metrics` - Per-customer CLV, RFM scores, order history

**Event Sourcing**:
- `domain_outbox` - Event outbox for async processing with processed_at timestamp

**Session Storage**:
- `sessions` - Express session storage (required for Replit Auth)
- `users` - User profile storage (required for Replit Auth)

### PDF Invoice Generation

**Problem**: Need server-side PDF generation for professional invoices.

**Solution**: Puppeteer (headless Chrome) renders HTML templates to PDF:
1. Order data retrieved from database
2. HTML invoice template populated with order details
3. Puppeteer renders HTML to PDF bytes
4. PDF stored temporarily or uploaded to cloud storage (S3/Drive integration planned)

**Pros**: Full HTML/CSS control, supports complex layouts
**Cons**: Resource-intensive, requires Chrome binary in deployment environment

## External Dependencies

### Database
- **PostgreSQL** via Neon serverless driver (`@neondatabase/serverless`)
- Drizzle ORM for type-safe database queries
- Connection pooling via pg Pool
- WebSocket-based protocol for serverless environments

### Authentication
- **Replit OIDC** for production authentication
- `openid-client` library for OAuth2/OIDC flows
- Passport.js strategy for OIDC integration
- Session storage in PostgreSQL

### Frontend Dependencies
- **Radix UI** - Unstyled, accessible component primitives
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - Pre-built component collection built on Radix + Tailwind
- **TanStack Query** - Server state management
- **Recharts** - React charting library
- **Vite** - Build tool and development server

### PDF Generation
- **Puppeteer** - Headless Chrome automation for PDF rendering

### Development Tools
- **TypeScript** in strict mode across all packages
- **Jest** for unit and integration testing
- **tsx** for TypeScript execution in development
- **esbuild** for production server bundling

### Replit-Specific Integrations
- `@replit/vite-plugin-runtime-error-modal` - Development error overlay
- `@replit/vite-plugin-cartographer` - Code navigation
- `@replit/vite-plugin-dev-banner` - Development mode indicator