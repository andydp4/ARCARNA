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
          --arc-open-l: calc(var(--arc-open) * 2);  /* the left opens twice as far */
          --arc-cap: 6%;      /* fixed shell at each pole */
          /* The ARCARNA mark etched over the shell, mapped onto the sphere
             rather than tiled flat: each motif is placed by latitude and
             longitude and foreshortened by the surface normal, so the
             pattern crowds and shrinks toward the limb and carries over the
             poles. A flat tile reads as wallpaper on a disc. */
          --arc-etch: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Cdefs%3E%3Cg id='d' transform='translate(-50 -50)'%3E%3Ccircle cx='46' cy='45' r='28' fill='none' stroke='%2339455a' stroke-width='13' stroke-dasharray='140 36' stroke-dashoffset='-118'/%3E%3Cpath d='M66 34 L79 42 L96 86 L68 70 Z' fill='%2339455a'/%3E%3C/g%3E%3Cg id='l' transform='translate(-50 -50)'%3E%3Ccircle cx='46' cy='45' r='28' fill='none' stroke='%239aabc0' stroke-width='13' stroke-dasharray='140 36' stroke-dashoffset='-118'/%3E%3Cpath d='M66 34 L79 42 L96 86 L68 70 Z' fill='%239aabc0'/%3E%3C/g%3E%3C/defs%3E%3Cuse href='%23d' transform='translate(104.8 199.4) scale(0.147 0.018)' opacity='0.31'/%3E%3Cuse href='%23l' transform='translate(105.7 199.5) scale(0.147 0.018)' opacity='0.31'/%3E%3Cuse href='%23d' transform='translate(70.8 194.9) scale(0.058 0.053)' opacity='0.33'/%3E%3Cuse href='%23l' transform='translate(71.2 195.3) scale(0.058 0.053)' opacity='0.33'/%3E%3Cuse href='%23d' transform='translate(84.1 194.9) scale(0.147 0.053)' opacity='0.51'/%3E%3Cuse href='%23l' transform='translate(85.0 195.3) scale(0.147 0.053)' opacity='0.51'/%3E%3Cuse href='%23d' transform='translate(104.8 194.9) scale(0.167 0.053)' opacity='0.54'/%3E%3Cuse href='%23l' transform='translate(105.9 195.3) scale(0.167 0.053)' opacity='0.54'/%3E%3Cuse href='%23d' transform='translate(123.3 194.9) scale(0.109 0.053)' opacity='0.44'/%3E%3Cuse href='%23l' transform='translate(124.0 195.3) scale(0.109 0.053)' opacity='0.44'/%3E%3Cuse href='%23d' transform='translate(54.7 186.3) scale(0.074 0.085)' opacity='0.46'/%3E%3Cuse href='%23l' transform='translate(55.2 186.9) scale(0.074 0.085)' opacity='0.46'/%3E%3Cuse href='%23d' transform='translate(68.4 186.3) scale(0.133 0.085)' opacity='0.6'/%3E%3Cuse href='%23l' transform='translate(69.3 186.9) scale(0.133 0.085)' opacity='0.6'/%3E%3Cuse href='%23d' transform='translate(88.3 186.3) scale(0.166 0.085)' opacity='0.67'/%3E%3Cuse href='%23l' transform='translate(89.4 186.9) scale(0.166 0.085)' opacity='0.67'/%3E%3Cuse href='%23d' transform='translate(110.6 186.3) scale(0.166 0.085)' opacity='0.67'/%3E%3Cuse href='%23l' transform='translate(111.7 186.9) scale(0.166 0.085)' opacity='0.67'/%3E%3Cuse href='%23d' transform='translate(130.7 186.3) scale(0.133 0.085)' opacity='0.6'/%3E%3Cuse href='%23l' transform='translate(131.6 186.9) scale(0.133 0.085)' opacity='0.6'/%3E%3Cuse href='%23d' transform='translate(144.8 186.3) scale(0.074 0.085)' opacity='0.46'/%3E%3Cuse href='%23l' transform='translate(145.3 186.9) scale(0.074 0.085)' opacity='0.46'/%3E%3Cuse href='%23d' transform='translate(33.9 173.9) scale(0.028 0.114)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(34.1 174.7) scale(0.028 0.114)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(40.9 173.9) scale(0.081 0.114)' opacity='0.55'/%3E%3Cuse href='%23l' transform='translate(41.4 174.7) scale(0.081 0.114)' opacity='0.55'/%3E%3Cuse href='%23d' transform='translate(54.3 173.9) scale(0.125 0.114)' opacity='0.67'/%3E%3Cuse href='%23l' transform='translate(55.1 174.7) scale(0.125 0.114)' opacity='0.67'/%3E%3Cuse href='%23d' transform='translate(72.6 173.9) scale(0.156 0.114)' opacity='0.74'/%3E%3Cuse href='%23l' transform='translate(73.6 174.7) scale(0.156 0.114)' opacity='0.74'/%3E%3Cuse href='%23d' transform='translate(93.9 173.9) scale(0.169 0.114)' opacity='0.77'/%3E%3Cuse href='%23l' transform='translate(95.0 174.7) scale(0.169 0.114)' opacity='0.77'/%3E%3Cuse href='%23d' transform='translate(115.9 173.9) scale(0.165 0.114)' opacity='0.76'/%3E%3Cuse href='%23l' transform='translate(117.0 174.7) scale(0.165 0.114)' opacity='0.76'/%3E%3Cuse href='%23d' transform='translate(136.1 173.9) scale(0.142 0.114)' opacity='0.71'/%3E%3Cuse href='%23l' transform='translate(137.1 174.7) scale(0.142 0.114)' opacity='0.71'/%3E%3Cuse href='%23d' transform='translate(152.5 173.9) scale(0.104 0.114)' opacity='0.62'/%3E%3Cuse href='%23l' transform='translate(153.1 174.7) scale(0.104 0.114)' opacity='0.62'/%3E%3Cuse href='%23d' transform='translate(163.1 173.9) scale(0.055 0.114)' opacity='0.46'/%3E%3Cuse href='%23l' transform='translate(163.5 174.7) scale(0.055 0.114)' opacity='0.46'/%3E%3Cuse href='%23d' transform='translate(21.9 158.3) scale(0.046 0.138)' opacity='0.46'/%3E%3Cuse href='%23l' transform='translate(22.2 159.2) scale(0.046 0.138)' opacity='0.46'/%3E%3Cuse href='%23d' transform='translate(30.6 158.3) scale(0.088 0.138)' opacity='0.62'/%3E%3Cuse href='%23l' transform='translate(31.2 159.2) scale(0.088 0.138)' opacity='0.62'/%3E%3Cuse href='%23d' transform='translate(44.4 158.3) scale(0.124 0.138)' opacity='0.73'/%3E%3Cuse href='%23l' transform='translate(45.2 159.2) scale(0.124 0.138)' opacity='0.73'/%3E%3Cuse href='%23d' transform='translate(62.3 158.3) scale(0.151 0.138)' opacity='0.79'/%3E%3Cuse href='%23l' transform='translate(63.3 159.2) scale(0.151 0.138)' opacity='0.79'/%3E%3Cuse href='%23d' transform='translate(83.0 158.3) scale(0.166 0.138)' opacity='0.83'/%3E%3Cuse href='%23l' transform='translate(84.1 159.2) scale(0.166 0.138)' opacity='0.83'/%3E%3Cuse href='%23d' transform='translate(105.0 158.3) scale(0.170 0.138)' opacity='0.84'/%3E%3Cuse href='%23l' transform='translate(106.1 159.2) scale(0.170 0.138)' opacity='0.84'/%3E%3Cuse href='%23d' transform='translate(126.6 158.3) scale(0.160 0.138)' opacity='0.81'/%3E%3Cuse href='%23l' transform='translate(127.6 159.2) scale(0.160 0.138)' opacity='0.81'/%3E%3Cuse href='%23d' transform='translate(146.2 158.3) scale(0.139 0.138)' opacity='0.76'/%3E%3Cuse href='%23l' transform='translate(147.1 159.2) scale(0.139 0.138)' opacity='0.76'/%3E%3Cuse href='%23d' transform='translate(162.4 158.3) scale(0.107 0.138)' opacity='0.68'/%3E%3Cuse href='%23l' transform='translate(163.1 159.2) scale(0.107 0.138)' opacity='0.68'/%3E%3Cuse href='%23d' transform='translate(174.0 158.3) scale(0.068 0.138)' opacity='0.55'/%3E%3Cuse href='%23l' transform='translate(174.4 159.2) scale(0.068 0.138)' opacity='0.55'/%3E%3Cuse href='%23d' transform='translate(180.1 158.3) scale(0.023 0.138)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(180.2 159.2) scale(0.023 0.138)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(9.2 140.2) scale(0.020 0.155)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(9.4 141.2) scale(0.020 0.155)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(14.4 140.2) scale(0.060 0.155)' opacity='0.55'/%3E%3Cuse href='%23l' transform='translate(14.8 141.2) scale(0.060 0.155)' opacity='0.55'/%3E%3Cuse href='%23d' transform='translate(24.5 140.2) scale(0.097 0.155)' opacity='0.68'/%3E%3Cuse href='%23l' transform='translate(25.1 141.2) scale(0.097 0.155)' opacity='0.68'/%3E%3Cuse href='%23d' transform='translate(39.0 140.2) scale(0.127 0.155)' opacity='0.78'/%3E%3Cuse href='%23l' transform='translate(39.8 141.2) scale(0.127 0.155)' opacity='0.78'/%3E%3Cuse href='%23d' transform='translate(57.1 140.2) scale(0.151 0.155)' opacity='0.84'/%3E%3Cuse href='%23l' transform='translate(58.0 141.2) scale(0.151 0.155)' opacity='0.84'/%3E%3Cuse href='%23d' transform='translate(77.6 140.2) scale(0.165 0.155)' opacity='0.87'/%3E%3Cuse href='%23l' transform='translate(78.7 141.2) scale(0.165 0.155)' opacity='0.87'/%3E%3Cuse href='%23d' transform='translate(99.5 140.2) scale(0.170 0.155)' opacity='0.88'/%3E%3Cuse href='%23l' transform='translate(100.5 141.2) scale(0.170 0.155)' opacity='0.88'/%3E%3Cuse href='%23d' transform='translate(121.3 140.2) scale(0.165 0.155)' opacity='0.87'/%3E%3Cuse href='%23l' transform='translate(122.4 141.2) scale(0.165 0.155)' opacity='0.87'/%3E%3Cuse href='%23d' transform='translate(142.0 140.2) scale(0.151 0.155)' opacity='0.84'/%3E%3Cuse href='%23l' transform='translate(142.9 141.2) scale(0.151 0.155)' opacity='0.84'/%3E%3Cuse href='%23d' transform='translate(160.2 140.2) scale(0.127 0.155)' opacity='0.78'/%3E%3Cuse href='%23l' transform='translate(161.0 141.2) scale(0.127 0.155)' opacity='0.78'/%3E%3Cuse href='%23d' transform='translate(174.9 140.2) scale(0.097 0.155)' opacity='0.68'/%3E%3Cuse href='%23l' transform='translate(175.5 141.2) scale(0.097 0.155)' opacity='0.68'/%3E%3Cuse href='%23d' transform='translate(185.2 140.2) scale(0.060 0.155)' opacity='0.55'/%3E%3Cuse href='%23l' transform='translate(185.6 141.2) scale(0.060 0.155)' opacity='0.55'/%3E%3Cuse href='%23d' transform='translate(190.6 140.2) scale(0.020 0.155)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(190.8 141.2) scale(0.020 0.155)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(4.7 120.3) scale(0.039 0.166)' opacity='0.47'/%3E%3Cuse href='%23l' transform='translate(4.9 121.3) scale(0.039 0.166)' opacity='0.47'/%3E%3Cuse href='%23d' transform='translate(12.3 120.3) scale(0.076 0.166)' opacity='0.64'/%3E%3Cuse href='%23l' transform='translate(12.8 121.3) scale(0.076 0.166)' opacity='0.64'/%3E%3Cuse href='%23d' transform='translate(24.7 120.3) scale(0.109 0.166)' opacity='0.75'/%3E%3Cuse href='%23l' transform='translate(25.4 121.3) scale(0.109 0.166)' opacity='0.75'/%3E%3Cuse href='%23d' transform='translate(41.1 120.3) scale(0.136 0.166)' opacity='0.82'/%3E%3Cuse href='%23l' transform='translate(42.0 121.3) scale(0.136 0.166)' opacity='0.82'/%3E%3Cuse href='%23d' transform='translate(60.8 120.3) scale(0.156 0.166)' opacity='0.88'/%3E%3Cuse href='%23l' transform='translate(61.8 121.3) scale(0.156 0.166)' opacity='0.88'/%3E%3Cuse href='%23d' transform='translate(82.5 120.3) scale(0.167 0.166)' opacity='0.9'/%3E%3Cuse href='%23l' transform='translate(83.6 121.3) scale(0.167 0.166)' opacity='0.9'/%3E%3Cuse href='%23d' transform='translate(105.1 120.3) scale(0.170 0.166)' opacity='0.91'/%3E%3Cuse href='%23l' transform='translate(106.2 121.3) scale(0.170 0.166)' opacity='0.91'/%3E%3Cuse href='%23d' transform='translate(127.5 120.3) scale(0.163 0.166)' opacity='0.89'/%3E%3Cuse href='%23l' transform='translate(128.6 121.3) scale(0.163 0.166)' opacity='0.89'/%3E%3Cuse href='%23d' transform='translate(148.4 120.3) scale(0.147 0.166)' opacity='0.85'/%3E%3Cuse href='%23l' transform='translate(149.4 121.3) scale(0.147 0.166)' opacity='0.85'/%3E%3Cuse href='%23d' transform='translate(166.7 120.3) scale(0.124 0.166)' opacity='0.79'/%3E%3Cuse href='%23l' transform='translate(167.5 121.3) scale(0.124 0.166)' opacity='0.79'/%3E%3Cuse href='%23d' transform='translate(181.4 120.3) scale(0.093 0.166)' opacity='0.7'/%3E%3Cuse href='%23l' transform='translate(182.0 121.3) scale(0.093 0.166)' opacity='0.7'/%3E%3Cuse href='%23d' transform='translate(191.7 120.3) scale(0.058 0.166)' opacity='0.56'/%3E%3Cuse href='%23l' transform='translate(192.1 121.3) scale(0.058 0.166)' opacity='0.56'/%3E%3Cuse href='%23d' transform='translate(197.1 120.3) scale(0.020 0.166)' opacity='0.35'/%3E%3Cuse href='%23l' transform='translate(197.2 121.3) scale(0.020 0.166)' opacity='0.35'/%3E%3Cuse href='%23d' transform='translate(0.6 99.5) scale(0.019 0.170)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(0.7 100.5) scale(0.019 0.170)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(5.4 99.5) scale(0.056 0.170)' opacity='0.56'/%3E%3Cuse href='%23l' transform='translate(5.8 100.5) scale(0.056 0.170)' opacity='0.56'/%3E%3Cuse href='%23d' transform='translate(15.0 99.5) scale(0.090 0.170)' opacity='0.69'/%3E%3Cuse href='%23l' transform='translate(15.6 100.5) scale(0.090 0.170)' opacity='0.69'/%3E%3Cuse href='%23d' transform='translate(28.9 99.5) scale(0.120 0.170)' opacity='0.79'/%3E%3Cuse href='%23l' transform='translate(29.7 100.5) scale(0.120 0.170)' opacity='0.79'/%3E%3Cuse href='%23d' transform='translate(46.3 99.5) scale(0.144 0.170)' opacity='0.85'/%3E%3Cuse href='%23l' transform='translate(47.3 100.5) scale(0.144 0.170)' opacity='0.85'/%3E%3Cuse href='%23d' transform='translate(66.5 99.5) scale(0.160 0.170)' opacity='0.9'/%3E%3Cuse href='%23l' transform='translate(67.5 100.5) scale(0.160 0.170)' opacity='0.9'/%3E%3Cuse href='%23d' transform='translate(88.3 99.5) scale(0.169 0.170)' opacity='0.92'/%3E%3Cuse href='%23l' transform='translate(89.4 100.5) scale(0.169 0.170)' opacity='0.92'/%3E%3Cuse href='%23d' transform='translate(110.6 99.5) scale(0.169 0.170)' opacity='0.92'/%3E%3Cuse href='%23l' transform='translate(111.7 100.5) scale(0.169 0.170)' opacity='0.92'/%3E%3Cuse href='%23d' transform='translate(132.5 99.5) scale(0.160 0.170)' opacity='0.9'/%3E%3Cuse href='%23l' transform='translate(133.5 100.5) scale(0.160 0.170)' opacity='0.9'/%3E%3Cuse href='%23d' transform='translate(152.7 99.5) scale(0.144 0.170)' opacity='0.85'/%3E%3Cuse href='%23l' transform='translate(153.7 100.5) scale(0.144 0.170)' opacity='0.85'/%3E%3Cuse href='%23d' transform='translate(170.3 99.5) scale(0.120 0.170)' opacity='0.79'/%3E%3Cuse href='%23l' transform='translate(171.1 100.5) scale(0.120 0.170)' opacity='0.79'/%3E%3Cuse href='%23d' transform='translate(184.4 99.5) scale(0.090 0.170)' opacity='0.69'/%3E%3Cuse href='%23l' transform='translate(185.0 100.5) scale(0.090 0.170)' opacity='0.69'/%3E%3Cuse href='%23d' transform='translate(194.2 99.5) scale(0.056 0.170)' opacity='0.56'/%3E%3Cuse href='%23l' transform='translate(194.6 100.5) scale(0.056 0.170)' opacity='0.56'/%3E%3Cuse href='%23d' transform='translate(199.3 99.5) scale(0.019 0.170)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(199.4 100.5) scale(0.019 0.170)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(4.7 78.7) scale(0.039 0.166)' opacity='0.47'/%3E%3Cuse href='%23l' transform='translate(4.9 79.7) scale(0.039 0.166)' opacity='0.47'/%3E%3Cuse href='%23d' transform='translate(12.3 78.7) scale(0.076 0.166)' opacity='0.64'/%3E%3Cuse href='%23l' transform='translate(12.8 79.7) scale(0.076 0.166)' opacity='0.64'/%3E%3Cuse href='%23d' transform='translate(24.7 78.7) scale(0.109 0.166)' opacity='0.75'/%3E%3Cuse href='%23l' transform='translate(25.4 79.7) scale(0.109 0.166)' opacity='0.75'/%3E%3Cuse href='%23d' transform='translate(41.1 78.7) scale(0.136 0.166)' opacity='0.82'/%3E%3Cuse href='%23l' transform='translate(42.0 79.7) scale(0.136 0.166)' opacity='0.82'/%3E%3Cuse href='%23d' transform='translate(60.8 78.7) scale(0.156 0.166)' opacity='0.88'/%3E%3Cuse href='%23l' transform='translate(61.8 79.7) scale(0.156 0.166)' opacity='0.88'/%3E%3Cuse href='%23d' transform='translate(82.5 78.7) scale(0.167 0.166)' opacity='0.9'/%3E%3Cuse href='%23l' transform='translate(83.6 79.7) scale(0.167 0.166)' opacity='0.9'/%3E%3Cuse href='%23d' transform='translate(105.1 78.7) scale(0.170 0.166)' opacity='0.91'/%3E%3Cuse href='%23l' transform='translate(106.2 79.7) scale(0.170 0.166)' opacity='0.91'/%3E%3Cuse href='%23d' transform='translate(127.5 78.7) scale(0.163 0.166)' opacity='0.89'/%3E%3Cuse href='%23l' transform='translate(128.6 79.7) scale(0.163 0.166)' opacity='0.89'/%3E%3Cuse href='%23d' transform='translate(148.4 78.7) scale(0.147 0.166)' opacity='0.85'/%3E%3Cuse href='%23l' transform='translate(149.4 79.7) scale(0.147 0.166)' opacity='0.85'/%3E%3Cuse href='%23d' transform='translate(166.7 78.7) scale(0.124 0.166)' opacity='0.79'/%3E%3Cuse href='%23l' transform='translate(167.5 79.7) scale(0.124 0.166)' opacity='0.79'/%3E%3Cuse href='%23d' transform='translate(181.4 78.7) scale(0.093 0.166)' opacity='0.7'/%3E%3Cuse href='%23l' transform='translate(182.0 79.7) scale(0.093 0.166)' opacity='0.7'/%3E%3Cuse href='%23d' transform='translate(191.7 78.7) scale(0.058 0.166)' opacity='0.56'/%3E%3Cuse href='%23l' transform='translate(192.1 79.7) scale(0.058 0.166)' opacity='0.56'/%3E%3Cuse href='%23d' transform='translate(197.1 78.7) scale(0.020 0.166)' opacity='0.35'/%3E%3Cuse href='%23l' transform='translate(197.2 79.7) scale(0.020 0.166)' opacity='0.35'/%3E%3Cuse href='%23d' transform='translate(9.2 58.8) scale(0.020 0.155)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(9.4 59.8) scale(0.020 0.155)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(14.4 58.8) scale(0.060 0.155)' opacity='0.55'/%3E%3Cuse href='%23l' transform='translate(14.8 59.8) scale(0.060 0.155)' opacity='0.55'/%3E%3Cuse href='%23d' transform='translate(24.5 58.8) scale(0.097 0.155)' opacity='0.68'/%3E%3Cuse href='%23l' transform='translate(25.1 59.8) scale(0.097 0.155)' opacity='0.68'/%3E%3Cuse href='%23d' transform='translate(39.0 58.8) scale(0.127 0.155)' opacity='0.78'/%3E%3Cuse href='%23l' transform='translate(39.8 59.8) scale(0.127 0.155)' opacity='0.78'/%3E%3Cuse href='%23d' transform='translate(57.1 58.8) scale(0.151 0.155)' opacity='0.84'/%3E%3Cuse href='%23l' transform='translate(58.0 59.8) scale(0.151 0.155)' opacity='0.84'/%3E%3Cuse href='%23d' transform='translate(77.6 58.8) scale(0.165 0.155)' opacity='0.87'/%3E%3Cuse href='%23l' transform='translate(78.7 59.8) scale(0.165 0.155)' opacity='0.87'/%3E%3Cuse href='%23d' transform='translate(99.5 58.8) scale(0.170 0.155)' opacity='0.88'/%3E%3Cuse href='%23l' transform='translate(100.5 59.8) scale(0.170 0.155)' opacity='0.88'/%3E%3Cuse href='%23d' transform='translate(121.3 58.8) scale(0.165 0.155)' opacity='0.87'/%3E%3Cuse href='%23l' transform='translate(122.4 59.8) scale(0.165 0.155)' opacity='0.87'/%3E%3Cuse href='%23d' transform='translate(142.0 58.8) scale(0.151 0.155)' opacity='0.84'/%3E%3Cuse href='%23l' transform='translate(142.9 59.8) scale(0.151 0.155)' opacity='0.84'/%3E%3Cuse href='%23d' transform='translate(160.2 58.8) scale(0.127 0.155)' opacity='0.78'/%3E%3Cuse href='%23l' transform='translate(161.0 59.8) scale(0.127 0.155)' opacity='0.78'/%3E%3Cuse href='%23d' transform='translate(174.9 58.8) scale(0.097 0.155)' opacity='0.68'/%3E%3Cuse href='%23l' transform='translate(175.5 59.8) scale(0.097 0.155)' opacity='0.68'/%3E%3Cuse href='%23d' transform='translate(185.2 58.8) scale(0.060 0.155)' opacity='0.55'/%3E%3Cuse href='%23l' transform='translate(185.6 59.8) scale(0.060 0.155)' opacity='0.55'/%3E%3Cuse href='%23d' transform='translate(190.6 58.8) scale(0.020 0.155)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(190.8 59.8) scale(0.020 0.155)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(21.9 40.8) scale(0.046 0.138)' opacity='0.46'/%3E%3Cuse href='%23l' transform='translate(22.2 41.7) scale(0.046 0.138)' opacity='0.46'/%3E%3Cuse href='%23d' transform='translate(30.6 40.8) scale(0.088 0.138)' opacity='0.62'/%3E%3Cuse href='%23l' transform='translate(31.2 41.7) scale(0.088 0.138)' opacity='0.62'/%3E%3Cuse href='%23d' transform='translate(44.4 40.8) scale(0.124 0.138)' opacity='0.73'/%3E%3Cuse href='%23l' transform='translate(45.2 41.7) scale(0.124 0.138)' opacity='0.73'/%3E%3Cuse href='%23d' transform='translate(62.3 40.8) scale(0.151 0.138)' opacity='0.79'/%3E%3Cuse href='%23l' transform='translate(63.3 41.7) scale(0.151 0.138)' opacity='0.79'/%3E%3Cuse href='%23d' transform='translate(83.0 40.8) scale(0.166 0.138)' opacity='0.83'/%3E%3Cuse href='%23l' transform='translate(84.1 41.7) scale(0.166 0.138)' opacity='0.83'/%3E%3Cuse href='%23d' transform='translate(105.0 40.8) scale(0.170 0.138)' opacity='0.84'/%3E%3Cuse href='%23l' transform='translate(106.1 41.7) scale(0.170 0.138)' opacity='0.84'/%3E%3Cuse href='%23d' transform='translate(126.6 40.8) scale(0.160 0.138)' opacity='0.81'/%3E%3Cuse href='%23l' transform='translate(127.6 41.7) scale(0.160 0.138)' opacity='0.81'/%3E%3Cuse href='%23d' transform='translate(146.2 40.8) scale(0.139 0.138)' opacity='0.76'/%3E%3Cuse href='%23l' transform='translate(147.1 41.7) scale(0.139 0.138)' opacity='0.76'/%3E%3Cuse href='%23d' transform='translate(162.4 40.8) scale(0.107 0.138)' opacity='0.68'/%3E%3Cuse href='%23l' transform='translate(163.1 41.7) scale(0.107 0.138)' opacity='0.68'/%3E%3Cuse href='%23d' transform='translate(174.0 40.8) scale(0.068 0.138)' opacity='0.55'/%3E%3Cuse href='%23l' transform='translate(174.4 41.7) scale(0.068 0.138)' opacity='0.55'/%3E%3Cuse href='%23d' transform='translate(180.1 40.8) scale(0.023 0.138)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(180.2 41.7) scale(0.023 0.138)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(33.9 25.3) scale(0.028 0.114)' opacity='0.34'/%3E%3Cuse href='%23l' transform='translate(34.1 26.1) scale(0.028 0.114)' opacity='0.34'/%3E%3Cuse href='%23d' transform='translate(40.9 25.3) scale(0.081 0.114)' opacity='0.55'/%3E%3Cuse href='%23l' transform='translate(41.4 26.1) scale(0.081 0.114)' opacity='0.55'/%3E%3Cuse href='%23d' transform='translate(54.3 25.3) scale(0.125 0.114)' opacity='0.67'/%3E%3Cuse href='%23l' transform='translate(55.1 26.1) scale(0.125 0.114)' opacity='0.67'/%3E%3Cuse href='%23d' transform='translate(72.6 25.3) scale(0.156 0.114)' opacity='0.74'/%3E%3Cuse href='%23l' transform='translate(73.6 26.1) scale(0.156 0.114)' opacity='0.74'/%3E%3Cuse href='%23d' transform='translate(93.9 25.3) scale(0.169 0.114)' opacity='0.77'/%3E%3Cuse href='%23l' transform='translate(95.0 26.1) scale(0.169 0.114)' opacity='0.77'/%3E%3Cuse href='%23d' transform='translate(115.9 25.3) scale(0.165 0.114)' opacity='0.76'/%3E%3Cuse href='%23l' transform='translate(117.0 26.1) scale(0.165 0.114)' opacity='0.76'/%3E%3Cuse href='%23d' transform='translate(136.1 25.3) scale(0.142 0.114)' opacity='0.71'/%3E%3Cuse href='%23l' transform='translate(137.1 26.1) scale(0.142 0.114)' opacity='0.71'/%3E%3Cuse href='%23d' transform='translate(152.5 25.3) scale(0.104 0.114)' opacity='0.62'/%3E%3Cuse href='%23l' transform='translate(153.1 26.1) scale(0.104 0.114)' opacity='0.62'/%3E%3Cuse href='%23d' transform='translate(163.1 25.3) scale(0.055 0.114)' opacity='0.46'/%3E%3Cuse href='%23l' transform='translate(163.5 26.1) scale(0.055 0.114)' opacity='0.46'/%3E%3Cuse href='%23d' transform='translate(54.7 13.1) scale(0.074 0.085)' opacity='0.46'/%3E%3Cuse href='%23l' transform='translate(55.2 13.7) scale(0.074 0.085)' opacity='0.46'/%3E%3Cuse href='%23d' transform='translate(68.4 13.1) scale(0.133 0.085)' opacity='0.6'/%3E%3Cuse href='%23l' transform='translate(69.3 13.7) scale(0.133 0.085)' opacity='0.6'/%3E%3Cuse href='%23d' transform='translate(88.3 13.1) scale(0.166 0.085)' opacity='0.67'/%3E%3Cuse href='%23l' transform='translate(89.4 13.7) scale(0.166 0.085)' opacity='0.67'/%3E%3Cuse href='%23d' transform='translate(110.6 13.1) scale(0.166 0.085)' opacity='0.67'/%3E%3Cuse href='%23l' transform='translate(111.7 13.7) scale(0.166 0.085)' opacity='0.67'/%3E%3Cuse href='%23d' transform='translate(130.7 13.1) scale(0.133 0.085)' opacity='0.6'/%3E%3Cuse href='%23l' transform='translate(131.6 13.7) scale(0.133 0.085)' opacity='0.6'/%3E%3Cuse href='%23d' transform='translate(144.8 13.1) scale(0.074 0.085)' opacity='0.46'/%3E%3Cuse href='%23l' transform='translate(145.3 13.7) scale(0.074 0.085)' opacity='0.46'/%3E%3Cuse href='%23d' transform='translate(70.8 4.7) scale(0.058 0.053)' opacity='0.33'/%3E%3Cuse href='%23l' transform='translate(71.2 5.1) scale(0.058 0.053)' opacity='0.33'/%3E%3Cuse href='%23d' transform='translate(84.1 4.7) scale(0.147 0.053)' opacity='0.51'/%3E%3Cuse href='%23l' transform='translate(85.0 5.1) scale(0.147 0.053)' opacity='0.51'/%3E%3Cuse href='%23d' transform='translate(104.8 4.7) scale(0.167 0.053)' opacity='0.54'/%3E%3Cuse href='%23l' transform='translate(105.9 5.1) scale(0.167 0.053)' opacity='0.54'/%3E%3Cuse href='%23d' transform='translate(123.3 4.7) scale(0.109 0.053)' opacity='0.44'/%3E%3Cuse href='%23l' transform='translate(124.0 5.1) scale(0.109 0.053)' opacity='0.44'/%3E%3Cuse href='%23d' transform='translate(104.8 0.5) scale(0.147 0.018)' opacity='0.31'/%3E%3Cuse href='%23l' transform='translate(105.7 0.6) scale(0.147 0.018)' opacity='0.31'/%3E%3C/svg%3E");
          /* Intensity of everything luminous. The shell and core keep their
             own values, so dialling this down dims the burst and the halo
             without dissolving the object itself.
                0.35 barely there · 0.55 low · 1.00 full · 1.50 hot (default) */
          --arc-gain: 1.5;
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
           one shared tooth profile. Sharing a single boundary makes the mesh
           exact by construction — two independently generated profiles have
           to agree, and an earlier pair did not, which left the shut sphere
           showing daylight down the seam. */
        .arc-cf .arc-door {
          position: absolute; inset: 0;
          /* Dark blue-black metal. Kept deliberately flat here: the sphere's
             form comes from .arc-form above, which is fixed to the shell, not
             from a gradient painted on panels that slide. */
          background-image: var(--arc-etch), linear-gradient(103deg, #050b14 0%, #101c2e 34%, #16243a 50%, #0c1626 68%, #04080f 100%);
          background-size: 100% 100%, auto;
          background-repeat: no-repeat, no-repeat;
          background-blend-mode: soft-light, normal;
        }
        /* Fixed shell at the poles. These never move, which is what stops the
           sphere reading as two halves coming apart: the aperture is a slot
           cut in a solid object, bounded by shell that stays put. */
                /* Fixed shell at the poles: the same full sphere, clipped to a band,
           so its etch registers exactly with the doors' instead of reading as
           a separate strip laid across the top and bottom. */
        .arc-cf .arc-cap {
          position: absolute; inset: 0;
          background-image: var(--arc-etch), linear-gradient(103deg, #050b14 0%, #101c2e 34%, #16243a 50%, #0c1626 68%, #04080f 100%);
          background-size: 100% 100%, auto;
          background-repeat: no-repeat, no-repeat;
          background-blend-mode: soft-light, normal;
        }
        .arc-cf .arc-cap-t { clip-path: inset(0 0 calc(100% - var(--arc-cap)) 0); }
        .arc-cf .arc-cap-b { clip-path: inset(calc(100% - var(--arc-cap)) 0 0 0); }
        /* drop-shadow rather than a border for the lit edge: it follows the
           clipped alpha shape, where a border sits on the box edge and would
           survive only on the tooth tips. */
        .arc-cf .arc-door-l {
          clip-path: polygon(0% 0%, 52.100% 0.000%, 52.100% 1.500%, 51.892% 2.286%, 51.309% 3.071%, 50.467% 3.857%, 49.533% 4.643%, 48.691% 5.429%, 48.108% 6.214%, 47.900% 7.000%, 47.900% 10.000%, 47.900% 10.000%, 47.900% 11.500%, 48.108% 12.286%, 48.691% 13.071%, 49.533% 13.857%, 50.467% 14.643%, 51.309% 15.429%, 51.892% 16.214%, 52.100% 17.000%, 52.100% 20.000%, 52.100% 20.000%, 52.100% 21.500%, 51.892% 22.286%, 51.309% 23.071%, 50.467% 23.857%, 49.533% 24.643%, 48.691% 25.429%, 48.108% 26.214%, 47.900% 27.000%, 47.900% 30.000%, 47.900% 30.000%, 47.900% 31.500%, 48.108% 32.286%, 48.691% 33.071%, 49.533% 33.857%, 50.467% 34.643%, 51.309% 35.429%, 51.892% 36.214%, 52.100% 37.000%, 52.100% 40.000%, 52.100% 40.000%, 52.100% 41.500%, 51.892% 42.286%, 51.309% 43.071%, 50.467% 43.857%, 49.533% 44.643%, 48.691% 45.429%, 48.108% 46.214%, 47.900% 47.000%, 47.900% 50.000%, 47.900% 50.000%, 47.900% 51.500%, 48.108% 52.286%, 48.691% 53.071%, 49.533% 53.857%, 50.467% 54.643%, 51.309% 55.429%, 51.892% 56.214%, 52.100% 57.000%, 52.100% 60.000%, 52.100% 60.000%, 52.100% 61.500%, 51.892% 62.286%, 51.309% 63.071%, 50.467% 63.857%, 49.533% 64.643%, 48.691% 65.429%, 48.108% 66.214%, 47.900% 67.000%, 47.900% 70.000%, 47.900% 70.000%, 47.900% 71.500%, 48.108% 72.286%, 48.691% 73.071%, 49.533% 73.857%, 50.467% 74.643%, 51.309% 75.429%, 51.892% 76.214%, 52.100% 77.000%, 52.100% 80.000%, 52.100% 80.000%, 52.100% 81.500%, 51.892% 82.286%, 51.309% 83.071%, 50.467% 83.857%, 49.533% 84.643%, 48.691% 85.429%, 48.108% 86.214%, 47.900% 87.000%, 47.900% 90.000%, 47.900% 90.000%, 47.900% 91.500%, 48.108% 92.286%, 48.691% 93.071%, 49.533% 93.857%, 50.467% 94.643%, 51.309% 95.429%, 51.892% 96.214%, 52.100% 97.000%, 52.100% 100.000%, 0% 100%);
          filter: drop-shadow(2px 0 3px rgba(93,180,255,0.42));
        }
        .arc-cf .arc-door-r {
          clip-path: polygon(100% 0%, 52.100% 0.000%, 52.100% 1.500%, 51.892% 2.286%, 51.309% 3.071%, 50.467% 3.857%, 49.533% 4.643%, 48.691% 5.429%, 48.108% 6.214%, 47.900% 7.000%, 47.900% 10.000%, 47.900% 10.000%, 47.900% 11.500%, 48.108% 12.286%, 48.691% 13.071%, 49.533% 13.857%, 50.467% 14.643%, 51.309% 15.429%, 51.892% 16.214%, 52.100% 17.000%, 52.100% 20.000%, 52.100% 20.000%, 52.100% 21.500%, 51.892% 22.286%, 51.309% 23.071%, 50.467% 23.857%, 49.533% 24.643%, 48.691% 25.429%, 48.108% 26.214%, 47.900% 27.000%, 47.900% 30.000%, 47.900% 30.000%, 47.900% 31.500%, 48.108% 32.286%, 48.691% 33.071%, 49.533% 33.857%, 50.467% 34.643%, 51.309% 35.429%, 51.892% 36.214%, 52.100% 37.000%, 52.100% 40.000%, 52.100% 40.000%, 52.100% 41.500%, 51.892% 42.286%, 51.309% 43.071%, 50.467% 43.857%, 49.533% 44.643%, 48.691% 45.429%, 48.108% 46.214%, 47.900% 47.000%, 47.900% 50.000%, 47.900% 50.000%, 47.900% 51.500%, 48.108% 52.286%, 48.691% 53.071%, 49.533% 53.857%, 50.467% 54.643%, 51.309% 55.429%, 51.892% 56.214%, 52.100% 57.000%, 52.100% 60.000%, 52.100% 60.000%, 52.100% 61.500%, 51.892% 62.286%, 51.309% 63.071%, 50.467% 63.857%, 49.533% 64.643%, 48.691% 65.429%, 48.108% 66.214%, 47.900% 67.000%, 47.900% 70.000%, 47.900% 70.000%, 47.900% 71.500%, 48.108% 72.286%, 48.691% 73.071%, 49.533% 73.857%, 50.467% 74.643%, 51.309% 75.429%, 51.892% 76.214%, 52.100% 77.000%, 52.100% 80.000%, 52.100% 80.000%, 52.100% 81.500%, 51.892% 82.286%, 51.309% 83.071%, 50.467% 83.857%, 49.533% 84.643%, 48.691% 85.429%, 48.108% 86.214%, 47.900% 87.000%, 47.900% 90.000%, 47.900% 90.000%, 47.900% 91.500%, 48.108% 92.286%, 48.691% 93.071%, 49.533% 93.857%, 50.467% 94.643%, 51.309% 95.429%, 51.892% 96.214%, 52.100% 97.000%, 52.100% 100.000%, 100% 100%);
          filter: drop-shadow(-2px 0 3px rgba(93,180,255,0.42));
        }
        /* The sphere's form: a highlight off-centre and the limb falling into
           darkness. Fixed to the shell rather than painted on the doors —
           shading belongs to the object, and would betray the illusion if it
           slid when a panel did. */
        .arc-cf .arc-form {
          position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(circle at 39% 33%,
            rgba(206,228,255,0.07) 0%, rgba(120,170,230,0.02) 22%, transparent 34%,
            rgba(2,4,10,0.26) 62%, rgba(2,4,10,0.68) 86%, rgba(2,4,10,0.93) 100%);
        }
        /* Specular and environment reflection. Above the doors and fixed,
           because a reflection belongs to the room rather than to the panels
           — it should not slide when they do. */
        .arc-cf .arc-sheen {
          position: absolute; inset: 0; border-radius: 50%;
          mix-blend-mode: screen;
          background:
            radial-gradient(ellipse 15% 11% at 30% 21%, rgba(232,243,255,0.55) 0%, rgba(190,220,255,0.22) 45%, transparent 78%),
            radial-gradient(ellipse 50% 38% at 33% 26%, rgba(178,208,245,0.16) 0%, rgba(110,160,220,0.05) 46%, transparent 74%),
            linear-gradient(180deg, transparent 40%, rgba(130,180,240,0.10) 48%, rgba(168,208,252,0.17) 51%, rgba(120,170,230,0.06) 56%, transparent 63%),
            radial-gradient(ellipse 38% 32% at 74% 84%, rgba(60,122,196,0.20) 0%, transparent 66%);
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
        <div className="arc-form" />
        <div className="arc-sheen" />
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
