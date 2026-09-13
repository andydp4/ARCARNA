import { cn } from "@/lib/utils";
import type { OpsClockText } from "@/lib/opsClock";

/**
 * The big number on a card.
 *
 * `role="timer"` with `aria-live="off"` is deliberate and load-bearing: a
 * board can hold thirty cards, each counting every second, and any one of them
 * inside a live region would make a screen reader read the whole counter out
 * loud once a second, forever. The value a screen-reader user actually needs —
 * "late by 4 minutes" — is carried by the minute-granular `aria-label` and
 * read when they land on the card, which is why `cardClock` returns a spoken
 * label separately from the ticking text (brief, "Keyboard & focus").
 *
 * `tabular-nums` stops the digits jittering sideways as the seconds roll: on a
 * wall-mounted tablet that shimmer is the most distracting thing on the screen.
 */
export function OpsCardClock({
  clock,
  className,
}: {
  clock: OpsClockText | null;
  className?: string;
}) {
  if (!clock) return null;
  return (
    <span
      role="timer"
      aria-live="off"
      aria-label={clock.ariaLabel}
      className={cn("shrink-0 font-semibold tabular-nums tracking-tight", className)}
    >
      {clock.text}
    </span>
  );
}
