/**
 * The reasons an order can be marked delayed.
 *
 * Shared because this list was duplicated: an identical array literal lived in
 * server/routes/reportCapture.ts and again in
 * client/src/components/reports/OrderOpsDialog.tsx. The server copy feeds a Zod
 * enum that validates the incoming request, so the two drifting apart fails
 * asymmetrically and silently — add a cause client-side only and the dropdown
 * offers a value the API rejects with a validation error; add it server-side
 * only and no operator can ever select it.
 *
 * `GET /api/delay-causes` existed to solve this and no client code ever called
 * it. A shared constant is better than that endpoint anyway: no round trip, and
 * `z.enum` keeps its literal types, which a runtime fetch would throw away.
 */
export const DELAY_CAUSES = [
  "Stock unavailable",
  "Queue overload",
  "System issue",
  "Prep error",
  "Other",
] as const;

export type DelayCause = (typeof DELAY_CAUSES)[number];
