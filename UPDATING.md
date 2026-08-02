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

The CSV format — columns, every accepted date format, and how venues and notes
are parsed — is documented in [README.md](README.md#csv-format). It is the
reference; this file is the routine.

Two things worth repeating, because they are the easiest to get wrong:

- **One row per band, not per show.** Same date + same venue groups them into
  one night automatically.
- **Put the city in the venue cell** — `Radio East, Austin`. A new venue in a
  new town then needs no configuration at all.

### Festivals are the one exception

Put the festival in the venue column with its year — `Outside Lands 2016`,
`FloydFest 2012` — then add it once to `venueIsFestival` in
`data/overrides.json` so it gets its own page and a real location:

```json
"FloydFest 2012": {
  "festival": "FloydFest", "year": 2012,
  "venue": "FloydFest Grounds, Floyd, VA"
}
```

This needs a config edit because only you know what physical place a festival
name refers to.

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

The build asserts its own output and exits non-zero on regression, so a bad
export can't quietly land.

After adding a lot of bands at once, it's worth confirming the wall still packs
cleanly: paste `tools/audit.js` into the browser console and run `__sweep(25)`.
See [README.md](README.md#auditing-the-layout) for what the numbers mean.
