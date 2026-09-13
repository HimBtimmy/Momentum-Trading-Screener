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
    triggerBuffer: 0.001,     // 0.1% above the pivot for the buy-stop
    // --- Minervini overlay --------------------------------------------------
    // The second screener. Same bars, same features, different question: the
    // Trend Template asks whether this is a Stage 2 leader worth owning, where
    // his own screen asks whether a tradeable flag is about to break.
    mmMinRs: 70,              // Trend Template point 7 (his trades show 80-90+)
    mmMinRsShort: 90,         // the short side only fires on former leaders
    mmPivotMode: 'pivot60',   // 'pivot60' | 'high20' (see minerviniPivot)
    mmPivotLookback: 60,      // base-high window, excluding the last 3 bars
    mmPivotExclude: 3,        // a swing high needs 3 sessions to be confirmed
    mmShortLookback: 20,      // prior-high window for 'high20'
    mmStopAdrMult: 1.5,       // stop = pivot - 1.5x ADR%  (his 12y sweep pick)
    mmExtendedAdrMult: 0.5,   // beyond this above the pivot = already broken out
    mmBreakoutVolMult: 1.5,   // volume demanded on the breakout bar
    mmVolumeDryUpMax: 0.9,    // 3d/50d average volume below this = quiet
    mmTriggerWindow: 10       // sessions a short trigger stays fresh
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
      // 9- and 12-month legs feed the IBD-weighted RS the Minervini screen
      // ranks on; his own screen uses the 1/3/6-month percentiles above.
      ret9m: pctChange(bars, 189),
      ret12m: pctChange(bars, 252),
      price: last(bars).close
    };
    var w52 = slice(bars, bars.length - 252, bars.length);
    f.high52 = Math.max.apply(null, w52.map(function (b) { return b.high; }));
    f.low52 = Math.min.apply(null, w52.map(function (b) { return b.low; }));
    f.pctOff52High = (f.high52 - f.price) / f.high52 * 100;
    f.pctFrom52Low = (f.price / f.low52 - 1) * 100;
    f.atr14 = mean(slice(f.tr, f.tr.length - 14, f.tr.length).filter(num));

    /* ---- series the Minervini overlay needs, computed here so both screens
     * read one set of features rather than each walking the bars again. ---- */
    f.sma5 = sma(closes, 5);
    f.sma10 = sma(closes, 10);
    f.sma20 = sma(closes, 20);
    f.adr5 = adrPct(bars, 5);
    f.adr14 = adrPct(bars, 14);
    f.avgVol50 = avgVol(bars, 50);
    f.avgVol3 = avgVol(bars, 3);
    f.volDryUp = f.avgVol50 > 0 ? f.avgVol3 / f.avgVol50 : NaN;
    f.volSurgeNow = f.avgVol50 > 0 ? last(bars).volume / f.avgVol50 : NaN;
    // Where the 52-week intraday high sits: the base-length reading and the
    // VCP sampling are both anchored to it.
    var hiIdx = bars.length - w52.length;
    w52.forEach(function (b, i) { if (b.high >= f.high52) { hiIdx = bars.length - w52.length + i; } });
    f.high52Idx = hiIdx;
    f.baseLength = (bars.length - 1) - hiIdx;
    f.baseDepth52 = f.high52 > 0 ? (f.high52 - f.low52) / f.high52 * 100 : NaN;
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

  /* ======================================================================= *
   * MINERVINI OVERLAY
   *
   * The second screener. It reads the same features as his own screen — one
   * pass over the bars, two verdicts — but asks a different question: is this
   * a Stage 2 leader setting up, by the Trend Template, rather than is there a
   * tradeable flag about to break.
   *
   * Ported from a Python implementation of the Trend Template plus its
   * short-side leader-breakdown setup, with three deliberate changes:
   *   - entry and stop follow that implementation (base-high pivot plus a tick,
   *     stop 1.5x ADR below the pivot), but the TARGET does not: profits are
   *     taken on his schedule instead — a third to a half into strength after
   *     3-5 sessions, stop to breakeven, trail the rest on a moving average.
   *     A fixed 2.5R target and a trailed runner are different strategies, and
   *     mixing them would mean neither set of numbers describes the result.
   *   - the fundamental test (c6) is tri-state. A dataset without earnings data
   *     leaves it unassessed rather than failing it, and the grade is then
   *     capped at A: an unconfirmed name is not a textbook one.
   *   - relative strength at the time of an old breakdown cannot be ranked from
   *     a single year of bars, so the short side ranks on current RS and says so.
   * ======================================================================= */

  var MM_TIERS = {
    A: { label: 'Tier A — tradeable', note: 'every criterion holds, price is above the 20-day MA and volume has dried up' },
    B: { label: 'Tier B — watchlist', note: 'the template holds and price is above the 20-day MA, but the quality tests are incomplete' },
    C: { label: 'Tier C — radar', note: 'the template holds but price is still below the 20-day MA — not setting up yet' }
  };

  var MM_STATUS = {
    'mm-a': 'Tier A · tradeable',
    'mm-b': 'Tier B · watchlist',
    'mm-c': 'Tier C · radar',
    'mm-extended': 'Already broken out',
    'mm-short-a': 'Short A · wedge rejection',
    'mm-short-b': 'Short B · shallow rejection',
    'mm-short-c': 'Short C · first breakdown',
    'mm-none': 'No template setup'
  };

  /* The pivot is the high of the BASE, not the high of the last few days.
   * pivot60 (default) takes the highest intraday high of the last 60 sessions
   * excluding the most recent 3, because a swing high needs three subsequent
   * sessions before it is confirmed — a spike printed yesterday is a breakout
   * in progress, not pivot material. high20 is the shorter, more frequently
   * triggered alternative.                                                  */
  function minerviniPivot(f, cfg, mode) {
    var bars = f.bars, n = bars.length;
    var use60 = (mode || cfg.mmPivotMode) !== 'high20';
    var lookback = use60 ? cfg.mmPivotLookback : cfg.mmShortLookback;
    var exclude = use60 ? cfg.mmPivotExclude : 1;
    var to = n - exclude;
    var from = Math.max(0, to - lookback);
    if (to <= from) return null;
    var bestIdx = from, i;
    for (i = from; i < to; i++) if (bars[i].high > bars[bestIdx].high) bestIdx = i;
    var tick = num(cfg.stopTick) ? cfg.stopTick : 0.01;
    return {
      mode: use60 ? 'pivot60' : 'high20',
      baseHigh: bars[bestIdx].high,
      pivot: bars[bestIdx].high + tick,      // one tick above the base high
      idx: bestIdx,
      date: bars[bestIdx].date,
      window: (to - from) + ' sessions ending ' + exclude + ' bar' + (exclude === 1 ? '' : 's') + ' ago'
    };
  }

  /* IBD-weighted momentum as of any bar: 2x the most recent quarter plus the
   * 6-, 9- and 12-month legs. Weighting the latest quarter double is what makes
   * it reward acceleration rather than a year-old move. */
  function ibdRawAt(f, idx) {
    var p3 = pctAt(f.bars, idx, 63), p6 = pctAt(f.bars, idx, 126);
    var p9 = pctAt(f.bars, idx, 189), p12 = pctAt(f.bars, idx, 252);
    if (!num(p3) || !num(p6)) return NaN;
    return 2 * p3 + p6 + (num(p9) ? p9 : p6) + (num(p12) ? p12 : p6);
  }

  /* The first crack: a close below the 50-day MA after 20 clear sessions above
   * it. This anchors the whole short setup, and the RS measured here is what
   * decides whether the name was a leader when it topped. */
  function firstBreakIndex(f) {
    var closes = f.closes, s50 = f.sma50, n = f.n, k, j, clear;
    for (k = 21; k < n; k++) {
      if (!(num(s50[k]) && closes[k] < s50[k])) continue;
      clear = true;
      for (j = k - 20; j < k; j++) if (num(s50[j]) && closes[j] < s50[j]) { clear = false; break; }
      if (clear) return k;
    }
    return null;
  }

  /* Accumulation: institutions buying a base trade heavier on advances than on
   * declines. Doji bars are in neither average. */
  function greenRedVolume(f, lookback) {
    var bars = f.bars, from = Math.max(0, bars.length - lookback);
    var green = [], red = [], i, b;
    for (i = from; i < bars.length; i++) {
      b = bars[i];
      if (b.close > b.open) green.push(b.volume);
      else if (b.open > b.close) red.push(b.volume);
    }
    var g = green.length ? mean(green) : NaN, r = red.length ? mean(red) : NaN;
    return { green: g, red: r, ratio: num(g) && num(r) && r > 0 ? g / r : NaN,
             ok: num(g) && num(r) ? g > r : false };
  }

  function mmLongPlan(f, piv, cfg) {
    var entry = piv.pivot;
    var stop = entry * (1 - cfg.mmStopAdrMult * f.adr / 100);
    var riskPct = (entry - stop) / entry * 100;
    var plan = {
      side: 'long', kind: 'minervini',
      entry: entry,
      pivot: piv.pivot,
      entryRule: 'Buy-stop one tick above the base high at ' + round(piv.baseHigh, 2) +
                 ' (' + piv.mode + ': the highest high of the ' + piv.window + '), and only on ' +
                 'volume of at least ' + cfg.mmBreakoutVolMult + 'x the 50-day average.',
      stop: stop,
      stopRule: 'Hard stop ' + cfg.mmStopAdrMult + 'x ADR below the pivot (' +
                round(f.adr, 1) + '% ADR, so ' + round(cfg.mmStopAdrMult * f.adr, 1) + '% of the entry).',
      riskPct: riskPct,
      adrMultiple: riskPct / f.adr,
      stopWithinAdr: riskPct <= f.adr * cfg.mmStopAdrMult + 0.001,
      requiredVolume: num(f.avgVol50) ? f.avgVol50 * cfg.mmBreakoutVolMult : NaN,
      targets: {
        r3: entry + 3 * (entry - stop),
        r5: entry + 5 * (entry - stop),
        trailMa: f.adr >= cfg.goodAdr ? '10-day EMA' : '20-day EMA'
      },
      // Profit-taking is deliberately his, not the source implementation's 2.5R.
      management: 'Sell 1/3 to 1/2 into strength after 3-5 days and move the stop to breakeven; trail the ' +
                  'remainder on the ' + (f.adr >= cfg.goodAdr ? '10-day' : '20-day') +
                  ' moving average and exit on the first close below it.'
    };
    plan.size = sizePosition(entry, stop, f, cfg, 'long');
    return plan;
  }

  function mmShortPlan(f, trig, cfg) {
    var entry = trig.entry;
    var stop = trig.resistLevel * 1.015;       // 1.5% above whatever rejected price
    var riskPct = (stop - entry) / entry * 100;
    var plan = {
      side: 'short', kind: 'minervini-short',
      entry: entry,
      pivot: trig.resistLevel,
      entryRule: trig.kind === 'FIRST_BREAKDOWN'
        ? 'Short the first close below the 50-day MA (' + round(trig.resistLevel, 2) + ').'
        : 'Short the rejection at the falling ' + trig.resistName + ' (' + round(trig.resistLevel, 2) + ') — ' +
          'the bar reached it and closed back below.',
      stop: stop,
      stopRule: 'Stop 1.5% above ' + (trig.kind === 'FIRST_BREAKDOWN' ? 'the 50-day MA' : 'the rejection high') +
                ' at ' + round(trig.resistLevel, 2) + '.',
      riskPct: riskPct,
      adrMultiple: riskPct / f.adr,
      stopWithinAdr: riskPct <= f.adr * cfg.stopAdrHardCap,
      targets: {
        r3: entry - 3 * (stop - entry),
        r5: entry - 5 * (stop - entry),
        trailMa: '10/20-day MA'
      },
      management: 'Cover into the 10- and 20-day moving averages rather than holding for a fixed target; ' +
                  'these are fast, violent moves and the first bounce is usually the one to cover into.'
    };
    plan.size = sizePosition(entry, stop, f, cfg, 'short');
    return plan;
  }

  /* ---------------------------------------------------------------- the long
   * Minervini's eight points collapse to five tests: the four MA-relationship
   * checks are one chained inequality (price > 50 > 150 > 200), and the rest
   * follow by transitivity. c6-c8 are the quality layer the source adds:
   * fundamentals, accumulation and range contraction.                        */
  function minerviniLong(f, cfg, rank, fundamentals, mode) {
    var i = f.n - 1, c = f.price;
    var s20 = f.sma20[i], s50 = f.sma50[i], s150 = f.sma150[i], s200 = f.sma200[i];
    var s200Prior = f.sma200[i - 21];
    var rs = rank && num(rank.rsIbd) ? rank.rsIbd : (rank && num(rank.rsRating) ? rank.rsRating : null);
    var piv = minerviniPivot(f, cfg, mode);
    var lookback = piv && piv.mode === 'pivot60' ? cfg.mmPivotLookback : cfg.mmShortLookback;
    var acc = greenRedVolume(f, lookback);

    var fund = fundamentals || null;
    var epsYoY = fund && num(fund.epsYoY) ? fund.epsYoY : null;
    var salesYoY = fund && num(fund.salesYoY) ? fund.salesYoY : null;
    var fundKnown = epsYoY !== null && salesYoY !== null;

    var items = [
      { key: 'c1', label: 'MA stack: price above the 50-, 150- and 200-day MA, in order',
        pass: num(s50) && num(s150) && num(s200) && c > s50 && s50 > s150 && s150 > s200,
        detail: num(s200) ? round(c, 2) + ' > ' + round(s50, 2) + ' > ' + round(s150, 2) + ' > ' + round(s200, 2)
                          : 'not enough history for a 200-day average' },
      { key: 'c2', label: '200-day MA trending up for at least a month',
        pass: num(s200) && num(s200Prior) ? s200 > s200Prior : null,
        detail: num(s200) && num(s200Prior)
          ? (s200 >= s200Prior ? '+' : '') + round((s200 / s200Prior - 1) * 100, 1) + '% over 21 sessions'
          : 'not enough history' },
      { key: 'c3', label: 'At least 30% above the 52-week low',
        pass: f.pctFrom52Low >= 30,
        detail: round(f.pctFrom52Low, 0) + '% above the 52-week low' },
      { key: 'c4', label: 'Within 25% of the 52-week high',
        pass: f.pctOff52High <= 25,
        detail: round(f.pctOff52High, 1) + '% off the 52-week high' },
      { key: 'c5', label: 'RS rating ' + cfg.mmMinRs + ' or better',
        pass: rs == null ? null : rs >= cfg.mmMinRs,
        detail: rs != null ? 'RS ' + rs + ' (IBD-weighted: 2x3m + 6m + 9m + 12m)'
                           : 'not assessable — no universe to rank against' },
      { key: 'c6', label: 'Latest quarter grew both EPS and sales year on year',
        pass: fundKnown ? (epsYoY > 0 && salesYoY > 0) : null,
        detail: fundKnown
          ? 'EPS ' + (epsYoY >= 0 ? '+' : '') + round(epsYoY, 1) + '%, sales ' +
            (salesYoY >= 0 ? '+' : '') + round(salesYoY, 1) + '%' +
            (fund.quarter ? ' (' + fund.quarter + ')' : '')
          : 'no earnings data in this dataset — unassessed' },
      { key: 'c7', label: 'Accumulation: up-day volume heavier than down-day volume',
        pass: num(acc.ratio) ? acc.ok : null,
        detail: num(acc.ratio) ? round(acc.ratio, 2) + 'x over the last ' + lookback + ' sessions'
                               : 'not enough two-sided volume to judge' },
      { key: 'c8', label: 'Tightness: the 5-day range is inside the 14-day range',
        pass: num(f.adr5) && num(f.adr14) ? f.adr5 < f.adr14 : null,
        detail: num(f.adr5) && num(f.adr14)
          ? '5-day ADR ' + round(f.adr5, 2) + '% vs 14-day ' + round(f.adr14, 2) + '%' : 'not enough history' }
    ];

    var by = {};
    items.forEach(function (x) { by[x.key] = x.pass; });
    var assessable = items.filter(function (x) { return x.pass !== null; });
    var passed = assessable.filter(function (x) { return x.pass; }).length;

    // A criterion that cannot be measured — RS with no universe to rank against,
    // c2 without 200 sessions — is excluded from the gate rather than counted as
    // a failure, exactly as the trend-template overlay treats it. It still caps
    // the grade below A+: an unverified name is not a textbook one.
    var coreOk = ['c1', 'c3', 'c4'].every(function (k) { return by[k] === true; }) &&
                 by.c2 !== false && by.c5 !== false;
    // Only a measured failure counts as a failure, here as everywhere else in
    // this file: a dataset with no fundamentals would otherwise cap every name
    // at tier B, and a series with no down days would fail the accumulation test
    // for having nothing to compare against. Unmeasured tests cap the GRADE at A
    // further down instead, which is where an unverified name belongs.
    var qualityOk = by.c6 !== false && by.c7 !== false && by.c8 !== false;
    var above20 = num(s20) && c > s20;
    var dryUp = num(f.volDryUp) && f.volDryUp < cfg.mmVolumeDryUpMax;

    var tier = '';
    if (coreOk) tier = (qualityOk && above20 && dryUp) ? 'A' : (above20 ? 'B' : 'C');

    var out = {
      side: 'long', type: 'mm-long', items: items, by: by,
      passed: passed, total: assessable.length,
      unassessed: items.length - assessable.length,
      fundamentalsKnown: fundKnown, fundamentals: fund,
      rsRating: rs, tier: tier, coreOk: coreOk, qualityOk: qualityOk,
      above20ma: above20, dryUp: dryUp, volDryUp: f.volDryUp,
      accumulation: acc, pivot: piv
    };
    if (!piv) { out.status = 'mm-none'; return out; }

    var adrToPivot = num(f.adr) && f.adr > 0 ? ((piv.pivot / c - 1) * 100) / f.adr : NaN;
    out.adrToPivot = adrToPivot;
    out.plan = mmLongPlan(f, piv, cfg);

    // Has price already left the base? An unextended close stays a setup
    // whatever the timing — entry near the pivot is still valid on risk.
    var bars = f.bars, n = bars.length, k;
    var daysAbove = null;
    for (k = piv.idx + 1; k < n; k++) {
      if (bars[k].close > piv.pivot) { daysAbove = (n - 1) - k; break; }
    }
    var hi20 = Math.max.apply(null, slice(bars, n - 21, n).map(function (b) { return b.high; }));
    var extended = c > piv.pivot * (1 + cfg.mmExtendedAdrMult * f.adr / 100);
    out.daysAbovePivot = daysAbove;
    out.extended = extended;
    out.alreadyBreakout = !!(extended && ((daysAbove !== null && daysAbove >= 2) || last(bars).high >= hi20));

    // VCP shape: sample the base at five points from the 52-week high to today;
    // the three interior closes sitting under today's close means the base's
    // middle is below price as it comes up the right side.
    var dist = (n - 1) - f.high52Idx;
    var vcp = false;
    if (dist > 21 && c < f.high52) {
      vcp = [1, 2, 3].every(function (m) {
        return bars[f.high52Idx + Math.round(m * dist / 4)].close < c;
      });
    }
    out.vcpCandidate = vcp;
    out.eightWeekHoldCandidate = !!(vcp && dist > 63);

    out.status = (tier && out.alreadyBreakout) ? 'mm-extended'
      : tier ? 'mm-' + tier.toLowerCase() : 'mm-none';
    out.eligible = tier === 'A' && !out.alreadyBreakout;
    out.score = mmLongScore(f, out, cfg);
    return out;
  }

  function mmLongScore(f, mm, cfg) {
    // 45 template + 15 relative strength + 40 setup quality.
    // Unmeasurable criteria score as neutral (half marks) rather than zero, so a
    // single-symbol import is not punished for having no universe to rank against.
    var core = 0;
    core += mm.by.c1 === true ? 13 : mm.by.c1 === null ? 6.5 : 0;
    ['c2', 'c3', 'c4', 'c5'].forEach(function (k) {
      core += mm.by[k] === true ? 8 : mm.by[k] === null ? 4 : 0;
    });
    var passedCore = ['c1', 'c2', 'c3', 'c4', 'c5'].filter(function (k) { return mm.by[k] !== false; }).length;

    var rs = num(mm.rsRating) ? clamp((mm.rsRating - 50) / 49, 0, 1) * 15 : 0;

    // Setup quality: how ready this base is to break. It is scaled by how much
    // of the template holds, so a tight, quiet base on a stock that is not in a
    // Stage 2 uptrend cannot out-score one that is.
    var quality = 0;
    if (num(mm.adrToPivot)) {
      quality += mm.adrToPivot < 0
        ? (mm.extended ? 6 : 15)                     // through the pivot already
        : clamp(1 - (mm.adrToPivot - 1) / 3, 0, 1) * 15;
    }
    if (num(f.adr5) && num(f.adr14) && f.adr14 > 0) quality += clamp((1 - f.adr5 / f.adr14) / 0.4, 0, 1) * 10;
    if (num(f.volDryUp)) quality += clamp((1 - f.volDryUp) / 0.5, 0, 1) * 8;
    if (num(mm.accumulation.ratio)) quality += clamp((mm.accumulation.ratio - 1) / 0.5, 0, 1) * 7;

    return clamp(core + rs + quality * (passedCore / 5), 0, 100);
  }

  /* --------------------------------------------------------------- the short
   * A former leader topping out. The first crack below a still-rising 50-day MA
   * is rarely the trade: these stocks wedge back up on light volume, get
   * rejected at a falling MA, and break again. The rejection is the entry.   */
  function minerviniShort(f, cfg, rank) {
    var bars = f.bars, n = bars.length, i = n - 1;
    var closes = f.closes;
    var s5 = f.sma5, s10 = f.sma10, s20 = f.sma20, s50 = f.sma50;
    var rsNow = rank && num(rank.rsIbd) ? rank.rsIbd : (rank && num(rank.rsRating) ? rank.rsRating : null);
    // What matters is that it WAS a leader when it broke: by the time a stock
    // has topped and wedged for weeks its current RS has decayed. rank.rsAtBreak
    // is that reading, ranked across the universe; fall back only when a year of
    // history before the breakdown is not there to measure it.
    var rsAtBreak = rank && num(rank.rsAtBreak) ? rank.rsAtBreak : null;
    var rs = rsAtBreak != null ? rsAtBreak : rsNow;
    var rsSource = rsAtBreak != null ? 'as of the breakdown' : 'current — too little history to measure it at the breakdown';
    var c = f.price;

    var firstBreak = firstBreakIndex(f), k;

    var trig = null;
    function rejectionAt(p, swing) {
      if (p < swing || p >= n - 1) return null;
      var a, hiL = -Infinity, hiR = -Infinity;
      for (a = p - swing; a < p; a++) hiL = Math.max(hiL, bars[a].high);
      for (a = p + 1; a < Math.min(p + swing + 1, n); a++) hiR = Math.max(hiR, bars[a].high);
      if (!(bars[p].high >= hiL && bars[p].high >= hiR)) return null;
      var mas = [['10-day MA', s10], ['50-day MA', s50]];
      for (a = 0; a < mas.length; a++) {
        var lvl = mas[a][1][p];
        if (num(lvl) && bars[p].high >= lvl * 0.99 && closes[p] < lvl) {
          return { resistName: mas[a][0], resistLevel: bars[p].high };
        }
      }
      return null;
    }

    if (firstBreak !== null) {
      var scanFrom = Math.max(firstBreak + 1, n - 1 - cfg.mmTriggerWindow - 6, 3);
      var tiers = [[3, 'A'], [1, 'B']];
      for (var t = 0; t < tiers.length && !trig; t++) {
        for (var p = n - 3; p >= scanFrom; p--) {
          var rej = rejectionAt(p, tiers[t][0]);
          if (rej && c < closes[p]) {
            trig = { kind: 'WEDGE_REJECTION', idx: p, tier: tiers[t][1], entry: closes[p],
                     resistName: rej.resistName, resistLevel: rej.resistLevel };
            break;
          }
        }
      }
      if (!trig && (n - 1 - firstBreak) <= cfg.mmTriggerWindow) {
        trig = { kind: 'FIRST_BREAKDOWN', idx: firstBreak, tier: 'C', entry: closes[firstBreak],
                 resistName: '50-day MA', resistLevel: num(s50[firstBreak]) ? s50[firstBreak] : bars[firstBreak].high };
      }
    }

    // distribution: rallies are lighter than declines
    var up = [], dn = [], volOk = false, volRatio = NaN;
    if (trig) {
      for (k = Math.max(0, trig.idx - 15); k < n; k++) {
        if (bars[k].close > bars[k].open) up.push(bars[k].volume);
        else if (bars[k].open > bars[k].close) dn.push(bars[k].volume);
      }
      if (up.length && dn.length) {
        volRatio = mean(up) / mean(dn);
        volOk = mean(up) < mean(dn);
      }
    }

    var items = [
      { key: 's1', label: 'Latest close below the 50-day MA',
        pass: num(s50[i]) ? c < s50[i] : null,
        detail: num(s50[i]) ? round(c, 2) + ' vs 50MA ' + round(s50[i], 2) : 'not enough history' },
      { key: 's2', label: '5- and 10-day MAs both falling',
        pass: num(s5[i]) && num(s5[i - 3]) && num(s10[i]) && num(s10[i - 3])
          ? (s5[i] < s5[i - 3] && s10[i] < s10[i - 3]) : null,
        detail: num(s5[i]) && num(s5[i - 3]) ? '5MA ' + round(s5[i], 2) + ' vs ' + round(s5[i - 3], 2) : 'not enough history' },
      { key: 's4', label: 'Bearish short-term stack: 5MA below 10MA below 20MA',
        pass: num(s5[i]) && num(s10[i]) && num(s20[i]) ? (s5[i] < s10[i] && s10[i] < s20[i]) : null,
        detail: num(s20[i]) ? round(s5[i], 2) + ' < ' + round(s10[i], 2) + ' < ' + round(s20[i], 2) : 'not enough history' },
      { key: 's5', label: 'It was a leader: RS ' + cfg.mmMinRsShort + ' or better',
        pass: rs == null ? null : rs >= cfg.mmMinRsShort,
        detail: rs != null ? 'RS ' + rs + ' (' + rsSource + ')'
                           : 'not assessable — no universe to rank against' },
      { key: 's9', label: 'A strict wedge rejection fired in the last ' + cfg.mmTriggerWindow + ' sessions',
        pass: !!(trig && trig.tier === 'A'),
        detail: trig ? trig.kind.toLowerCase().replace('_', ' ') + ' on ' + bars[trig.idx].date +
                       ' at the ' + trig.resistName + ' (tier ' + trig.tier + ')'
                     : (firstBreak === null ? 'no 50-day MA breakdown in this window' : 'no rejection has formed yet') },
      { key: 's10', label: 'Rally volume lighter than decline volume',
        pass: num(volRatio) ? volOk : null,
        detail: num(volRatio) ? round(volRatio, 2) + 'x (below 1.0 is distribution)' : 'no trigger to measure from' }
    ];

    var by = {};
    items.forEach(function (x) { by[x.key] = x.pass; });
    var assessable = items.filter(function (x) { return x.pass !== null; });
    var passed = assessable.filter(function (x) { return x.pass; }).length;
    var passAll = items.every(function (x) { return x.pass === true; });

    var out = {
      side: 'short', type: 'mm-short', items: items, by: by,
      passed: passed, total: assessable.length,
      unassessed: items.length - assessable.length,
      rsRating: rs, rsNow: rsNow, rsAtBreak: rsAtBreak, trigger: trig, volRatio: volRatio,
      firstBreakIdx: firstBreak,
      firstBreakDate: firstBreak !== null ? bars[firstBreak].date : '',
      daysSinceFirstBreak: firstBreak !== null ? (n - 1) - firstBreak : null,
      tier: trig ? trig.tier : '',
      status: trig ? 'mm-short-' + trig.tier.toLowerCase() : 'mm-none',
      eligible: passAll
    };
    // non-gating confirmations: they describe how good the short is, not whether it fired
    out.confirmations = [
      { label: '50-day MA still rising — a first crack, not a late downtrend',
        pass: num(s50[i]) && num(s50[i - 21]) ? s50[i] > s50[i - 21] : null },
      { label: 'Peak was 1.5x the 200-day MA or more — room to fall',
        pass: (function () {
          var pk = Math.max(0, n - 60), m;
          for (m = Math.max(0, n - 60); m < n; m++) if (closes[m] > closes[pk]) pk = m;
          return num(f.sma200[pk]) ? closes[pk] >= 1.5 * f.sma200[pk] : null;
        }()) },
      { label: 'Death cross: 5-day MA below the 50-day',
        pass: num(s5[i]) && num(s50[i]) ? s5[i] < s50[i] : null }
    ];
    if (trig) out.plan = mmShortPlan(f, trig, cfg);
    out.score = mmShortScore(f, out, cfg);
    return out;
  }

  function mmShortScore(f, mm, cfg) {
    var pts = 0;
    ['s1', 's2', 's4', 's5', 's9', 's10'].forEach(function (k) { if (mm.by[k] === true) pts += 7.5; });
    if (num(mm.rsRating)) pts += clamp((mm.rsRating - 70) / 29, 0, 1) * 20;
    pts += mm.tier === 'A' ? 20 : mm.tier === 'B' ? 12 : mm.tier === 'C' ? 5 : 0;
    if (num(mm.volRatio)) pts += clamp((1 - mm.volRatio) / 0.4, 0, 1) * 15;
    return clamp(pts, 0, 100);
  }

  /* ------------------------------------------------------------ mm quality
   * The same A+/A/B/C shape as his own screen, so the two verdicts on a card
   * can be read against each other.                                          */
  var MM_GRADES = {
    'A+': { label: 'A+ — textbook', blurb: 'This is a textbook Trend Template setup' },
    'A':  { label: 'A — high quality', blurb: 'A high-quality Trend Template setup' },
    'B':  { label: 'B — watchlist', blurb: 'The trend template holds, but this is a watchlist name rather than a trade' },
    'C':  { label: 'C — radar only', blurb: 'This one is on the radar rather than setting up' },
    'D':  { label: 'D — fails the template', blurb: 'This one does not pass the Trend Template' }
  };

  function assessMmQuality(f, mm, cfg) {
    var strengths = [], caveats = [], grade;
    if (mm.side === 'short') return assessMmShortQuality(f, mm, cfg);

    var failed = mm.items.filter(function (x) { return x.pass === false; });
    if (mm.passed === mm.total) strengths.push('it passes all ' + mm.total + ' template tests that can be measured here');
    else if (failed.length) caveats.push('it fails ' + failed.length + ' template test' + (failed.length === 1 ? '' : 's') +
      ' (' + joinList(failed.map(function (x) { return x.label.toLowerCase(); })) + ')');

    if (num(mm.rsRating)) {
      if (mm.rsRating >= 90) strengths.push('an RS rating of ' + mm.rsRating + ' puts it in the top decile of the screened universe');
      else if (mm.rsRating >= cfg.mmMinRs) strengths.push('its RS rating is ' + mm.rsRating);
      else caveats.push('an RS rating of ' + mm.rsRating + ' is below the ' + cfg.mmMinRs +
        ' the template asks for — the trend is intact but the leadership is not');
    }
    if (mm.vcpCandidate) strengths.push('the base has a VCP shape: its interior sits below the current price as it comes up the right side');
    if (mm.eightWeekHoldCandidate) strengths.push('the base is deep enough (over three months) for the eight-week hold rule');
    if (mm.dryUp) strengths.push('volume has dried up into the pivot (' + round(mm.volDryUp, 2) + 'x the 50-day average)');
    else if (num(mm.volDryUp)) caveats.push('volume has not dried up — the last three sessions average ' +
      round(mm.volDryUp, 2) + 'x the 50-day, where under ' + cfg.mmVolumeDryUpMax + ' is the quiet the template wants');
    if (mm.by.c8 === true) strengths.push('the daily range is contracting into the pivot');
    else if (mm.by.c8 === false) caveats.push('the daily range is widening rather than contracting into the pivot');
    if (mm.by.c7 === null) caveats.push('accumulation could not be measured — this series has no two-sided volume to compare');
    if (!mm.above20ma) caveats.push('price is below the 20-day MA, so the setup has not begun to tighten yet');
    if (mm.alreadyBreakout) caveats.push('price has already left the base — this is a breakout in progress, not a fresh entry');
    if (num(mm.adrToPivot) && mm.adrToPivot > 2)
      caveats.push('the pivot is still ' + round(mm.adrToPivot, 1) + ' ADRs away, so nothing is actionable yet');
    if (mm.by.c5 === null) caveats.push('relative strength could not be ranked — this symbol was screened on its ' +
      'own rather than against a universe, so the leadership test is unscored');
    if (mm.by.c6 === null) caveats.push('earnings growth is unverified: this dataset carries no fundamentals, so the ' +
      'template\'s one non-technical test is unscored');
    else if (mm.by.c6 === false) caveats.push('the latest quarter did not grow both EPS and sales year on year');
    else strengths.push('the latest quarter grew both EPS and sales year on year');

    var unmeasured = mm.items.filter(function (x) { return x.pass === null; }).length;
    var hard = caveats.length - unmeasured;
    // A+ means every test was run and every test passed. Anything unverified is
    // an A at best, however good the parts that could be measured look.
    if (mm.tier === 'A' && mm.score >= 72 && hard <= 1 && !unmeasured) grade = 'A+';
    else if (mm.tier === 'A' && mm.score >= 62 && hard <= 3) grade = 'A';
    else if (mm.tier === 'A' || mm.tier === 'B') grade = 'B';
    else if (mm.tier === 'C' || (mm.tier && mm.alreadyBreakout)) grade = 'C';
    else grade = 'D';

    return { grade: grade, label: MM_GRADES[grade].label, blurb: MM_GRADES[grade].blurb,
             strengths: strengths, caveats: caveats, tier: mm.tier, rsRating: mm.rsRating,
             passed: mm.passed, total: mm.total };
  }

  function assessMmShortQuality(f, mm, cfg) {
    var strengths = [], caveats = [], grade;
    var failed = mm.items.filter(function (x) { return x.pass === false; });
    if (failed.length) caveats.push('it fails ' + failed.length + ' of the short criteria (' +
      joinList(failed.map(function (x) { return x.label.toLowerCase(); })) + ')');
    if (mm.trigger) {
      strengths.push('a ' + mm.trigger.kind.toLowerCase().replace('_', ' ') + ' fired on ' +
        f.bars[mm.trigger.idx].date + ' at the ' + mm.trigger.resistName);
    }
    if (num(mm.rsRating) && mm.rsRating >= cfg.mmMinRsShort)
      strengths.push('it was a genuine leader — RS ' + mm.rsRating);
    else if (num(mm.rsRating))
      caveats.push('RS ' + mm.rsRating + ' is below the ' + cfg.mmMinRsShort +
        ' this setup demands: breaking down was never the interesting part, being a leader first was');
    if (num(mm.volRatio) && mm.volRatio < 1) strengths.push('rallies are trading lighter than declines (' + round(mm.volRatio, 2) + 'x)');
    else if (num(mm.volRatio)) caveats.push('rallies are still trading heavier than declines (' + round(mm.volRatio, 2) + 'x) — buyers have not left');
    mm.confirmations.forEach(function (x) { if (x.pass === true) strengths.push(x.label.toLowerCase()); });

    if (mm.tier === 'A' && mm.eligible && mm.score >= 70 && caveats.length <= 1) grade = 'A+';
    else if (mm.tier === 'A' && mm.eligible) grade = 'A';
    else if (mm.tier === 'A' || mm.tier === 'B') grade = 'B';
    else if (mm.tier === 'C') grade = 'C';
    else grade = 'D';
    return { grade: grade, label: MM_GRADES[grade].label, blurb: MM_GRADES[grade].blurb,
             strengths: strengths, caveats: caveats, tier: mm.tier, rsRating: mm.rsRating,
             passed: mm.passed, total: mm.total };
  }

  function mmJustify(sym, f, mm, cfg) {
    var q = mm.quality, bits = [];
    if (mm.side === 'short') {
      bits.push(q.blurb + ': ' + sym + ' is a former leader in a topping process, ' +
        (mm.daysSinceFirstBreak !== null
          ? 'first breaking its 50-day MA ' + mm.daysSinceFirstBreak + ' sessions ago on ' + mm.firstBreakDate
          : 'though no clean first breakdown is visible in this window') + '.');
      if (mm.plan) {
        bits.push('The plan shorts ' + money(mm.plan.entry) + ' with the stop 1.5% above ' +
          money(mm.plan.pivot) + ', ' + round(Math.abs(mm.plan.riskPct), 2) + '% of the entry (' +
          round(mm.plan.adrMultiple, 2) + 'x ADR). Cover into the 10- and 20-day MAs rather than a fixed target.');
      }
    } else {
      bits.push(q.blurb + ': ' + sym + ' passes ' + mm.passed + ' of ' + mm.total +
        ' measurable Trend Template tests' +
        (mm.tier && MM_TIERS[mm.tier]
          ? ', which puts it in tier ' + mm.tier + ': ' + MM_TIERS[mm.tier].label.split('— ')[1]
          : ', which is not enough for a tier') + '.');
      if (num(mm.rsRating)) bits.push('Relative strength ranks it ' + mm.rsRating + ' of 99 against the screened universe.');
      if (mm.pivot && mm.plan) {
        bits.push('The base high is ' + money(mm.pivot.baseHigh) + ' (' + mm.pivot.mode + ', ' + mm.pivot.window +
          '), so the pivot sits one tick above at ' + money(mm.plan.entry) + ' and the stop ' +
          cfg.mmStopAdrMult + 'x ADR below it at ' + money(mm.plan.stop) + ' — ' +
          round(mm.plan.riskPct, 2) + '% of the entry' +
          (num(mm.adrToPivot)
            ? (mm.adrToPivot >= 0 ? ', with price ' + round(mm.adrToPivot, 2) + ' ADRs below the pivot'
                                  : ', with price already through the pivot')
            : '') + '.');
        if (num(mm.plan.requiredVolume)) bits.push('The breakout bar needs at least ' +
          Math.round(mm.plan.requiredVolume).toLocaleString() + ' shares (' + cfg.mmBreakoutVolMult +
          'x the 50-day average) — breakout volume was the single most predictive factor in the study behind this screen.');
      }
      bits.push('Profit-taking follows Kullamägi rather than a fixed multiple: a third to a half into strength after ' +
        '3-5 sessions, stop to breakeven, trail the rest on the ' + (mm.plan ? mm.plan.targets.trailMa : '20-day EMA') + '.');
    }
    if (q.strengths.length) bits.push('In its favour: ' + joinList(q.strengths) + '.');
    bits.push(q.caveats.length ? 'Caveats — ' + joinList(q.caveats) + '.'
                               : 'No structural caveats: the template, the base and the risk all line up.');
    return bits.join(' ');
  }

  /* The record-level entry point: long and short are mutually exclusive (the
   * long needs price above the 50-day MA, the short needs a close below it),
   * so only one of them is ever evaluated. */
  function evaluateMinervini(sym, f, cfg, rank, fundamentals, mode) {
    var i = f.n - 1;
    var aboveMa = num(f.sma50[i]) && f.price > f.sma50[i];
    var mm = aboveMa ? minerviniLong(f, cfg, rank, fundamentals, mode)
                     : minerviniShort(f, cfg, rank);
    mm.quality = assessMmQuality(f, mm, cfg);
    mm.grade = mm.quality.grade;
    mm.statusText = MM_STATUS[mm.status] || mm.status;
    mm.justification = mmJustify(sym, f, mm, cfg);
    return mm;
  }

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
    // Percentiles need something to be a percentile OF. Ranking three imported
    // symbols against each other produces a number that looks like an RS rating
    // and means nothing — and, worse, the two screens would disagree about which
    // end of the scale a lone symbol sits at. Below this floor, RS is reported
    // as unassessable and both screens say so.
    var RANKABLE = 20;
    if (liquid.length < RANKABLE) liquid = [];
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

    // The Minervini side ranks on the IBD-weighted score — 2x the most recent
    // quarter plus the 6-, 9- and 12-month legs — rather than the worst of the
    // 1/3/6-month percentiles his own screen uses. Same bars, one extra sort.
    var ibd = liquid.map(function (r) {
      var f = r.f;
      var raw = ibdRawAt(f, f.n - 1);
      r.rsRaw = raw;
      return raw;
    }).filter(num).slice().sort(function (a, b) { return a - b; });
    liquid.forEach(function (r) {
      if (!num(r.rsRaw) || !ibd.length) return;
      var below = ibd.findIndex(function (x) { return x >= r.rsRaw; });
      var pctRank = (below < 0 ? ibd.length : below) / ibd.length;
      r.rank = r.rank || {};
      r.rank.rsIbd = clamp(Math.round(pctRank * 98 + 1), 1, 99);
    });

    // The short side needs RS as it stood at each name's first 50-day-MA
    // breakdown, ranked cross-sectionally so "was it a leader when it topped"
    // is comparable across the universe. It needs history BEFORE the break: the
    // floor is six months, below which the reading says nothing. The source
    // implementation asks for a full year, which no one-year dataset can ever
    // satisfy — with 252 sessions loaded the short side would then always fall
    // back to current RS and never fire. Load ~504 sessions for the full test.
    var breakRaws = [];
    liquid.forEach(function (r) {
      var fb = firstBreakIndex(r.f);
      if (fb === null || fb < 126) return;
      var raw = ibdRawAt(r.f, fb);
      if (num(raw)) { r.rsBreakRaw = raw; breakRaws.push(raw); }
    });
    breakRaws.sort(function (a, b) { return a - b; });
    liquid.forEach(function (r) {
      if (!num(r.rsBreakRaw) || !breakRaws.length) return;
      var below = breakRaws.findIndex(function (x) { return x >= r.rsBreakRaw; });
      r.rank = r.rank || {};
      r.rank.rsAtBreak = clamp(Math.round((below < 0 ? breakRaws.length : below) / breakRaws.length * 98 + 1), 1, 99);
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

      // The second verdict, from the same features. Both screens run for every
      // symbol so a card can show them side by side and the overlap is a fact
      // rather than a separate query.
      rec.mm = evaluateMinervini(r.symbol, f, cfg, r.rank,
                                 r.meta ? r.meta.fundamentals : null, cfg.mmPivotMode);
      rec.mmEligible = !!rec.mm.eligible && !capReason;
      rec.mmCapReason = rec.mm.eligible && capReason ? capReason : null;
      rec.bothEligible = rec.eligible && rec.mmEligible;
      results.push(rec);
    });

    results.sort(function (a, b) { return (b.eligible - a.eligible) || (b.score - a.score); });
    return { cfg: cfg, regime: regime, results: results,
             counts: {
               universe: universe.length,
               eligible: results.filter(function (r) { return r.eligible; }).length,
               breakout: results.filter(function (r) { return r.best && r.best.type === 'breakout'; }).length,
               ep: results.filter(function (r) { return r.best && r.best.type === 'ep'; }).length,
               parabolic: results.filter(function (r) { return r.best && r.best.type === 'parabolic'; }).length,
               mmEligible: results.filter(function (r) { return r.mmEligible; }).length,
               mmLong: results.filter(function (r) { return r.mmEligible && r.mm.side === 'long'; }).length,
               mmShort: results.filter(function (r) { return r.mmEligible && r.mm.side === 'short'; }).length,
               both: results.filter(function (r) { return r.bothEligible; }).length
             } };
  }

  /* ------------------------------------------------------------------- csv */

  /* RFC4180-ish field splitter: quoted fields may contain commas and escaped
   * quotes, which a plain split(',') would tear apart. */
  /* Re-run only the Minervini side, e.g. when the pivot mode changes. Cheap:
   * the features are already computed and are handed straight back in. */
  function rescoreMinervini(results, options, mode) {
    var cfg = Object.assign({}, DEFAULTS, options || {});
    results.forEach(function (rec) {
      if (!rec.f) return;
      rec.mm = evaluateMinervini(rec.symbol, rec.f, cfg, rec.rank,
                                 rec.meta ? rec.meta.fundamentals : null, mode || cfg.mmPivotMode);
      rec.mmEligible = !!rec.mm.eligible && !rec.capReason;
      rec.bothEligible = rec.eligible && rec.mmEligible;
    });
    return results;
  }

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
      name: head.findIndex(function (h) { return /^(name|company|security)$/.test(h); }),
      epsYoY: head.findIndex(function (h) { return /^(eps_yoy|epsyoy|eps_growth)$/.test(h); }),
      salesYoY: head.findIndex(function (h) { return /^(sales_yoy|salesyoy|revenue_yoy|sales_growth)$/.test(h); }),
      quarter: head.findIndex(function (h) { return /^(fund_quarter|quarter|latest_quarter)$/.test(h); })
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
      // Earnings growth, written once per symbol. The Minervini screen's only
      // non-technical test; absent, it stays unassessed rather than failing.
      if (!meta[sym].fundamentals && (ix.epsYoY >= 0 || ix.salesYoY >= 0)) {
        var eps = ix.epsYoY >= 0 ? parseFloat(c[ix.epsYoY]) : NaN;
        var sales = ix.salesYoY >= 0 ? parseFloat(c[ix.salesYoY]) : NaN;
        if (num(eps) || num(sales)) {
          meta[sym].fundamentals = {
            epsYoY: num(eps) ? eps : null,
            salesYoY: num(sales) ? sales : null,
            quarter: ix.quarter >= 0 ? (c[ix.quarter] || '').trim() : ''
          };
        }
      }
    });
    return Object.keys(bySym).map(function (sym) {
      var bars = bySym[sym].sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var m = meta[sym] || {};
      return { symbol: sym, name: m.name || sym, marketCap: m.marketCap || null,
               fundamentals: m.fundamentals || null, bars: bars, source: 'csv' };
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
    // the Minervini overlay
    minerviniPivot: minerviniPivot, minerviniLong: minerviniLong, minerviniShort: minerviniShort,
    evaluateMinervini: evaluateMinervini, rescoreMinervini: rescoreMinervini,
    assessMmQuality: assessMmQuality, mmJustify: mmJustify,
    MM_TIERS: MM_TIERS, MM_STATUS: MM_STATUS, MM_GRADES: MM_GRADES,
    screen: screen, parseCSV: parseCSV, splitCsvLine: splitCsvLine, money: money, pctFmt: pct, trendScore: trendScore
  };
});
