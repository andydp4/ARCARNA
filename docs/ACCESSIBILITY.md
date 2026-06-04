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

## Follow-up (Wave 8b)

- Add `eslint-plugin-jsx-a11y` once a root ESLint config exists on `main`.
- Screen-reader walkthrough (manual, not CI).
- WCAG AAA and RTL are out of scope (see `PHASE_U_UX_POLISH.md` U5).
