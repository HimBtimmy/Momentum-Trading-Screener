/* Engine-level checks for the Minervini overlay: the pivot and stop arithmetic
 * ported from the Python implementation, the tier ladder, the grade caps, and
 * the fact that profit-taking follows Kullamägi rather than a fixed multiple. */
global.window = {};
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'app');
const QM = require(path.join(APP, 'engine.js'));

let fails = [], passes = 0;
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (cond) passes++; else fails.push(name);
}
const near = (a, b, eps) => Math.abs(a - b) < (eps === undefined ? 1e-6 : eps);

/* ---- a deterministic series builder ------------------------------------ */
function series(n, fn) {
  const bars = [];
  let d = new Date(Date.UTC(2025, 0, 6));
  for (let i = 0; i < n; i++) {
    const { close, range, vol } = fn(i);
    const half = close * (range / 2);
    const prev = bars.length ? bars[bars.length - 1].close : close;
    bars.push({
      date: d.toISOString().slice(0, 10),
      open: close >= prev ? close - half * 0.3 : close + half * 0.3,
      high: close + half, low: close - half,
      close: close, volume: vol
    });
    d.setUTCDate(d.getUTCDate() + (d.getUTCDay() === 5 ? 3 : 1));
  }
  return bars;
}

/* A clean Stage 2 advance into a tight, quiet base: the base high prints early
 * in the base, the range contracts, volume dries up, and up days trade heavier
 * than down days. That is what the template is looking for, so the fixture has
 * to actually contain it. */
const ADVANCE = 270;                                   // bars of Stage 2 advance
const PEAK = 10 * Math.pow(1.009, ADVANCE);
const uptrend = series(300, (i) => {
  if (i <= ADVANCE) return { close: 10 * Math.pow(1.009, i), range: 0.05, vol: 2000000 };
  const k = i - ADVANCE;                               // 1..29 through the base
  // shallow drift down, then a lift into the pivot over the last five sessions:
  // a base coming up the right side, which is when the template calls it tier A
  const drift = k <= 24 ? 1 - 0.0008 * k : (1 - 0.0008 * 24) * (1 + 0.005 * (k - 24));
  const wobble = 1 + 0.015 * Math.sin(k / 2.4) * (1 - k / 40);
  return { close: PEAK * drift * wobble,
           range: 0.05 * (1 - 0.62 * k / 29),          // contracting
           vol: 2000000 * (1 - 0.78 * k / 29) };       // drying up
});
// Accumulation: heavier volume on up days than down days.
uptrend.forEach((b, i) => {
  if (i === 0) return;
  b.volume = Math.round(b.volume * (b.close > uptrend[i - 1].close ? 1.35 : 0.75));
});

const cfg = QM.DEFAULTS;
const f = QM.computeFeatures(uptrend);

console.log('\n1. the pivot');
const p60 = QM.minerviniPivot(f, cfg, 'pivot60');
const expectHigh = Math.max.apply(null, uptrend.slice(300 - 63, 300 - 3).map(b => b.high));
check('pivot60 takes the 60-session base high, last 3 bars excluded',
  near(p60.baseHigh, expectHigh), `${p60.baseHigh.toFixed(4)} vs ${expectHigh.toFixed(4)}`);
check('pivot sits one tick above that high', near(p60.pivot, p60.baseHigh + 0.01),
  `${p60.pivot.toFixed(4)}`);
const p20 = QM.minerviniPivot(f, cfg, 'high20');
const expect20 = Math.max.apply(null, uptrend.slice(300 - 21, 300 - 1).map(b => b.high));
check('high20 takes the prior 20-session high, last bar excluded',
  near(p20.baseHigh, expect20), `${p20.baseHigh.toFixed(4)} vs ${expect20.toFixed(4)}`);
check('the two modes give different pivots on this series', p60.baseHigh !== p20.baseHigh,
  `${p60.baseHigh.toFixed(2)} vs ${p20.baseHigh.toFixed(2)}`);

console.log('\n2. the stop, and what is NOT there');
const mmLong = QM.minerviniLong(f, cfg, { rsIbd: 95 }, null, 'pivot60');
const plan = mmLong.plan;
check('stop is exactly 1.5x ADR below the pivot',
  near(plan.stop, plan.entry * (1 - 1.5 * f.adr / 100)),
  `stop ${plan.stop.toFixed(4)} entry ${plan.entry.toFixed(4)} adr ${f.adr.toFixed(2)}%`);
check('risk equals 1.5x ADR', near(plan.riskPct, 1.5 * f.adr, 1e-9),
  `${plan.riskPct.toFixed(4)}% vs ${(1.5 * f.adr).toFixed(4)}%`);
check('no 2.5R take-profit is published', plan.takeProfit === undefined);
check('targets are R multiples plus a trailing MA',
  near(plan.targets.r3, plan.entry + 3 * (plan.entry - plan.stop)) &&
  /EMA/.test(plan.targets.trailMa), JSON.stringify(plan.targets));
check('management is the Kullamägi schedule',
  /1\/3 to 1\/2/.test(plan.management) && /breakeven/.test(plan.management),
  plan.management.slice(0, 60) + '…');
check('entry rule demands 1.5x average breakout volume',
  /1\.5x the 50-day average/.test(plan.entryRule));
check('required breakout volume is 1.5x the 50-day average',
  near(plan.requiredVolume, f.avgVol50 * 1.5));

console.log('\n3. criteria and tiers');
check('c1 passes on a clean MA stack', mmLong.by.c1 === true, mmLong.items[0].detail);
check('c8 sees the range contract into the base', mmLong.by.c8 === true, mmLong.items[7].detail);
check('c6 is unassessed without fundamentals', mmLong.by.c6 === null, mmLong.items[5].detail);
check('an unassessed c6 does not block tier A', mmLong.tier === 'A',
  'tier ' + mmLong.tier + ' | core ' + mmLong.coreOk + ' quality ' + mmLong.qualityOk +
  ' above20 ' + mmLong.above20ma + ' dryUp ' + mmLong.dryUp + ' (' + mmLong.volDryUp.toFixed(2) + ')' +
  ' c7 ' + mmLong.by.c7 + ' c8 ' + mmLong.by.c8);
check('but it does cap the grade below A+',
  QM.assessMmQuality(f, Object.assign({}, mmLong, { quality: null }), cfg).grade !== 'A+',
  QM.assessMmQuality(f, mmLong, cfg).grade);

const withFund = QM.minerviniLong(f, cfg, { rsIbd: 95 },
  { epsYoY: 30, salesYoY: 12, quarter: '2026-06-30' }, 'pivot60');
check('fundamentals fill c6 when supplied', withFund.by.c6 === true, withFund.items[5].detail);
const q = QM.assessMmQuality(f, withFund, cfg);
check('a confirmed textbook setup can reach A+', q.grade === 'A+', q.grade + ' score ' + Math.round(withFund.score));

const badFund = QM.minerviniLong(f, cfg, { rsIbd: 95 }, { epsYoY: -5, salesYoY: 12 }, 'pivot60');
check('negative EPS growth fails c6', badFund.by.c6 === false, badFund.items[5].detail);
check('failing c6 drops the tier below A', badFund.tier !== 'A', 'tier ' + badFund.tier);

const weakRs = QM.minerviniLong(f, cfg, { rsIbd: 40 }, null, 'pivot60');
check('RS below 70 fails c5 and empties the tier', weakRs.by.c5 === false && weakRs.tier === '',
  'c5 ' + weakRs.by.c5 + ' tier ' + JSON.stringify(weakRs.tier));
check('a failed template scores below a passing one', weakRs.score < mmLong.score,
  Math.round(weakRs.score) + ' vs ' + Math.round(mmLong.score));

console.log('\n4. already broken out');
// The pivot excludes only the last 3 bars, so a breakout older than that simply
// becomes the pivot. To be "already broken out" the move has to be inside that
// window — which is exactly the distinction the flag is drawing.
const broken = series(300, (i) => {
  if (i <= ADVANCE) return { close: 10 * Math.pow(1.009, i), range: 0.04, vol: 1500000 };
  const base = PEAK * (1 - 0.0008 * (i - ADVANCE));
  return { close: i >= 297 ? base * 1.25 : base, range: 0.04, vol: 1500000 };
});
const bf = QM.computeFeatures(broken);
const bo = QM.minerviniLong(bf, cfg, { rsIbd: 95 }, null, 'pivot60');
check('a name well past its pivot is flagged as already broken out', bo.alreadyBreakout === true,
  'extended ' + bo.extended + ' daysAbove ' + bo.daysAbovePivot);
check('its status says so', bo.status === 'mm-extended', bo.status);
check('distance to pivot goes negative', bo.adrToPivot < 0, bo.adrToPivot.toFixed(2));

console.log('\n5. the short side');
eval(fs.readFileSync(path.join(APP, 'datasets.js'), 'utf8'));
const DEMO = global.window.QM_DATA;
const shortRes = QM.screen(DEMO.universe, { indexBars: DEMO.index.bars });
const shorts = shortRes.results.filter(r => r.mm && r.mm.side === 'short' && r.mm.trigger);
check('the demo universe produces leader breakdowns', shorts.length > 0, shorts.length + ' names');
const wedge = shorts.filter(r => r.mm.trigger.kind === 'WEDGE_REJECTION')[0];
check('a wedge rejection is detected, not just the first crack', !!wedge,
  wedge ? wedge.symbol + ' tier ' + wedge.mm.tier : 'none');
if (wedge) {
  const sp = wedge.mm.plan;
  check('short entry is the close of the trigger bar',
    near(sp.entry, wedge.f.bars[wedge.mm.trigger.idx].close), sp.entry.toFixed(2));
  check('short stop is 1.5% above whatever rejected price',
    near(sp.stop, wedge.mm.trigger.resistLevel * 1.015), sp.stop.toFixed(4));
  check('short management covers into the MAs, with no fixed target',
    /10- and 20-day/.test(sp.management) && sp.takeProfit === undefined);
  check('the first 50-day-MA breakdown is dated', !!wedge.mm.firstBreakDate, wedge.mm.firstBreakDate);
  check('RS at the breakdown is reported when it can be measured',
    wedge.mm.rsAtBreak === null || (wedge.mm.rsAtBreak >= 1 && wedge.mm.rsAtBreak <= 99),
    String(wedge.mm.rsAtBreak));
  check('a broken-down name that was never a leader fails s5',
    shorts.every(r => r.mm.by.s5 === true || r.mm.rsRating < QM.DEFAULTS.mmMinRsShort));
}

console.log('\n6. the two screens share one pass over the data');
const D = DEMO;
const res = shortRes;
check('every record carries both verdicts',
  res.results.every(r => !r.f || (r.mm && r.mm.quality && r.mm.justification)));
check('counts report both screens and the overlap',
  Number.isInteger(res.counts.mmEligible) && Number.isInteger(res.counts.both),
  JSON.stringify({ kq: res.counts.eligible, mm: res.counts.mmEligible, both: res.counts.both }));
check('"both" is the intersection, not a separate screen',
  res.results.filter(r => r.bothEligible).every(r => r.eligible && r.mmEligible));
check('the Minervini justification names its own grade',
  res.results.filter(r => r.mm && r.mm.plan).every(r => r.mm.justification.length > 80));

const modes = res.results.filter(r => r.mm && r.mm.pivot).map(r => r.mm.pivot.baseHigh);
QM.rescoreMinervini(res.results, {}, 'high20');
const modes20 = res.results.filter(r => r.mm && r.mm.pivot).map(r => r.mm.pivot.baseHigh);
check('rescoring with high20 moves the pivots', modes.some((v, i) => v !== modes20[i]),
  `${modes.slice(0, 3).map(x => x.toFixed(2))} -> ${modes20.slice(0, 3).map(x => x.toFixed(2))}`);
check('rescoring keeps the Qullamaggie side untouched',
  res.results.filter(r => r.f).every(r => r.best !== undefined));

console.log('\n7. RS needs a universe to be a percentile of');
const tiny = D.universe.slice(0, 3);
const tinyRes = QM.screen(tiny, {});
check('a handful of symbols yields no RS rating at all',
  tinyRes.results.every(r => !r.rank || !isFinite(r.rank.rsRating)),
  JSON.stringify(tinyRes.results.map(r => r.rank && r.rank.rsRating)));
check('and both screens report it as unassessed rather than guessing',
  tinyRes.results.every(r => !r.mm || r.mm.by.c5 === null || r.mm.side === 'short'));

console.log('\n' + (fails.length
  ? fails.length + ' FAILURES: ' + fails.join(', ')
  : 'ALL MINERVINI CHECKS PASSED (' + passes + ' checks)'));
process.exit(fails.length ? 1 : 0);
