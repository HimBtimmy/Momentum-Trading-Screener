/* ============================================================================
 * app.js — the screener UI.
 *
 * Depends on engine.js (window.QM), chart.js (window.QMChart) and, for the
 * bundled demo, datasets.js (window.QM_DATA).
 * ==========================================================================*/
(function () {
  'use strict';
  var QM = window.QM, QMChart = window.QMChart;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var f2 = function (x) { return (Math.round(x * 100) / 100).toFixed(2); };
  var f1 = function (x) { return (Math.round(x * 10) / 10).toFixed(1); };
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var setupOf = function (r) { return r.best || r.display || null; };
  var capTxt = function (x) {
    if (!isFinite(x) || !x) return '—';
    if (x >= 1e12) return '$' + (x / 1e12).toFixed(2) + 'T';
    if (x >= 1e9) return '$' + (x / 1e9).toFixed(1) + 'B';
    if (x >= 1e6) return '$' + (x / 1e6).toFixed(0) + 'M';
    return '$' + Math.round(x).toLocaleString();
  };
  var signed = function (x, d) {
    if (!isFinite(x)) return '—';
    var v = Math.round(x * Math.pow(10, d || 1)) / Math.pow(10, d || 1);
    return (v > 0 ? '+' : '') + v + '%';
  };
  var pctTxt = function (x, d) { return (isFinite(x) ? (Math.round(x * Math.pow(10, d || 1)) / Math.pow(10, d || 1)) : '—') + '%'; };

  /* ------------------------------------------------------------ app state */
  var state = {
    source: 'demo',
    universe: [],          // [{symbol, name, sector, marketCap, bars}]
    indexBars: null,
    asOf: null,
    view: 'cards',
    showRejects: false,
    detail: null,                       // symbol shown in the detail overlay
    filters: { setup: '', status: '', eligibility: 'all',
               minScore: 0, maxScore: 100, minRs: 1, maxRs: 99 },
    settings: {
      accountEquity: 100000, riskPctPerTrade: 0.5, maxPositionPct: 20,
      minPrice: 5, minAdr: 3.5, minDollarVol: 5e6, marketCapTopPct: 100,
      setups: { breakout: true, ep: true, parabolic: true }
    },
    lastRun: null,
    provenance: null
  };

  var LS = {
    get: function (k, dflt) {
      try { var v = localStorage.getItem('qm.' + k); return v == null ? dflt : JSON.parse(v); }
      catch (e) { return dflt; }
    },
    set: function (k, v) { try { localStorage.setItem('qm.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  /* -------------------------------------------------------------- helpers */
  function truncate(bars, asOf) {
    if (!asOf) return bars;
    var out = [], i;
    for (i = 0; i < bars.length; i++) { if (bars[i].date <= asOf) out.push(bars[i]); else break; }
    return out;
  }

  function activeUniverse() {
    return state.universe.map(function (u) {
      return { symbol: u.symbol, name: u.name, sector: u.sector, marketCap: u.marketCap,
               bars: truncate(u.bars, state.asOf) };
    });
  }

  function dateBounds() {
    var min = null, max = null;
    state.universe.forEach(function (u) {
      if (!u.bars.length) return;
      var a = u.bars[0].date, b = u.bars[u.bars.length - 1].date;
      if (!min || a < min) min = a;
      if (!max || b > max) max = b;
    });
    return { min: min, max: max };
  }

  /* ------------------------------------------------------------- the run */
  function run() {
    var uni = activeUniverse().filter(function (u) { return u.bars.length >= 130; });
    var skipped = activeUniverse().length - uni.length;
    var opts = Object.assign({}, state.settings, {
      indexBars: state.indexBars ? truncate(state.indexBars, state.asOf) : null,
      marketCapTopPct: state.settings.marketCapTopPct
    });
    var res = uni.length ? QM.screen(uni, opts) : { results: [], counts: { universe: 0, eligible: 0 }, regime: null };
    res.skipped = skipped;
    state.lastRun = res;
    render();
  }

  /* -------------------------------------------------------------- render */
  function render() {
    var res = state.lastRun;
    renderRegime(res && res.regime);
    renderSummary(res);
    var host = $('#results');
    if (!res || !res.results.length) {
      host.innerHTML = '<p class="empty">No symbols loaded yet. Load the demo universe, or import a CSV of daily bars.</p>';
      return;
    }
    if (state.view === 'table') {
      host.innerHTML = renderTable();
      wireTableFilters();
      return;
    }
    var eligible = res.results.filter(function (r) { return r.eligible; });
    var rejected = res.results.filter(function (r) { return !r.eligible && r.f; });
    host.innerHTML = (eligible.length
      ? eligible.map(function (r) { return renderCard(r); }).join('')
      : '<p class="empty">Nothing qualifies on this date. That is the normal state of the screen ' +
        'most days — the setups cluster.</p>') +
      (state.showRejects ? renderRejects(rejected) : '');
    attachCharts();
    wireSymbolLinks();
  }

  function renderRejects(rejected) {
    if (!rejected.length) return '';
    var rows = rejected.map(function (r) {
      var s = setupOf(r);
      var why = r.capReason ? r.capReason
        : (s && s.failing && s.failing.length) ? s.failing.map(function (c) { return c.label; }).join(' · ')
        : (s && s.reason) || 'no qualifying setup';
      return '<tr><td class="sym"><button class="symlink" data-symbol="' + esc(r.symbol) + '" type="button">' +
        esc(r.symbol) + '</button></td>' +
        '<td class="num">' + pctTxt(r.f.adr) + ' ADR · ' + QM.money(r.f.dollarVol20) + '</td>' +
        '<td>' + esc(why) + '</td></tr>';
    }).join('');
    return '<section class="rejects"><h3>Rejected <span>' + rejected.length + '</span></h3>' +
      '<table><thead><tr><th>Symbol</th><th>Liquidity</th><th>Failing criteria</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></section>';
  }

  function renderRegime(regime) {
    var el = $('#regime');
    if (!regime) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'regime ' + regime.state;
    el.innerHTML = '<span class="tag">Market regime</span>' +
      '<strong>' + esc(regime.label) + '</strong>' +
      '<span class="note">' + esc(regime.note) + '</span>' +
      '<span class="sizehint">size × ' + regime.sizeHint.toFixed(2) + '</span>';
  }

  function renderSummary(res) {
    var el = $('#summary');
    if (!res) { el.hidden = true; return; }
    el.hidden = false;
    var c = res.counts;
    var tiles = [
      ['Screened', c.universe],
      ['Eligible', c.eligible],
      ['Breakouts', c.breakout || 0],
      ['Episodic pivots', c.ep || 0],
      ['Parabolic shorts', c.parabolic || 0],
      ['As of', state.asOf || '—']
    ];
    el.innerHTML = tiles.map(function (t) {
      return '<div class="stat"><span class="k">' + esc(t[0]) + '</span><span class="v">' + esc(t[1]) + '</span></div>';
    }).join('') + (res.skipped ? '<div class="stat warn"><span class="k">Too little history</span><span class="v">' +
      res.skipped + '</span></div>' : '');
  }

  var SETUP_LABEL = { breakout: 'Breakout', ep: 'Episodic pivot', parabolic: 'Parabolic short' };
  var STATUS_TEXT = {
    triggered: 'Triggered', 'triggered-lowvol': 'Triggered · thin volume', ready: 'Ready · pivot within 1 ADR',
    building: 'Building', extended: 'Extended · entry gone', fresh: 'Fresh gap', watch: 'Watch only · no crack yet'
  };

  function renderCard(r, opts) {
    opts = opts || {};
    var s = setupOf(r);
    if (!s || !s.plan) {
      return '<article class="card"><header class="card-head"><div class="id"><h3>' + esc(r.symbol) +
        '</h3><span class="nm">' + esc(r.skipped || 'no qualifying setup to show') + '</span></div></header></article>';
    }
    var p = s.plan, m = r.f, q = r.quality;
    var side = p.side;
    var rank = r.rank || {};
    var planAdr = Math.abs(p.riskPct) / m.adr;
    var chartId = 'c-' + (opts.prefix || '') + r.symbol.replace(/[^A-Za-z0-9]/g, '');

    var metrics = [
      ['Price', '$' + f2(m.price)],
      ['Mkt cap', capTxt(r.marketCap)],
      ['ADR', pctTxt(m.adr)],
      ['Turnover', QM.money(m.dollarVol20)],
      ['1D', signed(m.ret1d, 1)],
      ['5D', signed(m.ret5d, 1)],
      ['1M', signed(m.ret1m, 0)],
      ['3M', signed(m.ret3m, 0)],
      ['6M', signed(m.ret6m, 0)],
      ['RS', isFinite(rank.rsRating) ? String(rank.rsRating) : '—'],
      ['Off 52w high', pctTxt(m.pctOff52High)]
    ];
    var checks = s.checks.map(function (c) {
      return '<li class="' + (c.pass ? 'ok' : 'no') + '"><span class="mk">' + (c.pass ? '✓' : '✕') + '</span>' +
        '<span class="lb">' + esc(c.label) + '</span><span class="dt">' + esc(c.detail) + '</span></li>';
    }).join('');

    var tt = q && q.trendTemplate ? q.trendTemplate : null;
    var ttHtml = tt ? '<div class="trendtpl"><h4>Minervini trend template ' +
      '<span class="ttscore ' + (tt.passed >= 7 ? 'good' : tt.passed >= 5 ? 'mid' : 'bad') + '">' +
      tt.passed + '/' + tt.total + '</span></h4><ul class="ttlist">' +
      tt.items.map(function (x) {
        var cls = x.pass === null ? 'na' : x.pass ? 'ok' : 'no';
        var mark = x.pass === null ? '–' : x.pass ? '✓' : '✕';
        return '<li class="' + cls + '"><span class="mk">' + mark + '</span>' +
          '<span class="lb">' + esc(x.label) + '</span><span class="dt">' + esc(x.detail) + '</span></li>';
      }).join('') + '</ul></div>' : '';

    var planRows = [
      ['Entry trigger', '$' + f2(p.entry), 'accent'],
      ['Hard stop', '$' + f2(p.stop), 'bad'],
      ['Risk', pctTxt(Math.abs(p.riskPct), 2) + ' · ' + f2(planAdr) + '× ADR',
        planAdr <= 1.0 ? 'good' : planAdr <= 1.5 ? 'warn' : 'bad'],
      [side === 'short' ? 'Cover into' : '3R target',
        side === 'short' ? '$' + f2(p.targets.ema10) + ' / $' + f2(p.targets.ema20) : '$' + f2(p.targets.r3), ''],
      [side === 'short' ? '3R' : '5R target', '$' + f2(side === 'short' ? p.targets.r3 : p.targets.r5), ''],
      ['Trail on', String(p.targets.trailMa), '']
    ];
    var size = p.size;
    var sizeLine = size ? (size.shares.toLocaleString() + ' shares · ' + QM.money(size.notional) + ' · ' +
      f1(size.positionPct) + '% of equity · ' + QM.money(size.dollarsAtRisk) + ' at risk (' +
      f2(size.riskOfEquityPct) + '% of account)') : '';

    var failing = (s.failing || []).map(function (c) { return c.label; });
    if (r.capReason) failing.unshift(r.capReason);
    var banner = r.eligible ? '' :
      '<div class="reject-banner"><strong>Not eligible</strong> ' +
      (failing.length ? esc(failing.join(' · ')) : esc(s.reason || 'no qualifying setup')) +
      '<span class="hyp">The plan below is hypothetical — shown so you can see what the screen measured.</span></div>';

    return '<article class="card ' + s.type + ' ' + (s.status || '') + (r.eligible ? '' : ' rejected') + '">' +
      '<header class="card-head">' +
        '<div class="id">' +
          '<h3>' + esc(r.symbol) + '</h3>' +
          '<span class="nm">' + esc(r.name || '') + (r.sector ? ' · ' + esc(r.sector) : '') + '</span>' +
        '</div>' +
        '<div class="tags">' +
          (q ? '<span class="grade g' + q.grade.replace('+', 'plus') + '" title="setup quality">' +
               esc(q.label) + '</span>' : '') +
          '<span class="badge ' + s.type + '">' + esc(SETUP_LABEL[s.type]) + '</span>' +
          '<span class="pill ' + (s.status || '') + '">' + esc(STATUS_TEXT[s.status] || s.status || '') + '</span>' +
          '<span class="score" title="composite setup score"><b>' + Math.round(s.score) + '</b><i>/100</i></span>' +
        '</div>' +
      '</header>' +
      banner +
      '<div class="metrics">' + metrics.map(function (x) {
        return '<div class="m"><span class="k">' + esc(x[0]) + '</span><span class="v">' + esc(x[1]) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="chart" id="' + chartId + '" data-symbol="' + esc(r.symbol) + '"></div>' +
      '<div class="why"><h4>Why this one qualifies</h4><p>' + esc(r.justification || '') + '</p></div>' +
      '<div class="plan-grid">' +
        '<div class="plan"><h4>' + (side === 'short' ? 'Short plan' : 'Trade plan') + '</h4>' +
          '<dl>' + planRows.map(function (x) {
            return '<div class="row ' + x[2] + '"><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>';
          }).join('') + '</dl>' +
          (sizeLine ? '<p class="size">' + esc(sizeLine) + '</p>' : '') +
          (size && size.notes.length ? '<p class="notes">' + esc(size.notes.join('; ')) + '</p>' : '') +
          '<p class="rule">' + esc(p.entryRule) + ' ' + esc(p.stopRule) + '</p>' +
          (p.intradayNote ? '<p class="rule">' + esc(p.intradayNote) + '</p>' : '') +
          '<p class="rule mgmt">' + esc(p.management) + '</p>' +
        '</div>' +
        '<div class="criteria"><h4>Criteria</h4><ul class="checks">' + checks + '</ul>' + ttHtml + '</div>' +
      '</div>' +
    '</article>';
  }

  /* ---------------------------------------------------------- table view */

  var STATUS_ORDER = ['triggered', 'triggered-lowvol', 'ready', 'fresh', 'watch', 'building', 'extended'];

  function visibleRows() {
    var res = state.lastRun;
    if (!res) return [];
    var f = state.filters;
    return res.results.filter(function (r) {
      if (!r.f) return false;
      var s = setupOf(r);
      if (!s) return false;
      if (f.eligibility === 'eligible' && !r.eligible) return false;
      if (f.eligibility === 'rejected' && r.eligible) return false;
      if (f.setup && s.type !== f.setup) return false;
      if (f.status && (s.status || '') !== f.status) return false;
      var score = Math.round(s.score || 0);
      if (score < f.minScore || score > f.maxScore) return false;
      var rs = r.rank && isFinite(r.rank.rsRating) ? r.rank.rsRating : null;
      if (rs === null) { if (f.minRs > 1 || f.maxRs < 99) return false; }
      else if (rs < f.minRs || rs > f.maxRs) return false;
      return true;
    });
  }

  function renderTable() {
    var rows = visibleRows();
    var f = state.filters;
    var statuses = {};
    (state.lastRun ? state.lastRun.results : []).forEach(function (r) {
      var s = setupOf(r);
      if (s && s.status) statuses[s.status] = true;
    });
    var statusOpts = STATUS_ORDER.filter(function (x) { return statuses[x]; });

    var controls =
      '<div class="tablefilters">' +
        '<label class="ff"><span>Setup</span><select id="f-setup">' +
          ['', 'breakout', 'ep', 'parabolic'].map(function (v) {
            return '<option value="' + v + '"' + (f.setup === v ? ' selected' : '') + '>' +
              (v ? SETUP_LABEL[v] : 'All') + '</option>';
          }).join('') + '</select></label>' +
        '<label class="ff"><span>Status</span><select id="f-status">' +
          [''].concat(statusOpts).map(function (v) {
            return '<option value="' + v + '"' + (f.status === v ? ' selected' : '') + '>' +
              (v ? (STATUS_TEXT[v] || v) : 'All') + '</option>';
          }).join('') + '</select></label>' +
        '<label class="ff"><span>Eligibility</span><select id="f-elig">' +
          [['all', 'All'], ['eligible', 'Eligible only'], ['rejected', 'Rejected only']].map(function (o) {
            return '<option value="' + o[0] + '"' + (f.eligibility === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select></label>' +
        slicer('score', 'Score', 0, 100, f.minScore, f.maxScore) +
        slicer('rs', 'RS rating', 1, 99, f.minRs, f.maxRs) +
        '<button class="go ghost" id="f-reset" type="button">Clear filters</button>' +
        '<span class="fcount">' + rows.length + ' of ' +
          (state.lastRun ? state.lastRun.results.filter(function (r) { return r.f; }).length : 0) + '</span>' +
      '</div>';

    var body = rows.map(function (r) {
      var s = setupOf(r), p = s.plan, q = r.quality;
      var rs = r.rank && isFinite(r.rank.rsRating) ? r.rank.rsRating : null;
      return '<tr class="' + (r.eligible ? 'elig' : 'rej') + '">' +
        '<td class="sym"><button class="symlink" data-symbol="' + esc(r.symbol) + '" type="button">' +
          esc(r.symbol) + '</button></td>' +
        '<td>' + esc(SETUP_LABEL[s.type] || '') + '</td>' +
        '<td><span class="pill sm ' + (s.status || '') + '">' + esc(STATUS_TEXT[s.status] || s.status || '') + '</span></td>' +
        '<td>' + (r.eligible ? '<span class="yes">eligible</span>' : '<span class="no">rejected</span>') + '</td>' +
        '<td>' + (q ? '<span class="grade sm g' + q.grade.replace('+', 'plus') + '">' + esc(q.grade) + '</span>' : '—') + '</td>' +
        '<td class="num">' + Math.round(s.score) + '</td>' +
        '<td class="num">' + (rs === null ? '—' : rs) + '</td>' +
        '<td class="num">' + capTxt(r.marketCap) + '</td>' +
        '<td class="num">' + pctTxt(r.f.adr) + '</td>' +
        '<td class="num">' + signed(r.f.ret1d, 1) + '</td>' +
        '<td class="num">' + signed(r.f.ret5d, 1) + '</td>' +
        '<td class="num">' + (p ? '$' + f2(p.entry) : '—') + '</td>' +
        '<td class="num">' + (p ? '$' + f2(p.stop) : '—') + '</td>' +
        '<td class="num">' + (p ? pctTxt(Math.abs(p.riskPct), 2) : '—') + '</td>' +
        '<td class="num">' + (p ? f2(Math.abs(p.riskPct) / r.f.adr) + '×' : '—') + '</td>' +
        '<td class="num">' + (p && p.size ? p.size.shares.toLocaleString() : '—') + '</td>' +
      '</tr>';
    }).join('');

    return controls + '<div class="tbl-wrap"><table class="results">' +
      '<caption>Click a symbol for its chart, criteria and plan — rejected names included</caption>' +
      '<thead><tr><th>Symbol</th><th>Setup</th><th>Status</th><th>Eligible</th><th>Grade</th>' +
      '<th class="num">Score</th><th class="num">RS</th><th class="num">Mkt cap</th><th class="num">ADR</th>' +
      '<th class="num">1D</th><th class="num">5D</th><th class="num">Entry</th><th class="num">Stop</th>' +
      '<th class="num">Risk</th><th class="num">ADR×</th><th class="num">Shares</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="16">Nothing matches these filters.</td></tr>') +
      '</tbody></table></div>';
  }

  function slicer(id, label, lo, hi, minVal, maxVal) {
    return '<div class="slicer"><span class="sl-label">' + esc(label) + '</span>' +
      '<div class="sl-body">' +
        '<input type="range" id="f-' + id + '-min" min="' + lo + '" max="' + hi + '" value="' + minVal + '" ' +
          'aria-label="' + esc(label) + ' minimum">' +
        '<input type="range" id="f-' + id + '-max" min="' + lo + '" max="' + hi + '" value="' + maxVal + '" ' +
          'aria-label="' + esc(label) + ' maximum">' +
      '</div>' +
      '<span class="sl-val" id="f-' + id + '-val">' + minVal + '–' + maxVal + '</span></div>';
  }

  /* ------------------------------------------------------- detail overlay */

  function openDetail(symbol) {
    var res = state.lastRun;
    if (!res) return;
    var rec = res.results.filter(function (r) { return r.symbol === symbol; })[0];
    if (!rec) return;
    state.detail = symbol;
    var host = $('#detail');
    $('#detail-body').innerHTML = renderCard(rec, { prefix: 'd-' });
    host.hidden = false;
    document.body.classList.add('modal-open');
    attachCharts($('#detail-body'), 'd-');
    $('#detail-close').focus();
  }

  function closeDetail() {
    state.detail = null;
    $('#detail').hidden = true;
    $('#detail-body').innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  /* ------------------------------------------------------- filter wiring */

  function wireSymbolLinks(root) {
    $$('.symlink', root || $('#results')).forEach(function (btn) {
      btn.addEventListener('click', function () { openDetail(btn.getAttribute('data-symbol')); });
    });
  }

  /* Filter changes repaint only the rows, so the slider you are dragging is
   * never torn out from under you. */
  function refreshTableBody() {
    var host = $('#results table.results tbody');
    if (!host) { render(); return; }
    var html = renderTable();
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    host.innerHTML = tmp.querySelector('table.results tbody').innerHTML;
    var count = tmp.querySelector('.fcount');
    if (count && $('.fcount')) $('.fcount').textContent = count.textContent;
    wireSymbolLinks();
  }

  function bindSlicer(id, minKey, maxKey) {
    var lo = $('#f-' + id + '-min'), hi = $('#f-' + id + '-max'), out = $('#f-' + id + '-val');
    if (!lo || !hi) return;
    function sync(commit) {
      var a = +lo.value, b = +hi.value;
      if (a > b) {                       // handles crossed: push the other one
        if (document.activeElement === lo) { b = a; hi.value = b; }
        else { a = b; lo.value = a; }
      }
      out.textContent = a + '–' + b;
      state.filters[minKey] = a;
      state.filters[maxKey] = b;
      if (commit) refreshTableBody();
    }
    lo.addEventListener('input', function () { sync(false); });
    hi.addEventListener('input', function () { sync(false); });
    lo.addEventListener('change', function () { sync(true); });
    hi.addEventListener('change', function () { sync(true); });
  }

  function wireTableFilters() {
    wireSymbolLinks();
    var pairs = [['#f-setup', 'setup'], ['#f-status', 'status'], ['#f-elig', 'eligibility']];
    pairs.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.addEventListener('change', function () {
        state.filters[pair[1]] = this.value;
        refreshTableBody();
      });
    });
    bindSlicer('score', 'minScore', 'maxScore');
    bindSlicer('rs', 'minRs', 'maxRs');
    var reset = $('#f-reset');
    if (reset) reset.addEventListener('click', function () {
      state.filters = { setup: '', status: '', eligibility: 'all',
                        minScore: 0, maxScore: 100, minRs: 1, maxRs: 99 };
      render();
    });
  }

  /* --------------------------------------------------------------- charts */
  function attachCharts(root, prefix) {
    var res = state.lastRun;
    if (!res) return;
    $$('.chart', root || $('#results')).forEach(function (host) {
      var sym = host.getAttribute('data-symbol');
      var rec = res.results.filter(function (r) { return r.symbol === sym; })[0];
      if (!rec || !rec.f) return;
      var bars = rec.f.bars, n = bars.length;
      var closes = bars.map(function (b) { return b.close; });
      var from = Math.max(0, n - 120), to = n - 1;
      var s = setupOf(rec);
      if (!s || !s.plan) return;
      var p = s.plan;
      var base = s.base;
      var idxOf = function (d) { for (var i = 0; i < n; i++) if (bars[i].date === d) return i; return -1; };
      host.innerHTML = QMChart.renderChart({
        bars: bars, from: from, to: to,
        ema10: QM.ema(closes, 10), ema20: QM.ema(closes, 20), sma50: QM.sma(closes, 50),
        baseRect: (s.type === 'breakout' && base) ? {
          fromIdx: idxOf(base.startDate), toIdx: idxOf(base.endDate),
          high: base.high, low: base.low,
          label: base.len + '-session base · ' + f1(base.depthPct) + '% deep'
        } : null,
        pivot: s.type === 'breakout' ? s.pivot : null,
        entry: p.entry, stop: p.stop, markers: [],
        width: 900, priceH: 210, volH: 46, id: 'svg-' + (prefix || '') + sym
      });
      host.insertAdjacentHTML('beforeend',
        '<div class="legend">' +
        '<span class="li"><i class="sw up"></i>up session</span>' +
        '<span class="li"><i class="sw dn"></i>down session</span>' +
        '<span class="li"><i class="ln ma10"></i>10-day EMA</span>' +
        '<span class="li"><i class="ln ma20"></i>20-day EMA</span>' +
        '<span class="li"><i class="ln ma50"></i>50-day SMA</span>' +
        '<span class="li">hover for OHLCV</span></div>');
      hookTooltip(host, bars, from);
    });
  }

  var tip = null;
  function hookTooltip(host, bars, from) {
    var svg = host.querySelector('svg');
    if (!svg) return;
    var x0 = parseFloat(svg.getAttribute('data-x0'));
    var dx = parseFloat(svg.getAttribute('data-dx'));
    var vb = svg.getAttribute('viewBox').split(' ').map(Number);
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'qm-cross');
    line.setAttribute('y1', 0); line.setAttribute('y2', vb[3]);
    line.style.display = 'none';
    svg.appendChild(line);

    svg.addEventListener('mousemove', function (ev) {
      var rect = svg.getBoundingClientRect();
      var vx = (ev.clientX - rect.left) / rect.width * vb[2];
      var i = Math.round((vx - x0) / dx - 0.5);
      var b = bars[from + i];
      if (!b) { line.style.display = 'none'; if (tip) tip.hidden = true; return; }
      var cx = x0 + dx * (i + 0.5);
      line.setAttribute('x1', cx); line.setAttribute('x2', cx);
      line.style.display = '';
      if (!tip) { tip = document.createElement('div'); tip.className = 'qm-tip'; document.body.appendChild(tip); }
      tip.hidden = false;
      tip.innerHTML = '<b>' + esc(b.date) + '</b>' +
        '<span>O ' + f2(b.open) + '</span><span>H ' + f2(b.high) + '</span>' +
        '<span>L ' + f2(b.low) + '</span><span>C ' + f2(b.close) + '</span>' +
        '<span>V ' + (b.volume >= 1e6 ? (b.volume / 1e6).toFixed(1) + 'M' : Math.round(b.volume / 1e3) + 'K') + '</span>';
      var tx = ev.clientX + 14, ty = ev.clientY - 8;
      if (tx + 190 > window.innerWidth) tx = ev.clientX - 200;
      tip.style.left = tx + 'px';
      tip.style.top = (ty + window.scrollY) + 'px';
    });
    svg.addEventListener('mouseleave', function () {
      line.style.display = 'none';
      if (tip) tip.hidden = true;
    });
  }

  /* ----------------------------------------------------------- data loads */
  function loadDemo() {
    if (!window.QM_DATA) { flash('The bundled demo dataset did not load (datasets.js missing).', true); return; }
    state.universe = window.QM_DATA.universe.map(function (u) { return u; });
    state.indexBars = window.QM_DATA.index.bars;
    state.provenance = window.QM_DATA.provenance;
    state.source = 'demo';
    var b = dateBounds();
    state.asOf = b.max;
    syncDateInput(b);
    renderProvenance();
    run();
  }

  function loadCsv(text, label) {
    var rows;
    try { rows = QM.parseCSV(text); }
    catch (e) { flash(e.message, true); return; }
    if (!rows.length) { flash('No usable rows found in that CSV.', true); return; }
    var idx = null;
    rows = rows.filter(function (r) {
      if (/^(SPY|QQQ|SPX|\^GSPC|INDEX|IWM)$/i.test(r.symbol)) { idx = r.bars; return false; }
      return true;
    });
    state.universe = rows;
    state.indexBars = idx;
    state.source = 'csv';
    state.provenance = { synthetic: false, note: 'Imported from ' + (label || 'CSV') + ' — ' + rows.length +
      ' symbols, ' + (idx ? 'index series detected for the regime filter.' : 'no index series found, so the regime filter is off.') };
    var b = dateBounds();
    state.asOf = b.max;
    syncDateInput(b);
    renderProvenance();
    flash('Loaded ' + rows.length + ' symbols from ' + (label || 'CSV') + '.', false);
    run();
  }

  var PROVIDERS = {
    fmp: {
      label: 'Financial Modeling Prep',
      url: function (sym, key) {
        return 'https://financialmodelingprep.com/api/v3/historical-price-full/' +
               encodeURIComponent(sym) + '?serietype=line&timeseries=400&apikey=' + encodeURIComponent(key);
      },
      parse: function (j) {
        return (j.historical || []).map(function (d) {
          return { date: d.date, open: +d.open, high: +d.high, low: +d.low, close: +d.close, volume: +d.volume || 0 };
        }).reverse();
      }
    },
    tiingo: {
      label: 'Tiingo',
      url: function (sym, key) {
        return 'https://api.tiingo.com/tiingo/daily/' + encodeURIComponent(sym) +
               '/prices?startDate=2024-01-01&token=' + encodeURIComponent(key);
      },
      parse: function (j) {
        return (j || []).map(function (d) {
          return { date: String(d.date).slice(0, 10), open: +d.open, high: +d.high, low: +d.low,
                   close: +d.close, volume: +d.volume || 0 };
        });
      }
    },
    polygon: {
      label: 'Polygon.io',
      url: function (sym, key) {
        var to = new Date().toISOString().slice(0, 10);
        var fromD = new Date(Date.now() - 500 * 864e5).toISOString().slice(0, 10);
        return 'https://api.polygon.io/v2/aggs/ticker/' + encodeURIComponent(sym.toUpperCase()) +
               '/range/1/day/' + fromD + '/' + to + '?adjusted=true&sort=asc&limit=5000&apiKey=' + encodeURIComponent(key);
      },
      parse: function (j) {
        return (j.results || []).map(function (d) {
          return { date: new Date(d.t).toISOString().slice(0, 10), open: d.o, high: d.h, low: d.l, close: d.c, volume: d.v };
        });
      }
    }
  };

  function fetchLive() {
    var provider = $('#provider').value;
    var key = $('#apikey').value.trim();
    var syms = $('#symbols').value.split(/[\s,;]+/).filter(Boolean).slice(0, 40);
    var status = $('#live-status');
    if (!key) { status.textContent = 'An API key is required — it stays in this browser.'; status.className = 'msg bad'; return; }
    if (!syms.length) { status.textContent = 'Add at least one symbol.'; status.className = 'msg bad'; return; }
    LS.set('provider', provider);
    LS.set('apikey', key);
    LS.set('symbols', syms.join(' '));
    status.className = 'msg';
    status.textContent = 'Fetching ' + syms.length + ' symbols from ' + PROVIDERS[provider].label + '…';
    var out = [], errors = [];
    Promise.all(syms.map(function (sym) {
      return fetch(PROVIDERS[provider].url(sym, key))
        .then(function (r) { if (!r.ok) throw new Error(sym + ': HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          var bars = PROVIDERS[provider].parse(j);
          if (bars.length < 130) throw new Error(sym + ': only ' + bars.length + ' bars returned');
          out.push({ symbol: sym.toUpperCase(), name: sym.toUpperCase(), bars: bars, source: provider });
        })
        .catch(function (e) { errors.push(e.message); });
    })).then(function () {
      if (!out.length) {
        status.className = 'msg bad';
        status.innerHTML = 'Nothing loaded. ' + esc(errors.slice(0, 3).join(' · ')) +
          '<br>If this page is running as a published artifact, its content-security policy blocks all outbound ' +
          'requests — use the CSV tab, or open <code>app/index.html</code> from the repository locally.';
        return;
      }
      var idx = null;
      out = out.filter(function (r) {
        if (/^(SPY|QQQ|IWM)$/i.test(r.symbol)) { idx = r.bars; return false; }
        return true;
      });
      state.universe = out;
      state.indexBars = idx;
      state.source = 'live';
      state.provenance = { synthetic: false, note: 'Live data from ' + PROVIDERS[provider].label + ' — ' +
        out.length + ' symbols' + (idx ? ', index series used for the regime filter.' : '.') };
      var b = dateBounds();
      state.asOf = b.max;
      syncDateInput(b);
      renderProvenance();
      status.className = 'msg good';
      status.textContent = 'Loaded ' + out.length + ' symbols.' + (errors.length ? ' ' + errors.length + ' failed.' : '');
      run();
    });
  }

  function renderProvenance() {
    var el = $('#provenance');
    if (!state.provenance) { el.hidden = true; return; }
    el.hidden = false;
    var p = state.provenance;
    el.className = 'provenance ' + (p.synthetic ? 'synthetic' : 'real');
    el.innerHTML = '<strong>' + (p.synthetic ? 'Demo data — synthetic' : 'Live data') + '</strong> ' + esc(p.note);
  }

  function flash(msg, bad) {
    var el = $('#flash');
    el.hidden = false;
    el.className = 'msg ' + (bad ? 'bad' : 'good');
    el.textContent = msg;
    setTimeout(function () { el.hidden = true; }, 6000);
  }

  function syncDateInput(b) {
    var el = $('#asof');
    if (!b.min) return;
    el.min = b.min; el.max = b.max; el.value = state.asOf || b.max;
  }

  /* ----------------------------------------------------------------- wire */
  function wire() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.tab').forEach(function (x) { x.classList.toggle('on', x === t); });
        $$('.panel').forEach(function (p) { p.hidden = p.id !== 'panel-' + t.dataset.panel; });
      });
    });
    $('#load-demo').addEventListener('click', loadDemo);
    $('#csv-file').addEventListener('change', function (ev) {
      var f = ev.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { loadCsv(String(rd.result), f.name); };
      rd.readAsText(f);
    });
    $('#csv-load').addEventListener('click', function () {
      var t = $('#csv-text').value.trim();
      if (!t) { flash('Paste some CSV first.', true); return; }
      loadCsv(t, 'pasted CSV');
    });
    $('#fetch-live').addEventListener('click', fetchLive);
    $('#asof').addEventListener('change', function () { state.asOf = this.value; run(); });
    $('#view-cards').addEventListener('click', function () { setView('cards'); });
    $('#view-table').addEventListener('click', function () { setView('table'); });
    $('#show-rejects').addEventListener('change', function () { state.showRejects = this.checked; render(); });

    [['equity', 'accountEquity'], ['risk', 'riskPctPerTrade'], ['maxpos', 'maxPositionPct'],
     ['minadr', 'minAdr'], ['minprice', 'minPrice'], ['mcaptop', 'marketCapTopPct']].forEach(function (pair) {
      var el = $('#' + pair[0]);
      el.value = state.settings[pair[1]];
      el.addEventListener('change', function () {
        var v = parseFloat(this.value);
        if (isFinite(v)) { state.settings[pair[1]] = v; LS.set('settings', state.settings); run(); }
      });
    });
    var dv = $('#mindv');
    dv.value = state.settings.minDollarVol / 1e6;
    dv.addEventListener('change', function () {
      var v = parseFloat(this.value);
      if (isFinite(v)) { state.settings.minDollarVol = v * 1e6; LS.set('settings', state.settings); run(); }
    });
    ['breakout', 'ep', 'parabolic'].forEach(function (k) {
      var el = $('#setup-' + k);
      el.checked = state.settings.setups[k];
      el.addEventListener('change', function () {
        state.settings.setups[k] = this.checked;
        LS.set('settings', state.settings);
        run();
      });
    });
    $('#reset').addEventListener('click', function () {
      state.settings = {
        accountEquity: 100000, riskPctPerTrade: 0.5, maxPositionPct: 20,
        minPrice: 5, minAdr: 3.5, minDollarVol: 5e6, marketCapTopPct: 100,
        setups: { breakout: true, ep: true, parabolic: true }
      };
      LS.set('settings', state.settings);
      wireValues();
      run();
    });
    $('#detail-close').addEventListener('click', closeDetail);
    $('#detail').addEventListener('click', function (ev) {
      if (ev.target === this) closeDetail();          // click the backdrop to dismiss
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && state.detail) closeDetail();
    });

    $('#provider').value = LS.get('provider', 'fmp');
    $('#apikey').value = LS.get('apikey', '');
    $('#symbols').value = LS.get('symbols', 'NVDA AMD MU AVGO SMCI CRWD PLTR SPY');
  }

  function wireValues() {
    $('#equity').value = state.settings.accountEquity;
    $('#risk').value = state.settings.riskPctPerTrade;
    $('#maxpos').value = state.settings.maxPositionPct;
    $('#minadr').value = state.settings.minAdr;
    $('#minprice').value = state.settings.minPrice;
    $('#mcaptop').value = state.settings.marketCapTopPct;
    $('#mindv').value = state.settings.minDollarVol / 1e6;
    ['breakout', 'ep', 'parabolic'].forEach(function (k) { $('#setup-' + k).checked = state.settings.setups[k]; });
  }

  function setView(v) {
    state.view = v;
    $('#view-cards').classList.toggle('on', v === 'cards');
    $('#view-table').classList.toggle('on', v === 'table');
    render();
  }

  /* ------------------------------------------------------------- kick off */
  var saved = LS.get('settings', null);
  if (saved && typeof saved === 'object') state.settings = Object.assign(state.settings, saved);
  wire();
  wireValues();
  loadDemo();
})();
