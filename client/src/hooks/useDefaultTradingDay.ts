import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { currentTradingDay } from "@shared/time/tradingDay";

/** The org's configured timezone; "Europe/London" (the server's own default) until settings load. */
export function useOrgTimezone(): string {
  const { data } = useQuery<{ timezone?: string }>({ queryKey: ["/api/settings"], staleTime: 5 * 60_000 });
  return data?.timezone || "Europe/London";
}

/**
 * A report's date/week picker defaults to today's TRADING day, not the
 * calendar date — a trading day runs 06:00 to 06:00 local (shared/time/
 * tradingDay.ts), so before 06:00 "today" is still yesterday's trading day.
 * Defaulting to the calendar date instead made every report read as "today"
 * (all zeros) for the first few hours of the morning, on a day whose figures
 * live under yesterday's date.
 *
 * The guess starts as Europe/London's trading day (right for the overwhelming
 * majority of shops, synchronously, no loading flash) and is corrected once
 * the org's real timezone loads, but only while the person has not already
 * picked a different date.
 */
export function useDefaultTradingDay(): [string, (day: string) => void] {
  const timezone = useOrgTimezone();
  const guess = useRef(currentTradingDay("Europe/London"));
  const [day, setDay] = useState(guess.current);
  useEffect(() => {
    const real = currentTradingDay(timezone);
    if (real !== guess.current) {
      setDay((d) => (d === guess.current ? real : d));
      guess.current = real;
    }
  }, [timezone]);
  return [day, setDay];
}
