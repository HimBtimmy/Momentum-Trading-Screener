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
  var pctTxt = function (x, d) { return (isFinite(x) ? (Math.round(x * Math.pow(10, d || 1)) / Math.pow(10, d || 1)) : '—') + '%'; };

  /* ------------------------------------------------------------ app state */
  var state = {
    source: 'demo',
    universe: [],          // [{symbol, name, sector, marketCap, bars}]
    indexBars: null,
    asOf: null,
    view: 'cards',
    showRejects: false,
    settings: {
      accountEquity: 100000, riskPctPerTrade: 0.5, maxPositionPct: 20,
      minPrice: 5, minAdr: 3.5, minDollarVol: 5e6,
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
      indexBars: state.indexBars ? truncate(state.indexBars, state.asOf) : null
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
    var eligible = res.results.filter(function (r) { return r.eligible; });
    var rejected = res.results.filter(function (r) { return !r.eligible; });
    if (state.view === 'table') {
      host.innerHTML = renderTable(eligible, rejected);
    } else {
      host.innerHTML = (eligible.length
        ? eligible.map(renderCard).join('')
        : '<p class="empty">Nothing qualifies on this date. That is the normal state of the screen ' +
          'most days — the setups cluster.</p>') +
        (state.showRejects ? renderRejects(rejected) : '');
      attachCharts();
    }
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

  function renderCard(r) {
    var s = r.best, p = s.plan, m = r.f;
    var side = p.side;
    var rank = r.rank || {};
    var planAdr = Math.abs(p.riskPct) / m.adr;
    var chartId = 'c-' + r.symbol.replace(/[^A-Za-z0-9]/g, '');
    var metrics = [
      ['Price', '$' + f2(m.price)],
      ['ADR', pctTxt(m.adr)],
      ['Turnover', QM.money(m.dollarVol20)],
      ['1m', pctTxt(m.ret1m, 0)],
      ['3m', pctTxt(m.ret3m, 0)],
      ['6m', pctTxt(m.ret6m, 0)],
      ['RS rank', isFinite(rank.best) ? 'top ' + Math.round(rank.best) + '%' : '—'],
      ['Off 52w high', pctTxt(m.pctOff52High)]
    ];
    var checks = s.checks.map(function (c) {
      return '<li class="' + (c.pass ? 'ok' : 'no') + '"><span class="mk">' + (c.pass ? '✓' : '✕') + '</span>' +
        '<span class="lb">' + esc(c.label) + '</span><span class="dt">' + esc(c.detail) + '</span></li>';
    }).join('');

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

    return '<article class="card ' + s.type + ' ' + (s.status || '') + '">' +
      '<header class="card-head">' +
        '<div class="id">' +
          '<h3>' + esc(r.symbol) + '</h3>' +
          '<span class="nm">' + esc(r.name || '') + (r.sector ? ' · ' + esc(r.sector) : '') + '</span>' +
        '</div>' +
        '<div class="tags">' +
          '<span class="badge ' + s.type + '">' + esc(SETUP_LABEL[s.type]) + '</span>' +
          '<span class="pill ' + (s.status || '') + '">' + esc(STATUS_TEXT[s.status] || s.status || '') + '</span>' +
          '<span class="score" title="composite setup score"><b>' + Math.round(s.score) + '</b><i>/100</i></span>' +
        '</div>' +
      '</header>' +
      '<div class="metrics">' + metrics.map(function (x) {
        return '<div class="m"><span class="k">' + esc(x[0]) + '</span><span class="v">' + esc(x[1]) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="chart" id="' + chartId + '" data-symbol="' + esc(r.symbol) + '"></div>' +
      '<div class="why"><h4>Why this one qualifies</h4><p>' + esc(r.justification) + '</p></div>' +
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
        '<div class="criteria"><h4>Criteria</h4><ul class="checks">' + checks + '</ul></div>' +
      '</div>' +
    '</article>';
  }

  function renderRejects(rejected) {
    if (!rejected.length) return '';
    var rows = rejected.map(function (r) {
      if (!r.f) return '<tr><td class="sym">' + esc(r.symbol) + '</td><td colspan="2">' + esc(r.skipped || 'no data') + '</td></tr>';
      var best = null;
      (r.setups || []).forEach(function (s) { if (!best || (s.score || 0) > (best.score || 0)) best = s; });
      var why = best && best.failing && best.failing.length
        ? best.failing.map(function (c) { return c.label; }).join(' · ')
        : (best && best.reason) || 'no qualifying setup';
      return '<tr><td class="sym">' + esc(r.symbol) + '</td>' +
        '<td class="num">' + pctTxt(r.f.adr) + ' ADR · ' + QM.money(r.f.dollarVol20) + '</td>' +
        '<td>' + esc(why) + '</td></tr>';
    }).join('');
    return '<section class="rejects"><h3>Rejected <span>' + rejected.length + '</span></h3>' +
      '<table><thead><tr><th>Symbol</th><th>Liquidity</th><th>Failing criteria</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></section>';
  }

  function renderTable(eligible, rejected) {
    var rows = eligible.map(function (r) {
      var s = r.best, p = s.plan;
      return '<tr><td class="sym">' + esc(r.symbol) + '</td>' +
        '<td>' + esc(SETUP_LABEL[s.type]) + '</td>' +
        '<td>' + esc(STATUS_TEXT[s.status] || s.status || '') + '</td>' +
        '<td class="num">' + Math.round(s.score) + '</td>' +
        '<td class="num">' + pctTxt(r.f.adr) + '</td>' +
        '<td class="num">$' + f2(p.entry) + '</td>' +
        '<td class="num">$' + f2(p.stop) + '</td>' +
        '<td class="num">' + pctTxt(Math.abs(p.riskPct), 2) + '</td>' +
        '<td class="num">' + f2(Math.abs(p.riskPct) / r.f.adr) + '×</td>' +
        '<td class="num">' + (p.size ? p.size.shares.toLocaleString() : '—') + '</td></tr>';
    }).join('');
    return '<div class="tbl-wrap"><table class="results"><caption>Eligible candidates — ' +
      esc(state.asOf || '') + '</caption><thead><tr><th>Symbol</th><th>Setup</th><th>Status</th>' +
      '<th class="num">Score</th><th class="num">ADR</th><th class="num">Entry</th><th class="num">Stop</th>' +
      '<th class="num">Risk</th><th class="num">ADR×</th><th class="num">Shares</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="10">Nothing qualifies on this date.</td></tr>') +
      '</tbody></table></div>' + (state.showRejects ? renderRejects(rejected) : '');
  }

  /* --------------------------------------------------------------- charts */
  function attachCharts() {
    var res = state.lastRun;
    if (!res) return;
    $$('#results .chart').forEach(function (host) {
      var sym = host.getAttribute('data-symbol');
      var rec = res.results.filter(function (r) { return r.symbol === sym; })[0];
      if (!rec || !rec.f) return;
      var bars = rec.f.bars, n = bars.length;
      var closes = bars.map(function (b) { return b.close; });
      var from = Math.max(0, n - 120), to = n - 1;
      var s = rec.best, p = s.plan;
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
        width: 900, priceH: 210, volH: 46, id: 'svg-' + sym
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
     ['minadr', 'minAdr'], ['minprice', 'minPrice']].forEach(function (pair) {
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
        minPrice: 5, minAdr: 3.5, minDollarVol: 5e6,
        setups: { breakout: true, ep: true, parabolic: true }
      };
      LS.set('settings', state.settings);
      wireValues();
      run();
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
