/* audit.js — layout auditor for the word wall.
 *
 * The wall's whole promise is "no whitespace, no collisions", and that promise
 * is not checkable by eye. Two real bugs got through visual review and were only
 * caught here: tilted words colliding with the row above (because rotation is
 * about the top-left corner, so a negative tilt swings *up*), and the leftover
 * row landing mid-wall at 35% ink with 166px gutters. Both looked fine in a
 * screenshot.
 *
 * It also exists because the layout is random per visit. Checking one
 * arrangement proves nothing about the next one — only a sweep does.
 *
 * USAGE — paste into the browser console on the running page:
 *
 *   __audit()             one arrangement, current viewport
 *   __sweep(50)           reshuffle and audit 50 times, accumulating
 *   __report()            worst-case summary of everything swept so far
 *   __sweepFaces(30)      the same sweep across every typeface
 *   __runs                the raw rows, if you want to dig
 *
 * Re-paste after any reload. Resize the window between sweeps to cover
 * viewports — the numbers that matter are the worst case across all of them.
 *
 * NOTE: no requestAnimationFrame anywhere in here on purpose. Browsers suspend
 * rAF while a tab or preview pane is hidden, which hangs the sweep forever.
 * getBoundingClientRect forces a synchronous layout flush, so no frame wait is
 * needed regardless.
 */

(() => {
  const OVERLAP_MIN = 0.10;  // ignore slivers; below this it's antialiasing
  const SPARSE_BAND = 0.5;   // a band covering less than this is "sparse"
  const BAND_PX = 8;

  const rects = () => [...document.getElementById('wall').children].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      n: el.textContent,
      l: r.left + scrollX, t: r.top + scrollY,
      r: r.right + scrollX, b: r.bottom + scrollY,
      a: r.width * r.height,
    };
  });

  window.__audit = () => {
    const wall = document.getElementById('wall');
    const R = rects();

    // Overlaps, via a y-sweep. Naive all-pairs is tens of thousands of
    // comparisons per run and blows a console time budget over a long sweep.
    const S = [...R].sort((a, b) => a.t - b.t);
    let pairs = 0, worst = 0, worstPair = null;
    for (let i = 0; i < S.length; i++) {
      const A = S[i];
      for (let j = i + 1; j < S.length && S[j].t < A.b; j++) {
        const B = S[j];
        const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l); if (ox <= 0) continue;
        const oy = Math.min(A.b, B.b) - Math.max(A.t, B.t); if (oy <= 0) continue;
        const f = (ox * oy) / Math.min(A.a, B.a);
        if (f > OVERLAP_MIN) { pairs++; if (f > worst) { worst = f; worstPair = `${A.n} / ${B.n}`; } }
      }
    }

    // Coverage, band by band. A lone sparse band is just leading between rows;
    // a *run* of them is a hole, which is why the gap is reported in pixels.
    const top = wall.getBoundingClientRect().top + scrollY;
    const H = parseFloat(wall.style.height);
    const bands = [];
    for (let y = top; y < top + H; y += BAND_PX) {
      const segs = R.filter((w) => w.t < y + BAND_PX && w.b > y)
        .map((w) => [Math.max(w.l, 0), Math.min(w.r, innerWidth)])
        .sort((a, b) => a[0] - b[0]);
      let cov = 0, end = -1;
      for (const [s, e] of segs) { if (e <= end) continue; cov += e - Math.max(s, end); end = e; }
      bands.push(cov / innerWidth);
    }
    let run = 0, maxRun = 0;
    for (const b of bands) { if (b < SPARSE_BAND) { run++; maxRun = Math.max(maxRun, run); } else run = 0; }

    const sizes = [...document.getElementById('wall').children].map((e) => parseFloat(e.style.fontSize));
    const q = window.bandCloud?.quality || {};

    return {
      seed: window.bandCloud?.seed, face: window.bandCloud?.face,
      vp: `${innerWidth}x${innerHeight}`,
      overlaps: pairs, worstOverlap: +worst.toFixed(2), worstPair,
      avgCov: +(bands.reduce((a, b) => a + b, 0) / bands.length).toFixed(3),
      maxGapPx: maxRun * BAND_PX,
      minSize: +Math.min(...sizes).toFixed(1), maxSize: +Math.max(...sizes).toFixed(1),
      clampedRows: q.clampedRows, lastRowGrowth: q.lastRowGrowth && +q.lastRowGrowth.toFixed(2),
      hScroll: document.documentElement.scrollWidth - innerWidth,
    };
  };

  window.__runs = window.__runs || [];

  window.__sweep = (n = 40) => {
    for (let i = 0; i < n; i++) { window.bandCloud.shuffle(); window.__runs.push(window.__audit()); }
    return window.__report();
  };

  window.__sweepFaces = async (n = 30) => {
    for (const face of window.bandCloud.faces) {
      await window.bandCloud.setFace(face);
      for (let i = 0; i < n; i++) { window.bandCloud.shuffle(); window.__runs.push(window.__audit()); }
    }
    return window.__reportBy('face');
  };

  const summarize = (runs) => {
    const col = (k) => runs.map((r) => r[k]);
    const pick = (k, cmp) => runs.reduce((a, b) => (cmp(b[k], a[k]) ? b : a));
    const gappiest = pick('maxGapPx', (x, y) => x > y);
    const worstOv = pick('worstOverlap', (x, y) => x > y);
    const hist = {};
    for (const r of runs) { const k = Math.round(r.maxGapPx / 10) * 10; hist[k] = (hist[k] || 0) + 1; }
    return {
      n: runs.length,
      runsWithOverlap: runs.filter((r) => r.overlaps > 0).length,
      maxOverlapPairs: Math.max(...col('overlaps')),
      worstOverlap: worstOv.worstOverlap, worstPair: worstOv.worstPair,
      coverage: { min: Math.min(...col('avgCov')), max: Math.max(...col('avgCov')) },
      maxGapPx: { worst: gappiest.maxGapPx, seed: gappiest.seed, histogram: hist },
      size: { min: Math.min(...col('minSize')), max: Math.max(...col('maxSize')) },
      hScrollEver: Math.max(...col('hScroll')),
    };
  };

  window.__report = () => summarize(window.__runs);

  window.__reportBy = (key) => {
    const groups = {};
    for (const r of window.__runs) (groups[r[key]] ||= []).push(r);
    return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, summarize(v)]));
  };

  console.log('[audit] ready — __audit() · __sweep(n) · __sweepFaces(n) · __report() · __reportBy("face"|"vp")');
})();
