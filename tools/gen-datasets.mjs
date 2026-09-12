/* ============================================================================
 * gen-datasets.mjs — deterministic generator for the bundled datasets.
 *
 *  !! IMPORTANT — DATA PROVENANCE !!
 *  The series produced here are SYNTHETIC. They are shaped by hand to express
 *  specific Qullamaggie setups (and specific failure modes) on the real NYSE
 *  trading calendar for the June-August 2026 window, because this build
 *  environment has no egress to any market-data provider (every quote host
 *  returns 403 at the network policy gateway). They are teaching instruments,
 *  not price history. Replace them with real OHLCV via the CSV importer in the
 *  screener, or by re-running the build against a real data file — see
 *  data/DATA.md.
 *
 *  Usage: node tools/gen-datasets.mjs
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------- trading calendar */

const HOLIDAYS = new Set([
  // 2025
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07'
]);

function tradingDays(fromISO, toISO) {
  const out = [];
  const d = new Date(fromISO + 'T00:00:00Z');
  const end = new Date(toISO + 'T00:00:00Z');
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5 && !HOLIDAYS.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const CAL = tradingDays('2025-06-02', '2026-09-11');
const idxOf = (iso) => {
  const i = CAL.indexOf(iso);
  if (i < 0) throw new Error(iso + ' is not a trading day in the calendar');
  return i;
};

/* --------------------------------------------------------------- plumbing */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* Build one bar from a target close and a target daily range.               */
function makeBar(date, prevClose, close, rangePct, rnd, volume, gapOpen) {
  const range = close * rangePct / 100 * (0.8 + 0.45 * rnd());
  const up = close >= prevClose;
  let open = gapOpen != null ? gapOpen
    : clamp(prevClose * (1 + (rnd() - 0.5) * rangePct / 220), close - range * 0.8, close + range * 0.8);
  let hi = Math.max(open, close), lo = Math.min(open, close);
  const spare = Math.max(range - (hi - lo), range * 0.25);
  const upWick = up ? spare * (0.25 + 0.35 * rnd()) : spare * (0.45 + 0.35 * rnd());
  hi += upWick;
  lo -= Math.max(spare - upWick, range * 0.05);
  lo = Math.max(lo, 0.05);
  return {
    date,
    open: +open.toFixed(2), high: +hi.toFixed(2), low: +lo.toFixed(2), close: +close.toFixed(2),
    volume: Math.max(1000, Math.round(volume))
  };
}

/* Segment types:
 *   drift      { days, gainPct, adr, vol }            steady trend leg
 *   base       { days, depthPct, adrStart, adrEnd, vol, liftPct }  flag
 *   gap        { gapPct, closeAtPct, adr, vol }        one EP / news bar
 *   parabolic  { days, gainPct, adr, vol }            accelerating vertical
 *   drop       { days, lossPct, adr, vol }            decline
 */
function synth({ seed, startPrice, baseVolume, segments }) {
  const rnd = mulberry32(seed);
  const bars = [];
  let prev = startPrice;
  let cursor = 0;
  let lastBaseHigh = null;   // pivot of the most recently completed base

  const push = (b) => { bars.push(b); prev = b.close; cursor++; };

  for (const seg of segments) {
    if (seg.type === 'drift' || seg.type === 'drop') {
      const days = seg.days;
      const total = seg.type === 'drop' ? -Math.abs(seg.lossPct) : seg.gainPct;
      const perDay = Math.pow(1 + total / 100, 1 / days) - 1;
      for (let i = 0; i < days; i++) {
        const shock = (rnd() - 0.5) * seg.adr / 100 * (seg.noise ?? 0.9);
        let close = prev * (1 + perDay + shock);
        const v = baseVolume * (seg.vol ?? 1) * (0.7 + 0.7 * rnd());
        push(makeBar(CAL[cursor], prev, close, seg.adr, rnd, v));
      }
    } else if (seg.type === 'base') {
      const days = seg.days, top = prev, depth = seg.depthPct / 100;
      const baseStart = bars.length;
      for (let i = 0; i < days; i++) {
        const t = i / Math.max(1, days - 1);
        // floor of the channel lifts through the base -> higher lows
        const floorP = top * (1 - depth * (1 - t * (seg.liftPct ?? 0.6)));
        const ceilP = top * (1 - depth * 0.10 * t);
        const adr = seg.adrStart + (seg.adrEnd - seg.adrStart) * t;
        let close = prev * (1 + (rnd() - 0.5) * adr / 100 * 1.25);
        // pull toward the middle of the narrowing channel
        const mid = (floorP + ceilP) / 2;
        close = close + (mid - close) * (0.18 + 0.22 * t);
        close = clamp(close, floorP, ceilP);
        // A flag about to break coils right beneath its pivot. coilPct forces
        // the last few sessions up under the top of the range, which is what
        // makes the trigger-day stop tight enough to pass the 1x-ADR rule.
        let coilPivot = null;
        if (seg.coilPct != null && i >= days - 3) {
          // coil relative to the PIVOT (highest high of the base, including the
          // last bar of the preceding leg), not to the closing price
          coilPivot = Math.max(
            bars[baseStart - 1] ? bars[baseStart - 1].high : top, top,
            ...bars.slice(baseStart).map(b => b.high));
          const coilLo = coilPivot * (1 - seg.coilPct / 100);
          const coilHi = coilPivot * (1 - seg.coilPct / 400);
          close = clamp(Math.max(close, coilLo + (coilHi - coilLo) * rnd()), coilLo, coilHi);
        }
        const v = baseVolume * (seg.vol ?? 0.55) * (0.65 + 0.6 * rnd()) * (1 - 0.25 * t);
        const bar = makeBar(CAL[cursor], prev, close, adr, rnd, v);
        // a coiling bar must not print a new pivot high, or the pivot walks up
        if (coilPivot != null && bar.high > coilPivot * 0.998) {
          bar.high = +(coilPivot * 0.998).toFixed(2);
          bar.close = Math.min(bar.close, bar.high);
          bar.open = Math.min(bar.open, bar.high);
        }
        push(bar);
      }
      lastBaseHigh = Math.max(...bars.slice(baseStart).map(b => b.high),
                              bars[baseStart - 1] ? bars[baseStart - 1].high : 0);
    } else if (seg.type === 'gap') {
      // An episodic-pivot bar. Opening-range levels are modelled explicitly,
      // because the whole setup is decided in the first minutes of the day.
      const open = prev * (1 + seg.gapPct / 100);
      const hi = open * (1 + seg.highPct / 100);
      const lo = open * (1 + seg.lowPct / 100);
      const close = lo + (hi - lo) * (seg.closeAtPct / 100);
      bars.push({
        date: CAL[cursor], open: +open.toFixed(2), high: +hi.toFixed(2), low: +lo.toFixed(2),
        close: +close.toFixed(2), volume: Math.round(baseVolume * seg.vol),
        orh: +(open * (1 + seg.orhPct / 100)).toFixed(2),
        orl: +(open * (1 + seg.orlPct / 100)).toFixed(2),
        gap: true
      });
      prev = +close.toFixed(2); cursor++;
    } else if (seg.type === 'parabolic') {
      const days = seg.days;
      // accelerating: each day's gain grows toward the end
      const weights = Array.from({ length: days }, (_, i) => 0.5 + 1.6 * (i / (days - 1)) ** 1.7);
      const wsum = weights.reduce((a, b) => a + b, 0);
      const totalLog = Math.log(1 + seg.gainPct / 100);
      for (let i = 0; i < days; i++) {
        const g = Math.exp(totalLog * weights[i] / wsum) - 1;
        const close = prev * (1 + g + (rnd() - 0.5) * seg.adr / 110);
        const v = baseVolume * (seg.vol ?? 2) * (0.8 + 0.8 * rnd()) * (1 + i / days);
        push(makeBar(CAL[cursor], prev, close, seg.adr * (0.8 + 0.5 * i / days), rnd, v));
      }
    } else if (seg.type === 'breakout') {
      // The range-expansion bar. It clears the pivot of the base that just
      // ended and closes near its high; the day's low sits just underneath the
      // pivot, which is where the hard stop goes.
      const pivot = lastBaseHigh != null ? lastBaseHigh : prev * 1.02;
      const over = seg.overPivotPct != null ? seg.overPivotPct : 3.5;
      const lodBelow = seg.lodBelowPivotPct != null ? seg.lodBelowPivotPct : 2.5;
      const close = pivot * (1 + over / 100);
      const lo = Math.min(pivot * (1 - lodBelow / 100), prev * (1 - 0.004));
      const hi = close * (1 + seg.adr / 400);
      const open = lo + (Math.min(prev, pivot) - lo) * 0.7;
      bars.push({
        date: CAL[cursor], open: +open.toFixed(2), high: +hi.toFixed(2), low: +lo.toFixed(2),
        close: +close.toFixed(2), volume: Math.round(baseVolume * seg.vol), breakout: true, pivot: +pivot.toFixed(2)
      });
      prev = +close.toFixed(2); cursor++;
    } else if (seg.type === 'reversal') {
      // The bar that ends a move: a push in the gap direction that fails and
      // closes at the other end of the range. All levels are % of prev close.
      const open = prev * (1 + seg.gapPct / 100);
      const hi = prev * (1 + (seg.highPct != null ? seg.highPct : seg.gapPct + 0.6) / 100);
      const close = prev * (1 + seg.closePct / 100);
      const lo = prev * (1 + (seg.lowPct != null ? seg.lowPct : seg.closePct - seg.adr / 3) / 100);
      bars.push({
        date: CAL[cursor],
        open: +open.toFixed(2), high: +Math.max(hi, open, close).toFixed(2),
        low: +Math.min(lo, open, close).toFixed(2), close: +close.toFixed(2),
        volume: Math.round(baseVolume * (seg.vol ?? 2)),
        vwapFail: seg.shortEntryPct != null ? +(prev * (1 + seg.shortEntryPct / 100)).toFixed(2) : null,
        reversal: true
      });
      prev = +close.toFixed(2); cursor++;
    } else throw new Error('unknown segment ' + seg.type);
  }
  if (bars.length !== CAL.length) {
    throw new Error(`segment days (${bars.length}) != calendar length (${CAL.length})`);
  }
  return bars;
}

/* Convenience: how many calendar slots between two dates (inclusive start). */
const span = (a, b) => idxOf(b) - idxOf(a) + 1;

export { CAL, tradingDays, idxOf, span, synth, mulberry32, ROOT, fs, path };
