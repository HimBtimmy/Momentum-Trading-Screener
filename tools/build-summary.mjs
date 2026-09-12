/* ============================================================================
 * build-summary.mjs — renders the executive summary to HTML and Markdown.
 *   node tools/build-summary.mjs
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { META, SECTIONS, SOURCES } from './summary-content.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QM = require(path.join(ROOT, 'app/engine.js'));
const { renderChart, CHART_CSS } = require(path.join(ROOT, 'app/chart.js'));
const examples = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/examples-2026.json'), 'utf8'));
const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/case-results.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pc = (x, d = 1) => (x >= 0 ? '' : '') + x.toFixed(d) + '%';
const rr = (x) => (x >= 0 ? '+' : '') + x.toFixed(2) + 'R';

/* inline markup ----------------------------------------------------------- */
function inlineHtml(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
}
const inlineMd = (s) => s;

/* ---------------------------------------------------------------- figures */
function buildFigure(caseData, res) {
  const bars = caseData.bars;
  const idxOfDate = (d) => bars.findIndex(b => b.date === d);
  const closes = bars.map(b => b.close);
  const ema10 = QM.ema(closes, 10), ema20 = QM.ema(closes, 20), sma50 = QM.sma(closes, 50);
  const tIdx = res.triggerIdx;
  const from = Math.max(0, tIdx - 95);
  const to = Math.min(bars.length - 1, Math.max(tIdx + 40, idxOfDate(res.trade.exitDate) + 8));

  const isShort = res.trade.side === 'short';
  const markers = [{
    idx: tIdx, price: res.trade.entry, kind: 'entry',
    label: `${isShort ? 'short' : 'buy'} ${f2(res.trade.entry)}`,
    dy: isShort ? -34 : 46, dx: -10, anchor: 'end'
  }];
  let cum = 0;
  res.trade.tranches.forEach((t, i) => {
    cum += t.frac * t.r;
    markers.push({
      idx: idxOfDate(t.date), price: t.price,
      kind: t.r >= 0 ? 'exit' : 'loss',
      label: `${Math.round(t.frac * 100)}% @ ${f2(t.price)} · ${rr(t.r)}`,
      dy: i % 2 === 0 ? (isShort ? 26 : -26) : (isShort ? 44 : -44), dx: 10
    });
  });

  const base = res.setup.base;
  const baseRect = (res.wanted === 'breakout' && base) ? {
    fromIdx: idxOfDate(base.startDate), toIdx: idxOfDate(base.endDate),
    high: base.high, low: base.low,
    label: `${base.len}-session base · ${f1(base.depthPct)}% deep · ${base.higherLows ? 'higher lows' : 'flat lows'}`
  } : null;

  const svg = renderChart({
    bars, from, to, ema10, ema20, sma50, baseRect,
    pivot: res.wanted === 'breakout' ? res.setup.pivot : null,
    entry: res.trade.entry, stop: res.trade.stop, markers,
    id: 'chart-' + res.symbol, title: `${res.symbol} — ${res.setupLabel}`
  });

  return { svg, from, to, bars };
}

function checksTable(res) {
  const rows = res.setup.checks.map(c =>
    `<tr class="${c.pass ? 'ok' : 'no'}"><td class="mark">${c.pass ? '✓' : '✕'}</td>` +
    `<td>${esc(c.label)}</td><td class="num">${esc(c.detail)}</td></tr>`).join('\n');
  return `<table class="checks"><caption>Every criterion, as the engine scored it on ${esc(res.triggerDate)}</caption>
<thead><tr><th></th><th>Criterion</th><th>Measured</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function tradeTable(res) {
  const t = res.trade;
  const rows = t.tranches.map(x =>
    `<tr><td>${esc(x.date)}</td><td class="num">${Math.round(x.frac * 100)}%</td>` +
    `<td class="num">${f2(x.price)}</td><td class="num ${x.r >= 0 ? 'pos' : 'neg'}">${rr(x.r)}</td>` +
    `<td>${esc(x.reason)}</td></tr>`).join('\n');
  return `<table class="trade"><caption>Simulated fills under his own management rules</caption>
<thead><tr><th>Date</th><th>Size</th><th>Price</th><th>R</th><th>Why</th></tr></thead><tbody>${rows}
<tr class="total"><td>Total</td><td class="num">100%</td><td></td>
<td class="num ${t.totalR >= 0 ? 'pos' : 'neg'}">${rr(t.totalR)}</td>
<td>max favourable excursion ${f1(t.mfeR)}R</td></tr></tbody></table>`;
}

function figureBlock(caseData, res) {
  const { svg } = buildFigure(caseData, res);
  const t = res.trade;
  const verdict = t.totalR >= 0 ? 'win' : 'loss';
  const statTiles = [
    ['Setup', res.setupLabel.replace(/ \(.*/, '')],
    ['Trigger', res.triggerDate],
    ['ADR', f1(res.metrics.adr) + '%'],
    ['Risk', f2(t.riskPct) + '% · ' + f2(t.riskAdrMultiple) + '× ADR'],
    ['Result', rr(t.totalR)]
  ].map(([k, v]) => `<div class="tile"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('');

  return `<figure class="case ${verdict}" id="case-${esc(res.symbol)}">
  <figcaption class="case-head">
    <div class="case-title">
      <span class="badge ${verdict}">${verdict === 'win' ? 'Winner' : 'Loser'}</span>
      <h3>${esc(res.symbol)} <span class="case-name">${esc(res.name)}</span></h3>
    </div>
    <p class="case-context">${inlineHtml(res.context)}</p>
  </figcaption>
  <div class="tiles">${statTiles}</div>
  <div class="chart-wrap">${svg}
    <div class="legend">
      <span class="li"><i class="sw up"></i>up session (hollow)</span>
      <span class="li"><i class="sw dn"></i>down session (filled)</span>
      <span class="li"><i class="ln ma10"></i>10-day EMA</span>
      <span class="li"><i class="ln ma20"></i>20-day EMA</span>
      <span class="li"><i class="ln ma50"></i>50-day SMA</span>
    </div>
  </div>
  <div class="case-body">
    <div class="case-prose">
      <h4>Why the screen flagged it</h4>
      <p>${inlineHtml(res.justification)}</p>
      <h4>The plan on the trigger date</h4>
      <p class="plan">${inlineHtml(res.planText)}</p>
      <h4>What it teaches</h4>
      <p>${inlineHtml(res.lesson)}</p>
    </div>
    <div class="case-tables">${checksTable(res)}${tradeTable(res)}</div>
  </div>
</figure>`;
}

function scorecard() {
  const rows = results.map(r => {
    const t = r.trade;
    return `<tr><td class="sym">${esc(r.symbol)}</td><td>${esc(r.setupLabel.replace(/ \(.*/, ''))}</td>` +
      `<td>${esc(r.triggerDate)}</td><td class="num">${f2(t.riskAdrMultiple)}×</td>` +
      `<td class="num ${t.totalR >= 0 ? 'pos' : 'neg'}">${rr(t.totalR)}</td>` +
      `<td class="num">${f1(t.mfeR)}R</td>` +
      `<td class="num">${(t.totalR * 0.5).toFixed(2)}%</td></tr>`;
  }).join('\n');
  const total = results.reduce((a, r) => a + r.trade.totalR, 0);
  const wins = results.filter(r => r.trade.totalR > 0).length;
  const avgWin = results.filter(r => r.trade.totalR > 0).reduce((a, r) => a + r.trade.totalR, 0) / wins;
  const losers = results.filter(r => r.trade.totalR <= 0);
  const avgLoss = losers.reduce((a, r) => a + r.trade.totalR, 0) / losers.length;
  return `<table class="scorecard">
<caption>All five trades, sized at 0.5% of equity per trade</caption>
<thead><tr><th>Symbol</th><th>Setup</th><th>Trigger</th><th>Risk (ADR)</th><th>Result</th><th>MFE</th><th>Equity</th></tr></thead>
<tbody>${rows}
<tr class="total"><td colspan="4">5 trades · ${wins} winners · average winner ${rr(avgWin)} · average loser ${rr(avgLoss)}</td>
<td class="num pos">${rr(total)}</td><td></td><td class="num pos">+${(total * 0.5).toFixed(1)}%</td></tr></tbody></table>`;
}

/* ------------------------------------------------------------- data notice */
const NOTICE_TITLE = 'About the price data in these five charts';
const NOTICE_BODY =
  'This analysis was produced in a sandboxed environment whose network policy blocks every market-data host ' +
  '(Yahoo, Stooq, Polygon, Tiingo, FMP, Finnhub, Nasdaq, the SEC and qullamaggie.com itself all return 403 at ' +
  'the egress gateway). Real June–August 2026 OHLCV could not be fetched, so rather than attribute invented ' +
  'prices to real companies, the five case studies use **synthetic price series with archetype tickers**, ' +
  'generated by `tools/build-datasets.mjs` and laid out on the real NYSE trading calendar. The market backdrop ' +
  'described around them is real and sourced; the bars are not. Everything else — the rules, the screening ' +
  'logic, the entry and stop arithmetic and the trade simulation — is real code that runs on real data the ' +
  'moment you import a CSV into the screener. See `data/DATA.md`.';

/* ------------------------------------------------------------------- HTML */
function renderBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.p) out.push(`<p>${inlineHtml(b.p)}</p>`);
    else if (b.list) out.push(`<ul class="bullets">${b.list.map(li => `<li>${inlineHtml(li)}</li>`).join('')}</ul>`);
    else if (b.rules) out.push(`<dl class="rules">${b.rules.map(r =>
      `<dt>${inlineHtml(r.label)}</dt><dd>${inlineHtml(r.text)}</dd>`).join('')}</dl>`);
    else if (b.table) out.push(`<div class="tbl-wrap"><table class="spec"><thead><tr>${
      b.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
      b.table.rows.map(row => `<tr>${row.map((c, i) =>
        `<td${i === 0 ? ' class="rowhead"' : ''}>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')
      }</tbody></table></div>`);
    else if (b.callout) out.push(`<aside class="callout ${b.callout.kind}"><h4>${inlineHtml(b.callout.title)}</h4>` +
      `<p>${inlineHtml(b.callout.text)}</p></aside>`);
    else if (b.dataNotice) out.push(`<aside class="callout provenance"><h4>${esc(NOTICE_TITLE)}</h4>` +
      `<p>${inlineHtml(NOTICE_BODY)}</p></aside>`);
    else if (b.figures) out.push(examples.cases.map((c, i) => figureBlock(c, results[i])).join('\n'));
    else if (b.scorecard) out.push(`<div class="tbl-wrap wide">${scorecard()}</div>`);
  }
  return out.join('\n');
}

const toc = SECTIONS.map(s => `<li><a href="#${s.id}"><span class="eyebrow-sm">${esc(s.eyebrow)}</span>${esc(s.title)}</a></li>`).join('');

const html = `<title>The Qullamaggie Playbook</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;0,6..72,700;1,6..72,400&family=Source+Sans+3:ital,wght@0,300;0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root {
  --font-display: 'Newsreader', 'Iowan Old Style', Georgia, serif;
  --font-body: 'Source Sans 3', -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;

  --paper: #eef1ed;
  --surface: #fbfcfa;
  --surface-2: #f4f6f2;
  --ink-primary: #121a1b;
  --ink-secondary: #46524f;
  --ink-muted: #6b7672;
  --rule: #d4dad2;
  --rule-faint: #e3e7e0;
  --accent: #4a3aa7;
  --accent-soft: rgba(74, 58, 167, .09);

  --qm-up: #1baf7a;
  --qm-dn: #e34948;
  --qm-ma10: #2a78d6;
  --qm-ma20: #eb6834;
  --qm-ma50: #4a3aa7;
  --qm-base-fill: rgba(74, 58, 167, .07);
  --qm-base-stroke: #4a3aa7;
  --qm-shade: rgba(18, 26, 27, .035);

  --status-good: #0ca30c;
  --status-warning: #fab219;
  --status-serious: #ec835a;
  --status-critical: #d03b3b;

  --measure: 66ch;
  --wide: 1120px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #0f1211;
    --surface: #1a1a19;
    --surface-2: #202321;
    --ink-primary: #f3f5f0;
    --ink-secondary: #c3c2b7;
    --ink-muted: #8e968f;
    --rule: #30352f;
    --rule-faint: #262b26;
    --accent: #9085e9;
    --accent-soft: rgba(144, 133, 233, .14);
    --qm-up: #199e70;
    --qm-dn: #e66767;
    --qm-ma10: #3987e5;
    --qm-ma20: #d95926;
    --qm-ma50: #9085e9;
    --qm-base-fill: rgba(144, 133, 233, .12);
    --qm-base-stroke: #9085e9;
    --qm-shade: rgba(255, 255, 255, .04);
    --status-good: #0ca30c;
    --status-critical: #d03b3b;
  }
}
:root[data-theme="dark"] {
  --paper: #0f1211;
  --surface: #1a1a19;
  --surface-2: #202321;
  --ink-primary: #f3f5f0;
  --ink-secondary: #c3c2b7;
  --ink-muted: #8e968f;
  --rule: #30352f;
  --rule-faint: #262b26;
  --accent: #9085e9;
  --accent-soft: rgba(144, 133, 233, .14);
  --qm-up: #199e70;
  --qm-dn: #e66767;
  --qm-ma10: #3987e5;
  --qm-ma20: #d95926;
  --qm-ma50: #9085e9;
  --qm-base-fill: rgba(144, 133, 233, .12);
  --qm-base-stroke: #9085e9;
  --qm-shade: rgba(255, 255, 255, .04);
  --status-good: #0ca30c;
  --status-critical: #d03b3b;
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--paper); color: var(--ink-primary);
  font: 400 16.5px/1.62 var(--font-body);
  -webkit-font-smoothing: antialiased;
}
.shell { max-width: var(--wide); margin: 0 auto; padding-inline: 20px; padding-block: 0 72px; }
.measure { max-width: var(--measure); }

/* ---- masthead --------------------------------------------------------- */
header.mast { padding-block: 56px 30px; border-bottom: 2px solid var(--ink-primary); }
.kicker {
  display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: baseline;
  font: 500 11px/1 var(--font-mono); letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-muted); margin-bottom: 22px;
}
.kicker .dot { color: var(--accent); }
h1 {
  font: 600 clamp(2.6rem, 6.4vw, 4.3rem)/1.02 var(--font-display);
  letter-spacing: -.022em; margin: 0 0 18px; text-wrap: balance; max-width: 22ch;
}
.tagline {
  font: 300 clamp(1.05rem, 2.1vw, 1.3rem)/1.5 var(--font-body);
  color: var(--ink-secondary); max-width: 58ch; margin: 0;
}
nav.toc { margin-block: 34px 0; border-top: 1px solid var(--rule); padding-top: 20px; }
nav.toc ol {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 2px 26px;
}
nav.toc a {
  display: flex; flex-direction: column; gap: 1px; padding: 7px 0;
  color: var(--ink-primary); text-decoration: none; border-bottom: 1px solid transparent;
  font-size: 14.5px;
}
nav.toc a:hover { color: var(--accent); border-bottom-color: var(--accent); }
.eyebrow-sm { font: 500 9.5px/1 var(--font-mono); letter-spacing: .16em; text-transform: uppercase; color: var(--ink-muted); }

/* ---- sections --------------------------------------------------------- */
section {
  padding-block: 46px 20px; border-bottom: 1px solid var(--rule-faint);
  display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 0 34px; align-items: start;
}
section > * { grid-column: 2; }
section:last-of-type { border-bottom: 0; }
.sec-head { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; margin-bottom: 20px; align-items: baseline; }
.sec-head .eyebrow { grid-column: 1; justify-self: start; }
.sec-head h2 { grid-column: 2; }
figure.case, section > .tbl-wrap.wide { grid-column: 1 / -1; }
.eyebrow {
  font: 600 10.5px/1 var(--font-mono); letter-spacing: .17em; text-transform: uppercase;
  color: var(--accent); background: var(--accent-soft); padding: 6px 9px; border-radius: 2px; white-space: nowrap;
}
h2 { font: 600 clamp(1.55rem, 3.1vw, 2.1rem)/1.15 var(--font-display); letter-spacing: -.015em; margin: 0; text-wrap: balance; }
section > p, section > .rules, section > .bullets, section > .callout, section > .tbl-wrap { max-width: var(--measure); }
section > p { margin: 0 0 17px; }
strong { font-weight: 600; }
code {
  font: 500 .88em var(--font-mono); background: var(--surface-2); padding: .1em .35em;
  border-radius: 2px; border: 1px solid var(--rule-faint);
}
a { color: var(--accent); text-underline-offset: .18em; }

/* ---- rule lists ------------------------------------------------------- */
dl.rules { margin: 4px 0 22px; display: grid; gap: 0; }
dl.rules dt {
  font: 600 13px/1.4 var(--font-mono); color: var(--ink-primary);
  padding-top: 13px; border-top: 1px solid var(--rule-faint);
}
dl.rules dd { margin: 3px 0 13px; color: var(--ink-secondary); }
ul.bullets { margin: 0 0 20px; padding-left: 1.15em; }
ul.bullets li { margin-bottom: 8px; color: var(--ink-secondary); }

/* ---- callouts --------------------------------------------------------- */
.callout {
  margin: 6px 0 24px; padding: 17px 19px; background: var(--surface);
  border: 1px solid var(--rule); border-left: 3px solid var(--accent); border-radius: 2px;
}
.callout.warn { border-left-color: var(--status-critical); }
.callout.provenance { border-left-color: var(--status-warning); background: var(--surface-2); }
.callout h4 {
  margin: 0 0 7px; font: 600 12px/1.3 var(--font-mono); letter-spacing: .04em;
  text-transform: uppercase; color: var(--ink-primary);
}
.callout p { margin: 0; font-size: 15.5px; color: var(--ink-secondary); }

/* ---- tables ----------------------------------------------------------- */
.tbl-wrap { overflow-x: auto; margin: 4px 0 26px; }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
caption {
  text-align: left; font: 500 10.5px/1.4 var(--font-mono); letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink-muted); padding-bottom: 9px;
}
th {
  text-align: left; font: 600 10.5px/1.3 var(--font-mono); letter-spacing: .09em;
  text-transform: uppercase; color: var(--ink-muted); padding: 0 12px 8px 0;
  border-bottom: 1px solid var(--ink-primary);
}
td { padding: 10px 12px 10px 0; border-bottom: 1px solid var(--rule-faint); vertical-align: top; color: var(--ink-secondary); }
td.rowhead, td.sym { color: var(--ink-primary); font-weight: 600; white-space: nowrap; }
td.num, th.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }
td.pos { color: var(--status-good); font-weight: 600; }
td.neg { color: var(--status-critical); font-weight: 600; }
tr.total td { border-bottom: 0; border-top: 2px solid var(--ink-primary); color: var(--ink-primary); font-weight: 600; }
table.spec td.rowhead { width: 24%; }
table.scorecard { font-size: 14px; }

/* ---- case figures ----------------------------------------------------- */
figure.case {
  margin: 34px 0 46px; background: var(--surface); border: 1px solid var(--rule);
  border-radius: 3px; overflow: hidden;
}
.case-head { padding: 20px 22px 16px; border-bottom: 1px solid var(--rule-faint); }
.case-title { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.case-title h3 { margin: 0; font: 600 1.5rem/1.1 var(--font-display); letter-spacing: -.01em; }
.case-name { font: 400 .95rem/1.3 var(--font-body); color: var(--ink-muted); letter-spacing: 0; }
.badge {
  font: 600 10px/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase;
  padding: 6px 8px; border-radius: 2px; color: #fff;
}
.badge.win { background: var(--status-good); }
.badge.loss { background: var(--status-critical); }
.case-context { margin: 0; max-width: 78ch; color: var(--ink-secondary); font-size: 15.5px; }
.tiles {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  border-bottom: 1px solid var(--rule-faint); background: var(--surface-2);
}
.tile { padding: 11px 14px; border-right: 1px solid var(--rule-faint); display: flex; flex-direction: column; gap: 3px; }
.tile:last-child { border-right: 0; }
.tile .k { font: 500 9.5px/1 var(--font-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-muted); }
.tile .v { font: 600 14px/1.2 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink-primary); }
.chart-wrap { padding: 18px 16px 10px; }
.legend {
  display: flex; flex-wrap: wrap; gap: 7px 18px; padding: 12px 6px 4px;
  font: 500 10.5px/1 var(--font-mono); letter-spacing: .04em; color: var(--ink-muted);
}
.legend .li { display: inline-flex; align-items: center; gap: 6px; }
.legend i { display: inline-block; }
.legend .sw { width: 9px; height: 13px; border: 1.4px solid; }
.legend .sw.up { border-color: var(--qm-up); background: var(--surface); }
.legend .sw.dn { border-color: var(--qm-dn); background: var(--qm-dn); }
.legend .ln { width: 16px; height: 2px; }
.legend .ln.ma10 { background: var(--qm-ma10); }
.legend .ln.ma20 { background: var(--qm-ma20); }
.legend .ln.ma50 { background: var(--qm-ma50); }
.case-body {
  display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 30px;
  padding: 6px 22px 24px; border-top: 1px solid var(--rule-faint);
}
.case-prose h4, .case-tables caption {
  font: 600 10.5px/1.3 var(--font-mono); letter-spacing: .13em; text-transform: uppercase; color: var(--ink-muted);
}
.case-prose h4 { margin: 18px 0 7px; }
.case-prose p { margin: 0; color: var(--ink-secondary); font-size: 15px; }
.case-prose p.plan { font-size: 14.5px; }
.case-tables { padding-top: 18px; display: grid; gap: 24px; align-content: start; }
table.checks td.mark { width: 1.6em; font-family: var(--font-mono); font-weight: 600; padding-right: 6px; }
table.checks tr.ok td.mark { color: var(--status-good); }
table.checks tr.no td.mark { color: var(--status-critical); }
table.checks tr.no td { color: var(--ink-primary); }
table.checks td:nth-child(2) { font-size: 13.5px; }
table.checks td:last-child, table.trade td:last-child { font-size: 12.5px; }
table.checks td.num { font-size: 12px; white-space: normal; }

/* ---- sources / footer ------------------------------------------------- */
.sources ol { margin: 0; padding-left: 1.3em; columns: 2; column-gap: 34px; }
.sources li { margin-bottom: 9px; font-size: 14px; break-inside: avoid; }
footer.foot {
  margin-top: 44px; padding-top: 22px; border-top: 2px solid var(--ink-primary);
  font: 500 11.5px/1.7 var(--font-mono); color: var(--ink-muted);
}
footer.foot p { margin: 0 0 6px; max-width: 88ch; }

${CHART_CSS}

@media (max-width: 860px) {
  .case-body { grid-template-columns: 1fr; gap: 8px; }
  section { grid-template-columns: 1fr; gap: 0; }
  section > * { grid-column: 1; }
  .sec-head { grid-template-columns: 1fr; gap: 12px; }
  .sec-head .eyebrow, .sec-head h2 { grid-column: 1; }
  .sources ol { columns: 1; }
  .case-tables { padding-top: 4px; }
}
@media (max-width: 520px) {
  body { font-size: 16px; }
  header.mast { padding-block: 34px 22px; }
  .chart-wrap { padding: 12px 8px 6px; }
  .case-head, .case-body { padding-inline: 14px; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>

<div class="shell">
<header class="mast">
  <div class="kicker">
    <span>${esc(META.byline)}</span><span class="dot">&bull;</span>
    <span>${esc(META.dateLine)}</span><span class="dot">&bull;</span>
    <span>Momentum swing trading</span>
  </div>
  <h1>${esc(META.title)}</h1>
  <p class="tagline">${esc(META.tagline)}</p>
  <nav class="toc" aria-label="Contents"><ol>${toc}</ol></nav>
</header>

${SECTIONS.map(s => `<section id="${s.id}">
  <div class="sec-head"><span class="eyebrow">${esc(s.eyebrow)}</span><h2>${esc(s.title)}</h2></div>
  ${renderBlocks(s.blocks)}
</section>`).join('\n')}

<section class="sources" id="sources">
  <div class="sec-head"><span class="eyebrow">Sources</span><h2>Where the rules come from</h2></div>
  <ol>${SOURCES.map(([t, u]) => `<li><a href="${esc(u)}">${esc(t)}</a></li>`).join('')}</ol>
</section>

<footer class="foot">
  <p>Rules compiled from Kristjan Kullamägi's own published writing and interviews; the thresholds implemented in
  the screener are stated in the tables above. Price series in the five case studies are synthetic — see the
  provenance note in the Evidence section.</p>
  <p>Nothing here is investment advice. A strategy with a 25–30% win rate will produce long losing streaks, and
  position sizing is the only thing standing between a losing streak and a ruined account.</p>
</footer>
</div>
`;

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/executive-summary.html'), html);

/* --------------------------------------------------------------- Markdown */
function mdBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.p) out.push(inlineMd(b.p));
    else if (b.list) out.push(b.list.map(li => '- ' + inlineMd(li)).join('\n'));
    else if (b.rules) out.push(b.rules.map(r => `**${r.label}** — ${inlineMd(r.text)}`).join('\n\n'));
    else if (b.table) out.push(
      '| ' + b.table.head.join(' | ') + ' |\n|' + b.table.head.map(() => '---').join('|') + '|\n' +
      b.table.rows.map(r => '| ' + r.map(c => String(c).replace(/\|/g, '\\|')).join(' | ') + ' |').join('\n'));
    else if (b.callout) out.push(`> **${b.callout.title}**\n>\n> ${inlineMd(b.callout.text)}`);
    else if (b.dataNotice) out.push(`> **${NOTICE_TITLE}**\n>\n> ${inlineMd(NOTICE_BODY)}`);
    else if (b.figures) out.push(results.map(r => {
      const t = r.trade;
      return `### ${r.symbol} — ${r.setupLabel} · ${t.totalR >= 0 ? 'WINNER' : 'LOSER'} ${rr(t.totalR)}\n\n` +
        `*${r.name}. Trigger ${r.triggerDate}. ADR ${f1(r.metrics.adr)}%. ` +
        `Entry ${f2(t.entry)} · stop ${f2(t.stop)} · risk ${f2(t.riskPct)}% (${f2(t.riskAdrMultiple)}× ADR) · ` +
        `max favourable excursion ${f1(t.mfeR)}R.*\n\n` +
        `${r.context}\n\n**Why it was flagged.** ${r.justification}\n\n**The plan.** ${r.planText}\n\n` +
        `**Fills.**\n\n| Date | Size | Price | R | Why |\n|---|---|---|---|---|\n` +
        t.tranches.map(x => `| ${x.date} | ${Math.round(x.frac * 100)}% | ${f2(x.price)} | ${rr(x.r)} | ${x.reason} |`).join('\n') +
        `\n\n**Lesson.** ${r.lesson}\n\n` +
        `*Chart: see [docs/executive-summary.html](executive-summary.html#case-${r.symbol}).*`;
    }).join('\n\n---\n\n'));
    else if (b.scorecard) {
      const total = results.reduce((a, r) => a + r.trade.totalR, 0);
      out.push('| Symbol | Setup | Trigger | Risk (ADR) | Result | MFE | Equity @0.5% |\n|---|---|---|---|---|---|---|\n' +
        results.map(r => `| ${r.symbol} | ${r.setupLabel.replace(/ \(.*/, '')} | ${r.triggerDate} | ` +
          `${f2(r.trade.riskAdrMultiple)}× | ${rr(r.trade.totalR)} | ${f1(r.trade.mfeR)}R | ` +
          `${(r.trade.totalR * 0.5).toFixed(2)}% |`).join('\n') +
        `\n| **Total** | | | | **${rr(total)}** | | **+${(total * 0.5).toFixed(1)}%** |`);
    }
  }
  return out.join('\n\n');
}

const md = `# ${META.title}\n\n${META.tagline}\n\n*${META.byline} · ${META.dateLine}*\n\n` +
  `> The charts for the five case studies are in [docs/executive-summary.html](executive-summary.html); ` +
  `this file is the same document in plain text.\n\n` +
  SECTIONS.map(s => `## ${s.title}\n\n*${s.eyebrow}*\n\n${mdBlocks(s.blocks)}`).join('\n\n') +
  `\n\n## Sources\n\n${SOURCES.map(([t, u]) => `- [${t}](${u})`).join('\n')}\n\n---\n\n` +
  `*Rules compiled from Kristjan Kullamägi's own published writing and interviews. Price series in the case ` +
  `studies are synthetic — see the provenance note. Nothing here is investment advice.*\n`;

fs.writeFileSync(path.join(ROOT, 'docs/executive-summary.md'), md);

console.log('wrote docs/executive-summary.html (' + (html.length / 1024).toFixed(0) + ' KB)');
console.log('wrote docs/executive-summary.md  (' + (md.length / 1024).toFixed(0) + ' KB)');
