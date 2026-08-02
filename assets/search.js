/* search.js — autocomplete over bands, venues and festivals.
 *
 * ~245 entries, so scoring every one on every keystroke is far cheaper than
 * any index a library would build. No dependency needed at this size.
 */

import { dismiss } from './router.js';

const input = document.getElementById('search-input');
const list = document.getElementById('search-results');
const wall = document.getElementById('wall');

const MAX = 8;

let entries = [];
let results = [];
let cursor = -1;

/* ------------------------------------------------------------ normalize --- */

// Strip diacritics and punctuation so "Sigur Ros", "sigur rós" and "sigur-ros"
// all reach the same key — the data has both accented and plain spellings.
const norm = (s) => s
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const deArticle = (s) => s.replace(/^(the|a|an) /, '');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------------------------------------------------------- score --- */

// Higher is better; null means no match. The ladder is deliberate: what someone
// typed the start of should always beat what merely contains it somewhere.
function score(e, q) {
  const n = e.norm;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 900 - n.length * 0.1;
  if (e.bare.startsWith(q)) return 860 - n.length * 0.1;

  for (const w of e.words) if (w.startsWith(q)) return 700 - n.length * 0.1;

  // Acronyms: "kgatlw" -> King Gizzard and the Lizard Wizard, "rhcp", "nin"
  if (q.length >= 2 && e.acronym.startsWith(q)) return 640;

  const at = n.indexOf(q);
  if (at > -1) return 500 - at;

  // Last resort: in-order subsequence, scored by how tightly packed it is, so
  // "gizz" beats an accidental scatter across a long name.
  let i = 0, first = -1, last = -1;
  for (let c = 0; c < n.length && i < q.length; c++) {
    if (n[c] === q[i]) { if (first < 0) first = c; last = c; i++; }
  }
  if (i < q.length) return null;
  return 200 - (last - first);
}

function search(raw) {
  const q = norm(raw);
  if (!q) return [];
  const hits = [];
  for (const e of entries) {
    const s = score(e, q);
    if (s !== null) hits.push({ e, s: s + Math.min(e.weight, 12) });
  }
  hits.sort((a, b) => b.s - a.s || a.e.name.length - b.e.name.length);
  return hits.slice(0, MAX).map((h) => h.e);
}

/* --------------------------------------------------------------- render --- */

function highlight(name, raw) {
  const q = norm(raw);
  if (!q) return esc(name);
  // Map the normalized match back onto the original string by walking both.
  const n = norm(name);
  const at = n.indexOf(q);
  if (at < 0) return esc(name);
  let ni = 0, start = -1, end = -1;
  for (let i = 0; i < name.length; i++) {
    const c = norm(name[i]);
    if (!c) { if (ni > 0 && ni <= n.length && n[ni] === ' ') ni++; continue; }
    if (ni === at && start < 0) start = i;
    ni += c.length;
    if (ni >= at + q.length && end < 0) { end = i + 1; break; }
  }
  if (start < 0 || end < 0) return esc(name);
  return `${esc(name.slice(0, start))}<b>${esc(name.slice(start, end))}</b>${esc(name.slice(end))}`;
}

const KIND_LABEL = { a: 'Band', v: 'Venue', f: 'Festival' };

function draw(raw) {
  if (!results.length) {
    list.innerHTML = raw.trim()
      ? `<li class="r-empty">Nothing matches &ldquo;${esc(raw.trim())}&rdquo;</li>`
      : '';
    list.hidden = !raw.trim();
    input.setAttribute('aria-expanded', String(!list.hidden));
    return;
  }
  list.innerHTML = results.map((e, i) => `
    <li role="option" id="r-${i}" aria-selected="${i === cursor}" data-href="#/${e.kind}/${esc(e.id)}">
      <span class="r-name">${highlight(e.name, raw)}</span>
      <span class="r-meta">${KIND_LABEL[e.kind]} · ${esc(e.meta)}</span>
    </li>`).join('');
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  if (cursor >= 0) input.setAttribute('aria-activedescendant', `r-${cursor}`);
  else input.removeAttribute('aria-activedescendant');
}

/* ------------------------------------------------------- wall highlight --- */

// Typing also dims the wall to just the matches. Searching a *venue* lights up
// every band that played there, which is the nicest thing the index can do.
function paintWall() {
  const ids = new Set();
  for (const e of results) e.artistIds.forEach((id) => ids.add(id));

  wall.classList.toggle('is-filtered', results.length > 0);
  for (const el of wall.children) {
    el.classList.toggle('is-match', ids.has(el.dataset.id));
  }
}

function clearWall() {
  wall.classList.remove('is-filtered');
  for (const el of wall.children) el.classList.remove('is-match');
}

/* ----------------------------------------------------------------- wire --- */

function go(i) {
  const e = results[i];
  if (!e) return;
  input.value = '';
  results = [];
  cursor = -1;
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  clearWall();
  input.blur();
  location.hash = `#/${e.kind}/${e.id}`;
}

export function initSearch(data) {
  const showsById = new Map(data.shows.map((s) => [s.id, s]));
  const artistsOf = (showIds) => {
    const out = new Set();
    for (const id of showIds) {
      const s = showsById.get(id);
      if (s) for (const l of s.lineup) out.add(l.artistId);
    }
    return [...out];
  };

  const build = (kind, id, name, meta, weight, artistIds) => {
    const n = norm(name);
    return {
      kind, id, name, meta, weight, artistIds,
      norm: n,
      bare: deArticle(n),
      words: n.split(' ').filter(Boolean),
      acronym: n.split(' ').filter(Boolean).map((w) => w[0]).join(''),
    };
  };

  entries = [
    ...data.artists.map((a) => build('a', a.id, a.name,
      a.count === 1 ? 'seen once' : `seen ${a.count}×`, a.count, [a.id])),
    ...data.venues.map((v) => build('v', v.id, v.name,
      `${v.showIds.length} ${v.showIds.length === 1 ? 'night' : 'nights'}`,
      v.showIds.length, artistsOf(v.showIds))),
    ...data.festivals.map((f) => build('f', f.id, f.year ? `${f.name} ${f.year}` : f.name,
      `${f.showIds.length} ${f.showIds.length === 1 ? 'day' : 'days'}`,
      f.showIds.length, artistsOf(f.showIds))),
  ];

  input.addEventListener('input', () => {
    results = search(input.value);
    cursor = results.length ? 0 : -1;
    draw(input.value);
    if (input.value.trim()) paintWall(); else clearWall();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      draw(input.value);
      list.children[cursor]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (cursor >= 0) { e.preventDefault(); go(cursor); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value) { input.value = ''; results = []; cursor = -1; draw(''); clearWall(); }
      else input.blur();
    }
  });

  list.addEventListener('mousedown', (e) => {
    // mousedown, not click — blur would tear the list down first.
    const li = e.target.closest('li[role="option"]');
    if (li) { e.preventDefault(); go([...list.children].indexOf(li)); }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); clearWall(); }, 120);
  });
  input.addEventListener('focus', () => {
    // Searching is always a way *out* of a detail view, never something that
    // happens behind one — otherwise the wall highlight is hidden by the scrim.
    dismiss();
    if (input.value.trim()) { draw(input.value); paintWall(); }
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
