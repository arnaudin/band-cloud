# Band Cloud

Every band I've seen live, as a word cloud. Click a name for when and where;
search to jump straight to a band, venue or festival.

201 bands · 36 venues · 8 festivals · 159 nights · 2001–2020

## Stack

None. Static HTML, CSS and ES modules — no framework, no dependencies, no
external requests at runtime. Two self-hosted webfonts (60KB total). The only
Node in the project is the data tooling, and it has no packages either.

Everything uses relative paths, so the built folder can be dropped at any subpath
of any static host (`/shows/`, `/concerts/`, wherever) with no configuration.
Routing is hash-based for the same reason — no rewrite rules required.

```
index.html
assets/          runtime — styles, ES modules, fonts, generated data.json
data/            source CSV + corrections (the real pair is gitignored)
tools/           build.mjs · dist.mjs · audit.js
```

## Running it

```bash
node tools/build.mjs                          # data/*.csv -> assets/data.json
python3 -m http.server 8146                   # then open localhost:8146
```

A fresh clone works immediately: the real show history is private, so the build
falls back to the committed `data/sample.csv` and you get a working wall of
invented bands. See [UPDATING.md](UPDATING.md#whats-private).

It must be served over HTTP — opening `index.html` as a `file://` URL gives a
blank wall, because the page fetches `assets/data.json` and uses ES modules,
both of which browsers block on `file://`.

## Updating the data

**See [UPDATING.md](UPDATING.md)** for the full workflow and the accepted date
and venue formats. The short version:

```bash
# save the sheet's CSV export over data/source.csv, then
node tools/build.mjs
```

`data/source.csv` is the source of truth. `assets/data.json` is generated —
never hand-edit it. Corrections live in `data/overrides.json`, separate from the
CSV, so a fresh export never discards cleanup work.

The build asserts its own output (no duplicate ids, no orphan references, no
empty lineups, artist and show appearance counts in agreement) and exits
non-zero on regression without overwriting anything. Whatever it can't resolve
confidently goes to `REVIEW.md` as a checklist rather than being guessed at —
**read that file after each rebuild.**

## Layout

`assets/cloud.js` is the wall engine. Coverage is a property of the algorithm
rather than of tuning:

- every row is packed to a target 7% wider than the container, then scaled and
  gap-justified to land exactly on it, so no row can end short;
- a binary search sets one global type scale from the larger of two bounds —
  the smallest scale whose rows stack past the fold, and a legibility floor.
  On a wide screen the first wins and all 201 names land in one screen; on a
  phone the floor wins and the wall grows past the fold and scrolls.

The organic feel is layered on top of that guarantee: rows are size-homogeneous
but shuffled in order, sizes gradate continuously instead of in six steps,
words float in whatever vertical slack their row has, and wide words tilt by
however much that slack can absorb.

Sizing: how often a band was seen sets a floor tier (4× and 3× are always
large), and per-name variation spreads the 172 bands seen once across the
smaller tiers. Colour follows the same hierarchy — the more often seen, the
likelier a name carries an accent.

## Colour

Two themes, toggled with the half-circle chip or `C`, remembered in
`localStorage`.

- **Ink & Ash** (default) — near-black, warm greys, colour used sparingly.
- **Marquee** — tungsten bulbs on a theatre front; one hue family, all the
  variation in temperature and value.

The structural idea in both is a **tonal ramp**: tier drives *lightness*, not
just size (`--w0`…`--w5`). Before this, 172 of the 201 words rendered at full
bone and the wall read as a sheet of white with size doing all the work alone.
Now the one-off names recede toward the ground and the repeats come forward, so
value and scale reinforce each other.

Accents are mixed toward *that tier's own ramp value*, never toward the
background. Colour then reads as a hue shift at roughly constant lightness
rather than as a brightness drop, so it never fights the hierarchy — and the
result's contrast is bounded below by two endpoints that both clear AA, so an
accent can't quietly sink out of legibility.

Every word in both themes lands between **4.7:1 and 16:1** on its ground. That
constrains the design: the ramp wants to go darker at the bottom, but tiers 0–1
are ~146 of the 201 words, so a prettier floor would put most of the page under
AA. 4.7 is as dark as the tail is allowed to go.

## Typefaces

Two self-hosted faces, toggled with the `Aa` chip or `T`, remembered in
`localStorage`. The button is always set in the face you'd switch *to*, so it
previews its own result.

- **Oswald** (default) — variable 300–700, condensed grotesque. 28KB.
- **Permanent Marker** — marker on a wall. 29KB.

Each face carries its own typographic budget in `FACES` (`assets/app.js`) rather
than sharing global constants, because they aren't interchangeable: the marker
hand is a single weight, so there is no weight range to build tonal texture
from, and it needs a higher legibility floor (17px vs 13px) to stay readable at
the tail. Switching re-derives the words from the *same* seed, so the
composition survives and only the type changes.

Both are the Google Fonts `latin` subset (U+0000–00FF), which covers every name
in the data with room for future ones. Licences in `assets/fonts/LICENSES.md`.

## Randomness

Every load composes the wall afresh: sizes, weights, colours, tilt, row
composition and position all reshuffle. The 29 bands seen 2–4× stay pinned to
the large tiers by their play count, because that is the one thing on the page
carrying information. The 172 seen once are free to trade places — their sizes
were arbitrary to begin with — so the long tail gets its turn at being featured.

Shuffle in place with the `↻` button beside the stats, or press `R`.

The seed is per *session*, not per layout: `render()` re-runs on every resize, so
a resize reflows the same composition rather than scrambling it.

To keep a layout you like, read `bandCloud.seed` in the console and reload with
`?seed=<that number>`. That parameter is read but never written — auto-writing it
on shuffle would make the next reload reproduce the same wall, which is the whole
thing randomness exists to avoid.

### Why the leftover row is pinned to the bottom

`packRows` emits a final remainder row that is short by construction. It can be
stretched but not reliably filled, so it is held out of the row shuffle and
always placed last. Anywhere else it reads as a hole — measured at ~35% ink with
166px gutters against 86% and 6–12px for a healthy row. At the bottom it is
either clipped away entirely (the one-screen case) or reads as the ragged last
line of a justified column, which is just correct typesetting.

This only became visible once the layout was randomised. With the old fixed seed
that row happened to land somewhere harmless, which is a good argument for
auditing across seeds rather than eyeballing one.

## Auditing the layout

`tools/audit.js` — paste into the browser console on the running page:

```
__audit()          one arrangement, current viewport
__sweep(50)        reshuffle and audit 50 times
__report()         worst-case summary
__sweepFaces(25)   the same, across every typeface
__reportBy('vp')   group results by viewport
```

It measures pairwise glyph-box overlap (via a y-sweep, since all-pairs is 20k
comparisons a run) and horizontal coverage band by band. **This is not
decoration — it has caught two real bugs that passed visual review**: tilted
words colliding with the row above, and the leftover row landing mid-wall at 35%
ink. Both looked fine in a screenshot. And since the layout is now random per
visit, checking one arrangement proves nothing about the next.

Layout self-scoring (`clampedRows`, `worstFit`, `lastRowGrowth`) is always
computed but only surfaced on request — add `?debug` to the URL, or set
`bandCloud.debug = true`.

### Verified across seeds

130 seeds at three viewports, plus 50 more across both faces:

| | 1440×800 | 1024×768 | 390×844 | Marker face |
|---|---|---|---|---|
| Runs with any overlap | 2 / 50 | 2 / 40 | 3 / 40 | 2 / 25 |
| Worst overlap | 13% | 12% | 11% | 11% |
| Coverage range | .799–.863 | .822–.881 | .873–.918 | .832–.874 |
| Largest gap | 40px | 32px | 32px | 48px |
| Horizontal scroll | never | never | never | never |

The residual overlaps are axis-aligned bounding boxes on tilted words, where the
boxes intersect but the glyphs don't. Marker runs a looser gap spread than the
grotesque because it's a much wider face — fewer words per row means coarser row
granularity — but its coverage floor is actually higher.

## Motion

Two rules learned the hard way:

**Hover changes no geometry.** A scale on hover jitters badly here — with
`transform-origin` at `0 0` the box grows right and down, moving its own hit-edge
out from under the cursor, which drops hover, which shrinks it back, which
re-enters hover. On a wall this dense the grown box also steals hover from the
word beside it. The lift is a value lift instead: the hovered word climbs to the
top of the tonal ramp.

**Parallax depth is per row, not per word.** Depth by word meant neighbours in
the same row slid at different rates — up to 0.75× amplitude of relative
movement, which is more than the few pixels of gap between small adjacent words,
so they collided as the pointer moved. Measured at the far corner: 10 of 12
arrangements had overlapping words (worst 28%) versus 1 of 12 with the pointer
centred. Rows now slide as rigid units and the vertical component is uniform, so
nothing moves relative to anything it could touch — overlap counts are now
identical whether the pointer is centred or at double amplitude.

That second one is an auditing lesson as much as a layout one: every earlier
sweep ran without the pointer having moved, so `--px` was 0 and the entire
problem was invisible to both the audit and the screenshots.

### Known limits

Word rotation is capped at a few degrees. Full 90° verticals are incompatible
with justified-row packing — a rotated name needs vertical room equal to its
own width, which either breaks the coverage guarantee or blows out row heights.
Adding them would mean treating verticals as multi-row column blocks placed
before the rows are packed.

## Background

`assets/haze.js` paints a static, very low-contrast wash today. It is written
as the seam for the phase-2 idea — a live-lightshow / liquid-projection
visualization — with the legibility budget already pinned down: a master
`--haze-intensity` dial in CSS, a per-source alpha ceiling, and motion gated on
`prefers-reduced-motion` and tab visibility. See the comment at the top of the
file.

## Licence

Code is MIT — see [LICENSE](LICENSE). Two exceptions, both noted there:

- The bundled fonts keep their own licences (SIL OFL 1.1 and Apache 2.0), with
  full texts in [`assets/fonts/`](assets/fonts/LICENSES.md).
- The real concert history is personal and is not in this repository.
  `data/sample.csv` is invented placeholder data.
