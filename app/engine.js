/* ============================================================================
 * engine.js — Qullamaggie momentum screening engine
 *
 * Pure, dependency-free implementation of Kristjan Kullamagi's ("Qullamaggie")
 * three setups, usable both in the browser (window.QM) and in Node (require).
 *
 * Rule sources are documented in docs/executive-summary.md. Every threshold
 * below is exposed in DEFAULTS so it can be tuned from the UI.
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- config */

  var DEFAULTS = {
    // --- universe gates -----------------------------------------------------
    minPrice: 5,              // he avoids sub-$5 junk; keep as a floor
    minDollarVol: 5e6,        // 20d average turnover, $/day
    minAdr: 3.5,              // his stated screener floor
    goodAdr: 5.0,             // "momentum leading stock" territory
    // --- relative strength --------------------------------------------------
    rsWindows: { m1: 21, m3: 63, m6: 126 },
    minRet1m: 5,              // absolute backstop when the universe is small
    minRet3m: 15,
    minRet6m: 25,
    rsPercentile: 20,         // keep top N% of the screened universe by RS
    // --- the prior leg ------------------------------------------------------
    priorMoveWindows: [20, 40, 60],
    minPriorMove: 30,         // "30-100%+ move that lasts days to weeks"
    // --- the consolidation --------------------------------------------------
    baseMinLen: 5,            // very fast names base for only ~1 week
    baseMaxLen: 60,           // "2 weeks to 2 months" (cap generously)
    baseDepthAdrMult: 1.8,    // depth cap scales with ADR and base length
    baseDepthHardCap: 35,     // %
    maxRetraceOfLeg: 0.55,    // a flag should not give back most of the leg
    // --- trigger proximity --------------------------------------------------
    proximityAdrMult: 1.0,    // pivot within 1 ADR => actionable now
    breakoutVolMult: 1.4,     // range expansion should come with volume
    // --- episodic pivot -----------------------------------------------------
    epMinGap: 10,             // "gap up of 10% or more"
    epMinRvol: 3.0,           // "massive volume near the open"
    epLookback: 3,            // bars back we still call it fresh
    epBaseWindow: 90,         // "flat for 3-6 months before the catalyst"
    epBaseMaxRange: 45,       // % high/low spread of that dormant base
    epMaxPriorRun: 60,        // % 3m gain above which it is no longer dormant
    // --- parabolic short ----------------------------------------------------
    psMinUpDays: 3,           // "never day one, rarely day two"
    psMinMove20d: 50,         // large caps: 50-100%+ in days/weeks
    psSmallCapMove20d: 200,   // small caps: 300-1000%+
    psSmallCapMktCap: 5e8,
    psMinExtensionAdr: 3.0,   // ADRs above the 20-day EMA
    psMinRsi: 75,
    // --- risk ---------------------------------------------------------------
    stopTick: 0.01,           // the stop sits one tick beyond the anchor bar's extreme
    stopAdrCap: 1.0,          // "stop should never be wider than 1x ADR"
    stopAdrHardCap: 1.5,      // "maximum 1.5x"
    riskPctPerTrade: 0.5,     // 0.25-1%, typically 0.3-0.5%
    maxPositionPct: 20,       // 5-25% of account, most 10-15%
    maxOvernightPct: 30,      // never more than 30% overnight in one name
    maxPctOfAdv: 2,           // don't be more than 2% of the stock's daily volume
    accountEquity: 100000,
    triggerBuffer: 0.001      // 0.1% above the pivot for the buy-stop
  };

  /* ------------------------------------------------------------- primitives */

  function last(a) { return a[a.length - 1]; }
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function mean(a) { if (!a.length) return NaN; var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function slice(a, from, to) { return a.slice(Math.max(0, from), to); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function round(x, d) { var m = Math.pow(10, d == null ? 2 : d); return Math.round(x * m) / m; }

  function sma(vals, n) {
    var out = new Array(vals.length).fill(NaN), s = 0, i;
    for (i = 0; i < vals.length; i++) {
      s += vals[i];
      if (i >= n) s -= vals[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }

  function ema(vals, n) {
    var out = new Array(vals.length).fill(NaN), k = 2 / (n + 1), i, prev;
    if (vals.length < n) return out;
    prev = mean(slice(vals, 0, n));
    out[n - 1] = prev;
    for (i = n; i < vals.length; i++) { prev = vals[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  }

  function rsi(closes, n) {
    var out = new Array(closes.length).fill(NaN), gains = 0, losses = 0, i, d, ag, al;
    if (closes.length <= n) return out;
    for (i = 1; i <= n; i++) { d = closes[i] - closes[i - 1]; if (d >= 0) gains += d; else losses -= d; }
    ag = gains / n; al = losses / n;
    out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (i = n + 1; i < closes.length; i++) {
      d = closes[i] - closes[i - 1];
      ag = (ag * (n - 1) + (d > 0 ? d : 0)) / n;
      al = (al * (n - 1) + (d < 0 ? -d : 0)) / n;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }

  function trueRanges(bars) {
    var out = [NaN], i, b, p;
    for (i = 1; i < bars.length; i++) {
      b = bars[i]; p = bars[i - 1];
      out.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)));
    }
    return out;
  }

  /* ADR% exactly as he defines it: the average daily range in percent over the
   * past 20 sessions.  mean(high/low) - 1, expressed in percent.            */
  function adrPct(bars, n) {
    n = n || 20;
    var w = slice(bars, bars.length - n, bars.length), r = [], i;
    for (i = 0; i < w.length; i++) if (w[i].low > 0) r.push(w[i].high / w[i].low);
    return r.length ? (mean(r) - 1) * 100 : NaN;
  }

  function avgVol(bars, n) {
    var w = slice(bars, bars.length - n, bars.length);
    return mean(w.map(function (b) { return b.volume; }));
  }

  function avgDollarVol(bars, n) {
    var w = slice(bars, bars.length - n, bars.length);
    return mean(w.map(function (b) { return b.close * b.volume; }));
  }

  function pctAt(bars, endIdx, n) {
    if (endIdx - n < 0) return NaN;
    var a = bars[endIdx - n].close, b = bars[endIdx].close;
    return a > 0 ? (b / a - 1) * 100 : NaN;
  }

  function pctChange(bars, n) {
    if (bars.length <= n) return NaN;
    var a = bars[bars.length - 1 - n].close, b = last(bars).close;
    return a > 0 ? (b / a - 1) * 100 : NaN;
  }

  /* --------------------------------------------------------------- features */

  function computeFeatures(bars) {
    var closes = bars.map(function (b) { return b.close; });
    var f = {
      bars: bars,
      n: bars.length,
      closes: closes,
      ema10: ema(closes, 10),
      ema20: ema(closes, 20),
      sma50: sma(closes, 50),
      sma150: sma(closes, 150),
      sma200: sma(closes, 200),
      rsi14: rsi(closes, 14),
      tr: trueRanges(bars),
      adr: adrPct(bars, 20),
      avgVol20: avgVol(bars, 20),
      dollarVol20: avgDollarVol(bars, 20),
      ret1d: pctChange(bars, 1),
      ret5d: pctChange(bars, 5),
      ret1m: pctChange(bars, DEFAULTS.rsWindows.m1),
      ret3m: pctChange(bars, DEFAULTS.rsWindows.m3),
      ret6m: pctChange(bars, DEFAULTS.rsWindows.m6),
      price: last(bars).close
    };
    var w52 = slice(bars, bars.length - 252, bars.length);
    f.high52 = Math.max.apply(null, w52.map(function (b) { return b.high; }));
    f.low52 = Math.min.apply(null, w52.map(function (b) { return b.low; }));
    f.pctOff52High = (f.high52 - f.price) / f.high52 * 100;
    f.pctFrom52Low = (f.price / f.low52 - 1) * 100;
    f.atr14 = mean(slice(f.tr, f.tr.length - 14, f.tr.length).filter(num));
    return f;
  }

  /* ------------------------------------------------------------------ bases
   * Search every plausible consolidation ending on the last bar and keep the
   * highest-quality one.  A base is judged on the four things he names:
   * tight/orderly depth, higher lows, contracting range, drying volume --
   * plus whether price is riding the rising 10/20/50 MAs while it happens.  */

  function scoreBase(f, len, cfg, endOff) {
    var bars = f.bars, n = bars.length;
    endOff = endOff || 0;                         // how many bars after the base
    if (n < len + endOff + 25) return null;
    var s = n - endOff - len, e = n - endOff;     // base = bars[s..e-1]
    var w = slice(bars, s, e);
    if (w.length < len) return null;
    var hi = Math.max.apply(null, w.map(function (b) { return b.high; }));
    var lo = Math.min.apply(null, w.map(function (b) { return b.low; }));
    var depth = (hi - lo) / hi * 100;
    var depthCap = clamp(cfg.baseDepthAdrMult * f.adr * Math.sqrt(len / 5), 5, cfg.baseDepthHardCap);
    if (!(depth <= depthCap)) return null;

    // higher lows: lowest low of the back half vs the front half
    var half = Math.floor(len / 2);
    var loA = Math.min.apply(null, slice(w, 0, half).map(function (b) { return b.low; }));
    var loB = Math.min.apply(null, slice(w, half, len).map(function (b) { return b.low; }));
    var higherLows = loB >= loA * 0.995;
    var lowsSlope = (loB / loA - 1) * 100;

    // range contraction: last third vs first third of the base
    var third = Math.max(2, Math.floor(len / 3));
    var rngA = mean(slice(w, 0, third).map(function (b) { return (b.high - b.low) / b.close; }));
    var rngB = mean(slice(w, len - third, len).map(function (b) { return (b.high - b.low) / b.close; }));
    var contraction = rngA > 0 ? rngB / rngA : NaN;

    // the leg that preceded this base
    var leg = priorMove(f, s, cfg);

    // volume dry-up through the base vs the volume of the leg
    var volBase = mean(w.map(function (b) { return b.volume; }));
    var volLeg = leg.startIdx != null
      ? mean(slice(bars, leg.startIdx, s).map(function (b) { return b.volume; }))
      : f.avgVol20;
    var volRatio = volLeg > 0 ? volBase / volLeg : NaN;

    // MA surf: how much of the base held above a rising 50MA / near the 10-20
    var aboveSma50 = 0, nearEma = 0, i, idx;
    for (i = 0; i < len; i++) {
      idx = s + i;
      if (num(f.sma50[idx]) && bars[idx].close > f.sma50[idx]) aboveSma50++;
      if (num(f.ema20[idx]) && Math.abs(bars[idx].close - f.ema20[idx]) / bars[idx].close * 100 < Math.max(2, f.adr)) nearEma++;
    }
    var retraceOfLeg = leg.pct > 0 ? (hi - lo) / (hi - leg.startPrice) : NaN;

    var q = 0;
    q += clamp((1 - depth / depthCap), 0, 1) * 32;           // tightness
    q += higherLows ? 22 : 0;                                 // higher lows
    q += clamp((1.15 - contraction) / 0.55, 0, 1) * 20;       // contraction
    q += clamp((1.05 - volRatio) / 0.55, 0, 1) * 14;          // volume dry-up
    q += (aboveSma50 / len) * 7;                              // above rising 50
    q += (nearEma / len) * 5;                                 // surfing 10/20

    q -= endOff * 1.5;                                        // prefer fresh bases

    return {
      startIdx: s, endIdx: e - 1, len: len, endOff: endOff,
      startDate: bars[s].date, endDate: bars[e - 1].date,
      high: hi, low: lo, depthPct: depth, depthCapPct: depthCap,
      higherLows: higherLows, lowsSlopePct: lowsSlope,
      contraction: contraction, volRatio: volRatio,
      aboveSma50Frac: aboveSma50 / len, nearEmaFrac: nearEma / len,
      retraceOfLeg: retraceOfLeg, leg: leg, quality: clamp(q, 0, 100)
    };
  }

  function priorMove(f, endIdx, cfg) {
    var bars = f.bars, best = { pct: NaN, startIdx: null, startPrice: NaN, bars: null, startDate: null };
    cfg.priorMoveWindows.forEach(function (w) {
      var s = endIdx - w;
      if (s < 0) return;
      var lowest = Infinity, lowestIdx = s, i;
      for (i = s; i < endIdx; i++) if (bars[i].low < lowest) { lowest = bars[i].low; lowestIdx = i; }
      var peak = -Infinity;
      for (i = lowestIdx; i < endIdx; i++) if (bars[i].high > peak) peak = bars[i].high;
      if (!(lowest > 0) || peak <= 0) return;
      var pct = (peak / lowest - 1) * 100;
      if (!num(best.pct) || pct > best.pct) {
        best = { pct: pct, startIdx: lowestIdx, startPrice: lowest, peak: peak,
                 bars: endIdx - lowestIdx, startDate: bars[lowestIdx].date };
      }
    });
    return best;
  }

  function findBase(f, cfg) {
    var best = null, len, off;
    var maxOff = cfg.baseMaxEndOffset == null ? 4 : cfg.baseMaxEndOffset;
    for (off = 0; off <= maxOff; off++) {
      for (len = cfg.baseMinLen; len <= Math.min(cfg.baseMaxLen, f.n - off - 25); len++) {
        var b = scoreBase(f, len, cfg, off);
        if (!b) continue;
        if (!best || b.quality > best.quality) best = b;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------ trade plans */

  function sizePosition(entry, stop, f, cfg, side) {
    var perShare = Math.abs(entry - stop);
    if (!(perShare > 0)) return null;
    var riskDollars = cfg.accountEquity * cfg.riskPctPerTrade / 100;
    var shares = Math.floor(riskDollars / perShare);
    var notes = [];
    var capShares = Math.floor(cfg.accountEquity * cfg.maxPositionPct / 100 / entry);
    if (shares > capShares) {
      shares = capShares;
      notes.push('size capped by the ' + cfg.maxPositionPct + '% max-position rule, so realised risk is below ' +
                 cfg.riskPctPerTrade + '%');
    }
    var advShares = Math.floor(f.avgVol20 * cfg.maxPctOfAdv / 100);
    if (shares > advShares) {
      shares = advShares;
      notes.push('size capped at ' + cfg.maxPctOfAdv + '% of the 20-day average volume for liquidity');
    }
    return {
      shares: shares,
      riskPerShare: perShare,
      dollarsAtRisk: shares * perShare,
      riskOfEquityPct: cfg.accountEquity > 0 ? shares * perShare / cfg.accountEquity * 100 : NaN,
      notional: shares * entry,
      positionPct: cfg.accountEquity > 0 ? shares * entry / cfg.accountEquity * 100 : NaN,
      side: side || 'long',
      notes: notes
    };
  }

  function longPlan(f, pivot, structuralLow, cfg, kind) {
    var entry = pivot * (1 + cfg.triggerBuffer);
    // The stop goes one tick UNDER the low it is anchored to: resting exactly on
    // the low gets filled by a tick-for-tick retest that never breaks the level.
    var tick = num(cfg.stopTick) ? cfg.stopTick : 0.01;
    var structuralStop = structuralLow - tick;
    var adrStop = entry * (1 - f.adr / 100);
    var stop = Math.max(structuralStop, adrStop);   // the tighter of the two
    var riskPct = (entry - stop) / entry * 100;
    var structRiskPct = (entry - structuralStop) / entry * 100;
    var plan = {
      side: 'long', kind: kind,
      entry: entry,
      entryRule: 'Buy-stop on a break of the ' + (kind === 'ep' ? 'opening-range high (1-min, then add on the 5-min ORH)'
                                                                : '1-min / 5-min / 60-min opening-range high') +
                 ' once price clears ' + round(pivot, 2) + '.',
      stop: stop,
      stopRule: 'Hard stop one tick under the low of the entry day' +
                (structuralStop > adrStop ? ' (' + round(structuralLow, 2) + ' low, stop ' + round(structuralStop, 2) + ').'
                                          : ', held to ' + cfg.stopAdrCap + 'x ADR because the structural low is wider.'),
      riskPct: riskPct,
      structuralRiskPct: structRiskPct,
      adrMultiple: structRiskPct / f.adr,
      stopWithinAdr: structRiskPct <= f.adr * cfg.stopAdrHardCap,
      targets: {
        r3: entry + 3 * (entry - stop),
        r5: entry + 5 * (entry - stop),
        trailMa: f.adr >= cfg.goodAdr ? '10-day EMA' : '20-day EMA'
      },
      management: 'Sell 1/3 to 1/2 into strength after 3-5 days and move the stop to breakeven; trail the remainder on the ' +
                  (f.adr >= cfg.goodAdr ? '10-day' : '20-day') + ' moving average and exit on the first close below it.'
    };
    plan.size = sizePosition(entry, stop, f, cfg, 'long');
    return plan;
  }

  function shortPlan(f, trigger, structuralHigh, cfg) {
    var entry = trigger * (1 - cfg.triggerBuffer);
    var tick = num(cfg.stopTick) ? cfg.stopTick : 0.01;
    var structuralStop = structuralHigh + tick;   // one tick above the anchor high
    var adrStop = entry * (1 + f.adr / 100);
    var stop = Math.min(structuralStop, adrStop);
    var riskPct = (stop - entry) / entry * 100;
    var structRiskPct = (structuralStop - entry) / entry * 100;
    var e10 = last(f.ema10), e20 = last(f.ema20);
    var plan = {
      side: 'short', kind: 'parabolic',
      entry: entry,
      entryRule: 'Short the first break of the opening-range low (1- or 5-min), the first red 5-min candle after a gap up, ' +
                 'or a failed bounce back into VWAP - never on day one of the move.',
      stop: stop,
      stopRule: 'Hard stop one tick above the high of the day, or a reclaim of VWAP if VWAP was the trigger' +
                (structuralStop < adrStop ? '.' : ', held to ' + cfg.stopAdrCap + 'x ADR.'),
      riskPct: riskPct,
      structuralRiskPct: structRiskPct,
      adrMultiple: structRiskPct / f.adr,
      stopWithinAdr: structRiskPct <= f.adr * cfg.stopAdrHardCap,
      targets: {
        ema10: e10, ema20: e20,
        r3: entry - 3 * (stop - entry),
        r5: entry - 5 * (stop - entry),
        trailMa: '10/20-day MA (first real bounce zone)'
      },
      management: 'Cover into the 10- and 20-day moving averages, taking the first tranche once the stock is down ' +
                  '2-3 ADRs from entry. These are day-to-three-day trades, not positions to marry.'
    };
    plan.size = sizePosition(entry, stop, f, cfg, 'short');
    return plan;
  }

  /* ------------------------------------------------------------- detectors */

  function chk(label, pass, detail) { return { label: label, pass: !!pass, detail: detail }; }
  function pct(x, d) { return num(x) ? round(x, d == null ? 1 : d) + '%' : 'n/a'; }
  function money(x) {
    if (!num(x)) return 'n/a';
    if (x >= 1e9) return '$' + round(x / 1e9, 2) + 'B';
    if (x >= 1e6) return '$' + round(x / 1e6, 1) + 'M';
    if (x >= 1e3) return '$' + round(x / 1e3, 1) + 'K';
    return '$' + round(x, 2);
  }

  function liquidityChecks(f, cfg) {
    return [
      chk('Price >= $' + cfg.minPrice, f.price >= cfg.minPrice, '$' + round(f.price, 2)),
      chk('ADR% >= ' + cfg.minAdr + '%', f.adr >= cfg.minAdr, pct(f.adr) + (f.adr >= cfg.goodAdr ? ' (leader-grade)' : '')),
      chk('Turnover >= ' + money(cfg.minDollarVol) + '/day', f.dollarVol20 >= cfg.minDollarVol, money(f.dollarVol20))
    ];
  }

  function trendScore(f) {
    var i = f.n - 1, s = 0, parts = [];
    if (num(f.ema10[i]) && f.price > f.ema10[i]) { s += 3; parts.push('above 10EMA'); }
    if (num(f.ema20[i]) && f.price > f.ema20[i]) { s += 3; parts.push('above 20EMA'); }
    if (num(f.sma50[i]) && f.price > f.sma50[i]) { s += 4; parts.push('above 50MA'); }
    if (num(f.sma50[i]) && num(f.sma50[i - 10]) && f.sma50[i] > f.sma50[i - 10]) { s += 3; parts.push('50MA rising'); }
    if (num(f.sma200[i]) && f.price > f.sma200[i]) { s += 2; parts.push('above 200MA'); }
    return { score: s, parts: parts };
  }

  function rsScore(f, cfg, rank) {
    // 0-25.  Use universe percentile when we have one, otherwise absolute.
    if (rank && num(rank.best)) return clamp((100 - rank.best) / 100, 0, 1) * 25;
    var a = clamp(f.ret1m / 25, 0, 1), b = clamp(f.ret3m / 60, 0, 1), c = clamp(f.ret6m / 100, 0, 1);
    return (a * 8 + b * 9 + c * 8);
  }

  /* ---- Setup 1: breakout / continuation out of a tight flag -------------- */
  function detectBreakout(f, cfg, rank) {
    var base = findBase(f, cfg);
    if (!base) return { type: 'breakout', eligible: false, reason: 'no orderly consolidation found in the last ' + cfg.baseMaxLen + ' sessions' };

    var bars = f.bars, lastBar = last(bars), pivot = base.high;
    var post = slice(bars, base.endIdx + 1, f.n);          // bars after the base
    var boIdx = -1, i;
    for (i = base.endIdx + 1; i < f.n; i++) {
      if (bars[i].close > pivot * (1 - 0.0005)) { boIdx = i; break; }
    }
    var brokeOut = boIdx >= 0;
    var boBar = brokeOut ? bars[boIdx] : lastBar;
    var refVol = mean(slice(bars, (brokeOut ? boIdx : f.n) - 21, (brokeOut ? boIdx : f.n) - 1)
                      .map(function (b) { return b.volume; }));
    var rvol = refVol > 0 ? boBar.volume / refVol : NaN;
    var trIdx = brokeOut ? boIdx : f.n - 1;
    var rangeExp = f.tr[trIdx] / mean(slice(f.tr, trIdx - 5, trIdx).filter(num));
    var distPct = (pivot - f.price) / f.price * 100;        // >0 => still below the pivot
    var extendedPct = (f.price - pivot) / pivot * 100;      // >0 => already above it
    var barsSinceBreakout = brokeOut ? f.n - 1 - boIdx : null;
    var chasing = brokeOut && extendedPct > f.adr * 1.5;

    var t = trendScore(f);
    var checks = liquidityChecks(f, cfg).concat([
      chk('Prior leg >= ' + cfg.minPriorMove + '%', base.leg.pct >= cfg.minPriorMove,
          pct(base.leg.pct) + ' in ' + base.leg.bars + ' sessions from ' + base.leg.startDate),
      chk('Consolidation ' + cfg.baseMinLen + '-' + cfg.baseMaxLen + ' sessions', true,
          base.len + ' sessions, ' + base.startDate + ' to ' + base.endDate),
      chk('Depth tight for its ADR', base.depthPct <= base.depthCapPct,
          pct(base.depthPct) + ' deep vs ' + pct(base.depthCapPct) + ' allowed'),
      chk('Higher lows', base.higherLows, (base.lowsSlopePct >= 0 ? '+' : '') + pct(base.lowsSlopePct) + ' back-half vs front-half low'),
      chk('Range contracting', base.contraction <= 1.0, round(base.contraction, 2) + 'x last-third vs first-third range'),
      chk('Volume drying up', base.volRatio <= 1.0, round(base.volRatio, 2) + 'x the volume of the advance'),
      chk('Surfing rising MAs', base.aboveSma50Frac >= 0.8, round(base.aboveSma50Frac * 100, 0) + '% of base above the 50MA, ' +
          round(base.nearEmaFrac * 100, 0) + '% hugging the 20EMA'),
      chk('Not a deep retrace of the leg', !num(base.retraceOfLeg) || base.retraceOfLeg <= cfg.maxRetraceOfLeg,
          num(base.retraceOfLeg) ? round(base.retraceOfLeg * 100, 0) + '% of the leg given back' : 'n/a'),
      brokeOut
        ? chk('Breakout on volume expansion', rvol >= cfg.breakoutVolMult,
              round(rvol, 1) + 'x average volume on the ' + boBar.date + ' breakout, ' + round(rangeExp, 1) + 'x range expansion')
        : chk('Pivot within ' + cfg.proximityAdrMult + ' ADR', distPct <= f.adr * cfg.proximityAdrMult,
              pct(distPct) + ' below the ' + round(pivot, 2) + ' pivot'),
      chk('Entry not extended', !chasing,
          brokeOut ? pct(extendedPct) + ' above the pivot (' + round(extendedPct / f.adr, 1) + ' ADRs)' : 'not triggered yet')
    ]);

    var gateFails = checks.slice(0, 3).filter(function (c) { return !c.pass; }).length +
                    (base.leg.pct >= cfg.minPriorMove ? 0 : 1);

    // Stop: his rule is the low of the entry day. On a trigger bar we have it;
    // before the trigger we proxy with the tightest recent swing low.
    var structuralStop = brokeOut && barsSinceBreakout <= 1
      ? boBar.low
      : Math.min.apply(null, slice(bars, f.n - Math.min(5, base.len), f.n).map(function (b) { return b.low; }));
    // Entry reference. His fill is the 1/5/60-min opening-range high of the
    // trigger day, which sits just above the pivot on a normal breakout and
    // just above the open when the stock gaps through the pivot. Using the
    // trigger bar's HIGH as the reference would model chasing, which he
    // explicitly does not do.
    var gappedThrough = brokeOut && boBar.open > pivot;
    var entryRef = !brokeOut ? pivot
                 : gappedThrough ? boBar.open
                 : pivot;
    var plan = longPlan(f, entryRef, structuralStop, cfg, 'breakout');
    if (brokeOut && barsSinceBreakout <= 1) {
      plan.stopRule = 'Hard stop at the low of the breakout day (' + boBar.date + ', ' + round(boBar.low, 2) + ').';
      if (gappedThrough) {
        plan.entryRule = 'The stock gapped through the ' + round(pivot, 2) + ' pivot, so the entry is the break of the ' +
          '1-min opening-range high (reference: the ' + round(boBar.open, 2) + ' open) with the stop under the opening range.';
      }
    }

    var status = !brokeOut
      ? (distPct <= f.adr * cfg.proximityAdrMult ? 'ready' : 'building')
      : chasing ? 'extended'
      : rvol >= cfg.breakoutVolMult ? 'triggered' : 'triggered-lowvol';

    var score = rsScore(f, cfg, rank) + clamp(base.leg.pct / 100, 0, 1) * 15 + base.quality / 100 * 30 +
                t.score + clamp((f.adr - cfg.minAdr) / 5, 0, 1) * 6 +
                clamp(Math.log10(Math.max(1, f.dollarVol20 / cfg.minDollarVol)) / 1.5, 0, 1) * 4 +
                (status === 'triggered' ? 5 : status === 'ready' ? 4 : status === 'triggered-lowvol' ? 2 : 0);

    return {
      type: 'breakout',
      eligible: gateFails === 0 && base.quality >= 45 && !chasing &&
                (brokeOut || distPct <= f.adr * cfg.proximityAdrMult * 2),
      status: status,
      base: base, pivot: pivot, distToPivotPct: distPct, extendedPct: extendedPct, gappedThrough: gappedThrough,
      breakoutDate: brokeOut ? boBar.date : null, barsSinceBreakout: barsSinceBreakout,
      rvol: rvol, rangeExpansion: rangeExp, chasing: chasing,
      checks: checks, failing: checks.filter(function (c) { return !c.pass; }), trend: t,
      plan: plan, score: clamp(score, 0, 100)
    };
  }

  /* ---- Setup 2: episodic pivot ------------------------------------------ */
  function detectEP(f, cfg, rank) {
    var bars = f.bars, found = null, i, b, prev, gap, rvol;
    for (i = f.n - 1; i >= Math.max(1, f.n - cfg.epLookback); i--) {
      b = bars[i]; prev = bars[i - 1];
      gap = (b.open - prev.close) / prev.close * 100;
      rvol = f.avgVol20 > 0 ? b.volume / mean(slice(bars, i - 20, i).map(function (x) { return x.volume; })) : NaN;
      if (gap >= cfg.epMinGap) { found = { idx: i, bar: b, gap: gap, rvol: rvol, barsAgo: f.n - 1 - i }; break; }
    }
    if (!found) return { type: 'ep', eligible: false, reason: 'no >=' + cfg.epMinGap + '% gap in the last ' + cfg.epLookback + ' sessions' };

    var s = Math.max(0, found.idx - cfg.epBaseWindow), w = slice(bars, s, found.idx);
    var hi = Math.max.apply(null, w.map(function (x) { return x.high; }));
    var lo = Math.min.apply(null, w.map(function (x) { return x.low; }));
    var baseRange = (hi / lo - 1) * 100;
    var priorRun = w.length > 63 ? (w[w.length - 1].close / w[w.length - 64].close - 1) * 100 : NaN;
    var bar = found.bar;
    var closeInRange = (bar.close - bar.low) / (bar.high - bar.low) * 100;
    var dayRangeAdr = (bar.high - bar.low) / bar.close * 100 / f.adr;

    var checks = liquidityChecks(f, cfg).concat([
      chk('Gap >= ' + cfg.epMinGap + '%', found.gap >= cfg.epMinGap, pct(found.gap) + ' gap on ' + bar.date),
      chk('Volume >= ' + cfg.epMinRvol + 'x average', found.rvol >= cfg.epMinRvol, round(found.rvol, 1) + 'x the 20-day average'),
      chk('Dormant 3-6 months first', baseRange <= cfg.epBaseMaxRange, pct(baseRange) + ' high-low range over the prior ' + w.length + ' sessions'),
      chk('Not already extended', !num(priorRun) || priorRun <= cfg.epMaxPriorRun, num(priorRun) ? pct(priorRun) + ' in the 3 months into the gap' : 'n/a'),
      chk('Held the gap into the close', closeInRange >= 50, 'closed in the top ' + round(100 - closeInRange, 0) + '% of the day\'s range'),
      chk('Fresh (<= ' + cfg.epLookback + ' sessions old)', found.barsAgo <= cfg.epLookback, found.barsAgo === 0 ? 'today' : found.barsAgo + ' sessions ago')
    ]);

    var hasOR = num(bar.orh) && num(bar.orl);
    var plan = longPlan(f, hasOR ? bar.orh : bar.high, hasOR ? bar.orl : bar.low, cfg, 'ep');
    plan.usedOpeningRange = hasOR;
    plan.intradayNote = hasOR
      ? 'Levels come from the opening range of ' + bar.date + ' (ORH ' + round(bar.orh, 2) + ' / ORL ' +
        round(bar.orl, 2) + '); the full day spans ' + round(dayRangeAdr, 1) + ' ADRs, which is why the opening range, not the day, defines the risk.'
      : dayRangeAdr > 1.5
        ? 'The whole gap day spans ' + round(dayRangeAdr, 1) + ' ADRs, so a full-day stop is too wide: this setup has to be entered on the 1-min opening-range high with the stop at the opening-range low, and added to on the 5-min ORH. The daily levels below are only a placeholder until you have intraday data.'
        : 'The gap day spans ' + round(dayRangeAdr, 1) + ' ADRs, so the low of the day is a usable hard stop.';

    var gateFails = checks.slice(0, 3).filter(function (c) { return !c.pass; }).length;
    var score = rsScore(f, cfg, rank) * 0.6 + clamp(found.gap / 30, 0, 1) * 22 + clamp(found.rvol / 8, 0, 1) * 20 +
                clamp(1 - baseRange / cfg.epBaseMaxRange, 0, 1) * 16 + clamp(closeInRange / 100, 0, 1) * 12 +
                trendScore(f).score * 0.4 + clamp((f.adr - cfg.minAdr) / 5, 0, 1) * 5;

    return {
      type: 'ep', eligible: gateFails === 0 && found.gap >= cfg.epMinGap && found.rvol >= cfg.epMinRvol * 0.6 &&
                            baseRange <= cfg.epBaseMaxRange * 1.2,
      status: found.barsAgo === 0 ? 'triggered' : 'fresh',
      gap: found.gap, rvol: found.rvol, gapDate: bar.date, barsAgo: found.barsAgo,
      baseRangePct: baseRange, priorRunPct: priorRun, closeInRangePct: closeInRange, dayRangeAdr: dayRangeAdr,
      checks: checks, failing: checks.filter(function (c) { return !c.pass; }), plan: plan, score: clamp(score, 0, 100)
    };
  }

  /* ---- Setup 3: parabolic short ----------------------------------------- */
  function detectParabolic(f, cfg, meta) {
    var bars = f.bars, i = f.n - 1, upDays = 0, k;
    // The trigger bar is the first sign of WEAKNESS, so the up-day streak has
    // to be measured into the recent peak, not into today's close.
    var peakIdx = i;
    for (k = Math.max(1, i - 2); k <= i; k++) if (bars[k].close >= bars[peakIdx].close) peakIdx = k;
    for (k = peakIdx; k > 0; k--) { if (bars[k].close > bars[k - 1].close) upDays++; else break; }
    var barsSincePeak = i - peakIdx;
    var mv5 = pctAt(bars, peakIdx, 5), mv10 = pctAt(bars, peakIdx, 10), mv20 = pctAt(bars, peakIdx, 20);
    var smallCap = meta && num(meta.marketCap) && meta.marketCap < cfg.psSmallCapMktCap;
    var moveNeeded = smallCap ? cfg.psSmallCapMove20d : cfg.psMinMove20d;
    var bestMove = Math.max(num(mv5) ? mv5 : -Infinity, num(mv10) ? mv10 : -Infinity, num(mv20) ? mv20 : -Infinity);
    var e20 = f.ema20[i], e10 = f.ema10[i];
    var extAdr = num(e20) ? (f.price - e20) / f.price * 100 / f.adr : NaN;
    var extAdrPeak = num(f.ema20[peakIdx])
      ? (bars[peakIdx].close - f.ema20[peakIdx]) / bars[peakIdx].close * 100 / f.adr : NaN;
    if (num(extAdrPeak) && extAdrPeak > extAdr) extAdr = extAdrPeak;
    var r = Math.max(num(f.rsi14[i]) ? f.rsi14[i] : 0, num(f.rsi14[peakIdx]) ? f.rsi14[peakIdx] : 0);
    var bar = bars[i];
    var weakness = [];
    if (bar.close < bar.open) weakness.push('closed red');
    if (bar.close < bars[i - 1].low) weakness.push('closed below the prior day\'s low');
    if (bar.high < bars[i - 1].high) weakness.push('made a lower high');
    if ((bar.close - bar.low) / (bar.high - bar.low) < 0.35) weakness.push('closed in the bottom third of its range');

    var checks = liquidityChecks(f, cfg).concat([
      chk('Up ' + cfg.psMinUpDays + '+ days in a row', upDays >= cfg.psMinUpDays, upDays + ' consecutive up closes'),
      chk('Parabolic move >= ' + moveNeeded + '%', bestMove >= moveNeeded,
          pct(bestMove) + ' at its fastest over 5/10/20 sessions' + (smallCap ? ' (small-cap threshold)' : '')),
      chk('>= ' + cfg.psMinExtensionAdr + ' ADRs above the 20EMA', extAdr >= cfg.psMinExtensionAdr, round(extAdr, 1) + ' ADRs extended'),
      chk('RSI(14) >= ' + cfg.psMinRsi, r >= cfg.psMinRsi, round(r, 0)),
      chk('First sign of weakness', weakness.length > 0, weakness.length ? weakness.join(', ') : 'still going straight up - do not front-run it')
    ]);

    // His preferred trigger is a failed bounce into VWAP, which is an intraday
    // level. When the data carries one, use it and stop at that session's high;
    // otherwise fall back to a sell-stop under the two-day low.
    var hasVwap = num(bar.vwapFail);
    var trigger = hasVwap ? bar.vwapFail : Math.min(bar.low, bars[i - 1].low);
    var structuralStop = hasVwap ? bar.high : Math.max(bar.high, bars[i - 1].high);
    var plan = shortPlan(f, trigger, structuralStop, cfg);
    plan.usedVwap = hasVwap;
    if (hasVwap) {
      plan.entryRule = 'Failed reclaim of VWAP on ' + bar.date + ' (reference ' + round(bar.vwapFail, 2) +
        '), which is his preferred trigger; the alternatives are the 1- or 5-min opening-range low and the ' +
        'first red 5-min candle after a gap up. Never on day one of the move.';
      plan.stopRule = 'Hard stop at the high of ' + bar.date + ' (' + round(bar.high, 2) + ').';
    }
    plan.targetNote = 'First cover zone is the 10-day EMA at ' + round(e10, 2) + ' and the 20-day EMA at ' + round(e20, 2) +
                      ' (' + round((f.price - e20) / f.price * 100, 1) + '% below here).';

    var gateFails = checks.slice(0, 3).filter(function (c) { return !c.pass; }).length;
    var score = clamp(bestMove / (moveNeeded * 2), 0, 1) * 30 + clamp(extAdr / 10, 0, 1) * 25 +
                clamp((r - 60) / 40, 0, 1) * 15 + clamp(upDays / 6, 0, 1) * 15 + (weakness.length ? 15 : 0);

    return {
      type: 'parabolic', eligible: gateFails === 0 && upDays >= cfg.psMinUpDays && bestMove >= moveNeeded * 0.8 &&
                                   extAdr >= cfg.psMinExtensionAdr * 0.8 && weakness.length > 0,
      status: weakness.length ? 'triggered' : 'watch',
      upDays: upDays, bestMove: bestMove, extensionAdr: extAdr, rsi: r, weakness: weakness, smallCap: !!smallCap,
      peakDate: bars[peakIdx].date, barsSincePeak: barsSincePeak, peakClose: bars[peakIdx].close,
      checks: checks, failing: checks.filter(function (c) { return !c.pass; }), plan: plan, score: clamp(score, 0, 100)
    };
  }

  /* ------------------------------------------------------- trend template
   * Mark Minervini's eight-point trend template. Qullamaggie's screen and
   * Minervini's overlap but are not the same test: the flag mechanics can be
   * perfect on a stock whose longer-term structure is still repairing. We run
   * both and let the justification say which is which, rather than silently
   * calling everything textbook.                                            */

  function trendTemplate(f, rank) {
    var i = f.n - 1;
    var c = f.price;
    var s50 = f.sma50[i], s150 = f.sma150[i], s200 = f.sma200[i];
    var s200Prior = f.sma200[i - 20];
    var rs = rank && num(rank.rsRating) ? rank.rsRating : null;
    var items = [
      { label: 'Price above the 150- and 200-day MA',
        pass: num(s150) && num(s200) && c > s150 && c > s200,
        detail: num(s150) && num(s200)
          ? round(c, 2) + ' vs 150MA ' + round(s150, 2) + ' / 200MA ' + round(s200, 2)
          : 'not enough history' },
      { label: '150-day MA above the 200-day',
        pass: num(s150) && num(s200) && s150 > s200,
        detail: num(s150) && num(s200) ? round(s150, 2) + ' vs ' + round(s200, 2) : 'not enough history' },
      { label: '200-day MA trending up for at least a month',
        pass: num(s200) && num(s200Prior) && s200 > s200Prior,
        detail: num(s200) && num(s200Prior)
          ? (s200 / s200Prior - 1 >= 0 ? '+' : '') + round((s200 / s200Prior - 1) * 100, 1) + '% over 20 sessions'
          : 'not enough history' },
      { label: '50-day MA above both the 150- and 200-day',
        pass: num(s50) && num(s150) && num(s200) && s50 > s150 && s50 > s200,
        detail: num(s50) ? '50MA ' + round(s50, 2) : 'not enough history' },
      { label: 'Price above the 50-day MA',
        pass: num(s50) && c > s50,
        detail: num(s50) ? round((c / s50 - 1) * 100, 1) + '% above the 50MA' : 'not enough history' },
      { label: 'At least 30% above the 52-week low',
        pass: f.pctFrom52Low >= 30,
        detail: round(f.pctFrom52Low, 0) + '% above the 52-week low' },
      { label: 'Within 25% of the 52-week high',
        pass: f.pctOff52High <= 25,
        detail: round(f.pctOff52High, 1) + '% off the 52-week high' },
      { label: 'RS rating 70 or better',
        pass: rs == null ? null : rs >= 70,        // null = cannot be assessed
        detail: rs != null ? 'RS ' + rs : 'not assessable — no universe to rank against' }
    ];
    // A criterion we cannot measure is excluded from the score rather than
    // counted as a failure: screening one symbol on its own gives no RS rank.
    var assessable = items.filter(function (x) { return x.pass !== null; });
    var passed = assessable.filter(function (x) { return x.pass; }).length;
    return { items: items, passed: passed, total: assessable.length,
             unassessed: items.length - assessable.length, rsRating: rs };
  }

  /* ------------------------------------------------------------- quality
   * Grades a setup that has already passed the mechanical screen. The point is
   * NOT to exclude weak-momentum names - they are still tradeable under his
   * rules - but to say plainly where a candidate sits, and to attach the
   * specific caveats a trader should price in before taking it.             */

  var GRADES = {
    'A+': { label: 'A+ — textbook', blurb: 'This is the textbook version of the setup' },
    'A':  { label: 'A — high quality', blurb: 'A high-quality setup' },
    'B':  { label: 'B — tradeable, second tier', blurb: 'A mechanically valid but second-tier setup' },
    'C':  { label: 'C — mechanically qualifies only',
            blurb: 'This one clears the mechanical screen without the trend structure behind it' }
  };

  function assessQuality(f, setup, cfg, rank, regime) {
    var tt = trendTemplate(f, rank);
    var strengths = [], caveats = [];
    var rs = tt.rsRating;

    // ---- trend structure ------------------------------------------------
    var failedTT = tt.items.filter(function (x) { return x.pass === false; });
    if (tt.passed === tt.total) {
      strengths.push('it passes all ' + tt.total + ' of the Minervini trend-template tests that can be measured here');
    } else if (tt.passed >= tt.total - 2) {
      strengths.push('it passes ' + tt.passed + ' of ' + tt.total + ' Minervini trend-template tests');
    }
    if (failedTT.length) {
      caveats.push('it fails ' + failedTT.length + ' of Minervini\'s trend-template tests (' +
        failedTT.map(function (x) { return x.label.toLowerCase(); }).join('; ') + ')');
    }
    if (tt.unassessed) {
      caveats.push('relative strength could not be ranked — this symbol was screened on its own rather than ' +
        'against a universe, so the RS test is unscored');
    }

    // ---- relative strength ----------------------------------------------
    if (rs != null) {
      if (rs >= 90) strengths.push('relative strength is in the top decile of the screened universe (RS ' + rs + ')');
      else if (rs < 70) caveats.push('relative strength is only RS ' + rs +
        ', below the 70 floor Minervini treats as a minimum and well below the 80-90 where leadership lives — ' +
        'this is a momentum setup on a stock that is not yet a momentum leader');
    }

    // ---- volatility fit --------------------------------------------------
    if (f.adr >= cfg.goodAdr) strengths.push('ADR is leader-grade at ' + round(f.adr, 1) + '%');
    else caveats.push('ADR of ' + round(f.adr, 1) + '% is below the 5-6% he looks for, so the same number of ' +
      'R takes proportionally longer to arrive and the trade ties up capital for more time');

    // ---- position in the larger move ------------------------------------
    if (f.pctOff52High > 25) {
      caveats.push('it sits ' + round(f.pctOff52High, 0) + '% below its 52-week high, which makes this a repair ' +
        'pattern rather than a leadership breakout into blue sky');
    } else if (f.pctOff52High <= 5) {
      strengths.push('it is within ' + round(f.pctOff52High, 1) + '% of its 52-week high, so there is little ' +
        'trapped supply overhead');
    }

    // ---- setup-specific --------------------------------------------------
    if (setup.type === 'breakout' && setup.base) {
      var b = setup.base;
      if (b.higherLows && b.contraction <= 0.85 && b.volRatio <= 0.8) {
        strengths.push('the base has the full signature — rising lows, a ' + round(b.contraction, 2) +
          'x range contraction and volume down to ' + round(b.volRatio, 2) + 'x the advance');
      }
      if (!b.higherLows) caveats.push('the lows through the base are flat or falling rather than rising, which is ' +
        'the difference between accumulation and a stock merely pausing');
      if (b.volRatio > 1.0) caveats.push('volume through the base ran at ' + round(b.volRatio, 2) +
        'x the volume of the advance — supply is still being distributed into the range');
      if (b.contraction > 1.0) caveats.push('the daily range widened through the base instead of contracting');
      if (b.depthPct > b.depthCapPct * 0.85) caveats.push('at ' + round(b.depthPct, 1) +
        '% the base is close to the ' + round(b.depthCapPct, 1) + '% its ADR would justify — deeper bases fail more often');
      if (b.leg.pct < 40) caveats.push('the prior leg was only ' + round(b.leg.pct, 0) +
        '%, modest for a setup whose edge comes from continuation of a powerful move');
      if (setup.status === 'triggered-lowvol') caveats.push('the breakout printed on ' + round(setup.rvol, 1) +
        'x average volume — a range expansion without volume expansion is the classic failed breakout');
      if (setup.status === 'extended') caveats.push('price is already ' + round(setup.extendedPct, 1) +
        '% past the pivot, so the low-risk entry has gone');
    }
    if (setup.type === 'ep') {
      if (setup.rvol >= 5) strengths.push('the gap came on ' + round(setup.rvol, 1) + 'x normal volume');
      else if (setup.rvol < cfg.epMinRvol) caveats.push('volume was only ' + round(setup.rvol, 1) +
        'x average — the setup wants the full average daily volume inside the first 15-20 minutes, and a quiet ' +
        'gap is usually sold');
      if (setup.closeInRangePct < 50) caveats.push('it closed in the bottom ' + round(setup.closeInRangePct, 0) +
        '% of the gap day\'s range, so the buyers who made the gap did not stay for the bell');
      if (setup.baseRangePct > cfg.epBaseMaxRange * 0.8) caveats.push('the prior ' + cfg.epBaseWindow +
        ' sessions spanned ' + round(setup.baseRangePct, 0) + '%, so this is not the dormant, forgotten base the ' +
        'setup depends on — there is trapped supply above');
    }
    if (setup.type === 'parabolic') {
      if (!setup.weakness.length) caveats.push('there is still no sign of weakness, so this is a watch-list entry ' +
        'and not a trade');
      if (setup.extensionAdr >= 6) strengths.push('it is stretched ' + round(setup.extensionAdr, 1) +
        ' ADRs above the 20-day EMA');
    }

    // ---- risk and regime -------------------------------------------------
    var planAdr = setup.plan ? Math.abs(setup.plan.riskPct) / f.adr : null;
    if (setup.plan && !setup.plan.stopWithinAdr) {
      caveats.push('the structural stop is wider than one ADR, so the level below is the ADR cap rather than the ' +
        'chart — if the trigger day closes with its low further away than that, his rule is to skip the trade');
    } else if (planAdr != null && planAdr <= 0.6) {
      strengths.push('risk is only ' + round(planAdr, 2) + 'x ADR, so one average day of follow-through pays ' +
        'roughly ' + round(1 / planAdr, 1) + 'R');
    }
    if (regime && regime.state && regime.state !== 'uptrend' && setup.plan && setup.plan.side !== 'short') {
      caveats.push('the index is ' + regime.label.toLowerCase() + ', and long breakouts fail disproportionately ' +
        'in that tape');
    }

    // ---- grade -----------------------------------------------------------
    var baseQuality = setup.type === 'breakout' && setup.base ? setup.base.quality : 60;
    var grade;
    var hardCaveats = caveats.length - (tt.unassessed ? 1 : 0);   // an unscored test is not a flaw
    if (tt.passed === tt.total && setup.score >= 72 && baseQuality >= 62 && hardCaveats <= 1) grade = 'A+';
    else if (tt.passed >= tt.total - 1 && setup.score >= 62 && hardCaveats <= 3) grade = 'A';
    else if (tt.passed >= Math.ceil(tt.total * 0.6)) grade = 'B';
    else grade = 'C';
    // a setup nobody can enter cheaply is not an A, whatever the structure says
    if (grade !== 'C' && setup.plan && !setup.plan.stopWithinAdr && grade === 'A+') grade = 'A';

    return {
      grade: grade, label: GRADES[grade].label, blurb: GRADES[grade].blurb,
      trendTemplate: tt, strengths: strengths, caveats: caveats,
      rsRating: rs, ttPassed: tt.passed
    };
  }

  /* --------------------------------------------------------- justification */

  function justify(sym, f, setup, cfg, rank, regime) {
    var s = [], p = setup;
    var q = p.quality || assessQuality(f, p, cfg, rank, regime);
    var adrWord = f.adr >= 8 ? 'very high' : f.adr >= cfg.goodAdr ? 'leader-grade' : 'modest';
    var rs = q.rsRating;

    s.push(sym + ' trades at $' + round(f.price, 2) + ' with a ' + pct(f.adr) + ' ADR (' + adrWord +
      ') and ' + money(f.dollarVol20) + ' of average daily turnover, so it is ' +
      (f.adr >= cfg.goodAdr ? 'volatile enough to pay multiples of risk in days' :
        'liquid enough to trade cleanly, though its daily range is on the slow side for this strategy') +
      '. It is up ' + pct(f.ret1m) + ' over one month, ' + pct(f.ret3m) + ' over three and ' + pct(f.ret6m) +
      ' over six' + (rs != null ? ', an RS rating of ' + rs : '') +
      ', and it sits ' + pct(f.pctOff52High) + ' off its 52-week high.');

    if (p.type === 'breakout') {
      var b = p.base;
      s.push(q.blurb + ': a ' + pct(b.leg.pct) + ' advance over ' + b.leg.bars +
        ' sessions beginning ' + b.leg.startDate + ', then ' + b.len + ' sessions of consolidation since ' +
        b.startDate + '. The base is ' + pct(b.depthPct) + ' deep against the ' + pct(b.depthCapPct) +
        ' its ADR would allow, ' + (b.higherLows ? 'lows are rising (' + (b.lowsSlopePct >= 0 ? '+' : '') +
        pct(b.lowsSlopePct) + ' back-half vs front-half)' : 'the lows are flat rather than rising') +
        ', the daily range has moved to ' + round(b.contraction, 2) + 'x what it was at the start of the base, ' +
        'and volume has run at ' + round(b.volRatio, 2) + 'x the volume of the advance. Price spent ' +
        round(b.aboveSma50Frac * 100, 0) + '% of the base above the 50-day MA while hugging the 20-day EMA.');
      s.push(p.status === 'triggered' ? 'It cleared the ' + round(p.pivot, 2) + ' pivot on ' + p.breakoutDate +
        ' on ' + round(p.rvol, 1) + 'x average volume with a ' + round(p.rangeExpansion, 1) +
        'x range expansion, which is the trigger.'
        : p.status === 'extended' ? 'It has already run ' + pct(p.extendedPct) + ' past the ' + round(p.pivot, 2) +
        ' pivot (' + round(p.extendedPct / f.adr, 1) + ' ADRs), so the low-risk entry is gone.'
        : p.status === 'triggered-lowvol' ? 'It has cleared the ' + round(p.pivot, 2) + ' pivot, but on only ' +
        round(p.rvol, 1) + 'x volume.'
        : 'The trigger sits ' + pct(p.distToPivotPct) + ' overhead at ' + round(p.pivot, 2) +
        ', inside one ADR, so it is actionable on the next range expansion.');
    } else if (p.type === 'ep') {
      s.push(q.blurb + ', and an episodic pivot rather than a chart pattern: ' + sym + ' gapped ' + pct(p.gap) +
        ' on ' + p.gapDate + ' on ' + round(p.rvol, 1) + 'x its average volume, after spending the prior ' +
        cfg.epBaseWindow + ' sessions in a ' + pct(p.baseRangePct) + ' range. It closed in the top ' +
        round(100 - p.closeInRangePct, 0) + '% of the gap day\'s range.' +
        (p.baseRangePct <= cfg.epBaseMaxRange * 0.6
          ? ' Dormancy is the feature here: a stock nobody was positioned in has no trapped supply overhead, ' +
            'so the repricing has to be chased.' : ''));
      s.push(p.plan.intradayNote);
    } else {
      s.push(q.blurb + ' on the short side: ' + sym + ' is up ' + pct(p.bestMove) +
        ' at its fastest over the last 5-20 sessions, ' + p.upDays + ' consecutive up closes, RSI(14) at ' +
        round(p.rsi, 0) + ', and price stretched ' + round(p.extensionAdr, 1) + ' ADRs above its 20-day EMA.');
      s.push(p.weakness.length ? 'The first crack has appeared — it ' + p.weakness.join(' and ') +
        ' — which is the only condition under which this setup is tradeable.'
        : 'There is still no sign of weakness, so this is a watch-list name only.');
      s.push(p.plan.targetNote);
    }

    if (q.strengths.length) {
      s.push('In its favour: ' + joinList(q.strengths) + '.');
    }
    if (q.caveats.length) {
      s.push('Caveats — ' + joinList(q.caveats) + '.');
    } else {
      s.push('No structural caveats: the trend template, the base and the risk all line up.');
    }
    return s.join(' ');
  }

  function joinList(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join('; ') + '; and ' + items[items.length - 1];
  }

  function planText(sym, f, setup) {
    var p = setup.plan, t = [];
    var dir = p.side === 'short' ? 'short' : 'long';
    t.push('Entry: ' + p.entryRule + ' Reference level $' + round(p.entry, 2) + '.');
    var planAdrMult = Math.abs(p.riskPct) / f.adr;
    t.push('Stop: $' + round(p.stop, 2) + ' - ' + p.stopRule + ' That is ' + pct(Math.abs(p.riskPct)) +
           ' of price, ' + round(planAdrMult, 2) + 'x ADR.' +
           (p.stopWithinAdr ? '' : ' Note: the structural level (' + pct(Math.abs(p.structuralRiskPct)) + ', ' +
            round(p.adrMultiple, 2) + 'x ADR) is wider than the 1x-ADR rule, so this stop is the ADR cap - if the ' +
            'trigger day closes with its low further away than that, skip the trade rather than widening the risk.'));
    if (dir === 'long') {
      t.push('Targets: ' + '3R at $' + round(p.targets.r3, 2) + ', 5R at $' + round(p.targets.r5, 2) +
             '; then trail the balance on the ' + p.targets.trailMa + '.');
    } else {
      t.push('Targets: the 10-day EMA at $' + round(p.targets.ema10, 2) + ' and the 20-day EMA at $' + round(p.targets.ema20, 2) +
             ' (3R at $' + round(p.targets.r3, 2) + ').');
    }
    t.push('Management: ' + p.management);
    if (p.size) {
      t.push('Size: ' + p.size.shares.toLocaleString() + ' shares (' + money(p.size.notional) + ', ' +
             round(p.size.positionPct, 1) + '% of equity) risks ' + money(p.size.dollarsAtRisk) + ' = ' +
             round(p.size.riskOfEquityPct, 2) + '% of the account' +
             (p.size.notes.length ? '; ' + p.size.notes.join('; ') + '.' : '.'));
    }
    return t.join(' ');
  }

  /* ---------------------------------------------------------- market regime */

  function regimeFromIndex(bars) {
    if (!bars || bars.length < 210) return { state: 'unknown', label: 'Unknown', note: 'Not enough index history to judge the regime.', sizeHint: 1 };
    var f = computeFeatures(bars), i = f.n - 1;
    var above200 = f.price > f.sma200[i];
    var above50 = f.price > f.sma50[i];
    var rising200 = f.sma200[i] > f.sma200[i - 20];
    var dd = (Math.max.apply(null, slice(f.bars, f.n - 60, f.n).map(function (b) { return b.high; })) - f.price) / f.price * 100;
    var state, label, note, hint;
    if (above200 && above50 && rising200) {
      state = 'uptrend'; label = 'Uptrend'; hint = 1;
      note = 'Index above a rising 200-day and above the 50-day: full size on A+ setups, this is when breakouts pay.';
    } else if (above200 && !above50) {
      state = 'chop'; label = 'Choppy / pullback inside an uptrend'; hint = 0.6;
      note = 'Index above the 200-day but below the 50-day, ' + round(dd, 1) + '% off its 60-day high: half size, demand tighter bases, expect more failures.';
    } else if (!above200) {
      state = 'downtrend'; label = 'Downtrend'; hint = 0.25;
      note = 'Index below its 200-day: his own rule is to sit in cash, trade less and trade smaller - breakouts in downtrends mostly fail. The short book is where the edge moves.';
    } else {
      state = 'mixed'; label = 'Mixed'; hint = 0.6;
      note = 'Mixed signals from the index - treat as reduced size.';
    }
    return { state: state, label: label, note: note, sizeHint: hint, drawdownPct: dd,
             price: f.price, sma50: f.sma50[i], sma200: f.sma200[i] };
  }

  /* ---------------------------------------------------------------- screen */

  function screen(universe, options) {
    var cfg = Object.assign({}, DEFAULTS, options || {});
    var enabled = cfg.setups || { breakout: true, ep: true, parabolic: true };
    var regime = cfg.indexBars ? regimeFromIndex(cfg.indexBars) : (cfg.regime || null);

    // pass 1: features + liquidity gate
    var pool = [];
    universe.forEach(function (row) {
      var bars = row.bars;
      if (!bars || bars.length < 130) {
        pool.push({ symbol: row.symbol, meta: row, skipped: 'needs at least 130 daily bars (has ' + (bars ? bars.length : 0) + ')' });
        return;
      }
      var f = computeFeatures(bars);
      pool.push({ symbol: row.symbol, name: row.name, sector: row.sector, meta: row, f: f });
    });

    // pass 2: RS percentiles across the liquid part of the universe
    var liquid = pool.filter(function (r) {
      return r.f && r.f.price >= cfg.minPrice && r.f.dollarVol20 >= cfg.minDollarVol;
    });
    ['ret1m', 'ret3m', 'ret6m'].forEach(function (key) {
      var vals = liquid.map(function (r) { return r.f[key]; }).filter(num).slice().sort(function (a, b) { return b - a; });
      liquid.forEach(function (r) {
        var v = r.f[key];
        if (!num(v) || !vals.length) return;
        var idx = vals.findIndex(function (x) { return x <= v; });
        r.rank = r.rank || {};
        r.rank[key] = (idx < 0 ? 100 : (idx / vals.length) * 100);
      });
    });
    // Market-cap percentile across the screened universe (0 = largest).
    var caps = liquid.map(function (r) { return num(r.meta && r.meta.marketCap) ? r.meta.marketCap : NaN; })
                     .filter(num).slice().sort(function (a, b) { return b - a; });
    liquid.forEach(function (r) {
      var mc = r.meta && r.meta.marketCap;
      if (num(mc) && caps.length) {
        var ci = caps.findIndex(function (x) { return x <= mc; });
        r.marketCap = mc;
        r.marketCapPct = (ci < 0 ? 100 : ci / caps.length * 100);
      }
    });

    liquid.forEach(function (r) {
      if (!r.rank) return;
      r.rank.best = Math.min(
        num(r.rank.ret1m) ? r.rank.ret1m : 100,
        num(r.rank.ret3m) ? r.rank.ret3m : 100,
        num(r.rank.ret6m) ? r.rank.ret6m : 100);
      r.rank.all3 = Math.max(
        num(r.rank.ret1m) ? r.rank.ret1m : 100,
        num(r.rank.ret3m) ? r.rank.ret3m : 100,
        num(r.rank.ret6m) ? r.rank.ret6m : 100);
      // RS rating in the familiar 1-99 convention: 99 is the strongest name in
      // the universe, 1 the weakest. rank.best is a "top N%" figure, so invert.
      if (num(r.rank.best)) r.rank.rsRating = clamp(Math.round(100 - r.rank.best), 1, 99);
    });

    // pass 3: setups
    var results = [];
    var capGate = num(cfg.marketCapTopPct) && cfg.marketCapTopPct > 0 && cfg.marketCapTopPct < 100
      ? cfg.marketCapTopPct : null;

    pool.forEach(function (r) {
      if (!r.f) { results.push({ symbol: r.symbol, skipped: r.skipped, setups: [], eligible: false }); return; }
      var f = r.f, cand = [];
      if (enabled.breakout) cand.push(detectBreakout(f, cfg, r.rank));
      if (enabled.ep) cand.push(detectEP(f, cfg, r.rank));
      if (enabled.parabolic) cand.push(detectParabolic(f, cfg, r.meta));

      var byScore = function (a, b) { return (b.score || 0) - (a.score || 0); };
      var eligible = cand.filter(function (c) { return c.eligible; }).sort(byScore);

      // Outside the market-cap band the name is still analysed - it just cannot
      // be traded from this screen, and the reason is recorded.
      var capReason = null;
      if (capGate) {
        if (!num(r.marketCapPct)) capReason = 'no market cap available to rank';
        else if (r.marketCapPct > capGate) capReason = 'market cap outside the top ' + capGate + '% of the universe';
      }
      var best = capReason ? null : (eligible[0] || null);

      // A "display" setup exists even for rejects, so the UI can show the chart
      // and the failing criteria for any symbol the user clicks.
      var display = eligible[0] || cand.slice().sort(byScore)[0] || null;
      if (display && display.plan) display.quality = assessQuality(f, display, cfg, r.rank, regime);

      var rec = {
        symbol: r.symbol, name: r.name, sector: r.sector, f: f, rank: r.rank || null,
        marketCap: num(r.marketCap) ? r.marketCap : (r.meta && num(r.meta.marketCap) ? r.meta.marketCap : null),
        marketCapPct: num(r.marketCapPct) ? r.marketCapPct : null,
        setups: cand, best: best, display: display, eligible: !!best, regime: regime,
        capReason: capReason,
        quality: display && display.quality ? display.quality : null,
        score: (best || display) ? (best || display).score : 0
      };
      if (display && display.plan) {
        rec.justification = justify(r.symbol, f, display, cfg, r.rank, regime);
        rec.planText = planText(r.symbol, f, display);
        rec.hypothetical = !best;   // shown for context; not a tradeable signal
      }
      results.push(rec);
    });

    results.sort(function (a, b) { return (b.eligible - a.eligible) || (b.score - a.score); });
    return { cfg: cfg, regime: regime, results: results,
             counts: {
               universe: universe.length,
               eligible: results.filter(function (r) { return r.eligible; }).length,
               breakout: results.filter(function (r) { return r.best && r.best.type === 'breakout'; }).length,
               ep: results.filter(function (r) { return r.best && r.best.type === 'ep'; }).length,
               parabolic: results.filter(function (r) { return r.best && r.best.type === 'parabolic'; }).length
             } };
  }

  /* ------------------------------------------------------------------- csv */

  /* RFC4180-ish field splitter: quoted fields may contain commas and escaped
   * quotes, which a plain split(',') would tear apart. */
  function splitCsvLine(line) {
    var out = [], cur = '', inQuotes = false, i, ch;
    for (i = 0; i < line.length; i++) {
      ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text) {
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim().length; });
    if (!lines.length) return [];
    var head = splitCsvLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    var ix = {
      symbol: head.findIndex(function (h) { return /^(symbol|ticker|sym)$/.test(h); }),
      date: head.findIndex(function (h) { return /^(date|timestamp|time)$/.test(h); }),
      open: head.indexOf('open'), high: head.indexOf('high'), low: head.indexOf('low'),
      close: head.findIndex(function (h) { return /^(close|adj close|adjclose)$/.test(h); }),
      volume: head.findIndex(function (h) { return /^(volume|vol)$/.test(h); }),
      marketCap: head.findIndex(function (h) { return /^(marketcap|market_cap|mktcap|cap)$/.test(h); }),
      name: head.findIndex(function (h) { return /^(name|company|security)$/.test(h); })
    };
    if (ix.date < 0 || ix.close < 0) throw new Error('CSV needs at least date and close columns (got: ' + head.join(', ') + ')');
    var bySym = {}, meta = {};
    lines.slice(1).forEach(function (line) {
      var c = splitCsvLine(line);
      var sym = ix.symbol >= 0 ? (c[ix.symbol] || '').trim().toUpperCase() : 'IMPORT';
      var bar = {
        date: (c[ix.date] || '').trim().slice(0, 10),
        open: parseFloat(c[ix.open >= 0 ? ix.open : ix.close]),
        high: parseFloat(c[ix.high >= 0 ? ix.high : ix.close]),
        low: parseFloat(c[ix.low >= 0 ? ix.low : ix.close]),
        close: parseFloat(c[ix.close]),
        volume: ix.volume >= 0 ? parseFloat(c[ix.volume]) || 0 : 0
      };
      if (!bar.date || !num(bar.close)) return;
      (bySym[sym] = bySym[sym] || []).push(bar);
      meta[sym] = meta[sym] || {};
      if (ix.marketCap >= 0 && !meta[sym].marketCap) {
        var mc = parseFloat(c[ix.marketCap]);
        if (num(mc) && mc > 0) meta[sym].marketCap = mc;
      }
      if (ix.name >= 0 && !meta[sym].name && (c[ix.name] || '').trim()) {
        meta[sym].name = c[ix.name].trim();
      }
    });
    return Object.keys(bySym).map(function (sym) {
      var bars = bySym[sym].sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var m = meta[sym] || {};
      return { symbol: sym, name: m.name || sym, marketCap: m.marketCap || null, bars: bars, source: 'csv' };
    });
  }

  return {
    DEFAULTS: DEFAULTS,
    // primitives exported for the chart builder and for tests
    sma: sma, ema: ema, rsi: rsi, adrPct: adrPct, mean: mean, last: last, round: round, clamp: clamp,
    avgVol: avgVol, avgDollarVol: avgDollarVol, pctChange: pctChange, trueRanges: trueRanges,
    computeFeatures: computeFeatures, findBase: findBase, scoreBase: scoreBase, priorMove: priorMove,
    longPlan: longPlan, shortPlan: shortPlan, sizePosition: sizePosition,
    detectBreakout: detectBreakout, detectEP: detectEP, detectParabolic: detectParabolic,
    justify: justify, planText: planText, regimeFromIndex: regimeFromIndex,
    trendTemplate: trendTemplate, assessQuality: assessQuality,
    screen: screen, parseCSV: parseCSV, splitCsvLine: splitCsvLine, money: money, pctFmt: pct, trendScore: trendScore
  };
});
