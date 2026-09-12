/* ============================================================================
 * simulate.mjs — replays Qullamaggie's own trade-management rules over a bar
 * series so that every R-multiple quoted in the write-up is computed, not
 * asserted.
 *
 * Long rules  : enter on the trigger, hard stop at the entry-day low (capped
 *               at 1x ADR), sell half into strength after N days and move the
 *               stop to breakeven, trail the rest on the 10- or 20-day MA and
 *               exit on the first close below it.
 * Short rules : enter on the first weakness (opening-range low / failed VWAP
 *               reclaim), stop at the day's high, cover into the 10- and
 *               20-day MAs.
 *
 * Intrabar convention: the entry bar's own low cannot stop the trade out,
 * because on a real trigger day the entry happens before that low is known.
 * Every later bar is checked low-first (stops before targets) so results are
 * conservative.
 * ==========================================================================*/

export function simulateLong(bars, ctx) {
  const { entryIdx, entry, stop, ema10, ema20, adr, partialAfterDays = 4, partialFrac = 0.5 } = ctx;
  const risk = entry - stop;
  if (!(risk > 0)) throw new Error('long risk must be positive');
  const trailKey = adr >= 5 ? 'ema10' : 'ema20';
  const trail = trailKey === 'ema10' ? ema10 : ema20;
  const tranches = [];
  let openFrac = 1, activeStop = stop, held = 0, mfeR = 0, tookPartial = false;

  for (let i = entryIdx + 1; i < bars.length && openFrac > 0; i++) {
    const b = bars[i];
    held++;
    mfeR = Math.max(mfeR, (b.high - entry) / risk);

    if (b.low <= activeStop) {                                  // stops first
      // A gap through the stop fills at the open, not at the stop: this is how
      // a "-1R" trade becomes a -1.8R trade, and why size is set off the stop
      // rather than off hope.
      const fill = Math.min(activeStop, b.open);
      const gapped = fill < activeStop * 0.999;
      tranches.push({ date: b.date, frac: openFrac, price: fill,
                      r: (fill - entry) / risk,
                      reason: (tookPartial ? 'breakeven stop hit' : 'initial stop hit') +
                              (gapped ? ' — gapped through, filled at the open' : '') });
      openFrac = 0;
      break;
    }
    if (!tookPartial && held >= partialAfterDays && b.close > entry) {
      tranches.push({ date: b.date, frac: partialFrac, price: b.close,
                      r: (b.close - entry) / risk,
                      reason: `sold ${Math.round(partialFrac * 100)}% into strength after ${held} sessions` });
      openFrac -= partialFrac;
      activeStop = entry;                                        // stop to breakeven
      tookPartial = true;
      continue;
    }
    if (tookPartial && Number.isFinite(trail[i]) && b.close < trail[i]) {
      tranches.push({ date: b.date, frac: openFrac, price: b.close,
                      r: (b.close - entry) / risk,
                      reason: `first close below the ${trailKey === 'ema10' ? '10' : '20'}-day MA` });
      openFrac = 0;
      break;
    }
  }
  if (openFrac > 0) {
    const b = bars[bars.length - 1];
    tranches.push({ date: b.date, frac: openFrac, price: b.close,
                    r: (b.close - entry) / risk, reason: 'still open at the end of the window' });
  }
  return summarise(tranches, { entry, stop, risk, mfeR, side: 'long', trailKey });
}

export function simulateShort(bars, ctx) {
  const { entryIdx, entry, stop, ema10, ema20, coverFrac = 0.5 } = ctx;
  const risk = stop - entry;
  if (!(risk > 0)) throw new Error('short risk must be positive');
  const tranches = [];
  let openFrac = 1, mfeR = 0, tookFirst = false;

  for (let i = entryIdx + 1; i < bars.length && openFrac > 0; i++) {
    const b = bars[i];
    mfeR = Math.max(mfeR, (entry - b.low) / risk);

    if (b.high >= stop) {                                        // stops first
      const fill = Math.max(stop, b.open);
      const gapped = fill > stop * 1.001;
      tranches.push({ date: b.date, frac: openFrac, price: fill, r: (entry - fill) / risk,
                      reason: 'stop hit (day-high / VWAP reclaim)' +
                              (gapped ? ' — gapped through, filled at the open' : '') });
      openFrac = 0;
      break;
    }
    const t10 = ema10[i], t20 = ema20[i];
    if (!tookFirst && Number.isFinite(t10) && b.low <= t10) {
      const px = Math.min(Math.max(t10, b.low), b.high);
      tranches.push({ date: b.date, frac: coverFrac, price: px, r: (entry - px) / risk,
                      reason: 'covered into the 10-day MA' });
      openFrac -= coverFrac; tookFirst = true;
      continue;
    }
    if (tookFirst && Number.isFinite(t20) && b.low <= t20) {
      const px = Math.min(Math.max(t20, b.low), b.high);
      tranches.push({ date: b.date, frac: openFrac, price: px, r: (entry - px) / risk,
                      reason: 'covered the balance into the 20-day MA' });
      openFrac = 0;
      break;
    }
    if (tookFirst && Number.isFinite(t10) && b.close > t10) {
      tranches.push({ date: b.date, frac: openFrac, price: b.close, r: (entry - b.close) / risk,
                      reason: 'closed back above the 10-day MA — momentum reclaimed' });
      openFrac = 0;
      break;
    }
  }
  if (openFrac > 0) {
    const b = bars[bars.length - 1];
    tranches.push({ date: b.date, frac: openFrac, price: b.close, r: (entry - b.close) / risk,
                    reason: 'still open at the end of the window' });
  }
  return summarise(tranches, { entry, stop, risk, mfeR, side: 'short' });
}

function summarise(tranches, meta) {
  const totalR = tranches.reduce((a, t) => a + t.frac * t.r, 0);
  return {
    ...meta,
    tranches,
    totalR,
    exitDate: tranches[tranches.length - 1].date,
    outcome: totalR > 0.2 ? 'win' : totalR < -0.2 ? 'loss' : 'scratch'
  };
}
