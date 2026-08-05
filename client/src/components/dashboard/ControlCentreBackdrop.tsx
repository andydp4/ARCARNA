import { useEffect, useState } from "react";

/**
 * Control Centre backdrop: a sphere parting once, with a blue flash at the seam.
 *
 * Plays ONCE on mount and settles to a near-static resting state. It sits behind
 * the figures someone reads to run the business, and continuous motion behind
 * live numbers is what makes a dashboard tiring to look at rather than
 * impressive. Nothing loops.
 *
 * SWAP POINT FOR THE DESIGNED ASSET
 * ---------------------------------
 * This is a self-contained CSS/SVG stand-in so the plumbing — mount timing,
 * layering, reduced-motion handling, pointer transparency — is settled and
 * tested before the real animation exists. To swap in a Lottie export, replace
 * the <svg> below with the player and keep everything else: the wrapper's
 * layering, `prefersReduced` branch and `aria-hidden` are the parts that took
 * the thought, and none of them are asset-specific.
 *
 * Asset spec this was built to accept: Lottie JSON (Bodymovin), 1200x1200,
 * transparent background, 1.5-2s, plays once and holds the final frame, vector
 * only (no embedded rasters) to stay under ~150KB, plus a static final-frame
 * image for the reduced-motion branch.
 *
 * Accessibility: decorative, so aria-hidden and inert to pointers — it must
 * never intercept a click meant for a tile. Under prefers-reduced-motion it
 * renders the settled state directly with no animation at all, rather than a
 * faster version of the same motion.
 */
export function ControlCentreBackdrop() {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex h-[420px] justify-center overflow-hidden"
      data-testid="control-centre-backdrop"
    >
      <style>{`
        @keyframes arc-sphere-in {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes arc-part-up {
          0%, 22%  { transform: translateY(0); }
          62%,100% { transform: translateY(-26px); }
        }
        @keyframes arc-part-down {
          0%, 22%  { transform: translateY(0); }
          62%,100% { transform: translateY(26px); }
        }
        /* Peaks as the halves separate, then decays to a faint resting glow
           rather than to nothing — going fully dark reads as a failed load. */
        @keyframes arc-flash {
          0%, 20% { opacity: 0; }
          38%     { opacity: 0.85; }
          70%     { opacity: 0.16; }
          100%    { opacity: 0.10; }
        }
        .arc-backdrop-root { animation: arc-sphere-in 700ms ease-out both; }
        .arc-half-top    { animation: arc-part-up 1900ms cubic-bezier(.22,.61,.36,1) both; }
        .arc-half-bottom { animation: arc-part-down 1900ms cubic-bezier(.22,.61,.36,1) both; }
        .arc-flash       { animation: arc-flash 1900ms ease-out both; }
      `}</style>

      <svg
        viewBox="0 0 600 600"
        className={prefersReduced ? undefined : "arc-backdrop-root"}
        style={{
          width: "min(120vw, 900px)",
          height: "auto",
          // Transform/opacity only — no layout or paint thrash behind the tiles.
          willChange: prefersReduced ? undefined : "transform, opacity",
        }}
      >
        <defs>
          <radialGradient id="arc-glow">
            <stop offset="0%" stopColor="#4aa8ff" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#2b7fd4" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0b1b2e" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="arc-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.42" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
          </linearGradient>
          <clipPath id="arc-clip-top"><rect x="0" y="0" width="600" height="300" /></clipPath>
          <clipPath id="arc-clip-bottom"><rect x="0" y="300" width="600" height="300" /></clipPath>
        </defs>

        {/* The seam light, behind the shell so it reads as escaping from inside. */}
        <ellipse
          cx="300"
          cy="300"
          rx="250"
          ry="90"
          fill="url(#arc-glow)"
          className={prefersReduced ? undefined : "arc-flash"}
          opacity={prefersReduced ? 0.1 : undefined}
        />

        <g className="text-metal-warm-white" fill="none" stroke="url(#arc-rim)" strokeWidth="1.5">
          <g
            clipPath="url(#arc-clip-top)"
            className={prefersReduced ? undefined : "arc-half-top"}
            transform={prefersReduced ? "translate(0,-26)" : undefined}
          >
            <circle cx="300" cy="300" r="210" />
            <circle cx="300" cy="300" r="168" strokeOpacity="0.5" />
          </g>
          <g
            clipPath="url(#arc-clip-bottom)"
            className={prefersReduced ? undefined : "arc-half-bottom"}
            transform={prefersReduced ? "translate(0,26)" : undefined}
          >
            <circle cx="300" cy="300" r="210" />
            <circle cx="300" cy="300" r="168" strokeOpacity="0.5" />
          </g>
        </g>
      </svg>

      {/* Fades the backdrop into the page so it never competes with the tiles
          sitting on top of it. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
