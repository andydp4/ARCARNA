/**
 * Badges (v1.2 Phase 7C, STF-10): recognition without a league table.
 *
 * Owner decision (Q14): there is no public ranking. Badges are computed each
 * period from the person's own figures against fixed bars, so any number of
 * people can earn the same badge and nobody is placed above anyone else. They
 * are never stored and carry no money. Each bar needs a minimum amount of
 * data, so a single lucky order earns nothing.
 */
import type { PerformanceFigures } from "./staffPerformance";
import type { SpeedFigures } from "./staffSpeed";
import type { FairnessRates } from "./staffFairness";

export interface Badge {
  key: string;
  label: string;
  /** Plain words: what earned it. */
  why: string;
}

export interface BadgeSource {
  figures: Pick<PerformanceFigures, "completed" | "prepared" | "dispatched" | "loaded" | "picked" | "wrongItemOrders" | "completedOthers">;
  speed: SpeedFigures;
  rates: Pick<FairnessRates, "daysWorked">;
  namedCustomerCapturePercent: number | null;
  ordersTaken: number;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export function computeBadges(s: BadgeSource): Badge[] {
  const out: Badge[] = [];
  const sp = s.speed;
  if (sp.collectionJudged >= 10 && (sp.collectionOnTimePercent ?? 0) >= 95) {
    out.push({ key: "on-the-dot", label: "On the dot", why: `${f1(sp.collectionOnTimePercent!)}% of ${sp.collectionJudged} collections ready on time.` });
  }
  if (sp.deliveryJudged >= 10 && (sp.deliveryOnTimePercent ?? 0) >= 95) {
    out.push({ key: "road-runner", label: "Road runner", why: `${f1(sp.deliveryOnTimePercent!)}% of ${sp.deliveryJudged} deliveries on time.` });
  }
  if (sp.firstPromiseJudged >= 10 && (sp.firstPromiseKeptPercent ?? 0) >= 95) {
    out.push({ key: "promise-keeper", label: "Promise keeper", why: `Kept the first promise on ${sp.firstPromiseKept} of ${sp.firstPromiseJudged} orders.` });
  }
  if (s.figures.picked >= 20 && s.figures.wrongItemOrders === 0) {
    out.push({ key: "steady-hands", label: "Steady hands", why: `No wrong items across ${s.figures.picked} orders picked.` });
  }
  if (s.ordersTaken >= 10 && (s.namedCustomerCapturePercent ?? 0) >= 80) {
    out.push({ key: "knows-their-customers", label: "Knows their customers", why: `Named the customer on ${f1(s.namedCustomerCapturePercent!)}% of ${s.ordersTaken} sales.` });
  }
  if (sp.delaysDeclared >= 3 && sp.delaysToldInAdvance === sp.delaysDeclared) {
    out.push({ key: "straight-talker", label: "Straight talker", why: `Told the customer ahead of time on all ${sp.delaysDeclared} delays.` });
  }
  const jobsDone = [s.figures.loaded, s.figures.prepared, s.figures.completed, s.figures.dispatched].filter((n) => n >= 5).length;
  if (jobsDone >= 3) {
    out.push({ key: "all-rounder", label: "All-rounder", why: "Loaded, prepared, completed or dispatched at least five orders each, across three or more jobs." });
  }
  if (s.rates.daysWorked >= 5) {
    out.push({ key: "regular", label: "Regular", why: `Worked ${s.rates.daysWorked} days.` });
  }
  return out;
}
