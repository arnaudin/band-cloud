/* haze.js — the background wash behind the wall.
 *
 * PHASE 1 (this file): a static, very low-contrast bloom of coloured light.
 * Its job right now is to prove the layering and, more importantly, to pin down
 * the legibility budget before anything starts moving.
 *
 * PHASE 2 (the live-lightshow / liquid-projection idea): replace `paint` with a
 * draw loop. The seams are already here —
 *
 *   • `--haze-intensity` in app.css is the single master dial; the canvas is
 *     composited at that opacity, so nothing downstream can exceed it.
 *   • MAX_ALPHA caps any individual light source, so a loop that stacks dozens
 *     of them still can't wash out the type.
 *   • `paint(t)` already takes a time argument and is called from a rAF-able
 *     entry point; `start()` only needs its `requestAnimationFrame` back.
 *   • Motion is gated on `prefers-reduced-motion` and `document.hidden` below,
 *     so an animated version inherits both without new plumbing.
 *
 * Good candidates, in order of fit: 2D metaballs with a duotone gradient map
 * (a real 1960s liquid light show was oil and dye pressed between glass — this
 * is the most literal and the cheapest); a WebGL fragment shader of slow
 * chromatic beams sweeping through haze; audio-reactive via Web Audio.
 */

const MAX_ALPHA = 0.22; // ceiling for any one light source

// Hues come from the active theme's wall accents, so the wash always belongs to
// whatever palette is on screen.
const LIGHTS = [
  { x: 0.14, y: 0.10, r: 0.62, hue: '--a5', a: 0.20 },
  { x: 0.86, y: 0.06, r: 0.55, hue: '--a4', a: 0.16 },
  { x: 0.68, y: 0.74, r: 0.70, hue: '--a3', a: 0.13 },
  { x: 0.24, y: 0.92, r: 0.58, hue: '--a1', a: 0.15 },
];

const canvas = document.getElementById('haze');
const ctx = canvas ? canvas.getContext('2d') : null;

let colours = [];
let running = false;

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// #rrggbb -> "r, g, b" so it can be dropped into rgba() stops.
function rgbOf(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function resize() {
  if (!canvas) return;
  // Cap at 1.5 rather than devicePixelRatio: this is all soft gradients, so the
  // extra pixels on a 3× phone buy nothing and cost fill rate.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function paint(/* t */) {
  if (!ctx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const d = Math.hypot(w, h);

  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';

  LIGHTS.forEach((l, i) => {
    const g = ctx.createRadialGradient(l.x * w, l.y * h, 0, l.x * w, l.y * h, l.r * d * 0.5);
    const rgb = colours[i];
    g.addColorStop(0, `rgba(${rgb}, ${Math.min(l.a, MAX_ALPHA)})`);
    g.addColorStop(0.55, `rgba(${rgb}, ${Math.min(l.a, MAX_ALPHA) * 0.35})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  ctx.globalCompositeOperation = 'source-over';
}

// Re-read the palette and redraw. Called when the theme changes.
export function repaintHaze() {
  if (!ctx) return;
  colours = LIGHTS.map((l) => rgbOf(cssVar(l.hue) || '#888888'));
  paint(0);
}

export function initHaze() {
  if (!ctx) return;
  colours = LIGHTS.map((l) => rgbOf(cssVar(l.hue) || '#888888'));
  resize();
  paint(0);

  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { resize(); paint(0); }, 120);
  });

  // Phase 2 hooks, wired now so an animated `paint` inherits them for free.
  const motionOK = window.matchMedia('(prefers-reduced-motion: no-preference)');
  const shouldRun = () => motionOK.matches && !document.hidden;
  const sync = () => { running = shouldRun(); };
  motionOK.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
}

export const isRunning = () => running;
