# ARCARNA — UX/UI Redesign Brief

**Direction:** Liquid Metal Industrial ⚙️🩶  
**Status:** Approved design direction (May 2026)  
**Implementation:** Phase **E** (spatial shell + tokens) then Phase **U** (polish across pages)

> Official logo assets only: `client/public/brand/midnight-logo-navy-on-white.png`, `midnight-logo-white-on-navy.png`. Do not redraw the mark in CSS/SVG/AI. Hull shapes may echo logo geometry as layout inspiration only. See [`_shared-context.md`](./_shared-context.md).

---

## Core design philosophy

Midnight should feel like:

- precision industrial equipment
- luxury engineering hardware
- premium automotive interfaces
- brushed steel machinery
- liquid metal surfaces
- modern warehouse technology
- tactile and weighty
- calm, fast, confident

**NOT:**

- cyberpunk
- neon overload
- hacker terminal
- spaceship dashboards
- glowing sci-fi UI
- gamer RGB nonsense

The interface should feel:

> *Industrial-grade operational software built by Apple × Porsche × Bang & Olufsen for high-volume commerce.*

---

## Visual identity

### Overall mood

Keywords: liquid metal · titanium · brushed aluminium · obsidian glass · matte graphite · smoked chrome · precision engineered · tactile · minimal but powerful · premium operations.

The UI should feel **expensive, dense, efficient, and physical**.

---

## Colour system

### Primary palette

**Base:** matte black · graphite · gunmetal · charcoal · soft dark steel  

**Metallic tones:** brushed silver · titanium grey · stainless steel highlights · smoky chrome  

**Accent colours** (sparingly only): warm white · amber warning · electric blue (minimal) · deep emerald success · rich crimson alerts  

**NO:** rainbow gradients · bright neon pink · glowing cyan overload · vaporwave colours · childish saturation  

---

## Surface design

Components should resemble: machined metal · smoked glass · matte control panels · CNC hardware · premium automotive dashboards.

**Use:** subtle reflections · soft metallic gradients · micro texture · layered depth · soft inner shadows · glass blur sparingly · edge highlights  

**Avoid:** cartoon shadows · giant rounded blobs · excessive blur · glowing borders everywhere · “hologram” effects  

---

## Typography

**Style:** clean industrial typography — modern automotive · luxury hardware · operational precision.

**Characteristics:** medium weight · tight spacing · high readability · slightly condensed headings acceptable  

**Avoid:** futuristic sci-fi fonts · monospace everywhere · gamer typography · ultra-thin unreadable text  

---

## Layout principles

**Feel:** structured · modular · engineered · aligned · intentional  

**Use:** grid systems · consistent spacing · sharp alignment · strong hierarchy  

**Avoid:** floating random cards · overly playful layouts · visual chaos  

---

## Mobile-first requirements

Must work beautifully on iPhone · Android · iPad · desktop.

**Mobile priorities:** one-hand usability · large touch targets · fast navigation · no cramped tables · no horizontal scrolling  

---

## Navigation

| Platform | Pattern |
|----------|---------|
| **Mobile** | bottom navigation · floating quick actions · collapsible panels · gesture-friendly spacing |
| **Desktop** | compact side navigation · collapsible workspace panels · persistent quick actions |

Navigation should feel **fast, mechanical, frictionless**.

---

## Dashboard direction

Dashboard = **premium operations control centre** — NOT a finance-bro analytics toy.

**Prioritise:** operational clarity · order flow · inventory state · customer activity · staff actions · alerts needing attention  

**Deprioritise:** decorative charts · meaningless graphs · clutter KPIs  

---

## Data display

### Tables

**Feel:** dense but readable · enterprise-grade · highly scannable  

| Platform | Pattern |
|----------|---------|
| **Desktop** | advanced tables acceptable |
| **Mobile** | stacked operational cards · grouped data blocks · swipe actions where useful |

---

## Buttons & controls

**Feel:** physical · tactile · engineered  

**Use:** subtle depth · pressure states · metallic contrast · strong active feedback  

**Avoid:** jellybean buttons · candy gradients · glowing gamer effects  

---

## Motion & animation

**Style:** minimal, expensive, controlled  

**Use:** smooth acceleration · subtle transitions · panel slide-ins · mechanical precision  

**Avoid:** flashy animation · bouncing effects · excessive parallax · over-the-top motion  

---

## Functional UX priorities (highest flows)

1. **Order creation** — lightning fast · thumb friendly · low friction · searchable instantly  
2. **Product search** — barcode scan · predictive search · large mobile hit targets  
3. **Inventory** — quick adjustments · rapid scanning · simple stock state visibility  
4. **Customer management** — speed · communication visibility · recent activity  

---

## PWA requirements

Midnight should behave like a real installed app.

**Required:** installable · standalone mode · responsive · offline-safe shell · persistent login · splash screen · proper icons  

---

## Technical UX requirements

**Build:** Tailwind responsive system · design tokens · component consistency · dark-mode first · high performance · minimal render lag  

**Preferred stack:** shadcn/ui (heavily customised) · Framer Motion (light use) · Tailwind variants · Lucide icons  

**Feature flag:** experimental spatial workspace (`spatialWorkspace` in `shared/featureFlags.ts`) for core-orbit Insights shell — see [`../briefs/PHASE_E_LIQUID_METAL.md`](../briefs/PHASE_E_LIQUID_METAL.md).

---

## Accessibility

Must maintain: readable contrast · scalable text · touch accessibility · keyboard usability · clear status colours  

---

## Brand personality

Midnight should feel like:

> *Mission-critical retail infrastructure with luxury industrial design.*

**Feel:** calm · dominant · intelligent · premium · engineered · dependable  

**Not:** playful · sci-fi cosplay · startup fluff  

*A £20k industrial machine in software form.*

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [`README.md`](./README.md) | Concept gallery + mockup index |
| [`concept-E-aurora.md`](./concept-E-aurora.md) | Spatial “core orbit” implementation notes (Concept E) |
| [`../briefs/PHASE_U_UX_POLISH.md`](../briefs/PHASE_U_UX_POLISH.md) | U1–U7 polish briefs (apply this visual language) |
| [`../briefs/PHASE_E_LIQUID_METAL.md`](../briefs/PHASE_E_LIQUID_METAL.md) | E1 implementation brief |
