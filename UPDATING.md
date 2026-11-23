# Updating the site

`source.csv` in the data repo is the source of truth. There is no spreadsheet
behind it any more: edit the CSV itself.

## The usual way: ask Claude

Tell Claude Code what you saw — "I saw Earthless at Central Machine Works,
Austin last night." The **add-show** skill (in the data repo at
`skills/add-show/`, linked into `~/.claude/skills/`) appends the row, matches
existing venue spellings, checks the build, pushes the data repo and watches the
deploy through to the live site.

## By hand

1. Edit `source.csv` in the data repo (`../band-cloud-data/source.csv`), not
   `data/source.csv` here. The file here is a symlink, and an editor that saves
   by replacing the file turns it into a plain file the data repo never sees.
2. Run the build (from the project root, Node 18+):
   ```bash
   node tools/build.mjs
   ```
3. Read what it prints, then read `REVIEW.md`.
4. Reload the page to check it locally.
5. Publish by committing and pushing the data repo:
   ```bash
   cd ../band-cloud-data && git add source.csv && git commit -m 'Add shows' && git push
   ```
   The site updates by itself in about a minute. See [Publishing](#publishing).

That's it for a normal update — **no code to touch.** `assets/data.json` is
generated and should never be hand-edited (the next build overwrites it).

The build prints a summary and refuses to write a broken file. If it exits with
`Build failed`, nothing was overwritten and the site keeps running on the last
good data.

## What's private

The repo is public, the show history isn't. These are gitignored:

| | |
|---|---|
| `data/source.csv` | the show history, one row per band (a symlink into the data repo) |
| `data/overrides.json` | your corrections, which name real bands and venues (also a symlink) |
| `assets/data.json` | built from those — same facts, so ignoring only the CSV would be pointless |
| `REVIEW.md` | open questions about the private data |

The real `source.csv` and `overrides.json` live in a separate private repo,
[arnaudin/band-cloud-data](https://github.com/arnaudin/band-cloud-data), checked
out next to this one. The symlinks let the build here read them without them
ever being in this repo. On a new machine:

```bash
git clone https://github.com/arnaudin/band-cloud-data ../band-cloud-data
ln -s ../../band-cloud-data/source.csv data/source.csv
ln -s ../../band-cloud-data/overrides.json data/overrides.json
```

Edit the files in `../band-cloud-data/`, not through the links: anything that
saves by replacing the file turns the link back into a plain file, and the data
repo never sees the change. `ls -l data/` shows `->` on both while they're
intact.

`data/sample.csv` and `data/sample.overrides.json` are committed in their place.
**The build falls back to them automatically**, so a fresh clone runs with no
setup and anyone reading the repo sees the engine work on invented data. The
real files win when present; the build prints a banner when it falls back to the
sample, so you always know which data you're looking at.

The consequence: **this repo can't deploy itself**, because the data it needs
isn't in it. GitHub Pages served straight from this repo would fetch a missing
`assets/data.json` and render "Couldn't load the data" instead of the wall. The
deploy runs from the data repo instead.

## Publishing

The live site at
[ryanarnaudin.com/sites/band-cloud](https://ryanarnaudin.com/sites/band-cloud/)
is `sites/band-cloud/` in the
[arnaudin.github.io](https://github.com/arnaudin/arnaudin.github.io) repo, and
it updates itself:

1. A push to `band-cloud-data` that changes `source.csv` or `overrides.json`
   runs its `Deploy Band Cloud to the site` workflow. A push here that changes
   `index.html`, `assets/` or the build scripts runs
   `.github/workflows/trigger-deploy.yml`, which asks the data repo to run the
   same deploy.
2. The deploy checks out both repos, runs `tools/build.mjs` and `tools/dist.mjs`,
   copies `dist/` over `sites/band-cloud/`, and commits that to the site repo.
3. That commit sets off the site repo's own build, which uploads to the server.

The workflow lives in the data repo, not here, because Actions logs on a public
repo are public and the build prints details of the private data. It refuses to
deploy if the real data is missing (the sample fallback would publish invented
bands), if the build has any warnings, or if anything outside
`sites/band-cloud/` would change.

Don't edit `sites/band-cloud/` in the site repo by hand; the next deploy
overwrites it. To redeploy without a change, use **Run workflow** on the data
repo's Actions tab. Setup and the token it needs are documented at the top of
its `.github/workflows/deploy.yml`.

`node tools/dist.mjs` still works locally if you want the deployable folder for
another host: it assembles `dist/` with `index.html` and `assets/` only, which
goes at any path on any static host with no server config.

---

## Adding a one-off show

The add-show skill handles this, including the rules below. When editing by
hand: the CSV format — columns, every accepted date format, and how venues and notes
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

Only for things a CSV row can't say on its own. It keeps corrections and
lookups out of the rows, so the CSV stays a plain record of each show.

| Section | For |
|---|---|
| `artistAliases` | two spellings of one band (`The Infamous Stringdusters` → `Infamous Stringdusters`) |
| `venueAliases` | two spellings of one venue (`Radio/East, Austin` → `Radio East, Austin`) |
| `cityRegions` | teaching a new city its state |
| `venueMeta` | a city you know but don't want in the CSV; `"assumed": true` marks a guess |
| `dateFixes` | a typo you'd rather not "correct" in the CSV |
| `venueIsFestival` | mapping a festival to its real site |
| `festivalNotes` | a Notes value that should become a festival |
| `cityHints` | a Notes value that is really a city — superseded by putting the city in the venue cell, kept for older rows |

Rebuild after editing this file — it is read at build time, not by the page.

Fixing the underlying row in the CSV is always better than adding an alias.
Aliases are for when both spellings are legitimately in use.

---

## Reading `REVIEW.md`

Regenerated every build, and gitignored — it describes the private data. It
holds, in order:

- **Counts** — artists, venues, festivals, shows, appearances, year span, and
  what the build did to the rows (dropped, deduplicated, corrected)
- **Venues with no city**, and locations the build *inferred* rather than read,
  marked *assumed*, for you to confirm
- **Flagged for review** — standing data questions from `overrides.json`
- **Artists seen more than once**
- **Build warnings**, if any — unparseable dates, missing overrides sections

Most of it is a to-do list, not errors. The exception is **Build warnings**:
the deploy refuses to publish while there are any, because each one is a row
that would go live wrong. The counts are
the fastest way to spot an import that went wrong: a sudden jump in venues or a
drop in appearances usually means a column shifted.

---

## Checking your work

The build asserts its own output and exits non-zero on regression, so a bad
edit can't quietly land.

After adding a lot of bands at once, it's worth confirming the wall still packs
cleanly: paste `tools/audit.js` into the browser console and run `__sweep(25)`.
See [README.md](README.md#auditing-the-layout) for what the numbers mean.

Adding `?debug` to the URL logs each layout's self-scoring, which is the quickest
way to see whether a growing list is straining the packer.
