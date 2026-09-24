/**
 * Runs the app's own 06:00 close for every finished trading day not yet
 * closed — exactly what the worker's housekeeping pass does, on demand, so a
 * time-travelled dataset gets its closes when the day ends rather than up to
 * fifteen minutes later.
 *
 *   npx tsx tests/money/closeDay.ts
 */
import { runDueDailyCloses } from "../../server/services/dailyClose";

runDueDailyCloses()
  .then((results) => {
    for (const r of results) {
      console.log(`closed ${r.tradingDay}: ${r.shiftsClosed} shift(s), ${r.uncountedDrawers} uncounted drawer(s)`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
