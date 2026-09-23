import { SpotlightTour, type TourStep } from "@/components/tour/SpotlightTour";
import { centreTourAccountKey } from "@shared/uiSeen";
import type { CentreKey } from "@/components/nav-items";

/**
 * One short tour per Centre (v1.2 Phase 3), shown once per account the first
 * time someone reaches a page in that Centre, and replayable from the menu's
 * "Replay tour". The Operations Centre keeps its own board tour (`OpsTour`),
 * which runs on the same engine.
 */

const START_EVENT = "arcarna:centre-tour:start";

/** "Replay tour" in the Centre menu. */
export function startCentreTour() {
  window.dispatchEvent(new Event(START_EVENT));
}

/** What each Centre's own menu is for, in a sentence. */
const CENTRE_MENU_COPY: Record<Exclude<CentreKey, "operations">, { title: string; body: string }> = {
  control: {
    title: "Seven Centres",
    body: "arcarna is now arranged into Centres. Hover over the menu (or tap it on a tablet) and pick one to open it.",
  },
  stock: {
    title: "The Stock Centre",
    body: "Products, Stock Truths, Purchase Drafts and Suppliers live here. A cashier sees Stock levels: what's on the shelf, nothing more.",
  },
  truths: {
    title: "The Truths Centre",
    body: "It opens on Truths at a glance: the widgets your admin chose, each with its window. Every Truth and all the Evidence are in this menu.",
  },
  customer: {
    title: "The Customer Centre",
    body: "Customers, Loyalty, Promotions and Gift Cards.",
  },
  finance: {
    title: "The Finance Centre",
    body: "Shifts, Expenses, Reseller Partners, Cashier Payroll and Invoices. Cashiers see their own shifts.",
  },
  settings: {
    title: "The Settings Centre",
    body: "Settings, with each of its tabs listed here, plus User Access, Locations, Rules and the admin tools you have access to.",
  },
};

function stepsFor(centre: Exclude<CentreKey, "operations">): TourStep[] {
  const menu = CENTRE_MENU_COPY[centre];
  return [
    // The Control Centre has no pages of its own, so its menu IS the main menu.
    { testId: centre === "control" ? "nav-main-list" : "nav-centre-menu", ...menu, preferredSide: "right" },
    {
      testId: "nav-main-menu",
      title: "Back to the main menu",
      body: "← Main menu takes you back to the list of Centres.",
      preferredSide: "right",
    },
    {
      testId: "page-header",
      title: "Where you are",
      body: "The small heading above every page's title names the Centre it belongs to.",
      preferredSide: "bottom",
    },
    {
      testId: "nav-pin",
      title: "Keep the menu open",
      body: "The menu slides over the page and tucks away when you move off it. Pin it to keep it open beside the page on this device.",
      preferredSide: "right",
    },
    {
      testId: "nav-replay-tour",
      title: "See this again",
      body: "Replay tour shows this again whenever you like.",
      preferredSide: "right",
    },
  ];
}

const STEPS: Record<Exclude<CentreKey, "operations">, TourStep[]> = {
  control: stepsFor("control"),
  stock: stepsFor("stock"),
  truths: stepsFor("truths"),
  customer: stepsFor("customer"),
  finance: stepsFor("finance"),
  settings: stepsFor("settings"),
};

export function CentreTour({ centre }: { centre: CentreKey }) {
  if (centre === "operations") return null;
  const key = centreTourAccountKey(centre);
  return (
    <SpotlightTour
      // A new Centre is a new tour: remount so its own seen flag and steps apply.
      key={key}
      steps={STEPS[centre]}
      seenKey={key}
      legacyLocalKey={`arcarna.${key}`}
      ready
      startEvent={START_EVENT}
      idPrefix="centre-tour"
      minStepsToStart={2}
    />
  );
}
