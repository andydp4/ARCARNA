import { useEffect, useState } from "react";

/**
 * Control Centre backdrop: a dark sphere parts along a horizontal seam,
 * light blasts out through the gap, peaks as an anamorphic blue flare, then
 * settles to a slow Truth Blue pulse that holds for as long as the page is
 * open.
 *
 * Beats:
 *   0.00-0.55s  the sphere sits dark, rim-lit, barely there
 *   0.55-1.15s  the halves part; a seam of light opens between them
 *   1.15-1.45s  the blast — white-hot core, anamorphic streak, spokes
 *   1.45-2.70s  decay; the flare falls back through Sky to Truth Blue
 *   2.70s+      settled: a slow Truth Blue breath, ~5s per cycle
 *
 * Built from CSS rather than a rendered video, for three reasons. The brief
 * ends in an indefinite slow pulse, and a one-shot video can only stop dead
 * or loop the whole blast. Autoplay policies refuse video often enough that
 * a decorative layer silently failing is a real outcome. And this animates
 * transform and opacity only, so it composites on the GPU and costs
 * essentially nothing once settled — which matters directly behind live
 * figures someone is trying to read.
 *
 * Design source, with a headless previewer for stepping the timeline:
 * scripts/brand/arcarna-core-flare.html
 *
 * Accessibility: decorative, so aria-hidden and inert to pointers — it must
 * never intercept a click meant for a tile. Under prefers-reduced-motion it
 * renders the settled state directly, with no sequence and no pulse, rather
 * than a faster version of the same motion.
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
          --arc-part: 26px;
          /* Overall intensity of everything luminous — the blast, the
             streak, the spill and the settled pulse all scale together,
             while the sphere itself stays put. The whole point of it
             being one number is that the piece can be dialled to taste
             behind live figures without retiming anything.
                0.35  barely there
                0.55  low — current default, for testing in situ
                0.80  present
                1.00  full, as designed */
          --arc-gain: 0.55;
        }
        /* Everything luminous blends additively, so overlaps build toward
           white the way real light does. */
        .arc-cf .arc-l { position: absolute; inset: 0; opacity: var(--arc-gain); }
        .arc-cf .arc-l > * { position: absolute; mix-blend-mode: screen; }
        .arc-cf .arc-c { left: 50%; top: 46%; }

        .arc-cf .arc-half {
          position: absolute;
          left: 50%; top: 46%;
          width: var(--arc-sphere); height: var(--arc-sphere);
          margin-left: calc(var(--arc-sphere) / -2);
          margin-top: calc(var(--arc-sphere) / -2);
          border-radius: 50%;
          background:
            radial-gradient(circle at 42% 34%, #0d1828 0%, #070d18 46%, #02040a 78%),
            radial-gradient(circle at 50% 50%, transparent 58%, rgba(60,122,196,0.55) 80%, rgba(93,180,255,0.22) 90%, transparent 97%);
          box-shadow: inset 0 0 70px rgba(3,6,14,0.85), 0 0 40px rgba(2,4,10,0.9);
        }
        .arc-cf .arc-top    { clip-path: inset(0 0 50% 0); }
        .arc-cf .arc-bottom { clip-path: inset(50% 0 0 0); }
        /* The lit lip of each half, facing the seam. */
        .arc-cf .arc-half::after {
          content: ""; position: absolute; left: 4%; width: 92%; height: 4px;
          background: linear-gradient(90deg, transparent, #B6D9FF 30%, #fff 50%, #B6D9FF 70%, transparent);
          filter: blur(1.5px);
        }
        .arc-cf .arc-top::after    { bottom: calc(50% - 1px); }
        .arc-cf .arc-bottom::after { top: calc(50% - 1px); }

        .arc-cf .arc-core {
          width: 240px; height: 240px; margin-left: -120px; margin-top: -120px;
          border-radius: 50%;
          background: radial-gradient(circle,
            rgba(255,255,255,0.95) 0%, rgba(234,244,255,0.85) 6%, rgba(182,217,255,0.55) 14%,
            rgba(93,180,255,0.28) 26%, rgba(60,122,196,0.10) 44%, transparent 68%);
        }
        /* The long horizontal bar of an anamorphic blue flare. */
        .arc-cf .arc-streak {
          width: 1500px; height: 160px; margin-left: -750px; margin-top: -80px;
          background: radial-gradient(ellipse 50% 50% at 50% 50%,
            rgba(255,255,255,0.95) 0%, rgba(160,208,255,0.55) 8%, rgba(93,180,255,0.30) 22%,
            rgba(60,122,196,0.14) 42%, rgba(18,59,120,0.05) 66%, transparent 82%);
          transform: scaleY(0.16);
        }
        .arc-cf .arc-seam {
          width: 620px; height: 26px; margin-left: -310px; margin-top: -13px;
          background: linear-gradient(90deg, transparent 0%, rgba(60,122,196,0.35) 12%,
            rgba(93,180,255,0.85) 34%, rgba(255,255,255,0.95) 50%, rgba(93,180,255,0.85) 66%,
            rgba(60,122,196,0.35) 88%, transparent 100%);
          filter: blur(3px);
          transform: scaleY(0.22);
        }
        .arc-cf .arc-spokes {
          width: 900px; height: 900px; margin-left: -450px; margin-top: -450px;
          background: conic-gradient(from 0deg,
            transparent 0deg, rgba(182,217,255,0.30) 2deg, transparent 5deg,
            transparent 40deg, rgba(93,180,255,0.16) 42deg, transparent 46deg,
            transparent 86deg, rgba(182,217,255,0.22) 90deg, transparent 94deg,
            transparent 130deg, rgba(93,180,255,0.14) 133deg, transparent 137deg,
            transparent 176deg, rgba(182,217,255,0.30) 180deg, transparent 184deg,
            transparent 220deg, rgba(93,180,255,0.16) 223deg, transparent 227deg,
            transparent 266deg, rgba(182,217,255,0.22) 270deg, transparent 274deg,
            transparent 310deg, rgba(93,180,255,0.14) 313deg, transparent 317deg, transparent 360deg);
          -webkit-mask-image: radial-gradient(circle, #000 0%, rgba(0,0,0,0.5) 30%, transparent 62%);
                  mask-image: radial-gradient(circle, #000 0%, rgba(0,0,0,0.5) 30%, transparent 62%);
          filter: blur(1px);
        }
        /* The state the piece rests in: Truth Blue, not white. It fades up
           as the flash decays so the colour lands on brand rather than
           being a dimmer version of the blast. */
        .arc-cf .arc-ember {
          width: 760px; height: 120px; margin-left: -380px; margin-top: -60px;
          background: radial-gradient(ellipse 50% 50% at 50% 50%,
            rgba(182,217,255,0.55) 0%, rgba(93,180,255,0.34) 9%, rgba(60,122,196,0.30) 22%,
            rgba(60,122,196,0.12) 46%, rgba(18,59,120,0.04) 70%, transparent 86%);
          transform: scaleY(0.20);
        }
        .arc-cf .arc-spill {
          left: 50%; top: 46%; width: 1200px; height: 420px; margin-left: -600px;
          background: radial-gradient(ellipse 50% 50% at 50% 0%,
            rgba(93,180,255,0.30) 0%, rgba(60,122,196,0.14) 26%, rgba(18,59,120,0.05) 52%, transparent 76%);
        }
        /* A brief wash over the whole band at the instant of the blast. */
        .arc-cf .arc-bloom {
          inset: 0; margin: 0;
          background: radial-gradient(ellipse 70% 120% at 50% 46%,
            rgba(182,217,255,0.34) 0%, rgba(93,180,255,0.16) 24%, rgba(60,122,196,0.06) 48%, transparent 74%);
        }

        @keyframes arc-cf-rise { from { opacity: 0; } to { opacity: 1; } }
        @keyframes arc-cf-up   { 0%,22% { transform: translateY(0); } 62%,100% { transform: translateY(calc(var(--arc-part) * -1)); } }
        @keyframes arc-cf-down { 0%,22% { transform: translateY(0); } 62%,100% { transform: translateY(var(--arc-part)); } }
        @keyframes arc-cf-core {
          0%,14% { opacity: 0; transform: scale(0.20); }
          30% { opacity: 0.35; transform: scale(0.42); }
          40% { opacity: 1; transform: scale(1.25); }
          46% { opacity: 0.95; transform: scale(1.05); }
          70% { opacity: 0.34; transform: scale(0.74); }
          100% { opacity: 0.10; transform: scale(0.52); }
        }
        @keyframes arc-cf-streak {
          0%,16% { opacity: 0; transform: scaleY(0.16) scaleX(0.05); }
          32% { opacity: 0.30; transform: scaleY(0.16) scaleX(0.30); }
          40% { opacity: 1; transform: scaleY(0.20) scaleX(1.00); }
          52% { opacity: 0.72; transform: scaleY(0.16) scaleX(0.88); }
          100% { opacity: 0.10; transform: scaleY(0.10) scaleX(0.44); }
        }
        @keyframes arc-cf-seam {
          0%,12% { opacity: 0; transform: scaleY(0.22) scaleX(0.02); }
          30% { opacity: 0.85; transform: scaleY(0.22) scaleX(0.42); }
          40% { opacity: 1; transform: scaleY(0.30) scaleX(1.00); }
          100% { opacity: 0.30; transform: scaleY(0.16) scaleX(0.66); }
        }
        @keyframes arc-cf-spokes {
          0%,30% { opacity: 0; transform: scale(0.45) rotate(0deg); }
          40% { opacity: 0.85; transform: scale(1.00) rotate(4deg); }
          58% { opacity: 0.18; transform: scale(1.16) rotate(7deg); }
          100% { opacity: 0; transform: scale(1.22) rotate(9deg); }
        }
        @keyframes arc-cf-spill { 0%,26% { opacity: 0; } 40% { opacity: 1; } 100% { opacity: 0.30; } }
        @keyframes arc-cf-bloom { 0%,30% { opacity: 0; } 40% { opacity: 1; } 55% { opacity: 0.20; } 100% { opacity: 0; } }
        @keyframes arc-cf-ember {
          0%,46% { opacity: 0; transform: scaleY(0.20) scaleX(0.70); }
          72% { opacity: 0.75; transform: scaleY(0.20) scaleX(0.94); }
          100% { opacity: 1; transform: scaleY(0.20) scaleX(1); }
        }
        @keyframes arc-cf-pulse { 0%,100% { opacity: 0.42; } 50% { opacity: 0.90; } }

        .arc-cf .arc-top    { animation: arc-cf-rise 700ms ease-out both, arc-cf-up   2700ms cubic-bezier(.19,1,.22,1) both; }
        .arc-cf .arc-bottom { animation: arc-cf-rise 700ms ease-out both, arc-cf-down 2700ms cubic-bezier(.19,1,.22,1) both; }
        .arc-cf .arc-core   { animation: arc-cf-core   2700ms cubic-bezier(.19,1,.22,1) both, arc-cf-pulse 5200ms ease-in-out 2700ms infinite; }
        .arc-cf .arc-seam   { animation: arc-cf-seam   2700ms cubic-bezier(.19,1,.22,1) both, arc-cf-pulse 5200ms ease-in-out 2700ms infinite; }
        .arc-cf .arc-streak { animation: arc-cf-streak 2700ms cubic-bezier(.19,1,.22,1) both, arc-cf-pulse 5200ms ease-in-out 2700ms infinite; }
        .arc-cf .arc-ember  { animation: arc-cf-ember  2700ms cubic-bezier(.19,1,.22,1) both, arc-cf-pulse 5200ms ease-in-out 2700ms infinite; }
        .arc-cf .arc-spill  { animation: arc-cf-spill  2700ms cubic-bezier(.19,1,.22,1) both, arc-cf-pulse 5200ms ease-in-out 2700ms infinite; }
        .arc-cf .arc-spokes { animation: arc-cf-spokes 2700ms cubic-bezier(.19,1,.22,1) both; }
        .arc-cf .arc-bloom  { animation: arc-cf-bloom  2700ms cubic-bezier(.19,1,.22,1) both; }

        /* Reduced motion: the settled frame, stated outright. No sequence,
           no pulse — not a faster version of the same motion. */
        .arc-cf[data-static="true"] * { animation: none !important; }
        .arc-cf[data-static="true"] .arc-top    { transform: translateY(calc(var(--arc-part) * -1)); }
        .arc-cf[data-static="true"] .arc-bottom { transform: translateY(var(--arc-part)); }
        .arc-cf[data-static="true"] .arc-core   { opacity: 0.10; transform: scale(0.52); }
        .arc-cf[data-static="true"] .arc-streak { opacity: 0.10; transform: scaleY(0.10) scaleX(0.44); }
        .arc-cf[data-static="true"] .arc-seam   { opacity: 0.30; transform: scaleY(0.16) scaleX(0.66); }
        .arc-cf[data-static="true"] .arc-ember  { opacity: 0.70; transform: scaleY(0.20) scaleX(1); }
        .arc-cf[data-static="true"] .arc-spill  { opacity: 0.30; }
        .arc-cf[data-static="true"] .arc-spokes,
        .arc-cf[data-static="true"] .arc-bloom  { opacity: 0; }
      `}</style>

      {/* Behind the sphere, so the flare reads as light escaping past it. */}
      <div className="arc-l">
        <div className="arc-spill" />
        <div className="arc-spokes arc-c" />
        <div className="arc-streak arc-c" />
      </div>

      <div className="arc-half arc-top" />
      <div className="arc-half arc-bottom" />

      {/* In front, so the seam itself stays the brightest thing in frame. */}
      <div className="arc-l">
        <div className="arc-ember arc-c" />
        <div className="arc-seam arc-c" />
        <div className="arc-core arc-c" />
        <div className="arc-bloom" />
      </div>

      {/* Fades the backdrop into the page so it never competes with the
          tiles sitting on top of it. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
