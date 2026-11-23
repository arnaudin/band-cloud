---
name: add-show
description: Add a concert to Ryan's Band Cloud site and stage it in his local site repo. Use when he gives a band, date, and venue (e.g. "add Earthless at Central Machine Works, Austin last night", "I saw X at Y"). Appends to the source CSV, rebuilds, and copies the build into the local arnaudin.github.io repo for him to review and commit. Never commits or pushes.
---

# add-show

Input: band, date, venue (city optional but wanted). Optional notes (tour name, openers).

## Paths

- Project: `/Users/ryanarnaudin/Documents/Claude/band-cloud`
- Data: `data/source.csv` (gitignored, private). Columns: `Band,Date,Venue or Festival,Notes`
- Site repo: `/Users/ryanarnaudin/Documents/GitHub/arnaudin.github.io`, target folder `sites/band-cloud/`

## Steps

1. **Resolve the date** to `M/D/YYYY`, no zero padding. Convert relative dates ("last night") from today's date.
2. **Format the venue as `Venue, City`**, no state (`Central Machine Works, Austin`). Check `data/source.csv` for the venue or city already in use and match its spelling exactly, so no alias is needed. If the city is unknown and not in the CSV, ask.
   - Festivals are the exception: put `Festival Year` in the venue column and tell Ryan it needs a `venueIsFestival` entry in `data/overrides.json` (see UPDATING.md). Ask what physical place it maps to.
3. **One row per band.** If he names several bands for one night, add one row each with the same date and venue.
4. **Append the row.** The CSV may lack a trailing newline: check with `tail -c 50 data/source.csv | od -c` and write a leading `\n` if needed. Quote the venue if it contains a comma. Leave Notes empty unless given.
   ```
   Earthless,11/21/2026,"Central Machine Works, Austin",
   ```
5. **Rebuild** from the project root: `node tools/build.mjs`. Confirm 0 warnings and that appearances rose by the number of rows added. If it prints `Build failed` or warnings, stop and report.
6. **Assemble dist:** `node tools/dist.mjs`.
7. **Copy into the site repo:**
   ```bash
   rsync -a --delete /Users/ryanarnaudin/Documents/Claude/band-cloud/dist/ \
     /Users/ryanarnaudin/Documents/GitHub/arnaudin.github.io/sites/band-cloud/
   ```
   Then `git status --short sites` in the site repo; expect only `sites/band-cloud/assets/data.json` modified. Flag anything else.

## Rules

- Do not commit or push in either repo. Ryan reviews and commits; GitHub automation publishes.
- The site repo usually has unrelated uncommitted changes. Tell him to stage only `sites/band-cloud/`.
- `data/source.csv`, `assets/data.json` and `REVIEW.md` are private: don't paste their contents beyond the new row.
- Report: the row added, the artist's appearance count, and that nothing is committed.
