# Midnight EPOS Design Guidelines

## Design Approach
**System Selected:** Material Design principles adapted for shadcn/ui components
**Justification:** POS systems prioritize speed, accuracy, and touch-friendly mobile interactions. Material Design's elevation system and clear hierarchy work perfectly for transaction-heavy interfaces requiring quick decision-making.

## Core Design Elements

### A. Color Palette
**Dark Mode (Primary):**
- Background: 30 15% 11% (slate-950 equivalent, #1E293B base)
- Surface: 217 33% 17% (elevated cards)
- Primary: 217 91% 60% (blue #3B82F6)
- Success/Accent: 160 84% 39% (emerald #10B981)
- Text Primary: 210 40% 98%
- Text Secondary: 215 20% 65%
- Border: 217 33% 25%
- Destructive: 0 72% 51%

**Light Mode (Secondary):**
- Background: 0 0% 100%
- Surface: 210 40% 98%
- Primary: 217 91% 60%
- Success: 160 84% 39%
- Text: 222 47% 11%

### B. Typography
**Fonts:** Inter (primary), JetBrains Mono (numbers/prices)
- Display: 32px/40px, font-semibold (mobile headers)
- H1: 24px/32px, font-semibold
- H2: 20px/28px, font-medium
- Body: 16px/24px, font-normal
- Small: 14px/20px
- Price Display: 28px/36px, JetBrains Mono, font-bold
- Mini (labels): 12px/16px, font-medium, uppercase tracking-wide

### C. Layout System
**Spacing Primitives:** 2, 4, 6, 8, 12, 16 (tailwind units)
- Card padding: p-4 mobile, p-6 desktop
- Section spacing: space-y-4 mobile, space-y-6 desktop
- Grid gaps: gap-4
- Touch targets: min-h-12 (48px minimum)

**Grid System:**
- Mobile: Single column, full-width cards
- Tablet: 2-column grid for products/transactions
- Desktop: 3-column dashboard, 2-column transaction views

### D. Component Library

**Navigation:**
- Bottom Tab Bar (mobile): 5 icons max, h-16, fixed bottom, backdrop-blur
- Sidebar (desktop): w-64, collapsible to w-16 icon-only
- Icons: Heroicons (outline for inactive, solid for active)

**Cards:**
- Elevated: shadow-lg with border border-slate-800
- Interactive: hover:shadow-xl hover:border-blue-500 transition-all
- Product Cards: aspect-square images, price prominent, quick-add button
- Transaction Cards: compact list view, timestamp, total, status badge

**Buttons:**
- Primary: bg-blue-600 h-12 min-w-24 touch-optimized
- Success: bg-emerald-600 (checkout/confirm actions)
- Destructive: bg-red-600 (void/refund)
- Outline on images: backdrop-blur-md bg-white/10 border-white/20

**Forms:**
- Input height: h-12 for touch
- Number pads: Custom 3x4 grid, h-14 buttons with haptic feedback feel
- Search: Sticky top-0 with backdrop-blur

**Data Display:**
- Tables: Sticky headers, alternating row bg, horizontal scroll mobile
- Status Badges: Rounded-full px-3 h-6 with dot indicator
- Price Tags: Large, bold, emerald-500 color, right-aligned

**Modals/Sheets:**
- Mobile: Bottom sheets (slide up from bottom)
- Desktop: Centered modals max-w-lg
- Backdrop: bg-black/60 backdrop-blur-sm

### E. Key Screens Structure

**Dashboard:**
- Top: Stats grid (4 cards: Sales Today, Transactions, Pending Orders, Low Stock)
- Middle: Quick Actions (6-8 large touch buttons in 2-col grid)
- Bottom: Recent Transactions list

**POS Transaction Screen:**
- Top: Running total display (sticky, large price)
- Middle: Product grid with search/category filters
- Right Sidebar (desktop): Cart items with quantity controls
- Bottom (mobile): Cart summary bar with "Review Order" button
- Floating Action Button: Blue circular checkout button (bottom-right mobile)

**Inventory:**
- Search bar (sticky)
- Category chips (horizontal scroll)
- Product grid with stock levels
- Color-coded stock indicators: emerald (in stock), amber (low), red (out)

**Reports:**
- Date range picker (sticky)
- Chart cards (full-width mobile, 2-col desktop)
- Export button (top-right)
- Tabular data with sort/filter

## Images
**No Hero Image** - This is a utility dashboard prioritizing function over marketing.

**Product Images:**
- Aspect ratio: 1:1 (square)
- Resolution: 400x400px minimum
- Placement: Product cards, transaction line items
- Fallback: Gradient with product initial letter

**Category Icons:**
- Custom illustrated icons for product categories
- Size: 48x48px
- Style: Duotone with blue/emerald accents

## Interactions
- Touch ripple effect on buttons (subtle blue-500/20)
- Skeleton loaders for data fetching
- Toast notifications (top-right desktop, top mobile)
- Pull-to-refresh on transaction lists
- Swipe actions on cart items (swipe left = remove)

## Accessibility
- Focus rings: ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-950
- ARIA labels on all icon buttons
- Dark mode optimized contrast ratios (WCAG AAA)
- Large touch targets throughout (min 48x48px)

**Critical:** All form inputs, selects, and text fields maintain consistent dark backgrounds (slate-900/slate-800) with proper contrast.