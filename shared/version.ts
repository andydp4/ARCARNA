/**
 * Single source of truth for the app's user-facing version number — read by
 * both the server (health endpoint, logs) and the client (Settings/About,
 * the What's New modal's localStorage key) so the two can never drift.
 * Bump this alongside package.json's own "version" field on every release.
 */
export const APP_VERSION = "1.1.0";
