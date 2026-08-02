/* cloud.js — the justified wall.
 *
 * Coverage is a property of the algorithm, not of tuning: every row is packed
 * *past* the container edge and then shrunk to fit, so a row can never be short,
 * and the global scale is solved so the stack of rows can never be shorter than
 * the viewport. Whitespace has nowhere to appear.
 *
 * The organic feel comes from four things layered on that guarantee — rows are
 * size-homogeneous but shuffled in order, sizes gradate continuously rather than
 * in six steps, words float vertically in whatever slack their row has, and wide
 * words tilt by however much that slack allows.
 */

const TIERS = [1.0, 1.35, 1.85, 2.6, 3.5, 4.8];
const ACCENTS = ['--a1', '--a2', '--a3', '--a4', '--a5'];

// Overridden per typeface: a variable grotesque offers a real weight range to
// build tonal texture from, a single-weight marker face offers exactly one.
const DEFAULT_WEIGHTS = [300, 400, 500, 600, 700];

const CFG = {
  bleed: 1.07,       // pack rows this far past the container edge
  gapEm: 0.3,        // word gap, in ems of the word's own size
  leading: 1.0,      // row height as a multiple of its largest word
  driftPad: 0.24,    // extra row height reserved for float + tilt
  minShrink: 0.84,   // furthest a row may be squeezed to fit
  maxGrow: 1.32,     // furthest a row may be stretched to fit
  maxGrowLast: 1.9,  // the final row gets more license — nothing follows it
  maxNegGap: 0.14,   // hard floor on gap tightening, as a fraction of word size
  maxGapStretch: 2.6, // ceiling on gap stretching, in multiples of the base gap
  maxTilt: 4.2,      // degrees
  tiltRate: 0.38,    // share of words eligible to tilt
  sortBlur: 0.34,    // tier bleed between neighboring rows (see `sortKey`)
  maxWordW: 1.04,    // a word may never exceed this fraction of the container
  refPx: 200,        // measurement reference size
};

// Bleeding past the edge is the point; bleeding *most of a name* past it is not.
// On a phone an untamed top-tier word runs ~700px wide in a 390px viewport and
// all you can read is "Portug". This caps width, and the solver stays correct
// because the cap is monotonic in scale.
const sizeOf = (w, scale, cap) => Math.min(w.weight * scale, cap / w.ratio);

// Accents are a hierarchy, not confetti: the more often a band was seen, the
// likelier it carries color. Scattering them evenly reads as random highlighting.
const ACCENT_RATE = [0.05, 0.07, 0.1, 0.22, 0.4, 0.6];

/* ----------------------------------------------------------------- seeds --- */

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// One id, many independent streams — so size, weight, color, tilt and float
// never correlate with each other.
function mix(h, salt) {
  let x = (h ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

// Fold the session seed into a band's own hash, giving a fresh but still fully
// reproducible starting point for that band's streams. Returns a u32 rather than
// a unit float, because it feeds `mix` again rather than being consumed directly.
function mix2(h, seed) {
  let x = (h ^ Math.imul(seed >>> 0, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

function shuffled(arr, seed) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(mix(seed, i) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* --------------------------------------------------------------- prepare --- */

// Viewport-independent per-word properties. Deterministic *given a seed*: the
// same seed always rebuilds the same wall, so a resize reflows without
// reshuffling, while a new seed composes the page afresh.
export function prepare(artists, seed = 0, { weights = DEFAULT_WEIGHTS } = {}) {
  return artists.map((a) => {
    const h = mix2(fnv1a(a.id), seed);

    // The tier floor comes from play count, never from the seed — how often a
    // band was actually seen is the one thing on this page carrying information,
    // so it survives every reshuffle. Bands seen once are free to trade places;
    // their sizes were arbitrary to begin with.
    const tier =
      a.count >= 4 ? 5 :
      a.count === 3 ? 4 :
      a.count === 2 ? 3 :
      (() => { const u = mix(h, 1); return u < 0.5 ? 0 : u < 0.85 ? 1 : 2; })();

    // ±12% continuous jitter, so the six tiers read as a gradient not a staircase
    const weight = TIERS[tier] * (0.88 + 0.24 * mix(h, 2));

    // Bias the heaviest tiers a step bolder, then clamp — a single-weight face
    // collapses this to its one weight rather than asking for one it lacks.
    const wIdx = clamp(
      Math.floor(mix(h, 3) * (weights.length - 1)) + (tier >= 4 ? 1 : 0),
      0, weights.length - 1,
    );
    const isAccent = mix(h, 4) < ACCENT_RATE[tier];

    return {
      id: a.id,
      name: a.name,
      count: a.count,
      tier,
      weight,
      // Rows are packed in this order, not by `weight`. The extra jitter lets
      // neighboring tiers share a row so the wall doesn't band into stripes of
      // uniform size — the slack it creates is what words float in.
      sortKey: weight * (1 - CFG.sortBlur / 2 + CFG.sortBlur * mix(h, 12)),
      fontWeight: weights[wIdx],
      accent: isAccent ? ACCENTS[Math.floor(mix(h, 5) * ACCENTS.length)] : null,
      tilt: mix(h, 7) < CFG.tiltRate ? (mix(h, 6) - 0.5) * 2 * CFG.maxTilt : 0,
      float: mix(h, 8),
      seed: h,
      ratio: 0, // filled by measure()
    };
  });
}

/* --------------------------------------------------------------- measure --- */

let mctx = null;

// Advance ratios at each word's own weight — measuring at one weight and
// rendering at another would push rows past their target width.
export function measure(words, fontStack) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');

  const byWeight = new Map();
  for (const w of words) {
    if (!byWeight.has(w.fontWeight)) byWeight.set(w.fontWeight, []);
    byWeight.get(w.fontWeight).push(w);
  }
  for (const [wt, list] of byWeight) {
    mctx.font = `${wt} ${CFG.refPx}px ${fontStack}`;
    for (const w of list) w.ratio = mctx.measureText(w.name).width / CFG.refPx;
  }
  return words;
}

/* ------------------------------------------------------------------ pack --- */

function packRows(sorted, scale, width) {
  const target = width * CFG.bleed;
  const cap = width * CFG.maxWordW;
  const rows = [];
  let cur = [];
  let nat = 0;

  for (const w of sorted) {
    const size = sizeOf(w, scale, cap);
    const adv = w.ratio * size;
    const gap = cur.length ? CFG.gapEm * size : 0;
    const natWith = nat + gap + adv;

    if (natWith < target) { cur.push(w); nat = natWith; continue; }

    // Best fit, not first fit. Always swallowing the word that crosses the line
    // is fine when words are small relative to the row, but on a phone one name
    // can be nearly a full row wide — that overshoots by up to 2×, pins the row
    // at minShrink, and dumps the remainder into negative gaps as overlap.
    // Whichever side lands closer to target wins.
    if (cur.length && target - nat < natWith - target) {
      rows.push({ words: cur, nat });
      cur = [w];
      nat = adv;
    } else {
      cur.push(w);
      rows.push({ words: cur, nat: natWith });
      cur = [];
      nat = 0;
    }
  }
  if (cur.length) rows.push({ words: cur, nat, last: true });

  for (const r of rows) {
    // Rows may now land either side of target, so the fit range is symmetric.
    // Either way the row is scaled to exactly target — that, not the overshoot,
    // is what makes whitespace impossible.
    r.fit = clamp(target / r.nat, CFG.minShrink, r.last ? CFG.maxGrowLast : CFG.maxGrow);
    let maxSize = 0;
    for (const w of r.words) {
      const s = sizeOf(w, scale, cap);
      if (s > maxSize) maxSize = s;
    }
    r.maxSize = maxSize * r.fit;
    r.height = r.maxSize * (CFG.leading + CFG.driftPad);
  }
  return rows;
}

const stackHeight = (rows) => rows.reduce((h, r) => h + r.height, 0);

/* ----------------------------------------------------------------- solve --- */

// Two independent lower bounds on type size; the larger wins.
//
//   fill  — the smallest scale whose rows still stack past the viewport bottom
//   floor — the scale at which the smallest word is still comfortably readable
//
// On a wide screen `fill` dominates and the whole wall lands in one screen. On
// a phone `floor` dominates, the wall grows past the fold, and the page
// scrolls. One rule, both behaviors.
function solveScale(sorted, width, height, minPx) {
  let lo = 1;
  let hi = 600;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (stackHeight(packRows(sorted, mid, width)) < height) lo = mid; else hi = mid;
  }
  let minWeight = Infinity;
  for (const w of sorted) if (w.weight < minWeight) minWeight = w.weight;
  return { scale: Math.max(hi, minPx / minWeight), fill: hi, floor: minPx / minWeight };
}

/* ---------------------------------------------------------------- layout --- */

export function layout(words, { width, height, minPx, seed = 0 }) {
  // Sort big-to-small so rows stay roughly size-homogeneous — a tall row holding
  // tiny words is exactly how generated clouds end up with holes in them. The
  // blur in `sortKey` softens that into a gradient rather than six hard bands.
  const sorted = words.slice().sort((a, b) => b.sortKey - a.sortKey);

  const { scale, fill, floor } = solveScale(sorted, width, height, minPx);
  const rows = packRows(sorted, scale, width);

  // Homogeneous rows in sorted order would band the wall light-to-dark, so the
  // row *order* is shuffled while each row's internal composition is preserved.
  //
  // The leftover row is held out of that shuffle and pinned to the end. It's the
  // remainder after the last full row, so it's short by construction — it can be
  // stretched but not reliably filled. Anywhere but the bottom it reads as a
  // hole: shuffled into the top of the wall it renders at ~35% ink with 166px
  // gutters, against 86% and 6–12px for a healthy row. At the bottom it is
  // either clipped away entirely (the one-screen case) or reads as the ragged
  // last line of a justified column, which is just correct typesetting.
  const leftover = rows.length > 1 && rows[rows.length - 1].last ? rows.pop() : null;
  const ordered = shuffled(rows, seed);
  if (leftover) ordered.push(leftover);

  const target = width * CFG.bleed;
  const cap = width * CFG.maxWordW;
  const placed = [];
  let y = 0;

  // Self-scoring, so a caller can reject a bad arrangement without touching the
  // DOM. Every value here is a *known* failure mode of the constants above:
  // a row squeezed into overlap, a row stretched visibly loose, and the final
  // row ballooning because it happened to catch only a word or two.
  const quality = { rows: ordered.length, clampedRows: 0, worstFit: 1, lastRowGrowth: 1, shortestRow: Infinity };

  ordered.forEach((row, ri) => {
    const rowSeed = fnv1a(`row:${ri}:${row.words.length}:${seed}`);
    const members = shuffled(row.words, rowSeed);

    // Measure the row at its fitted size, then push any residual into the gaps
    // so it lands exactly on target — no row can end short.
    let advTotal = 0;
    let gapTotal = 0;
    members.forEach((w, i) => {
      const size = sizeOf(w, scale, cap) * row.fit;
      advTotal += w.ratio * size;
      if (i) gapTotal += CFG.gapEm * size;
    });
    // Any residual goes into the gaps so the row lands exactly on target. Gap
    // tightening is floored, though: past a point it stops reading as tight
    // setting and starts reading as two names printed on top of each other.
    const residual = target - (advTotal + gapTotal);
    let gapBonus = members.length > 1 ? residual / (members.length - 1) : 0;

    // Stretching is capped as well as tightening. A row that simply cannot be
    // filled is better left ragged than blown out to even gutters — past a
    // couple of word-spaces the eye stops reading it as a line of type and
    // starts reading it as the hole this whole engine exists to prevent.
    if (gapBonus > 0) {
      const avgSize = (advTotal + gapTotal) / Math.max(members.length, 1) / 2;
      gapBonus = Math.min(gapBonus, CFG.gapEm * avgSize * CFG.maxGapStretch);
    }

    if (gapBonus < 0) {
      let minSize = Infinity;
      for (const w of members) minSize = Math.min(minSize, sizeOf(w, scale, cap) * row.fit);
      const floored = Math.max(gapBonus, -minSize * CFG.maxNegGap);
      // Hitting the floor means the residual could not be absorbed: this row is
      // wider than its target and will visibly crowd. Worth counting.
      if (floored !== gapBonus) quality.clampedRows++;
      gapBonus = floored;
    }

    if (Math.abs(row.fit - 1) > Math.abs(quality.worstFit - 1)) quality.worstFit = row.fit;
    if (row.last) quality.lastRowGrowth = row.fit;
    quality.shortestRow = Math.min(quality.shortestRow, members.length);

    // Stratify the vertical float across the row rather than letting each word
    // pick independently. Independent picks occasionally send every word in a
    // row to the same end of its band, leaving a blank stripe the full width of
    // the page; spreading the ranks 0→1 guarantees the band is always occupied
    // top and bottom, while the shuffle keeps the stagger from reading as a wave.
    const ranked = members.map((w, i) => ({ i, k: w.float })).sort((a, b) => a.k - b.k);
    const floats = new Array(members.length);
    ranked.forEach((o, rank) => {
      floats[o.i] = members.length > 1 ? rank / (members.length - 1) : 0.5;
    });

    // Ragged left edge: rows start 1–5% off-canvas, so both sides bleed.
    let x = -width * (0.01 + 0.04 * mix(rowSeed, 11));

    members.forEach((w, i) => {
      const size = sizeOf(w, scale, cap) * row.fit;
      const adv = w.ratio * size;
      if (i) x += CFG.gapEm * size + gapBonus;

      // Whatever vertical room this word doesn't use, it may float within.
      const slack = Math.max(0, row.height - size * CFG.leading);
      const yOff = slack * floats[i];

      // A tilted word grows vertically by adv·sin θ. Rotation is about the
      // top-left corner, so the direction matters: a positive tilt swings the
      // far end down into the row below, a negative one swings it *up* into the
      // row above. Budget against whichever side it actually travels toward.
      const room = w.tilt >= 0
        ? (slack - yOff) + size * 0.02
        : yOff + size * 0.02;
      const maxDeg = (Math.asin(clamp(Math.max(0, room) / Math.max(adv, 1), 0, 1)) * 180) / Math.PI;
      const tilt = Math.sign(w.tilt) * Math.min(Math.abs(w.tilt), maxDeg);

      placed.push({ word: w, x, y: y + yOff, size, tilt, row: ri });
      x += adv;
    });

    y += row.height;
  });

  return { placed, height: y, rows: ordered.length, scale, fill, floor, quality };
}

export { CFG };
