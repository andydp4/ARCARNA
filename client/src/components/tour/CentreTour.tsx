import { useMemo } from "react";
import { SpotlightTour, type TourStep } from "@/components/tour/SpotlightTour";
import { centreTourAccountKey, centreTourLocalKey } from "@shared/uiSeen";
import type { CentreKey } from "@/components/nav-items";

/**
 * One short tour per Centre (v1.2 Phase 3), shown once per account the first
 * time someone reaches a page in that Centre, and replayable from the menu's
 * "Replay tour". The Operations Centre keeps its own board tour (`OpsTour`),
 * which runs on the same engine.
 */

const START_EVENT = "arcarna:centre-tour:start";

/**
 * "Replay tour" in the Centre menu. A plain event: the tour is mounted by the
 * Layout on every page it applies to, so there is nothing to wait for.
 */
export function startCentreTour() {
  window.dispatchEvent(new Event(START_EVENT));
}

/** What each Centre's own menu is for, in a sentence. */
const CENTRE_MENU_COPY: Record<Exclude<CentreKey, "operations" | "control">, { title: string; body: string }> = {
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

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/**
 * "Seven Centres" was hard-coded (v1.2.1 UI-06), but a cashier's menu shows
 * five. The count is the viewer's own: the Centres their role can open.
 */
export function centresTitle(count: number): string {
  const word = NUMBER_WORDS[count] ?? String(count);
  return `${word} ${count === 1 ? "Centre" : "Centres"}`;
}

export interface CentreTourOptions {
  /** A phone: the menu is a sheet behind the ☰ button, and there is no pin. */
  phone: boolean;
  /** How many Centres this viewer's menu lists. */
  centreCount: number;
}

/**
 * The steps for one Centre's tour. On a phone (v1.2.1 UI-05) the menu is a
 * closed sheet, so steps that point inside it (the Centre's menu, ← Main
 * menu, the pin, Replay tour) found nothing and were dropped, leaving a
 * one-step tour. The phone gets its own steps, pointed at the ☰ button that
 * opens the menu, which is always on screen.
 */
export function centreTourSteps(centre: Exclude<CentreKey, "operations">, opts: CentreTourOptions): TourStep[] {
  const menu =
    centre === "control"
      ? {
          title: centresTitle(opts.centreCount),
          body: opts.phone
            ? "arcarna is arranged into Centres. Tap the menu button to see them, and pick one to open it."
            : "arcarna is now arranged into Centres. Hover over the menu (or tap it on a tablet) and pick one to open it.",
        }
      : CENTRE_MENU_COPY[centre];
  const whereYouAre: TourStep = {
    testId: "page-header",
    title: "Where you are",
    body: "The small heading above every page's title names the Centre it belongs to.",
    preferredSide: "bottom",
  };

  if (opts.phone) {
    return [
      {
        testId: "button-nav-toggle",
        title: menu.title,
        body:
          centre === "control"
            ? menu.body
            : `${menu.body} Tap the menu button to see this Centre's pages; ← Main menu at the top goes back to the list of Centres.`,
        preferredSide: "bottom",
      },
      whereYouAre,
      {
        testId: "button-nav-toggle",
        title: "See this again",
        body: "Replay tour, at the bottom of the menu, shows this again whenever you like.",
        preferredSide: "bottom",
      },
    ];
  }

  return [
    // The Control Centre has no pages of its own, so its menu IS the main menu.
    { testId: centre === "control" ? "nav-main-list" : "nav-centre-menu", ...menu, preferredSide: "right" },
    {
      testId: "nav-main-menu",
      title: "Back to the main menu",
      body: "← Main menu takes you back to the list of Centres.",
      preferredSide: "right",
    },
    whereYouAre,
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

export function CentreTour({ centre, phone, centreCount }: { centre: CentreKey } & CentreTourOptions) {
  const steps = useMemo(
    () => (centre === "operations" ? [] : centreTourSteps(centre, { phone, centreCount })),
    [centre, phone, centreCount],
  );
  if (centre === "operations") return null;
  const key = centreTourAccountKey(centre);
  return (
    <SpotlightTour
      // A new Centre (or a phone turned into a tablet) is a new tour: remount
      // so its own seen flag and steps apply.
      key={`${key}:${phone ? "phone" : "wide"}`}
      steps={steps}
      seenKey={key}
      legacyLocalKey={centreTourLocalKey(centre)}
      ready
      startEvent={START_EVENT}
      idPrefix="centre-tour"
      minStepsToStart={2}
    />
  );
}
