#!/usr/bin/env node
// Builds assets/data.json (and REVIEW.md) from data/source.csv + data/overrides.json.
//
//   node tools/build.mjs
//
// No dependencies. source.csv is the source of truth — re-export the sheet over it
// and rebuild; every correction lives in overrides.json and is re-applied each run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts) => join(ROOT, ...parts);

// The real history is gitignored, so a fresh clone has only the sample pair.
// Falling back keeps `node tools/build.mjs` working immediately after clone
// instead of failing on a missing file someone can't obtain.
function pick(realPath, samplePath, label) {
  if (existsSync(p(realPath))) return { path: p(realPath), sample: false };
  if (existsSync(p(samplePath))) return { path: p(samplePath), sample: true };
  console.error(`\n  Missing both ${realPath} and ${samplePath} — cannot build ${label}.\n`);
  process.exit(1);
}

const csvSrc = pick('data/source.csv', 'data/sample.csv', 'the show data');
const ovSrc = pick('data/overrides.json', 'data/sample.overrides.json', 'the corrections');
const usingSample = csvSrc.sample || ovSrc.sample;

/* ------------------------------------------------------------------ csv --- */

// Minimal RFC 4180 parser. Quoted fields matter here: "Crosby, Stills & Nash"
// and "The Pub, Harrisonburg" both carry commas inside the field.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { endField(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) endRow();

  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r, idx) => {
      const o = { _row: idx + 2 }; // 1-based, +1 for the header line
      header.forEach((h, j) => { o[h] = (r[j] ?? '').trim(); });
      return o;
    });
}

/* ------------------------------------------------------------- helpers --- */

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

function slugify(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')          // elide, don't split: Slim's -> slims
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Sort key: drop a leading article so "The Avett Brothers" files under A.
const sortKey = (name) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9 ]/g, '');

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

const pad = (n) => String(n).padStart(2, '0');
const sane = (y) => y >= 1950 && y <= 2100;

// Real sheets don't hold one date format. A multi-day festival gets written as a
// range, a show you only half-remember gets a month or a year, and sometimes you
// just type it out longhand. Parsing only M/D/YYYY silently turned all of those
// into "undated", which then also split each row into its own show.
//
// Returns { date, end, precision } — precision is one of
// day | range | month | year, or null if genuinely unreadable.
function parseDate(raw) {
  const s = raw.trim();
  if (!s) return null;
  let m;

  // 7/26/2012
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    const [, mo, d, y] = m;
    return sane(+y) ? { date: `${y}-${pad(mo)}-${pad(d)}`, end: null, precision: 'day' } : null;
  }

  // 7/26-29/2012 — range inside one month
  if ((m = /^(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{4})$/.exec(s))) {
    const [, mo, d1, d2, y] = m;
    return sane(+y)
      ? { date: `${y}-${pad(mo)}-${pad(d1)}`, end: `${y}-${pad(mo)}-${pad(d2)}`, precision: 'range' }
      : null;
  }

  // 9/30-10/2/2016 — range crossing a month boundary
  if ((m = /^(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    const [, m1, d1, m2, d2, y] = m;
    return sane(+y)
      ? { date: `${y}-${pad(m1)}-${pad(d1)}`, end: `${y}-${pad(m2)}-${pad(d2)}`, precision: 'range' }
      : null;
  }

  // December 7, 2002
  if ((m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
    const idx = MONTHS.indexOf(m[1].toLowerCase());
    return idx >= 0 && sane(+m[3])
      ? { date: `${m[3]}-${pad(idx + 1)}-${pad(m[2])}`, end: null, precision: 'day' }
      : null;
  }

  // November 2023
  if ((m = /^([A-Za-z]+)\s+(\d{4})$/.exec(s))) {
    const idx = MONTHS.indexOf(m[1].toLowerCase());
    return idx >= 0 && sane(+m[2])
      ? { date: `${m[2]}-${pad(idx + 1)}`, end: null, precision: 'month' }
      : null;
  }

  // 11/2023
  if ((m = /^(\d{1,2})\/(\d{4})$/.exec(s))) {
    return sane(+m[2]) ? { date: `${m[2]}-${pad(m[1])}`, end: null, precision: 'month' } : null;
  }

  // 2003
  if ((m = /^(\d{4})$/.exec(s))) {
    return sane(+m[1]) ? { date: m[1], end: null, precision: 'year' } : null;
  }

  return null;
}

// The sheet increasingly writes venues as "Name, City" or "Name, City, ST".
// Reading that directly means a new one-off in a new town needs no hand-added
// metadata — just type the city in the cell and it lands on the venue page.
//
// "Austin, TX" is the ambiguous case: two parts where the second is a state
// code means a city was recorded with no venue, not a venue called Austin.
function splitVenue(raw, cityRegions) {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return { name: parts[0] ?? null, city: null, region: null };
  if (parts.length === 2) {
    if (/^[A-Z]{2}$/.test(parts[1])) return { name: null, city: parts[0], region: parts[1] };
    return { name: parts[0], city: parts[1], region: cityRegions[parts[1]] ?? null };
  }
  return { name: parts[0], city: parts[1], region: parts[2] };
}

/* --------------------------------------------------------------- build --- */

const csv = parseCsv(readFileSync(csvSrc.path, 'utf8'));
const ov = JSON.parse(readFileSync(ovSrc.path, 'utf8'));

// Defaults, so a hand-written overrides file may omit sections it doesn't need.
for (const k of ['artistAliases', 'venueAliases', 'cityRegions', 'venueMeta',
  'dateFixes', 'venueIsFestival', 'festivalNotes', 'cityHints']) ov[k] ??= {};
ov.review ??= { notes: [] };
ov.review.notes ??= [];

const stats = { rows: csv.length, droppedBlank: 0, deduped: 0, dateFixed: 0 };
const warnings = [];

const artists = new Map();   // id -> { id, name, sort, count, showIds }
const venues = new Map();    // id -> { id, name, city, region, assumed, showIds }
const festivals = new Map(); // id -> { id, name, year, showIds }
const shows = new Map();     // id -> { ..., lineup, links }

const seen = new Set();

for (const r of csv) {
  const rawArtist = collapse(r.Band || '');
  if (!rawArtist) { stats.droppedBlank++; continue; }

  const artistName = ov.artistAliases[rawArtist] ?? rawArtist;
  const artistId = slugify(artistName);

  // --- date -------------------------------------------------------------
  let rawDate = collapse(r.Date || '');
  if (ov.dateFixes[rawDate]) { rawDate = ov.dateFixes[rawDate]; stats.dateFixed++; }
  const parsed = rawDate ? parseDate(rawDate) : null;
  const date = parsed ? parsed.date : null;
  if (rawDate && !parsed) warnings.push(`Row ${r._row}: unparseable date "${rawDate}" (${artistName})`);

  // --- venue / festival -------------------------------------------------
  let rawVenue = collapse(r['Venue or Festival'] || '');
  let festivalName = null;
  let festivalYear = null;

  const asFestival = ov.venueIsFestival[rawVenue];
  if (asFestival) {
    festivalName = asFestival.festival;
    festivalYear = asFestival.year;
    rawVenue = asFestival.venue;
  }

  // Alias on the sheet's exact string first, then split off any trailing city.
  const aliased = rawVenue ? (ov.venueAliases[rawVenue] ?? rawVenue) : '';
  const split = aliased ? splitVenue(aliased, ov.cityRegions) : { name: null, city: null, region: null };

  // An alias may also apply to the bare name, so "Slims, San Francisco" still
  // becomes Slim's. Re-split the alias target rather than using it whole: some
  // aliases carry a city themselves, and using the raw target as a name is how
  // you end up with a venue called "Virginia Tech, Blacksburg".
  let venueName = split.name;
  if (venueName && ov.venueAliases[venueName]) {
    const re = splitVenue(ov.venueAliases[venueName], ov.cityRegions);
    venueName = re.name ?? venueName;
    split.city = split.city ?? re.city;
    split.region = split.region ?? re.region;
  }
  const venueId = venueName ? slugify(venueName) : null;

  // --- note: festival tag / link / city hint / appearance note ----------
  const rawNote = collapse(r.Notes || '');
  let note = null;
  let link = null;
  let cityHint = null;

  if (rawNote) {
    if (/^https?:\/\//i.test(rawNote)) {
      let label = 'setlist';
      try { label = new URL(rawNote).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
      link = { label, url: rawNote };
    } else if (ov.festivalNotes[rawNote]) {
      festivalName = ov.festivalNotes[rawNote].festival;
      festivalYear = date ? Number(date.slice(0, 4)) : null;
    } else if (ov.cityHints[rawNote]) {
      cityHint = ov.cityHints[rawNote];
    } else {
      note = rawNote;
    }
  }

  // --- dedup (after normalization, so Slims/Slim's collapse) ------------
  const dedupKey = `${artistId}|${date ?? ''}|${venueId ?? ''}`;
  if (seen.has(dedupKey)) { stats.deduped++; continue; }
  seen.add(dedupKey);

  // --- show grouping ----------------------------------------------------
  // Dated rows at the same venue are the same night. Undated rows are never
  // merged — a shared night would be a guess, so each keeps its own show.
  const showId = date
    ? `${date}--${venueId ?? 'unknown'}`
    : `undated--${venueId ?? 'unknown'}--${artistId}`;

  if (!shows.has(showId)) {
    shows.set(showId, {
      id: showId,
      date,
      dateEnd: parsed ? parsed.end : null,
      datePrecision: parsed ? parsed.precision : 'unknown',
      venueId,
      festivalId: null,
      note: null,
      lineup: [],
      links: [],
    });
  }
  const show = shows.get(showId);

  if (festivalName) {
    const fid = slugify(festivalYear ? `${festivalName} ${festivalYear}` : festivalName);
    show.festivalId = fid;
    if (!festivals.has(fid)) {
      festivals.set(fid, { id: fid, name: festivalName, year: festivalYear, showIds: [] });
    }
    if (!festivals.get(fid).showIds.includes(showId)) festivals.get(fid).showIds.push(showId);
  }

  if (link && !show.links.some((l) => l.url === link.url)) show.links.push(link);
  show.lineup.push({ artistId, note });

  // --- entities ---------------------------------------------------------
  if (!artists.has(artistId)) {
    artists.set(artistId, { id: artistId, name: artistName, sort: sortKey(artistName), count: 0, showIds: [] });
  }
  const a = artists.get(artistId);
  a.count++;
  if (!a.showIds.includes(showId)) a.showIds.push(showId);

  if (venueId) {
    if (!venues.has(venueId)) {
      // The sheet's own "Name, City" wins over overrides.venueMeta — it's the
      // more recently edited source, and it's where new one-offs arrive.
      const meta = ov.venueMeta[venueId] ?? {};
      const city = split.city ?? meta.city ?? null;
      const region = split.region ?? (split.city ? ov.cityRegions[split.city] : null) ?? meta.region ?? null;
      venues.set(venueId, {
        id: venueId,
        name: venueName,
        city,
        region,
        assumed: !split.city && meta.assumed === true,
        showIds: [],
      });
      if (!city) warnings.push(`Venue "${venueName}" (${venueId}) has no city — add one in the sheet as "${venueName}, City"`);
    }
    const v = venues.get(venueId);
    if (!v.showIds.includes(showId)) v.showIds.push(showId);
    if (split.city && !v.city) { v.city = split.city; v.region = split.region; v.assumed = false; }
    if (cityHint && !v.city) { v.city = cityHint.city; v.region = cityHint.region; v.assumed = true; }
  } else if (split.city) {
    // A row that recorded only a city — keep it on the show rather than
    // inventing a venue named after the town.
    show.note = show.note ?? [split.city, split.region].filter(Boolean).join(', ');
  } else if (cityHint) {
    show.note = `${cityHint.city}, ${cityHint.region}`;
  }
}

/* ---------------------------------------------------------------- sort --- */

const byDateDesc = (a, b) => (b.date ?? '').localeCompare(a.date ?? '');
const showList = [...shows.values()].sort(byDateDesc);
for (const s of showList) {
  // Preserve CSV order within a lineup — it tends to reflect the bill.
  s.lineup = s.lineup.filter((x, i, arr) => arr.findIndex((y) => y.artistId === x.artistId) === i);
}
for (const a of artists.values()) a.showIds.sort((x, y) => byDateDesc(shows.get(x), shows.get(y)));
for (const v of venues.values()) v.showIds.sort((x, y) => byDateDesc(shows.get(x), shows.get(y)));
for (const f of festivals.values()) f.showIds.sort((x, y) => byDateDesc(shows.get(x), shows.get(y)));

const data = {
  generated: new Date().toISOString().slice(0, 10),
  artists: [...artists.values()].sort((a, b) => a.sort.localeCompare(b.sort)),
  venues: [...venues.values()].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name))),
  festivals: [...festivals.values()].sort((a, b) => a.name.localeCompare(b.name)),
  shows: showList,
};

/* ----------------------------------------------------------- assertions --- */

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

check(data.artists.length > 0, 'no artists produced');
check(data.artists.every((a) => a.name.trim() !== ''), 'blank artist name present');
check(data.artists.every((a) => a.count >= 1), 'artist with zero appearances');
check(new Set(data.artists.map((a) => a.id)).size === data.artists.length, 'duplicate artist id');
check(new Set(data.venues.map((v) => v.id)).size === data.venues.length, 'duplicate venue id');
check(new Set(data.shows.map((s) => s.id)).size === data.shows.length, 'duplicate show id');
check(data.shows.every((s) => s.lineup.length > 0), 'show with an empty lineup');

const appearances = data.shows.reduce((n, s) => n + s.lineup.length, 0);
check(appearances === data.artists.reduce((n, a) => n + a.count, 0), 'appearance count mismatch between shows and artists');

for (const s of data.shows) {
  for (const l of s.lineup) check(artists.has(l.artistId), `show ${s.id} references unknown artist ${l.artistId}`);
  if (s.venueId) check(venues.has(s.venueId), `show ${s.id} references unknown venue ${s.venueId}`);
  if (s.festivalId) check(festivals.has(s.festivalId), `show ${s.id} references unknown festival ${s.festivalId}`);
}

if (problems.length) {
  console.error('\nBuild failed:\n' + problems.map((x) => `  ✗ ${x}`).join('\n') + '\n');
  process.exit(1);
}

/* -------------------------------------------------------------- output --- */

writeFileSync(p('assets', 'data.json'), JSON.stringify(data));

const dated = data.shows.filter((s) => s.date);
const years = dated.map((s) => Number(s.date.slice(0, 4)));
const span = [Math.min(...years), Math.max(...years)];
const repeats = data.artists.filter((a) => a.count > 1).sort((a, b) => b.count - a.count);

const review = [
  '# REVIEW — open data questions',
  '',
  `Generated ${data.generated} by \`tools/build.mjs\`. Answer these in \`data/source.csv\``,
  'or `data/overrides.json`, then rebuild.',
  '',
  '## Counts',
  '',
  `- **${data.artists.length}** artists`,
  `- **${data.venues.length}** venues`,
  `- **${data.festivals.length}** festivals`,
  `- **${data.shows.length}** shows (${dated.length} dated, ${data.shows.length - dated.length} undated)`,
  `- **${appearances}** appearances, ${span[0]}–${span[1]}`,
  `- ${stats.rows} CSV rows in · ${stats.droppedBlank} blank-artist rows dropped · ${stats.deduped} duplicates collapsed · ${stats.dateFixed} dates corrected`,
  '',
  '## Venues with no city',
  '',
  ...(data.venues.filter((v) => !v.city).length
    ? data.venues.filter((v) => !v.city).map((v) => `- [ ] **${v.name}** — where was this?`)
    : ['- none']),
  '',
  '## Assumed venue locations',
  '',
  ...(data.venues.filter((v) => v.assumed && v.city).length
    ? data.venues.filter((v) => v.assumed && v.city).map((v) => `- [ ] **${v.name}** — assumed ${v.city}, ${v.region}. Correct?`)
    : ['- none']),
  '',
  '## Flagged for review',
  '',
  ...ov.review.notes.flatMap((n) => [`- [ ] **${n.topic}** — ${n.detail}`, '']),
  '## Artists seen more than once',
  '',
  ...repeats.map((a) => `- ${a.name} — ${a.count}×`),
  '',
  ...(warnings.length ? ['## Build warnings', '', ...warnings.map((w) => `- ${w}`), ''] : []),
].join('\n');

writeFileSync(p('REVIEW.md'), review + '\n');

const kb = (Buffer.byteLength(JSON.stringify(data)) / 1024).toFixed(1);
if (usingSample) {
  console.log(`
  ── Built from SAMPLE data ─────────────────────────────────────────
     ${csvSrc.sample ? 'data/sample.csv' : 'data/source.csv'} + ${ovSrc.sample ? 'data/sample.overrides.json' : 'data/overrides.json'}
     Every band and venue below is invented. Drop your own export at
     data/source.csv to build the real thing.
  ───────────────────────────────────────────────────────────────────`);
}
console.log(`
  artists      ${data.artists.length}
  venues       ${data.venues.length}
  festivals    ${data.festivals.length}
  shows        ${data.shows.length}  (${dated.length} dated, ${data.shows.length - dated.length} undated)
  appearances  ${appearances}   ${span[0]}–${span[1]}

  rows in ${stats.rows} · dropped ${stats.droppedBlank} blank · collapsed ${stats.deduped} dupes · fixed ${stats.dateFixed} dates
  ${warnings.length} warning(s) → REVIEW.md

  assets/data.json  ${kb} KB
`);
