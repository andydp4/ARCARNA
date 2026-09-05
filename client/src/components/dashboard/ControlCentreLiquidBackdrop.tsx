import { useEffect, useRef, useState } from "react";

/**
 * Control Centre backdrop: a Truth Blue liquid.
 *
 * A domain-warped fBm field — fbm(p + fbm(p + fbm(p))) — rendered as a
 * WebGL fragment shader. The canonical source, with the mark-reveal and
 * endcard cuts and a frame-stepping renderer, is
 * scripts/brand/arcarna-liquid.html; this carries the backdrop cut only.
 *
 * Three things here are deliberate and easy to undo by accident:
 *
 * Resolution is pinned to 1x, not the device ratio. The marketing cuts
 * render at full device resolution because the letterform edges have to
 * hold up; this sits at 52% opacity behind a scrim with live figures on
 * top, where nobody can see the difference and a retina till would be
 * paying four times the fill rate for it.
 *
 * The field is periodic (LIQUID_PERIOD), not drifting. It costs some
 * variation — a cycle has to come back — but it means the ground never
 * wanders somewhere unintended over a long shift, and it matches the
 * looping backdrop clip frame for frame.
 *
 * It stops when the tab is hidden. A shader running behind a background
 * tab on a POS terminal all day is pure waste.
 *
 * Accessibility: decorative, so aria-hidden and inert to pointers — it
 * must never intercept a click meant for a tile. Under
 * prefers-reduced-motion it holds a single frame rather than animating.
 * Where WebGL is unavailable it falls back to a static gradient ground
 * rather than a blank band.
 */

const FRAGMENT_SHADER = `
precision highp float;
uniform vec2  u_res;
uniform float u_phase;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),               hash(i+vec2(1.0,0.0)), u.x),
             mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}
/* The Blue Set, docs/training/brand.css */
vec3 ramp(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3( 16.0, 52.0,112.0)/255.0;
  vec3 c1 = vec3( 30.0, 84.0,158.0)/255.0;
  vec3 c2 = vec3( 52.0,116.0,192.0)/255.0;
  vec3 c3 = vec3( 78.0,150.0,222.0)/255.0;
  vec3 c4 = vec3(110.0,190.0,255.0)/255.0;
  vec3 c5 = vec3(148.0,204.0,255.0)/255.0;
  vec3 c6 = vec3(198.0,228.0,255.0)/255.0;
  float s = t * 6.0, i = floor(s), f = s - i;
  vec3 a = c0, b = c1;
  if      (i > 4.5) { a = c5; b = c6; }
  else if (i > 3.5) { a = c4; b = c5; }
  else if (i > 2.5) { a = c3; b = c4; }
  else if (i > 1.5) { a = c2; b = c3; }
  else if (i > 0.5) { a = c1; b = c2; }
  return mix(a, b, f);
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p  = uv * 2.0;

  /* The warp offsets travel a circle rather than a line, so cos and sin
     make the field exactly periodic and it never drifts off somewhere. */
  float a = 6.2831853 * u_phase;
  vec2 w1 = vec2(cos( a       ), sin( a       )) * 0.34;
  vec2 w2 = vec2(cos(-a + 2.10), sin(-a + 2.10)) * 0.30;

  vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + 5.5*q + vec2(1.7, 9.2) + w1),
                fbm(p + 5.5*q + vec2(8.3, 2.8) + w2));
  float v = (fbm(p + 5.5*r) - 0.29) / 0.30;
  v = pow(clamp(v, 0.0, 1.0), 0.82);
  /* Hardens the boundary between bands — liquid metal rather than haze. */
  v = mix(v, smoothstep(0.16, 0.84, v), 0.65);

  float rl = min(length(r - 0.5) * 2.2, 1.0);
  vec3 col = ramp(v * 0.62 + rl * 0.26);

  /* Blue loses most of its saturation through frost, so it leaves
     over-saturated to survive the glass above it. */
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = lum + (col - lum) * 1.26;

  float d = length(uv - 0.5);
  col *= 1.0 + 0.26 * max(0.0, 1.0 - d * 2.5);
  float m = 1.0 - d * 2.06;
  gl_FragColor = vec4(col, m > 0.0 ? pow(m, 0.85) : 0.0);
}
`;

const VERTEX_SHADER = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";

/** One turn of the field. Matches the backdrop clip's length exactly. */
const LIQUID_PERIOD = 12000;
/** Skips the origin, where the noise is characterless. */
const LIQUID_OFFSET = 42000;

export function ControlCentreLiquidBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [usable, setUsable] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = (canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false }) ||
        canvas.getContext("experimental-webgl", {
          alpha: true, premultipliedAlpha: false, antialias: false,
        })) as WebGLRenderingContext | null;
    } catch {
      gl = null;
    }
    if (!gl) { setUsable(false); return; }

    const compile = (type: number, src: string) => {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        throw new Error(gl!.getShaderInfoLog(s) ?? "shader compile failed");
      }
      return s;
    };

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
      }
    } catch {
      setUsable(false);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_res");
    const uPhase = gl.getUniformLocation(program, "u_phase");

    let frame = 0;
    let start = 0;

    // 1x, not devicePixelRatio — see the note at the top of the file.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl!.viewport(0, 0, w, h);
      }
    };

    const draw = (now: number) => {
      if (!start) start = now;
      resize();
      gl!.uniform2f(uRes, canvas.width, canvas.height);
      const ms = (reduced ? 0 : now - start) + LIQUID_OFFSET;
      gl!.uniform1f(uPhase, (ms % LIQUID_PERIOD) / LIQUID_PERIOD);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    // A shader running behind a hidden tab on a till all day is waste.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
      } else if (!reduced) {
        start = 0;
        frame = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      const lose = gl!.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    };
  }, []);

  return (
    <div
      className="arc-lq pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden"
      aria-hidden
    >
      <style>{`
        .arc-lq { --lq-opacity: 0.52; }

        .arc-lq .arc-lq-canvas,
        .arc-lq .arc-lq-fallback {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 1100px;
          height: 1100px;
          transform: translate(-50%, -50%);
          opacity: var(--lq-opacity);
        }

        /* No WebGL: a still ground rather than an empty band. It is not
           pretending to be the same thing. */
        .arc-lq .arc-lq-fallback {
          border-radius: 50%;
          background:
            radial-gradient(circle at 42% 38%, rgba(148,204,255,0.42), rgba(60,122,196,0.30) 34%,
                            rgba(11,46,102,0.18) 62%, transparent 82%),
            radial-gradient(circle at 62% 66%, rgba(60,122,196,0.34), transparent 60%);
        }

        /* Fine static grain. Large smooth blues band into visible steps on
           8-bit panels; this dithers it away for the cost of one tiled
           image, rather than the animated canvas the marketing cuts use. */
        .arc-lq::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.03;
          mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        /* Settles the field into the page so the figures below never fight
           it, and keeps the left edge — where the heading sits — calmest. */
        .arc-lq .arc-lq-scrim {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(180deg, rgba(6,19,39,0.30) 0%, rgba(6,19,39,0.10) 34%,
                            rgba(6,19,39,0.62) 82%, hsl(220 10% 7%) 100%),
            linear-gradient(90deg, rgba(6,19,39,0.62) 0%, rgba(6,19,39,0.12) 38%, rgba(6,19,39,0) 62%);
        }
      `}</style>

      {usable ? (
        <canvas ref={canvasRef} className="arc-lq-canvas" />
      ) : (
        <div className="arc-lq-fallback" />
      )}
      <div className="arc-lq-scrim" />
    </div>
  );
}
