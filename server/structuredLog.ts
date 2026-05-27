/**
 * One-line JSON logs for machine parsing (S8). Prefer over ad-hoc console strings for /api.
 */
export function logApiJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...payload }));
}
