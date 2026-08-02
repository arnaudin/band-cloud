/* router.js — hash routes and the detail panel.
 *
 * Hash routing rather than paths, so the whole thing works from any
 * subdirectory of any static host with no rewrite rules:
 *   #/a/earthless   #/v/great-american-music-hall   #/f/bonnaroo-2011
 */

const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
const scrim = document.getElementById('scrim');
const closeBtn = document.getElementById('panel-close');

let db = null;
let lastFocus = null;

/* ---------------------------------------------------------------- format --- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Built from parts, not `new Date(string)` — parsing "2013-03-17" as a string
// treats it as UTC and can render the day before in western timezones.
const asDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d || 1); };
const fmt = (iso, opts) => asDate(iso).toLocaleDateString('en-US', opts);

const longDate = (iso) =>
  fmt(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// The sheet records what was actually remembered: an exact day, a festival's
// run of days, sometimes only a month or a year. Render each at the precision
// it was given rather than inventing a day that was never recorded.
function showDate(s) {
  if (!s.date) return null;
  switch (s.datePrecision) {
    case 'day': return longDate(s.date);
    case 'range': {
      if (!s.dateEnd) return longDate(s.date);
      const sameMonth = s.date.slice(0, 7) === s.dateEnd.slice(0, 7);
      const from = fmt(s.date, sameMonth ? { month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric' });
      const to = fmt(s.dateEnd, sameMonth ? { day: 'numeric' } : { month: 'long', day: 'numeric' });
      return `${from}–${to}, ${s.date.slice(0, 4)}`;
    }
    case 'month': return fmt(`${s.date}-01`, { month: 'long', year: 'numeric' });
    case 'year': return s.date;
    default: return null;
  }
}

const yearOf = (s) => (s.date ? +s.date.slice(0, 4) : null);

function yearRange(shows) {
  const ys = shows.map(yearOf).filter(Boolean);
  if (!ys.length) return null;
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------- fragments --- */

function venueLine(show) {
  const v = show.venueId ? db.venue.get(show.venueId) : null;
  if (!v) return `<div class="show-venue">Venue not recorded</div>`;
  const city = v.city
    ? `<div class="show-city">${esc(v.city)}${v.region ? `, ${esc(v.region)}` : ''}${v.assumed ? ' <span class="assumed">(assumed)</span>' : ''}</div>`
    : '';
  return `<div class="show-venue"><a href="#/v/${esc(v.id)}">${esc(v.name)}</a></div>${city}`;
}

function dateLine(show) {
  const d = showDate(show);
  if (!d) return `<div class="show-date is-unknown">Date not recorded</div>`;
  // Flag anything coarser than a day, so a month or a year never reads as a
  // precise claim about when the show was.
  const vague = show.datePrecision === 'month' || show.datePrecision === 'year';
  return `<div class="show-date">${esc(d)}${vague ? ' <span class="approx">approx.</span>' : ''}</div>`;
}

function festivalBadge(show) {
  if (!show.festivalId) return '';
  const f = db.festival.get(show.festivalId);
  if (!f) return '';
  return `<a class="badge" href="#/f/${esc(f.id)}">${esc(f.name)}${f.year ? ` ${f.year}` : ''}</a>`;
}

function linkLine(show) {
  if (!show.links.length) return '';
  return `<div class="show-links">${show.links
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`)
    .join(' · ')}</div>`;
}

// The payoff of grouping rows into shows: who else was on the bill that night.
// `label` differs by context — on a band's page these are the *other* acts, on a
// venue or festival page they're simply the bill.
function lineupLine(show, exceptArtistId, label) {
  const others = show.lineup.filter((l) => l.artistId !== exceptArtistId);
  if (!others.length) return '';

  // A tour name usually belongs to the whole bill ("Villains World Tour" sits on
  // both acts that night). Repeating it after every name reads as noise, so a
  // note shared by everyone is hoisted out and printed once instead.
  const notes = others.map((l) => l.note || null);
  const shared = notes.length > 1 && notes.every((n) => n && n === notes[0]) ? notes[0] : null;

  const names = others.map((l) => {
    const a = db.artist.get(l.artistId);
    if (!a) return '';
    const tag = !shared && l.note ? ` <span class="show-tour">${esc(l.note)}</span>` : '';
    return `<a href="#/a/${esc(a.id)}">${esc(a.name)}</a>${tag}`;
  }).filter(Boolean);
  if (!names.length) return '';

  return `<div class="show-with">${esc(label)} ${names.join(', ')}</div>`
    + (shared ? noteLine(shared) : '');
}

function noteLine(text) {
  return text ? `<div class="show-note">${esc(text)}</div>` : '';
}

/* ----------------------------------------------------------------- views --- */

function artistView(a) {
  const shows = a.showIds.map((id) => db.show.get(id));
  const range = yearRange(shows);
  const sub = [
    `Seen ${plural(a.count, 'time', 'times')}`,
    range,
  ].filter(Boolean).join(' · ');

  const blocks = shows.map((s) => {
    const mine = s.lineup.find((l) => l.artistId === a.id);
    return `<section class="show">
      ${dateLine(s)}
      ${venueLine(s)}
      ${festivalBadge(s)}
      ${noteLine(mine && mine.note)}
      ${noteLine(s.note)}
      ${lineupLine(s, a.id, 'Also that night:')}
      ${linkLine(s)}
    </section>`;
  }).join('');

  return { kicker: 'Band', title: a.name, sub, blocks };
}

function showListView(shows, { kicker, title, sub }) {
  const blocks = shows.map((s) => `<section class="show">
    ${dateLine(s)}
    ${kicker === 'Venue' ? venueSideLine(s) : venueLine(s)}
    ${noteLine(s.note)}
    ${lineupLine(s, null, 'Played:')}
    ${linkLine(s)}
  </section>`).join('');
  return { kicker, title, sub, blocks };
}

// On a venue page the venue is the title, so the only thing left worth showing
// from the header is whether the night was part of a festival.
const venueSideLine = (s) => festivalBadge(s);

function venueView(v) {
  const shows = v.showIds.map((id) => db.show.get(id));
  const acts = new Set(shows.flatMap((s) => s.lineup.map((l) => l.artistId)));
  const sub = [
    v.city ? `${v.city}${v.region ? `, ${v.region}` : ''}${v.assumed ? ' (assumed)' : ''}` : null,
    plural(shows.length, 'night', 'nights'),
    plural(acts.size, 'band', 'bands'),
    yearRange(shows),
  ].filter(Boolean).join(' · ');
  return showListView(shows, { kicker: 'Venue', title: v.name, sub });
}

function festivalView(f) {
  const shows = f.showIds.map((id) => db.show.get(id));
  const acts = new Set(shows.flatMap((s) => s.lineup.map((l) => l.artistId)));
  const sub = [
    plural(shows.length, 'day', 'days'),
    plural(acts.size, 'band', 'bands'),
    yearRange(shows),
  ].filter(Boolean).join(' · ');
  const title = f.year ? `${f.name} ${f.year}` : f.name;
  return showListView(shows, { kicker: 'Festival', title, sub });
}

// Every venue, reachable from the masthead. Venue and festival pages already
// existed as routes but were only findable by guessing a name into search —
// this is the way in.
function venueIndexView() {
  const venues = [...db.venue.values()];
  const nights = venues.reduce((n, v) => n + v.showIds.length, 0);
  const rows = venues.map((v) => {
    const shows = v.showIds.map((id) => db.show.get(id));
    const acts = new Set(shows.flatMap((s) => s.lineup.map((l) => l.artistId)));
    const where = v.city ? `${v.city}${v.region ? `, ${v.region}` : ''}` : 'Location unknown';
    return `<a class="idx" href="#/v/${esc(v.id)}">
      <span class="idx-name">${esc(v.name)}</span>
      <span class="idx-meta">${esc(where)}</span>
      <span class="idx-count">${plural(acts.size, 'band', 'bands')}</span>
    </a>`;
  }).join('');

  return {
    kicker: 'Index',
    title: 'Venues',
    sub: `${plural(venues.length, 'venue', 'venues')} · ${plural(nights, 'night', 'nights')} · ${yearRange([...db.show.values()])}`,
    blocks: `<div class="idx-list">${rows}</div>`,
  };
}

/* ----------------------------------------------------------------- panel --- */

function openPanel(view) {
  panelBody.innerHTML = `
    <p class="panel-kicker">${esc(view.kicker)}</p>
    <h2 id="panel-title">${esc(view.title)}</h2>
    <p class="panel-sub">${esc(view.sub)}</p>
    ${view.blocks}`;

  if (panel.hidden) lastFocus = document.activeElement;
  panel.hidden = false;
  scrim.hidden = false;
  document.body.classList.add('panel-open');
  panel.scrollTop = 0;
  closeBtn.focus();
}

function closePanel() {
  if (panel.hidden) return;
  panel.hidden = true;
  scrim.hidden = true;
  document.body.classList.remove('panel-open');
  // Return focus to whatever opened it, if it's still on the page.
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

// Replace rather than push, so closing rewinds the panel entry instead of
// stacking a second one — otherwise Back lands the user right back in the panel.
export function dismiss() {
  if (!location.hash && panel.hidden) return;
  history.replaceState(null, '', location.pathname + location.search);
  route();
}

function route() {
  if (location.hash === '#/venues') { openPanel(venueIndexView()); return; }

  const m = /^#\/(a|v|f)\/(.+)$/.exec(location.hash);
  if (!m) { closePanel(); return; }

  const [, kind, id] = m;
  const decoded = decodeURIComponent(id);
  let view = null;

  if (kind === 'a' && db.artist.has(decoded)) view = artistView(db.artist.get(decoded));
  else if (kind === 'v' && db.venue.has(decoded)) view = venueView(db.venue.get(decoded));
  else if (kind === 'f' && db.festival.has(decoded)) view = festivalView(db.festival.get(decoded));

  if (!view) { dismiss(); return; }
  openPanel(view);
}

/* ------------------------------------------------------------------ init --- */

export function initPanel(data) {
  db = {
    artist: new Map(data.artists.map((a) => [a.id, a])),
    venue: new Map(data.venues.map((v) => [v.id, v])),
    festival: new Map(data.festivals.map((f) => [f.id, f])),
    show: new Map(data.shows.map((s) => [s.id, s])),
  };

  window.addEventListener('hashchange', route);
  closeBtn.addEventListener('click', dismiss);
  scrim.addEventListener('click', dismiss);

  document.addEventListener('keydown', (e) => {
    if (panel.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
    if (e.key !== 'Tab') return;

    const focusables = panel.querySelectorAll('a[href], button:not([disabled])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });

  route(); // honour a deep link on cold load
}
