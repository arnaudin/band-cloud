import { prepare, measure, layout } from './cloud.js';
import { initPanel } from './router.js';
import { initSearch } from './search.js';
import { initHaze, repaintHaze } from './haze.js';

const wall = document.getElementById('wall');
const statsEl = document.getElementById('stats');

// Each face carries its own typographic budget. Permanent Marker is a wide,
// single-weight, low-contrast face: it needs more size to stay readable and has
// no weight range to build tonal texture from, so both numbers differ from the
// grotesque rather than being global constants.
const FACES = {
  grotesque: { label: 'Oswald', family: '"Oswald"', weights: [300, 400, 500, 600, 700], minPx: 13 },
  // Permanent Marker carries far more apparent size per em than a grotesque —
  // big x-height, heavy stroke, no counters to speak of — so an equal pixel
  // value reads noticeably larger. A lower floor lets the fill bound take over
  // and brings the whole wall back down to the same optical weight.
  marker:    { label: 'Marker', family: '"Permanent Marker"', weights: [400], minPx: 11.5 },
};
const FACE_ORDER = ['grotesque', 'marker'];
const FACE_KEY = 'bandcloud:face';

const THEMES = {
  ink:     { label: 'Ink & Ash' },
  marquee: { label: 'Marquee' },
};
const THEME_ORDER = ['ink', 'marquee'];
const THEME_KEY = 'bandcloud:theme';

const state = {
  data: null, words: [], nodes: new Map(),
  seed: 0, face: 'grotesque', theme: 'ink',
  quality: null,
  debug: new URLSearchParams(location.search).has('debug'),
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ------------------------------------------------------------------ seed --- */

// The seed lives for the session, not the layout call. `render()` re-runs on
// every resize, so minting a seed there would scramble the wall as you dragged
// a window edge — the composition must survive a reflow.
//
// `?seed=N` pins a composition: handy for sharing one, or for replaying an
// arrangement that looked wrong. It is read but deliberately never written —
// writing it on shuffle would make the next reload reproduce the same wall,
// which is exactly the behavior this feature removes.
function readSeed() {
  const pinned = new URLSearchParams(location.search).get('seed');
  if (pinned !== null && /^\d+$/.test(pinned)) return Number(pinned) >>> 0;
  return newSeed();
}

const newSeed = () => (Math.random() * 0x100000000) >>> 0;

/* ------------------------------------------------------------------ boot --- */

async function boot() {
  performance.mark('data:start');
  const res = await fetch('assets/data.json');
  if (!res.ok) throw new Error(`data.json ${res.status}`);
  state.data = await res.json();
  performance.mark('data:end');

  const d = state.data;
  const years = d.shows.filter((s) => s.date).map((s) => +s.date.slice(0, 4));
  // No "nights" count: undated rows each become their own show, so the figure
  // overstated how many distinct nights are actually recorded.
  statsEl.innerHTML =
    `${d.artists.length} bands · <a href="#/venues">${d.venues.length} venues</a> · ${Math.min(...years)}–${Math.max(...years)}`;

  state.seed = readSeed();
  state.face = readFace();
  state.theme = readTheme();
  document.documentElement.dataset.face = state.face;
  document.documentElement.dataset.theme = state.theme;
  state.words = prepare(d.artists, state.seed, { weights: FACES[state.face].weights });

  // Measuring against a font that hasn't loaded yet would size every row wrong,
  // so the wall stays hidden until the real metrics are available.
  wall.classList.add('is-measuring');
  await loadFace(state.face);
  measure(state.words, css('--display'));

  createNodes();
  styleNodes();
  render({ entrance: true });
  wall.classList.remove('is-measuring');

  initHaze();
  initSearch(d);
  initPanel(d); // also resolves a deep link on cold load
  observeResize();
  observePointer();
  initShuffle();
  initFaceToggle();
  initThemeToggle();
}

/* ------------------------------------------------------------- typeface --- */

// Query string wins over the saved preference, and is never written back — same
// contract as ?seed=. Lets a specific look be linked, scripted, or captured
// without disturbing what the browser remembers.
function readFace() {
  const q = new URLSearchParams(location.search).get('face');
  if (q && FACES[q]) return q;
  try {
    const saved = localStorage.getItem(FACE_KEY);
    if (saved && FACES[saved]) return saved;
  } catch { /* private mode — fall through to the default */ }
  return 'grotesque';
}

// `document.fonts.ready` only settles fonts the browser has already decided to
// fetch, and a face that isn't on screen yet isn't one of them. Each weight has
// to be requested explicitly, or the first measure runs against the fallback and
// every row is packed to the wrong width.
function loadFace(face) {
  const { family, weights } = FACES[face];
  return Promise.all(weights.map((w) => document.fonts.load(`${w} 40px ${family}`)))
    .catch(() => {}); // a failed webfont falls back rather than blanking the wall
}

async function setFace(face) {
  if (!FACES[face] || face === state.face) return;
  state.face = face;
  try { localStorage.setItem(FACE_KEY, face); } catch { /* non-fatal */ }

  document.documentElement.dataset.face = face;
  await loadFace(face);

  // Weight assignment is face-dependent, so the words are rebuilt — but from the
  // *same* seed, so the composition survives and only the type changes.
  state.words = prepare(state.data.artists, state.seed, { weights: FACES[face].weights });
  measure(state.words, css('--display'));
  styleNodes();
  render({ entrance: true });

  syncFaceButton();
  announce(`Typeface: ${FACES[face].label}`);
}

const nextFace = () => FACE_ORDER[(FACE_ORDER.indexOf(state.face) + 1) % FACE_ORDER.length];

// The button previews the face you'd get, not the one you're in.
function syncFaceButton() {
  const btn = document.getElementById('face');
  if (!btn) return;
  const next = nextFace();
  btn.style.fontFamily = FACES[next].family;
  btn.title = `Typeface: ${FACES[next].label} (T)`;
  btn.querySelector('.sr-only').textContent = `Switch typeface to ${FACES[next].label}`;
}

/* ---------------------------------------------------------------- theme --- */

function readTheme() {
  const q = new URLSearchParams(location.search).get('theme');
  if (q && THEMES[q]) return q;
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && THEMES[saved]) return saved;
  } catch { /* private mode */ }
  return 'ink';
}

// Pure CSS token swap — no relayout needed, since nothing about the palette
// affects glyph metrics. The haze re-reads its hues from the new theme.
function setTheme(theme) {
  if (!THEMES[theme] || theme === state.theme) return;
  state.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* non-fatal */ }
  document.documentElement.dataset.theme = theme;
  repaintHaze();
  syncThemeButton();
  announce(`Theme: ${THEMES[theme].label}`);
}

const nextTheme = () => THEME_ORDER[(THEME_ORDER.indexOf(state.theme) + 1) % THEME_ORDER.length];

function syncThemeButton() {
  const btn = document.getElementById('theme');
  if (!btn) return;
  btn.title = `Theme: ${THEMES[nextTheme()].label} (C)`;
  btn.querySelector('.sr-only').textContent = `Switch theme to ${THEMES[nextTheme()].label}`;
}

function initThemeToggle() {
  syncThemeButton();
  document.getElementById('theme')?.addEventListener('click', () => setTheme(nextTheme()));

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'c') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;  // leave Cmd-C alone
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (document.activeElement.isContentEditable) return;
    e.preventDefault();
    setTheme(nextTheme());
  });
}

function initFaceToggle() {
  syncFaceButton();
  document.getElementById('face')?.addEventListener('click', () => setFace(nextFace()));

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 't') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (document.activeElement.isContentEditable) return;
    e.preventDefault();
    setFace(nextFace());
  });
}

/* --------------------------------------------------------------- shuffle --- */

function shuffle() {
  state.seed = newSeed();
  state.words = prepare(state.data.artists, state.seed, { weights: FACES[state.face].weights });

  // Advance ratios are measured at each word's *own* font weight, and a reshuffle
  // reassigns those weights. Reusing stale ratios would push rows past their
  // target width — the exact cause of the overlap fixed during the build.
  measure(state.words, css('--display'));

  styleNodes();
  render({ entrance: true });
  announce('Layout reshuffled');
}

function initShuffle() {
  document.getElementById('shuffle')?.addEventListener('click', shuffle);

  // Small public handle. `bandCloud.seed` is how you keep a composition you
  // like — reload with `?seed=<that number>` and you get it back exactly.
  // The rest is what tools/audit.js drives.
  window.bandCloud = {
    get seed() { return state.seed; },
    get face() { return state.face; },
    get theme() { return state.theme; },
    setTheme,
    themes: Object.keys(THEMES),
    get quality() { return state.quality; },
    get debug() { return state.debug; },
    set debug(v) { state.debug = Boolean(v); },
    shuffle,
    setFace,
    faces: Object.keys(FACES),
  };

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'r') return;
    // Leave Cmd-R / Ctrl-R alone — that's reload, and stealing it would be rude.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (document.activeElement.isContentEditable) return;
    e.preventDefault();
    shuffle();
  });
}

// The words don't change, only their arrangement, so nothing else would tell a
// screen reader anything happened.
function announce(msg) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = msg; });
}

/* -------------------------------------------------------------- parallax --- */

function observePointer() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

  const AMP = 3.5; // px at the far corner, for the frontmost tier
  let queued = false;
  let mx = 0;
  let my = 0;

  window.addEventListener('pointermove', (e) => {
    mx = (e.clientX / window.innerWidth - 0.5) * -2;
    my = (e.clientY / window.innerHeight - 0.5) * -2;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      wall.style.setProperty('--px', `${(mx * AMP).toFixed(2)}px`);
      wall.style.setProperty('--py', `${(my * AMP).toFixed(2)}px`);
    });
  }, { passive: true });
}

/* ---------------------------------------------------------------- render --- */

// Word elements are created once and never replaced, only restyled, so focus,
// the router's `lastFocus` reference, and any in-flight transition survive a
// reshuffle.
function createNodes() {
  const frag = document.createDocumentFragment();
  for (const w of state.words) {
    const el = document.createElement('a');
    el.className = 'word';
    el.href = `#/a/${w.id}`;
    el.textContent = w.name;
    el.dataset.id = w.id;
    // Size is the only thing carrying meaning, so state it for screen readers.
    el.setAttribute('aria-label', `${w.name}, seen ${w.count} ${w.count === 1 ? 'time' : 'times'}`);
    state.nodes.set(w.id, el);
    frag.appendChild(el);
  }
  wall.appendChild(frag);
}

// How strongly an accent asserts itself, by tier. A saturated hue on a 13px
// one-off name would out-shout a 76px headliner, inverting the hierarchy the
// tonal ramp exists to build — so low tiers keep most of their neutral.
//
// The mix is toward that tier's own ramp value, NOT toward --ground. Two
// reasons: color then reads as a hue shift at constant value rather than as a
// brightness drop, so it never fights the hierarchy; and the result's contrast
// is bounded below by the two endpoints, both of which clear 4.5:1, so accents
// can't quietly sink under AA the way mixing toward the background would.
const ACCENT_STRENGTH = [55, 65, 76, 88, 95, 100];

// Everything a reshuffle can change but a resize cannot. Kept separate from
// placement, which depends on the viewport and re-runs far more often.
function styleNodes() {
  for (const w of state.words) {
    const el = state.nodes.get(w.id);
    el.classList.toggle('is-accent', Boolean(w.accent));
    el.style.fontWeight = w.fontWeight;

    // Lightness by tier is the whole point — see the token block in app.css.
    const color = w.accent
      ? `color-mix(in srgb, var(${w.accent}) ${ACCENT_STRENGTH[w.tier]}%, var(--w${w.tier}))`
      : `var(--w${w.tier})`;
    el.style.color = color;
    // Hover lifts to the top of the ramp, or to the accent at full strength.
    el.style.setProperty('--hl', w.accent ? `var(${w.accent})` : 'var(--w5)');
  }
}

let entranceTimer = null;

function render({ entrance = false, pass = 0 } = {}) {
  performance.mark('layout:start');

  const width = wall.clientWidth;
  const top = wall.getBoundingClientRect().top + window.scrollY;
  const avail = Math.max(320, window.innerHeight - top);

  // Legibility floor — the second of the two bounds the solver takes the max of,
  // and the one that decides one-screen vs scrolling. It constrains the *solve*,
  // not the final pixel: per-row fitting can still shave a word by up to
  // `minShrink`, so the smallest thing actually rendered runs ~1px under this.
  //
  // At 1440×800 filling exactly one screen lands the tail at ~14px on its own,
  // so this doesn't bind and the whole wall fits. At 1024×768 filling one screen
  // would need ~11px, which is past readable — so it binds, the wall grows past
  // the fold, and the page scrolls. That's the correct answer: a window that
  // small genuinely cannot hold this many legible names at once.
  //
  // Per face, because a marker hand needs more size to stay readable than a
  // grotesque does.
  const minPx = FACES[state.face].minPx;

  const { placed, height, quality } = layout(state.words, { width, height: avail, minPx, seed: state.seed });

  // Layout self-scoring is only interesting when you're tuning the engine, so it
  // is computed always but surfaced only on request. `?debug` or
  // `bandCloud.debug = true` prints it; tools/audit.js reads the same numbers.
  state.quality = quality;
  if (state.debug) {
    console.log('[band-cloud] layout', {
      seed: state.seed, face: state.face, width, rows: quality.rows,
      ...quality, heightPx: Math.round(height), availPx: Math.round(avail),
    });
  }

  // The solver always overshoots the viewport a little — it stops at the first
  // scale whose rows stack past the fold, and rows are granular. When the
  // overshoot is small we're in the desktop "one screen" case, so clip it and
  // let the bottom row bleed exactly like the left and right edges, instead of
  // leaving a 20-odd pixel scrollbar stub. A real overflow still scrolls.
  const fits = height <= avail * 1.2;
  wall.classList.toggle('is-clipped', fits);
  wall.style.height = `${fits ? avail : height}px`;

  const cx = width / 2;
  const cy = Math.min(avail, height) / 2;
  const maxD = Math.hypot(cx, cy) || 1;

  for (const p of placed) {
    const el = state.nodes.get(p.word.id);
    const t = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px) rotate(${p.tilt.toFixed(2)}deg)`;
    el.style.fontSize = `${p.size.toFixed(2)}px`;
    el.style.setProperty('--t1', t);
    el.style.transform = t;

    // Parallax depth, assigned per row so a whole row slides as one unit and
    // neighbors never separate. Alternating direction by row makes the layers
    // read as depth rather than as the whole wall sliding.
    const dir = p.row % 2 ? -1 : 1;
    el.style.setProperty('--dp', (dir * (0.35 + ((p.row * 7) % 5) / 5 * 0.65)).toFixed(3));

    if (entrance) {
      el.style.setProperty('--t0', `translate(${p.x.toFixed(2)}px, ${(p.y + 14).toFixed(2)}px) rotate(${p.tilt.toFixed(2)}deg)`);
      const d = Math.hypot(p.x + p.size / 2 - cx, p.y - cy) / maxD;
      el.style.setProperty('--d', `${Math.round(d * 420)}ms`);
    }
  }

  performance.mark('layout:end');
  performance.measure('layout', 'layout:start', 'layout:end');

  // Scrollbar feedback: the width above was measured while the *previous*
  // layout's scrollbar was still on screen. Applying the new height can remove
  // (or add) that scrollbar, which changes the container width out from under
  // the solve and leaves rows short. Settle it with one corrective pass — never
  // more, or a width that oscillates between the two states would loop forever.
  if (pass === 0 && wall.clientWidth !== width) {
    render({ entrance, pass: 1 });
    return;
  }

  if (entrance) {
    clearTimeout(entranceTimer);
    // Removing and re-adding the class in one frame won't restart a running
    // animation; reading a layout property in between forces the flush that
    // makes the second add count. This is what lets a reshuffle replay the
    // settle rather than snapping into place.
    wall.classList.remove('is-entering');
    void wall.offsetWidth;
    wall.classList.add('is-entering');
    // Hand back to CSS transitions once the entrance is done, so later relayouts
    // animate to their new positions instead of replaying the entrance.
    entranceTimer = setTimeout(() => {
      wall.classList.remove('is-entering');
      wall.classList.add('is-live');
    }, 1200);
  }
}

/* ---------------------------------------------------------------- resize --- */

function observeResize() {
  let t = null;
  let lastW = wall.clientWidth;
  let lastH = window.innerHeight;

  const maybeRelayout = () => {
    const w = wall.clientWidth;
    const h = window.innerHeight;
    // Mobile browsers fire this constantly as the URL bar slides; only a real
    // width change (or a big height change) is worth a relayout.
    if (w === lastW && Math.abs(h - lastH) < 120) return;
    lastW = w; lastH = h;
    clearTimeout(t);
    t = setTimeout(() => render(), 100);
  };

  // The wall is always viewport-width, so a viewport change is the signal that
  // actually matters, and `resize` is the most universally delivered form of it.
  window.addEventListener('resize', maybeRelayout);

  // ResizeObserver as well, not instead: it catches width changes that never
  // touch the viewport — browser zoom, a container the folder gets embedded in,
  // a devtools pane opening. Both funnel through the same guard, so whichever
  // fires first wins and the other no-ops.
  if ('ResizeObserver' in window) new ResizeObserver(maybeRelayout).observe(wall);
}

boot().catch((err) => {
  console.error(err);
  wall.classList.remove('is-measuring');
  wall.innerHTML = `<p style="padding:2rem;color:#8a837a">Couldn't load the data: ${err.message}</p>`;
});
