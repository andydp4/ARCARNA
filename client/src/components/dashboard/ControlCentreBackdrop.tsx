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
          --arc-open: 16px;   /* how far the right door slides */
          --arc-open-l: calc(var(--arc-open) * 1.5);  /* the left opens half again as far */
          --arc-cap: 6%;      /* fixed shell at each pole; doors run between */
          /* Intensity of everything luminous. The shell and core keep their
             own values, so dialling this down dims the burst and the halo
             without dissolving the object itself.
                0.35 barely there · 0.55 low · 1.00 full · 1.50 hot */
          --arc-gain: 1;
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
        /* The far inside wall of the shell, seen through the aperture above
           and below the core. Lit only by bounce off the plasma, so it reads
           as the inside of the same object rather than a hole through it. */
        .arc-cf .arc-interior {
          position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(ellipse 42% 60% at 50% 44%, #0c1a2c 0%, #071120 44%, #03070f 78%, #02040a 100%);
          box-shadow: inset 0 22px 40px rgba(2,4,10,0.9), inset 0 -22px 40px rgba(2,4,10,0.9);
        }
        /* The Truth Blue sphere inside. Fills the shell exactly, so the
           aperture only ever shows blue — no dark inside the slot. Read as
           dense plasma, not glass: lit from within, not seen through. */
        .arc-cf .arc-core {
          position: absolute; inset: 0; border-radius: 50%;
          background:
            /* Terminator, shaded toward Navy rather than black. A slice this
               narrow is geometrically almost flat, so the poles still have to
               fall away for it to read as curved — but the sphere stays Truth
               Blue to its edge, with no black inside the shell. */
            linear-gradient(180deg,
              rgba(11,46,102,0.88) 0%, rgba(11,46,102,0.52) 10%, rgba(18,59,120,0.16) 22%,
              transparent 36%, transparent 64%,
              rgba(18,59,120,0.22) 78%, rgba(11,46,102,0.60) 91%, rgba(11,46,102,0.90) 100%),
            radial-gradient(ellipse 26% 20% at 46% 40%, #ffffff 0%, #dcefff 34%, transparent 72%),
            radial-gradient(circle at 44% 38%,
              #cfe6ff 0%, #B6D9FF 11%, #5DB4FF 26%, #3C7AC4 48%,
              #2a5c9c 68%, #123B78 86%, #0B2E66 100%);
          box-shadow: 0 0 50px rgba(93,180,255,0.55), 0 0 120px rgba(60,122,196,0.45);
        }
        /* Both doors span the full shell and are clipped to opposite sides of
           one shared square wave. Sharing a single boundary makes the mesh
           exact by construction — two independently generated profiles have
           to agree, and an earlier pair did not, which left the shut sphere
           showing daylight down the seam. */
        .arc-cf .arc-door {
          position: absolute; top: var(--arc-cap); bottom: var(--arc-cap); left: 0; right: 0;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 22%, transparent 74%, rgba(0,0,0,0.35) 100%),
            linear-gradient(90deg, #0a1220 0%, #1b2b44 30%, #223350 46%, #142135 62%, #070d18 100%);
        }
        /* Fixed shell at the poles. These never move, which is what stops the
           sphere reading as two halves coming apart: the aperture is a slot
           cut in a solid object, bounded by shell that stays put. */
        .arc-cf .arc-cap {
          position: absolute; left: -2%; right: -2%; height: var(--arc-cap);
          background: linear-gradient(90deg, #0c1626 0%, #142034 38%, #0e1a2b 66%, #091120 100%);
        }
        .arc-cf .arc-cap-t { top: 0;    box-shadow: inset 0 -1px 0 rgba(93,180,255,0.18); }
        .arc-cf .arc-cap-b { bottom: 0; box-shadow: inset 0 1px 0 rgba(93,180,255,0.18); }
        /* drop-shadow rather than a border for the lit edge: it follows the
           clipped alpha shape, where a border sits on the box edge and would
           survive only on the tooth tips. */
        .arc-cf .arc-door-l {
          clip-path: polygon(0% 0%, 52.6% 0%, 52.6% 10%, 47.4% 10%, 47.4% 20%, 52.6% 20%, 52.6% 30%, 47.4% 30%, 47.4% 40%, 52.6% 40%, 52.6% 50%, 47.4% 50%, 47.4% 60%, 52.6% 60%, 52.6% 70%, 47.4% 70%, 47.4% 80%, 52.6% 80%, 52.6% 90%, 47.4% 90%, 47.4% 100%, 0% 100%);
          filter: drop-shadow(2px 0 3px rgba(93,180,255,0.42));
        }
        .arc-cf .arc-door-r {
          clip-path: polygon(100% 0%, 52.6% 0%, 52.6% 10%, 47.4% 10%, 47.4% 20%, 52.6% 20%, 52.6% 30%, 47.4% 30%, 47.4% 40%, 52.6% 40%, 52.6% 50%, 47.4% 50%, 47.4% 60%, 52.6% 60%, 52.6% 70%, 47.4% 70%, 47.4% 80%, 52.6% 80%, 52.6% 90%, 47.4% 90%, 47.4% 100%, 100% 100%);
          filter: drop-shadow(-2px 0 3px rgba(93,180,255,0.42));
        }
        /* Above the doors, so the sphere reads as one machined object
           rather than two panels sitting side by side. */
        .arc-cf .arc-rim {
          position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(circle at 50% 50%,
            transparent 62%, rgba(60,122,196,0.42) 84%, rgba(93,180,255,0.20) 93%, transparent 99%);
          box-shadow: inset 0 0 40px rgba(2,4,10,0.75);
        }

        /* Opacity alone saturates at 1, so a gain above full would silently
           do nothing. Below 1 it fades; above 1 brightness carries it on. */
        .arc-cf .arc-l {
          position: absolute; inset: 0;
          opacity: min(1, var(--arc-gain));
          filter: brightness(max(1, var(--arc-gain)));
        }
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
        /* The long faint flare, running with the aperture rather than across it. */
        .arc-cf .arc-streak {
          width: 150px; height: 1200px; margin-left: -75px; margin-top: -600px;
          background: radial-gradient(ellipse 50% 50% at 50% 50%,
            rgba(255,255,255,0.92) 0%, rgba(160,208,255,0.50) 8%, rgba(93,180,255,0.26) 22%,
            rgba(60,122,196,0.12) 42%, rgba(18,59,120,0.04) 66%, transparent 82%);
          transform: scaleX(0.14);
        }
        .arc-cf .arc-spokes {
          width: 820px; height: 820px; margin-left: -410px; margin-top: -410px;
          /* Vertical arms only, plus faint diagonals — the horizontal pair
             were the last thing throwing a level line across the frame. */
          background: conic-gradient(from 0deg,
            transparent 0deg, rgba(182,217,255,0.30) 2deg, transparent 6deg,
            transparent 42deg, rgba(93,180,255,0.07) 45deg, transparent 48deg,
            transparent 132deg, rgba(93,180,255,0.07) 135deg, transparent 138deg,
            transparent 174deg, rgba(182,217,255,0.30) 180deg, transparent 186deg,
            transparent 222deg, rgba(93,180,255,0.07) 225deg, transparent 228deg,
            transparent 312deg, rgba(93,180,255,0.07) 315deg, transparent 318deg, transparent 360deg);
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
        /* The left door overruns and draws back, so the mechanism reads as
           driven rather than eased into place. */
        @keyframes arc-cf-door-l {
          0%,18% { transform: translateX(0); }
          52% { transform: translateX(calc(var(--arc-open-l) * -1.3)); }
          76%,100% { transform: translateX(calc(var(--arc-open-l) * -1)); }
        }
        @keyframes arc-cf-door-r { 0%,18% { transform: translateX(0); } 58%,100% { transform: translateX(var(--arc-open)); } }
        @keyframes arc-cf-shaft {
          0%,16% { opacity: 0; transform: scaleX(0.05) scaleY(0.30); }
          34% { opacity: 0.42; transform: scaleX(0.14) scaleY(0.70); }
          44% { opacity: 1; transform: scaleX(0.30) scaleY(1.00); }
          60% { opacity: 0.52; transform: scaleX(0.20) scaleY(0.80); }
          100% { opacity: 0.30; transform: scaleX(0.16) scaleY(0.62); }
        }
        @keyframes arc-cf-streak {
          0%,22% { opacity: 0; transform: scaleX(0.14) scaleY(0.05); }
          44% { opacity: 1; transform: scaleX(0.18) scaleY(1.00); }
          60% { opacity: 0.55; transform: scaleX(0.14) scaleY(0.80); }
          100% { opacity: 0.14; transform: scaleX(0.10) scaleY(0.42); }
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
        .arc-cf[data-static="true"] .arc-door-l { transform: translateX(calc(var(--arc-open-l) * -1)); }
        .arc-cf[data-static="true"] .arc-door-r { transform: translateX(var(--arc-open)); }
        .arc-cf[data-static="true"] .arc-shaft  { opacity: 0.30; transform: scaleX(0.16) scaleY(0.62); }
        .arc-cf[data-static="true"] .arc-streak { opacity: 0.14; transform: scaleX(0.10) scaleY(0.42); }
        .arc-cf[data-static="true"] .arc-halo   { opacity: 0.55; }
        .arc-cf[data-static="true"] .arc-spokes,
        .arc-cf[data-static="true"] .arc-bloom  { opacity: 0; }
      `}</style>

      <div className="arc-l"><div className="arc-halo arc-mid" /></div>

      <div className="arc-shell arc-mid">
        <div className="arc-interior" />
        <div className="arc-core" />
        <div className="arc-door arc-door-l" />
        <div className="arc-door arc-door-r" />
        <div className="arc-cap arc-cap-t" />
        <div className="arc-cap arc-cap-b" />
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
