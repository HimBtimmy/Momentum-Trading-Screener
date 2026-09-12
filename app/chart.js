/* ============================================================================
 * chart.js — annotated candlestick SVG, shared by the screener app and the
 * executive-summary build. UMD: window.QMChart in the browser, require() in Node.
 *
 * Marks       : hollow body = up session, filled body = down session, so
 *               direction is never carried by colour alone.
 * Overlays    : 10EMA (blue), 20EMA (orange), 50SMA (violet) — 2px lines.
 * Annotations : base rectangle, pivot, entry, stop, one marker per fill.
 * Theming     : every colour is a CSS custom property from the host page.
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QMChart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);

  function renderChart(opt) {
    const {
      bars, from, to, ema10, ema20, sma50,
      baseRect, pivot, entry, stop, markers = [], shades = [],
      width = 960, priceH = 330, volH = 76, title, subtitle, id
    } = opt;

    const PADL = 8, PADR = 74, PADT = 16, PADB = 26;
    const win = bars.slice(from, to + 1);
    const n = win.length;
    const plotW = width - PADL - PADR;
    const dx = plotW / n;
    const bodyW = Math.max(2.2, Math.min(7, dx * 0.62));

    const lowsHighs = win.flatMap(b => [b.high, b.low]);
    const extras = [pivot, entry, stop].filter(v => Number.isFinite(v));
    const overlayVals = [ema10, ema20, sma50].flatMap(a => a ? a.slice(from, to + 1).filter(Number.isFinite) : []);
    let lo = Math.min(...lowsHighs, ...extras, ...overlayVals);
    let hi = Math.max(...lowsHighs, ...extras, ...overlayVals);
    const padY = (hi - lo) * 0.06;
    lo -= padY; hi += padY;

    const x = (i) => PADL + dx * (i + 0.5);
    const y = (v) => PADT + priceH - (v - lo) / (hi - lo) * priceH;
    const maxVol = Math.max(...win.map(b => b.volume));
    const volTop = PADT + priceH + 22;
    const vy = (v) => volTop + volH - (v / maxVol) * volH;

    const out = [];
    const totalH = PADT + priceH + 22 + volH + PADB;
    out.push(`<svg class="qm-chart" viewBox="0 0 ${width} ${totalH}" role="img" ` +
      `aria-label="${esc(title || 'price chart')}" data-x0="${f2(PADL)}" data-dx="${f2(dx)}" ` +
      `data-from="${from}" data-n="${n}" data-ph="${PADT + priceH}" id="${esc(id || '')}">`);

    /* ---- shaded regions (market-context bands) ---------------------------- */
    for (const s of shades) {
      const a = s.fromIdx - from, b = s.toIdx - from;
      if (b < 0 || a > n) continue;
      const xa = PADL + dx * Math.max(0, a), xb = PADL + dx * Math.min(n, b + 1);
      out.push(`<rect x="${f2(xa)}" y="${PADT}" width="${f2(xb - xa)}" height="${priceH}" ` +
        `fill="var(--qm-shade)" />`);
      if (s.label) out.push(`<text class="qm-shade-label" x="${f2((xa + xb) / 2)}" y="${PADT + 11}" ` +
        `text-anchor="middle">${esc(s.label)}</text>`);
    }

    /* ---- y grid ----------------------------------------------------------- */
    const ticks = niceTicks(lo, hi, 5);
    for (const t of ticks) {
      out.push(`<line class="qm-grid" x1="${PADL}" y1="${f2(y(t))}" x2="${f2(PADL + plotW)}" y2="${f2(y(t))}" />`);
      out.push(`<text class="qm-axis" x="${f2(PADL + plotW + 6)}" y="${f2(y(t) + 3.2)}">${f2(t)}</text>`);
    }

    /* ---- x axis: first session of each month ------------------------------ */
    let lastMonth = null;
    win.forEach((b, i) => {
      const m = b.date.slice(0, 7);
      if (m !== lastMonth) {
        lastMonth = m;
        if (i > 1) out.push(`<line class="qm-grid-v" x1="${f2(x(i))}" y1="${PADT}" x2="${f2(x(i))}" y2="${f2(volTop + volH)}" />`);
        out.push(`<text class="qm-axis" x="${f2(x(i))}" y="${f2(volTop + volH + 15)}" text-anchor="middle">` +
          `${esc(monthLabel(b.date))}</text>`);
      }
    });

    /* ---- the base rectangle ----------------------------------------------- */
    if (baseRect) {
      const a = baseRect.fromIdx - from, b = baseRect.toIdx - from;
      const xa = PADL + dx * Math.max(0, a), xb = PADL + dx * Math.min(n, b + 1);
      out.push(`<rect class="qm-base" x="${f2(xa)}" y="${f2(y(baseRect.high))}" width="${f2(xb - xa)}" ` +
        `height="${f2(Math.abs(y(baseRect.low) - y(baseRect.high)))}" rx="2" />`);
      // the band under the base floor is always empty in the base's own x-range
      out.push(`<text class="qm-note" x="${f2(xa)}" y="${f2(y(baseRect.low) + 13)}">${esc(baseRect.label)}</text>`);
    }

    /* ---- volume ----------------------------------------------------------- */
    const volAvg = [];
    for (let i = 0; i < win.length; i++) {
      const s = win.slice(Math.max(0, i - 19), i + 1);
      volAvg.push(s.reduce((a, b) => a + b.volume, 0) / s.length);
    }
    win.forEach((b, i) => {
      const up = b.close >= b.open;
      out.push(`<rect class="qm-vol ${up ? 'up' : 'dn'}" x="${f2(x(i) - bodyW / 2)}" y="${f2(vy(b.volume))}" ` +
        `width="${f2(bodyW)}" height="${f2(volTop + volH - vy(b.volume))}" />`);
    });
    out.push(`<path class="qm-volavg" d="${volAvg.map((v, i) => `${i ? 'L' : 'M'}${f2(x(i))} ${f2(vy(v))}`).join(' ')}" />`);
    out.push(`<text class="qm-axis" x="${f2(PADL + plotW + 6)}" y="${f2(volTop + 10)}">vol</text>`);

    /* ---- moving averages -------------------------------------------------- */
    const maLine = (arr, cls) => {
      if (!arr) return;
      const pts = [];
      for (let i = from; i <= to; i++) if (Number.isFinite(arr[i])) pts.push(`${pts.length ? 'L' : 'M'}${f2(x(i - from))} ${f2(y(arr[i]))}`);
      if (pts.length > 1) out.push(`<path class="qm-ma ${cls}" d="${pts.join(' ')}" />`);
    };
    maLine(sma50, 'ma50');
    maLine(ema20, 'ma20');
    maLine(ema10, 'ma10');

    /* ---- candles ---------------------------------------------------------- */
    win.forEach((b, i) => {
      const up = b.close >= b.open;
      const yo = y(b.open), yc = y(b.close);
      const top = Math.min(yo, yc), h = Math.max(1.2, Math.abs(yc - yo));
      out.push(`<g class="qm-candle ${up ? 'up' : 'dn'}">` +
        `<line x1="${f2(x(i))}" y1="${f2(y(b.high))}" x2="${f2(x(i))}" y2="${f2(y(b.low))}" />` +
        `<rect x="${f2(x(i) - bodyW / 2)}" y="${f2(top)}" width="${f2(bodyW)}" height="${f2(h)}" />` +
        `</g>`);
    });

    /* ---- levels ----------------------------------------------------------- */
    /* Entry sits a fraction above the pivot, so at chart scale the two lines and
     * their labels would collide. Merge anything closer than 0.4% and stack the
     * remaining labels in the left gutter with a guaranteed 13px gap.          */
    const levels = [];
    const addLevel = (v, cls, label) => { if (Number.isFinite(v)) levels.push({ v, cls, label }); };
    const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) / b < 0.004;
    if (near(entry, pivot)) {
      addLevel(pivot, 'pivot', `pivot ${f2(pivot)}`);
      addLevel(entry, 'entry', `entry ${f2(entry)} (+${f2((entry / pivot - 1) * 100)}%)`);
    } else {
      addLevel(pivot, 'pivot', `pivot ${f2(pivot)}`);
      addLevel(entry, 'entry', `entry ${f2(entry)}`);
    }
    addLevel(stop, 'stop', `stop ${f2(stop)}`);

    for (const L of levels) {
      out.push(`<line class="qm-level ${L.cls}" x1="${PADL}" y1="${f2(y(L.v))}" x2="${f2(PADL + plotW)}" y2="${f2(y(L.v))}" />`);
    }
    // stack the labels downward from the highest level, never overlapping
    const sorted = levels.map(L => ({ ...L, y0: y(L.v) })).sort((a, b) => a.y0 - b.y0);
    let cursorY = -Infinity;
    for (const L of sorted) {
      let ly = Math.max(L.y0 - 4, cursorY + 13);
      cursorY = ly;
      const w = L.label.length * 5.5 + 10;
      out.push(`<g class="qm-level-tag ${L.cls}">` +
        `<rect x="${f2(PADL + 3)}" y="${f2(ly - 9.5)}" width="${f2(w)}" height="13" rx="2" />` +
        `<text x="${f2(PADL + 8)}" y="${f2(ly)}">${esc(L.label)}</text></g>`);
    }

    /* ---- fill markers ----------------------------------------------------- */
    markers.forEach((m) => {
      const i = m.idx - from;
      if (i < 0 || i >= n) return;
      const cy = y(m.price);
      const cls = m.kind === 'entry' ? 'entry' : m.kind === 'loss' ? 'loss' : 'exit';
      out.push(`<g class="qm-marker ${cls}">` +
        `<circle cx="${f2(x(i))}" cy="${f2(cy)}" r="5.5" />` +
        `<line x1="${f2(x(i))}" y1="${f2(cy)}" x2="${f2(x(i) + (m.dx || 0))}" y2="${f2(cy + (m.dy || -22))}" />` +
        `<text x="${f2(x(i) + (m.dx || 0) + (m.anchor === 'end' ? -6 : 6))}" y="${f2(cy + (m.dy || -22) + 3)}" ` +
        `text-anchor="${m.anchor || 'start'}">${esc(m.label)}</text></g>`);
    });

    out.push('</svg>');
    return out.join('\n');
  }

  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
    const out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(+t.toFixed(6));
    return out;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthLabel(iso) {
    const [y, m] = iso.split('-');
    return MONTHS[+m - 1] + (m === '01' ? ` '${y.slice(2)}` : '');
  }

  /* The CSS the figures rely on. Emitted once per page. */
  const CHART_CSS = `
  .qm-chart { width: 100%; height: auto; display: block; overflow: visible; }
  .qm-grid { stroke: var(--rule-faint); stroke-width: 1; }
  .qm-grid-v { stroke: var(--rule-faint); stroke-width: 1; stroke-dasharray: 2 4; }
  .qm-axis { fill: var(--ink-muted); font: 500 10px var(--font-mono); font-variant-numeric: tabular-nums; }
  .qm-shade { opacity: 1; }
  .qm-shade-label { fill: var(--ink-muted); font: 500 9.5px var(--font-mono); letter-spacing: .06em; }
  .qm-candle line { stroke-width: 1.1; }
  .qm-candle.up line, .qm-candle.up rect { stroke: var(--qm-up); }
  .qm-candle.dn line, .qm-candle.dn rect { stroke: var(--qm-dn); }
  .qm-candle.up rect { fill: var(--surface); stroke-width: 1.1; }
  .qm-candle.dn rect { fill: var(--qm-dn); stroke-width: .8; }
  .qm-vol { opacity: .5; }
  .qm-vol.up { fill: var(--qm-up); }
  .qm-vol.dn { fill: var(--qm-dn); }
  .qm-volavg { fill: none; stroke: var(--ink-muted); stroke-width: 1.2; opacity: .8; }
  .qm-ma { fill: none; stroke-width: 2; stroke-linejoin: round; }
  .qm-ma.ma10 { stroke: var(--qm-ma10); }
  .qm-ma.ma20 { stroke: var(--qm-ma20); }
  .qm-ma.ma50 { stroke: var(--qm-ma50); }
  .qm-base { fill: var(--qm-base-fill); stroke: var(--qm-base-stroke); stroke-width: 1; stroke-dasharray: 3 3; }
  .qm-note { fill: var(--ink-secondary); font: 500 10px var(--font-mono); }
  .qm-level { stroke-width: 1.4; stroke-dasharray: 6 4; }
  .qm-level.pivot { stroke: var(--qm-ma50); }
  .qm-level.entry { stroke: var(--status-good); }
  .qm-level.stop { stroke: var(--status-critical); }
  .qm-level-tag text { font: 600 10px var(--font-mono); font-variant-numeric: tabular-nums; }
  .qm-level-tag rect { fill: var(--surface); opacity: .92; }
  .qm-level-tag.pivot text { fill: var(--qm-ma50); }
  .qm-level-tag.entry text { fill: var(--status-good); }
  .qm-level-tag.stop text { fill: var(--status-critical); }
  .qm-marker circle { fill: var(--surface); stroke-width: 2.2; }
  .qm-marker line { stroke-width: 1; }
  .qm-marker text { font: 600 10px var(--font-mono); }
  .qm-marker.entry circle, .qm-marker.entry line { stroke: var(--ink-primary); }
  .qm-marker.entry text { fill: var(--ink-primary); }
  .qm-marker.exit circle, .qm-marker.exit line { stroke: var(--status-good); }
  .qm-marker.exit text { fill: var(--status-good); }
  .qm-marker.loss circle, .qm-marker.loss line { stroke: var(--status-critical); }
  .qm-marker.loss text { fill: var(--status-critical); }
  `;

  return { renderChart: renderChart, CHART_CSS: CHART_CSS };
});
