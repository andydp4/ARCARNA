# Accessibility (WCAG AA)

Midnight EPOS targets **WCAG 2.1 Level AA** on cashier-critical surfaces: POS, customers, products, orders, and settings.

## Automated checks

Requires Playwright + dev database (same as e2e smoke):

```bash
export DATABASE_URL=postgresql://...
export SESSION_SECRET=local-dev-session-secret-32chars-min
npm run test:a11y
```

CI runs the `a11y` Playwright project on pull requests (after schema push). Failures list **serious** and **critical** axe violations only.

## Manual checklist

- Tab through POS: cart, product search, pay — every control reachable without mouse.
- Icon-only buttons must have `aria-label` (grep `size="icon"` without `aria-label`).
- `prefers-reduced-motion: reduce` — skeleton pulses and non-essential animations off (see U1/U2).
- Contrast: run axe in DevTools or `npm run test:a11y` after token changes.

## Wave 8b (jsx-a11y ESLint)

- `eslint-plugin-jsx-a11y` is enabled in `.eslintrc.cjs` (recommended rules; POS paths excluded until U7 lands).
- `npm run lint` — advisory pass over `client/src` (fix violations incrementally).
- `npm run lint:a11y-new` — strict pass on onboarding + command palette files (CI-friendly slice).
- `npm run lint:strict` — full client tree with zero warnings (target for a follow-up PR).

## Follow-up

- [ ] Screen-reader walkthrough sign-off (manual) — see `GAPS_BACKLOG.md` GAP-U5-02.
- [ ] Expand `lint:strict` to green on all non-POS pages, then include POS after U7.
- WCAG AAA and RTL are out of scope (see `PHASE_U_UX_POLISH.md` U5).
