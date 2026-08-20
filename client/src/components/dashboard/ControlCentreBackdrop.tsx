import { useEffect, useState } from "react";

/**
 * Control Centre backdrop: a metal sphere holds a Truth Blue sphere inside
 * it. Two doors slide apart horizontally, opening a vertical aperture; the
 * blue shine escapes in a burst, the eye adjusts, and it settles to the core
 * pulsing quietly behind a part-open door.
 *
 * Beats:
 *   0.00-0.50s  the metal sphere sits closed, dark, rim-lit
 *   0.50-1.20s  the doors slide apart; a line of Truth Blue appears
 *   1.20-1.50s  the shine escapes — vertical shaft, anamorphic flare
 *   1.50-2.70s  the eye adjusts; the burst falls away
 *   2.70s+      settled: the core breathing behind the open door, ~5s
 *
 * The doors are clipped by the shell, which is a circle with
 * overflow:hidden, so they slide out of sight behind that mask rather than
 * detaching. The silhouette stays a whole circle throughout — it is a thing
 * opening, not a thing being pulled apart.
 *
 * Built from CSS rather than a rendered video, for three reasons. The piece
 * ends in an indefinite pulse, and a one-shot video can only stop dead or
 * loop the whole burst. Autoplay policies refuse video often enough that a
 * decorative layer silently failing is a real outcome. And it animates
 * transform and opacity only, so it composites on the GPU and costs
 * essentially nothing once settled — which matters directly behind live
 * figures someone is trying to read.
 *
 * Design source, with a headless previewer for stepping the timeline:
 * scripts/brand/arcarna-core-flare.html
 *
 * Accessibility: decorative, so aria-hidden and inert to pointers — it must
 * never intercept a click meant for a tile. Under prefers-reduced-motion it
 * renders the settled state directly, with no sequence and no pulse.
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
      data-static={prefersReduced ? "true" : undefined}
      className="arc-cf pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden"
      data-testid="control-centre-backdrop"
    >
      <style>{`
        .arc-cf {
          --arc-sphere: 260px;
          --arc-open: 16px;   /* how far each door slides — "opens slightly" */
          /* Intensity of everything luminous. The shell and core keep their
             own values, so dialling this down dims the burst and the halo
             without dissolving the object itself.
                0.35 barely there · 0.55 low · 0.80 present · 1.00 full */
          --arc-gain: 0.55;
        }
        .arc-cf .arc-mid { position: absolute; left: 50%; top: 46%; }

        /* The shell is the circular mask. Everything inside is cut to it,
           which is what keeps the silhouette whole while the doors travel. */
        .arc-cf .arc-shell {
          width: var(--arc-sphere); height: var(--arc-sphere);
          margin-left: calc(var(--arc-sphere) / -2);
          margin-top: calc(var(--arc-sphere) / -2);
          border-radius: 50%;
          overflow: hidden;
          background: radial-gradient(circle at 50% 50%, #060c16 0%, #02040a 70%);
          box-shadow: inset 0 0 60px rgba(2,4,10,0.9), 0 0 50px rgba(2,4,10,0.85);
        }
        /* The Truth Blue sphere inside. Set back off the shell wall so the
           aperture frames a rounded object rather than a flat slice. */
        .arc-cf .arc-core {
          position: absolute; inset: 19%; border-radius: 50%;
          background: radial-gradient(circle at 42% 36%,
            #cfe6ff 0%, #B6D9FF 9%, #5DB4FF 24%, #3C7AC4 46%,
            #2a5c9c 66%, #123B78 84%, #0B2E66 100%);
          box-shadow: 0 0 50px rgba(93,180,255,0.55), 0 0 120px rgba(60,122,196,0.45);
        }
        .arc-cf .arc-door {
          position: absolute; top: -6%; height: 112%; width: 52%;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 22%, transparent 74%, rgba(0,0,0,0.35) 100%),
            linear-gradient(90deg, #0f1b2c 0%, #16243a 34%, #101c2e 62%, #0a1322 100%);
        }
        .arc-cf .arc-door-l { left: -2%;  border-right: 1px solid rgba(93,180,255,0.30); }
        .arc-cf .arc-door-r { right: -2%; border-left:  1px solid rgba(93,180,255,0.30); }
        /* The lit inner edge of each door, catching the core's light. */
        .arc-cf .arc-door::after {
          content: ""; position: absolute; top: 0; bottom: 0; width: 3px;
          background: linear-gradient(180deg, transparent, #B6D9FF 34%, #fff 50%, #B6D9FF 66%, transparent);
          filter: blur(1.5px);
        }
        .arc-cf .arc-door-l::after { right: 0; }
        .arc-cf .arc-door-r::after { left: 0; }
        /* Above the doors, so the sphere reads as one machined object
           rather than two panels sitting side by side. */
        .arc-cf .arc-rim {
          position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(circle at 50% 50%,
            transparent 62%, rgba(60,122,196,0.42) 84%, rgba(93,180,255,0.20) 93%, transparent 99%);
          box-shadow: inset 0 0 40px rgba(2,4,10,0.75);
        }

        .arc-cf .arc-l { position: absolute; inset: 0; opacity: var(--arc-gain); }
        .arc-cf .arc-l > * { position: absolute; mix-blend-mode: screen; }

        /* The shaft through the slot — tall and narrow, the shape of the
           opening it comes out of. */
        .arc-cf .arc-shaft {
          width: 260px; height: 460px; margin-left: -130px; margin-top: -230px;
          background: radial-gradient(ellipse 50% 50% at 50% 50%,
            rgba(255,255,255,0.90) 0%, rgba(182,217,255,0.62) 10%, rgba(93,180,255,0.34) 26%,
            rgba(60,122,196,0.16) 48%, rgba(18,59,120,0.05) 72%, transparent 88%);
          transform: scaleX(0.16);
        }
        /* A lens artifact, so horizontal regardless of the aperture. */
        .arc-cf .arc-streak {
          width: 1500px; height: 150px; margin-left: -750px; margin-top: -75px;
          background: radial-gradient(ellipse 50% 50% at 50% 50%,
            rgba(255,255,255,0.92) 0%, rgba(160,208,255,0.50) 8%, rgba(93,180,255,0.26) 22%,
            rgba(60,122,196,0.12) 42%, rgba(18,59,120,0.04) 66%, transparent 82%);
          transform: scaleY(0.14);
        }
        .arc-cf .arc-spokes {
          width: 820px; height: 820px; margin-left: -410px; margin-top: -410px;
          background: conic-gradient(from 0deg,
            transparent 0deg, rgba(182,217,255,0.26) 2deg, transparent 5deg,
            transparent 86deg, rgba(182,217,255,0.20) 90deg, transparent 94deg,
            transparent 176deg, rgba(182,217,255,0.26) 180deg, transparent 184deg,
            transparent 266deg, rgba(182,217,255,0.20) 270deg, transparent 274deg, transparent 360deg);
          -webkit-mask-image: radial-gradient(circle, #000 0%, rgba(0,0,0,0.5) 30%, transparent 62%);
                  mask-image: radial-gradient(circle, #000 0%, rgba(0,0,0,0.5) 30%, transparent 62%);
          filter: blur(1px);
        }
        /* What the sphere throws onto the space around it, and what remains
           once the burst is over. */
        .arc-cf .arc-halo {
          width: 720px; height: 720px; margin-left: -360px; margin-top: -360px;
          background: radial-gradient(circle,
            rgba(93,180,255,0.26) 0%, rgba(60,122,196,0.16) 22%, rgba(18,59,120,0.06) 44%, transparent 70%);
        }
        .arc-cf .arc-bloom {
          inset: 0; margin: 0;
          background: radial-gradient(ellipse 70% 120% at 50% 46%,
            rgba(182,217,255,0.30) 0%, rgba(93,180,255,0.14) 24%, rgba(60,122,196,0.05) 48%, transparent 74%);
        }

        @keyframes arc-cf-rise { from { opacity: 0; } to { opacity: 1; } }
        @keyframes arc-cf-door-l { 0%,18% { transform: translateX(0); } 58%,100% { transform: translateX(calc(var(--arc-open) * -1)); } }
        @keyframes arc-cf-door-r { 0%,18% { transform: translateX(0); } 58%,100% { transform: translateX(var(--arc-open)); } }
        @keyframes arc-cf-shaft {
          0%,16% { opacity: 0; transform: scaleX(0.05) scaleY(0.30); }
          34% { opacity: 0.42; transform: scaleX(0.14) scaleY(0.70); }
          44% { opacity: 1; transform: scaleX(0.30) scaleY(1.00); }
          60% { opacity: 0.52; transform: scaleX(0.20) scaleY(0.80); }
          100% { opacity: 0.30; transform: scaleX(0.16) scaleY(0.62); }
        }
        @keyframes arc-cf-streak {
          0%,22% { opacity: 0; transform: scaleY(0.14) scaleX(0.05); }
          44% { opacity: 1; transform: scaleY(0.18) scaleX(1.00); }
          60% { opacity: 0.55; transform: scaleY(0.14) scaleX(0.80); }
          100% { opacity: 0.14; transform: scaleY(0.10) scaleX(0.42); }
        }
        @keyframes arc-cf-spokes {
          0%,34% { opacity: 0; transform: scale(0.45) rotate(0deg); }
          44% { opacity: 0.70; transform: scale(1.00) rotate(3deg); }
          62% { opacity: 0.14; transform: scale(1.14) rotate(6deg); }
          100% { opacity: 0; transform: scale(1.18) rotate(8deg); }
        }
        @keyframes arc-cf-bloom { 0%,34% { opacity: 0; } 44% { opacity: 1; } 58% { opacity: 0.18; } 100% { opacity: 0; } }
        @keyframes arc-cf-halo {
          0%,20% { opacity: 0.10; transform: scale(0.80); }
          44% { opacity: 1.00; transform: scale(1.10); }
          100% { opacity: 0.55; transform: scale(1.00); }
        }
        @keyframes arc-cf-pulse { 0%,100% { opacity: 0.50; } 50% { opacity: 0.95; } }
        @keyframes arc-cf-core-pulse {
          0%,100% { opacity: 0.80; filter: brightness(0.86); }
          50% { opacity: 1; filter: brightness(1.14); }
        }

        .arc-cf .arc-shell  { animation: arc-cf-rise 700ms ease-out both; }
        .arc-cf .arc-door-l { animation: arc-cf-door-l 2700ms cubic-bezier(.19,1,.22,1) both; }
        .arc-cf .arc-door-r { animation: arc-cf-door-r 2700ms cubic-bezier(.19,1,.22,1) both; }
        .arc-cf .arc-core   { animation: arc-cf-core-pulse 5200ms ease-in-out 2700ms infinite; }
        .arc-cf .arc-shaft  { animation: arc-cf-shaft  2700ms cubic-bezier(.19,1,.22,1) both, arc-cf-pulse 5200ms ease-in-out 2700ms infinite; }
        .arc-cf .arc-streak { animation: arc-cf-streak 2700ms cubic-bezier(.19,1,.22,1) both, arc-cf-pulse 5200ms ease-in-out 2700ms infinite; }
        .arc-cf .arc-halo   { animation: arc-cf-halo   2700ms cubic-bezier(.19,1,.22,1) both, arc-cf-pulse 5200ms ease-in-out 2700ms infinite; }
        .arc-cf .arc-spokes { animation: arc-cf-spokes 2700ms cubic-bezier(.19,1,.22,1) both; }
        .arc-cf .arc-bloom  { animation: arc-cf-bloom  2700ms cubic-bezier(.19,1,.22,1) both; }

        /* Reduced motion: the settled frame, stated outright. */
        .arc-cf[data-static="true"] * { animation: none !important; }
        .arc-cf[data-static="true"] .arc-door-l { transform: translateX(calc(var(--arc-open) * -1)); }
        .arc-cf[data-static="true"] .arc-door-r { transform: translateX(var(--arc-open)); }
        .arc-cf[data-static="true"] .arc-shaft  { opacity: 0.30; transform: scaleX(0.16) scaleY(0.62); }
        .arc-cf[data-static="true"] .arc-streak { opacity: 0.14; transform: scaleY(0.10) scaleX(0.42); }
        .arc-cf[data-static="true"] .arc-halo   { opacity: 0.55; }
        .arc-cf[data-static="true"] .arc-spokes,
        .arc-cf[data-static="true"] .arc-bloom  { opacity: 0; }
      `}</style>

      <div className="arc-l"><div className="arc-halo arc-mid" /></div>

      <div className="arc-shell arc-mid">
        <div className="arc-core" />
        <div className="arc-door arc-door-l" />
        <div className="arc-door arc-door-r" />
        <div className="arc-rim" />
      </div>

      <div className="arc-l">
        <div className="arc-spokes arc-mid" />
        <div className="arc-streak arc-mid" />
        <div className="arc-shaft arc-mid" />
        <div className="arc-bloom" />
      </div>

      {/* Fades the backdrop into the page so it never competes with the
          tiles sitting on top of it. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
