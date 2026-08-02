# Updating the site

## The whole loop

1. Edit the Google Sheet.
2. **File → Download → CSV**, and save it over `data/source.csv`.
3. Run the build:
   ```bash
   cd ~/Documents/Claude/band-cloud && node tools/build.mjs
   ```
4. Read what it prints, then read `REVIEW.md`.
5. Reload the page. Done.

To publish, also:

```bash
node tools/dist.mjs        # assembles dist/ — index.html + assets/ only
```

and upload `dist/`. It goes at any path on any static host; every reference is
relative and routing is hash-based, so there's no server config.

That's it for a normal update — **no code to touch.** The sheet is the source of
truth; `assets/data.json` is generated and should never be hand-edited (the next
build overwrites it).

The build prints a summary and refuses to write a broken file. If it exits with
`Build failed`, nothing was overwritten and the site keeps running on the last
good data.

## What's private

The repo is public, the show history isn't. These are gitignored:

| | |
|---|---|
| `data/source.csv` | the export from your sheet |
| `data/overrides.json` | your corrections, which name real bands and venues |
| `assets/data.json` | built from those — same facts, so ignoring only the CSV would be pointless |
| `REVIEW.md` | open questions about the private data |

`data/sample.csv` and `data/sample.overrides.json` are committed in their place.
**The build falls back to them automatically**, so a fresh clone runs with no
setup and anyone reading the repo sees the engine work on invented data. When
the real files are present they win, and the build says which pair it used.

The consequence: **the repo can't deploy itself**, because the data it needs
isn't in it. That's why `tools/dist.mjs` exists — build locally, upload `dist/`.
GitHub Pages served straight from this repo would show an empty wall.

---

## Adding a one-off show

Add one row per **band**, not per show. Two bands on the same night at the same
venue = two rows with the same date and venue; the build groups them back into
one show and they'll show up on each other's page as "Also that night".

| Band | Date | Venue or Festival | Notes |
|---|---|---|---|
| `Mdou Moctar` | `9/24/2025` | `Radio East, Austin` | |

### Date — all of these work

| You write | Reads as |
|---|---|
| `9/24/2025` | exact day |
| `December 7, 2002` | exact day |
| `7/26-29/2012` | a run of days (festivals) |
| `9/30-10/2/2016` | a run crossing a month |
| `11/2023` or `November 2023` | just the month — shown as "approx." |
| `2003` | just the year — shown as "approx." |
| *(blank)* | "Date not recorded" |

A date containing a comma (`December 7, 2002`) has to be quoted in the CSV.
Google Sheets does that for you on export — it only bites if you hand-edit the
file.

Anything coarser than a day is labelled **approx.** in the drawer, so a vague
memory never reads as a precise claim.

Undated rows are **never merged into a shared night**, even at the same venue —
that would be inventing a fact. Two undated rows at The NorVa stay two entries
until you give them a date.

### Venue — put the city right in the cell

| You write | Result |
|---|---|
| `Radio East, Austin` | venue *Radio East*, city Austin, TX |
| `Boar's Nest Cafe, Harrisonburg, VA` | venue, city, state |
| `The Fillmore` | venue with no city — flagged in REVIEW.md |
| `Austin, TX` | city only, no venue named |

The state fills itself in for cities already in `cityRegions` (Austin, SF,
Charlottesville, Blacksburg…). A two-letter code as the *second* part means
"city, state with no venue" — that's why `Austin, TX` doesn't create a venue
called Austin.

**A brand new venue in a brand new town needs nothing but this cell.** Type the
city and it lands on the venue page with the right location.

### Festivals

Put the festival in the venue column with its year — `Outside Lands 2016`,
`FloydFest 2012` — and add it once to `venueIsFestival` in
`data/overrides.json` so it gets its own page and a real site:

```json
"FloydFest 2012": {
  "festival": "FloydFest", "year": 2012,
  "venue": "FloydFest Grounds, Floyd, VA"
}
```

This is the one case that needs a config edit, because only you know what
physical place a festival name refers to.

### Notes

The Notes column does several jobs, sorted out automatically:

- **A tour or billing** → shown under that band's entry.
  *`Villains World Tour`, `Second night of a two-night stand`*
  When every act that night carries the same note, it's printed once for the
  show rather than repeated after each name.
- **A festival name** listed in `festivalNotes` → becomes a festival badge.
  *`Bridge School Benefit`, `Warped Tour`*
- **A URL** → becomes a link. *setlist.fm etc.*
- **Anything else** → free text on the show.

---

## When to edit `data/overrides.json`

Only for things the sheet can't say on its own. It exists so a fresh export
never wipes out cleanup work.

| Section | For |
|---|---|
| `artistAliases` | two spellings of one band (`The Infamous Stringdusters` → `Infamous Stringdusters`) |
| `venueAliases` | two spellings of one venue (`Radio/East, Austin` → `Radio East, Austin`) |
| `cityRegions` | teaching a new city its state |
| `venueMeta` | a city you know but don't want in the sheet; `"assumed": true` marks a guess |
| `dateFixes` | a typo you'd rather not "correct" in the sheet |
| `venueIsFestival` | mapping a festival to its real site |
| `festivalNotes` | a Notes value that should become a festival |

Fixing the underlying row in the sheet is always better than adding an alias.
Aliases are for when both spellings are legitimately in use.

---

## Reading `REVIEW.md`

Regenerated every build. It's the list of things the build **would not guess**:

- venues with no city
- locations it inferred (marked *assumed*) that you should confirm
- standing data questions

Nothing here breaks the site — it's a to-do list, not errors. Work through it
when you feel like it.

---

## Checking your work

The build asserts its own output (no duplicate ids, no orphan references, no
empty lineups, artist and show counts in agreement) and exits non-zero on
regression.

If you add a lot of bands at once and want to confirm the wall still packs
cleanly, see the auditor section in `README.md` — paste `tools/audit.js` into
the browser console and run `__sweep(25)`.

---

## Serving it locally

```bash
cd ~/Documents/Claude/band-cloud && python3 -m http.server 8146
```

Then <http://localhost:8146>. It must be served over HTTP — opening
`index.html` as a `file://` URL gives a blank wall, because the page fetches
`assets/data.json` and uses ES modules, both of which browsers block on
`file://`.
