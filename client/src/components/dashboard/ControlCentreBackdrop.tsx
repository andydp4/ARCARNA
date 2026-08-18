import { useEffect, useRef, useState } from "react";

/**
 * Control Centre backdrop: the ARCARNA Light Spheres loop, played once.
 *
 * Plays ONCE on mount and holds its last frame. It sits behind the figures
 * someone reads to run the business, and continuous motion behind live numbers
 * is what makes a dashboard tiring to look at rather than impressive.
 *
 * Flip LOOP to true to let it run continuously — that is the one knob worth
 * reaching for here, and the reason it is a named constant rather than a
 * hardcoded attribute. Everything else (layering, reduced-motion handling,
 * pointer transparency) is deliberately not asset-specific.
 *
 * Source of the asset: scripts/brand/arcarna-light-spheres.html, rendered by
 * scripts/brand/render-brand-loop.mjs. Palette is the brand Blue Set.
 *
 * Accessibility: decorative, so aria-hidden and inert to pointers — it must
 * never intercept a click meant for a tile. Under prefers-reduced-motion it
 * renders the poster still with no video at all, rather than a shorter or
 * slower version of the same motion.
 */

/** Let the loop run continuously instead of settling after one pass. */
const LOOP = false;

const BASE = `${import.meta.env.BASE_URL ?? "/"}brand/motion`.replace(/\/{2,}/g, "/");
const POSTER = `${BASE}/arcarna-light-spheres-poster.jpg`;

export function ControlCentreBackdrop() {
  const [prefersReduced, setPrefersReduced] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || prefersReduced) return;

    /* React does not reliably reflect the `muted` prop onto the DOM
     * attribute, and every autoplay policy refuses a video that is not
     * muted at the moment it is asked to play. Set it on the element
     * itself rather than trusting the prop. */
    video.muted = true;

    /* One attempt can lose a race with buffering, so retry when the
     * element reports it has enough data. If autoplay is refused outright
     * the poster stays up, which is a fine resting state. */
    let cancelled = false;
    const attempt = () => {
      if (cancelled) return;
      void video.play().catch(() => {});
    };
    attempt();
    video.addEventListener("canplay", attempt);
    return () => {
      cancelled = true;
      video.removeEventListener("canplay", attempt);
    };
  }, [prefersReduced]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex h-[420px] justify-center overflow-hidden"
      data-testid="control-centre-backdrop"
    >
      {prefersReduced ? (
        <img
          src={POSTER}
          alt=""
          className="h-full w-full object-cover opacity-60"
          data-testid="control-centre-backdrop-still"
        />
      ) : (
        <video
          ref={videoRef}
          className="h-full w-full object-cover opacity-60"
          poster={POSTER}
          autoPlay
          muted
          playsInline
          loop={LOOP}
          preload="auto"
          data-testid="control-centre-backdrop-video"
        >
          <source src={`${BASE}/arcarna-light-spheres.webm`} type="video/webm" />
          <source src={`${BASE}/arcarna-light-spheres.mp4`} type="video/mp4" />
        </video>
      )}

      {/* Fades the backdrop into the page so it never competes with the tiles
          sitting on top of it. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
