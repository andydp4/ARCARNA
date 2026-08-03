/**
 * Single source of truth for the fallback tax rate.
 *
 * The POS previously hardcoded 10% while the order engine hardcoded 20%, so a
 * customer was shown one total and charged another. Both sides now read the
 * org's configured rate and fall back to this only when none is set.
 */
export const DEFAULT_TAX_RATE_PERCENT = 20;
