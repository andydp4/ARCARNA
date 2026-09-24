import type { TourStep } from "@/components/tour/SpotlightTour";
import type { TourTarget } from "@/components/tour/tourTarget";
import type { Role } from "@shared/rbac";
import type { FeatureTourName } from "@shared/uiSeen";

/**
 * One short tour per new v1.2 feature (v1.2 Phase 9), keyed by the route the
 * feature lives on. Each is shown once per account (featureTour:<name>-1.2.0)
 * the first time the viewer actually reaches the feature, which is why every
 * tour waits for an `anchor`: My run's stops only when there are some, the label printer card
 * only on the System tab.
 *
 * Steps whose target is not on screen are dropped by the engine, so one list
 * can cover a phone and a desktop layout. Every `testId` here must exist in
 * the client source (featureTours.test.ts checks).
 */

export interface FeatureTourStep extends TourStep {
  /** Only these roles get this step (defaults to everyone the tour is for). */
  roles?: readonly Role[];
}

export interface FeatureTourDef {
  feature: FeatureTourName;
  /** Paths (no query string) the tour is mounted on. */
  paths: readonly string[];
  /** Who gets the tour at all; undefined = every staff role. */
  roles?: readonly Role[];
  /** The tour waits for this before starting on its own. */
  anchor: TourTarget;
  steps: readonly FeatureTourStep[];
}

const MANAGERS: readonly Role[] = ["MANAGER", "ADMIN", "SUPER_ADMIN"];
const ADMINS: readonly Role[] = ["ADMIN", "SUPER_ADMIN"];
const MANAGER_ONLY: readonly Role[] = ["MANAGER"];

export const FEATURE_TOUR_DEFS: readonly FeatureTourDef[] = [
  {
    feature: "needsALook",
    paths: ["/needs-a-look"],
    roles: MANAGERS,
    anchor: { testId: "select-needs-a-look-queue" },
    steps: [
      {
        testId: "page-header",
        title: "Needs a look",
        body: "Sales below the minimum or below cost, refunds the refund rules pick out, weekly patterns and contact-details requests land here. Nothing here was blocked.",
        preferredSide: "bottom",
      },
      {
        testId: "select-needs-a-look-queue",
        title: "Your queues",
        body: "Each role has its own queue. Managers see items about cashiers; items about a manager go to admins only.",
        preferredSide: "bottom",
      },
      {
        testId: "select-needs-a-look-state",
        title: "Open to done",
        body: "Mark each item Acknowledged, Explained or Escalated, with a note. Escalating tells the people above you.",
        preferredSide: "bottom",
      },
      {
        testId: "section-contact-requests",
        roles: ADMINS,
        title: "Contact details requests",
        body: "A manager asking for a customer's phone or email. Approve for 24 hours or Decline; you can revoke an approval at any time.",
        preferredSide: "bottom",
      },
      {
        testId: "text-needs-a-look-stale",
        title: "The weekly line",
        body: "How many items have waited more than 7 days without a review.",
        preferredSide: "bottom",
      },
    ],
  },
  {
    feature: "myRun",
    paths: ["/my-run"],
    anchor: { testId: "my-run-stops" },
    steps: [
      {
        testId: "run-stop-",
        match: "prefix",
        title: "Your stops, in order",
        body: "Deliveries assigned to you that are ready or on the road. Drag a stop or use the arrows to change the order; it is kept for today.",
        preferredSide: "bottom",
      },
      {
        testId: "link-navigate-",
        match: "prefix",
        title: "Navigate",
        body: "Opens directions to the address: Apple Maps on an iPhone, Google Maps otherwise.",
        preferredSide: "top",
      },
      {
        testId: "button-start-run",
        title: "Start run",
        body: "Tick the stops you are taking (or Select all), then Start run. They move to out for delivery.",
        preferredSide: "top",
      },
      {
        testId: "button-delivered-",
        match: "prefix",
        title: "Delivered",
        body: "Tap it at the door. With no signal, the tap is kept on this phone and sent when you are back online.",
        preferredSide: "top",
      },
      {
        testId: "button-couldnt-deliver-",
        match: "prefix",
        title: "Couldn't deliver",
        body: "Pick a reason (No answer, Wrong address, Refused or Other). The order goes back to ready and managers get a Signal.",
        preferredSide: "top",
      },
      {
        testId: "select-run-driver",
        roles: MANAGERS,
        title: "Whose run",
        body: "Managers can look at anyone's run from here.",
        preferredSide: "bottom",
      },
    ],
  },
  {
    feature: "labelPrinter",
    paths: ["/settings"],
    anchor: { testId: "card-label-printer" },
    steps: [
      {
        testId: "card-label-printer",
        title: "Label printer",
        body: "A Niimbot B1 over Bluetooth, with 50 × 30 mm labels. Each till pairs once; it is remembered on that device only.",
        preferredSide: "bottom",
      },
      {
        testId: "label-printer-unsupported",
        title: "This browser cannot print",
        body: "Bluetooth printing needs Chrome or Edge on a computer, or the free Bluefy app on an iPhone. The message says what to do on this device.",
        preferredSide: "bottom",
      },
      {
        testId: "label-printer-connect",
        title: "Pair the printer",
        body: "Turn the printer on, tap here and pick it from the list.",
        preferredSide: "bottom",
      },
      {
        testId: "label-preview",
        title: "Test label",
        body: "Print a test label here. Products and orders on the Operations board have their own Print label.",
        preferredSide: "top",
      },
    ],
  },
  {
    feature: "orderTiming",
    paths: ["/reports/order-timing"],
    roles: MANAGERS,
    anchor: { testId: "select-timing-group" },
    steps: [
      {
        testId: "select-timing-preset",
        title: "Pick the dates",
        body: "Order Timing shows how fast orders move and where they wait.",
        preferredSide: "bottom",
      },
      {
        testId: "select-timing-group",
        title: "Group it",
        body: "By fulfilment, by who claimed, completed or keyed in the order, or by hour, day or channel.",
        preferredSide: "bottom",
      },
      {
        testId: "text-timing-orders",
        title: "The team first",
        body: "On time means ready (collection) or handed over (delivery) by the promise plus the grace. Backdated and carried-over orders are counted but not timed.",
        preferredSide: "bottom",
      },
      {
        testId: "badge-timing-provisional",
        title: "Provisional",
        body: "Per-person figures are new. Check them against the team figures before acting on them.",
        preferredSide: "bottom",
      },
    ],
  },
  {
    feature: "staffPerformance",
    paths: ["/reports/staff-performance"],
    roles: MANAGERS,
    anchor: { testId: "select-performance-preset" },
    steps: [
      {
        testId: "page-header",
        title: "Staff Performance",
        body: "Replaces Staff KPI. It counts the same completed orders as sales Evidence, so the rows add up to the sales you took.",
        preferredSide: "bottom",
      },
      {
        testId: "select-performance-preset",
        title: "Any dates",
        body: "Pick a period; each figure shows the change against the one before. Filter by location, role, fulfilment or channel.",
        preferredSide: "bottom",
      },
      {
        testId: "text-performance-provisional",
        title: "Provisional for now",
        body: "Per-person figures are being checked against the team totals. Do not act on them before the date shown.",
        preferredSide: "bottom",
      },
      {
        testId: "tab-performance-volume",
        title: "Six views",
        body: "Volume, Value, Quality, Benefit, Speed and Fairness. Fairness shows rates per active hour, so part-timers compare fairly.",
        preferredSide: "bottom",
      },
      {
        testId: "table-performance-",
        match: "prefix",
        // A phone shows the same people as cards (UI-17).
        alt: [{ testId: "cards-performance-", match: "prefix" }],
        title: "One row per person",
        body: "Pick a person for their 8-week trend and their orders. Admin cover is counted but never ranked.",
        preferredSide: "top",
      },
    ],
  },
  {
    feature: "customerContact",
    paths: ["/customers"],
    roles: MANAGERS,
    anchor: { testId: "button-contact-", match: "prefix" },
    steps: [
      {
        testId: "customer-row-",
        match: "prefix",
        roles: MANAGER_ONLY,
        title: "Contact details are masked",
        body: "You see ••4821 and j•••@gmail.com, not the full number or email. Only admins see contact details.",
        preferredSide: "bottom",
      },
      {
        testId: "customer-card-",
        match: "prefix",
        roles: MANAGER_ONLY,
        title: "Contact details are masked",
        body: "You see ••4821 and j•••@gmail.com, not the full number or email. Only admins see contact details.",
        preferredSide: "bottom",
      },
      {
        testId: "button-contact-",
        match: "prefix",
        roles: MANAGER_ONLY,
        title: "Contact",
        body: "Message the customer instead comes first: arcarna sends an approved WhatsApp message and nobody sees the number. If you need the details, request them with a reason; an admin approves 24 hours, and every look is logged.",
        preferredSide: "left",
      },
      {
        testId: "button-contact-",
        match: "prefix",
        roles: ADMINS,
        title: "Contact and Access history",
        body: "Message the customer without showing the number, and see their Access history: every reveal, call, export and request.",
        preferredSide: "left",
      },
    ],
  },
  {
    feature: "contactAccessLog",
    paths: ["/customer-access-log"],
    roles: ["SUPER_ADMIN"],
    anchor: { testId: "select-access-action" },
    steps: [
      {
        testId: "page-header",
        title: "Customer data access",
        body: "Every reveal, driver's call, replaced number, export, request and decision, message sent and API read, across the whole shop.",
        preferredSide: "bottom",
      },
      {
        testId: "select-access-action",
        title: "Narrow it down",
        body: "Show one kind of access, over the last 7 days up to a year.",
        preferredSide: "bottom",
      },
      {
        testId: "table-customer-access-log",
        title: "Who looked, and when",
        body: "Admins see the same for one customer at a time, on that customer's Access history.",
        preferredSide: "top",
      },
    ],
  },
  {
    // The header button exists only when ANTHROPIC_API_KEY is set, so with the
    // feature off this tour never starts. Not on the till: never over a sale.
    feature: "ask",
    paths: ["/truths", "/my-performance"],
    anchor: { testId: "button-ask-arcarna" },
    steps: [
      {
        testId: "button-ask-arcarna",
        title: "Ask arcarna",
        body: "Ask a question in plain English, like \"How am I doing this week?\". It answers from the shop's own figures, only the ones your role can already see, and links to the Evidence it used.",
        preferredSide: "bottom",
      },
      {
        testId: "button-truths-ask",
        roles: MANAGERS,
        title: "Ask from the Truths Centre",
        body: "The same assistant opens from here. It reads figures; it never changes anything. Check important figures on the Evidence it links to.",
        preferredSide: "bottom",
      },
    ],
  },
];

function cleanPath(path: string): string {
  return (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
}

function allowed(roles: readonly Role[] | undefined, role: string | null | undefined): boolean {
  return !roles || roles.some((r) => r === role);
}

/** The feature tours this viewer gets on this path, their steps filtered to the viewer's role. */
export function featureToursFor(path: string, role: string | null | undefined): FeatureTourDef[] {
  if (!role || role === "CUSTOMER") return [];
  const here = cleanPath(path);
  return FEATURE_TOUR_DEFS.filter((def) => def.paths.includes(here) && allowed(def.roles, role))
    .map((def) => ({ ...def, steps: def.steps.filter((step) => allowed(step.roles, role)) }))
    .filter((def) => def.steps.length > 0);
}

export const featureTourStartEvent = (feature: string) => `arcarna:feature-tour:${feature}:start`;
