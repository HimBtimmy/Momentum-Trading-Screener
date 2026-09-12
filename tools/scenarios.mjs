/* ============================================================================
 * scenarios.mjs — hand-shaped price scenarios (SYNTHETIC — see data/DATA.md)
 *
 * Each scenario is a list of segments laid out on the real NYSE trading
 * calendar from 2025-06-02 to 2026-09-11. Segments are declared by date range
 * so the day counts can never drift out of sync with the calendar.
 * ==========================================================================*/
import { span } from './gen-datasets.mjs';

/* seg helper: S('drift','2026-01-02','2026-03-06',{gainPct:46,adr:5}) */
const S = (type, from, to, props = {}) => ({ type, from, to, days: span(from, to), ...props });
/* single-bar segments */
const B1 = (type, on, props = {}) => ({ type, from: on, to: on, days: 1, ...props });

export const CASES = [
  /* ======================================================= 1. BREAKOUT WIN */
  {
    symbol: 'MEMQ', name: 'Memory / storage momentum leader (archetype)',
    sector: 'Semiconductors', setupLabel: 'Breakout (continuation flag)',
    outcomeLabel: 'WIN', seed: 11071, startPrice: 18.0, baseVolume: 3.0e6, marketCap: 9.4e9,
    triggerDate: '2026-07-02',
    context: 'The dominant theme of 2026 was the memory shortage — DRAM/NAND names led every ' +
      'momentum list in the real tape. June 2026 was a down month for tech (Nasdaq −2.8%), which is ' +
      'exactly what turns a vertical leg into a tradeable flag: the leader stops going up but refuses ' +
      'to break, while the index does the correcting for it.',
    lesson: 'The A+ version of the setup: a real leg, a month of orderly digestion on drying volume ' +
      'while the index corrected, then a range expansion out of a 4%-deep pivot area. Risk was 0.55 ADR, ' +
      'so one ADR of follow-through paid roughly 2R.',
    segments: [
      S('drift', '2025-06-02', '2025-11-28', { gainPct: 16, adr: 4.0, vol: 0.8 }),
      S('drop',  '2025-12-01', '2026-01-09', { lossPct: 13, adr: 4.5, vol: 0.9 }),
      S('drift', '2026-01-12', '2026-03-06', { gainPct: 46, adr: 5.0, vol: 1.1 }),
      S('base',  '2026-03-09', '2026-04-10', { depthPct: 13, adrStart: 5.2, adrEnd: 4.2, vol: 0.6, liftPct: 0.5 }),
      S('drift', '2026-04-13', '2026-05-22', { gainPct: 76, adr: 7.0, vol: 1.6 }),
      S('base',  '2026-05-26', '2026-07-01', { depthPct: 14.5, adrStart: 7.0, adrEnd: 4.3, vol: 0.55, liftPct: 0.62, coilPct: 2.8 }),
      B1('breakout', '2026-07-02', { overPivotPct: 3.2, lodBelowPivotPct: 2.2, adr: 8.0, vol: 3.2 }),
      S('drift', '2026-07-06', '2026-08-14', { gainPct: 48, adr: 7.0, vol: 1.5 }),
      S('drop',  '2026-08-17', '2026-09-11', { lossPct: 17, adr: 6.5, vol: 1.2 })
    ]
  },

  /* ======================================================== 2. EP WIN ===== */
  {
    symbol: 'NRGX', name: 'Oilfield-services re-rating (archetype)',
    sector: 'Energy Services', setupLabel: 'Episodic pivot (contract + guidance gap)',
    outcomeLabel: 'WIN', seed: 22143, startPrice: 9.2, baseVolume: 2.2e6, marketCap: 2.6e9,
    triggerDate: '2026-07-22',
    context: 'July 2026 was a rotation month: the S&P was roughly flat while leadership moved out of ' +
      'mega-cap tech into energy, financials and materials. Energy-services names were the real-tape ' +
      'example of this — one of them was up over 400% on a one-year view by August. EPs cluster in ' +
      'earnings season, and this one lands in the last week of July.',
    lesson: 'Dormancy is the feature. Five months of a 16%-wide range means no trapped supply overhead ' +
      'and no one positioned, so a 19% gap on 6x volume forces a repricing that institutions spend weeks ' +
      'chasing. The opening-range stop made the risk 2.3% on a stock that then ran 45%.',
    segments: [
      S('drift', '2025-06-02', '2025-08-29', { lossPct: 0, gainPct: -6, adr: 4.5, vol: 0.9 }),
      S('base',  '2025-09-02', '2025-12-31', { depthPct: 16, adrStart: 4.5, adrEnd: 4.0, vol: 0.7, liftPct: 0.3 }),
      S('drift', '2026-01-02', '2026-02-27', { gainPct: 9, adr: 4.2, vol: 0.9 }),
      S('base',  '2026-03-02', '2026-05-22', { depthPct: 15, adrStart: 4.4, adrEnd: 4.0, vol: 0.7, liftPct: 0.4 }),
      S('drift', '2026-05-26', '2026-07-21', { gainPct: 6, adr: 4.2, vol: 0.85 }),
      B1('gap',  '2026-07-22', { gapPct: 19, highPct: 7.5, lowPct: -1.0, closeAtPct: 84,
                                 orhPct: 1.3, orlPct: -1.15, vol: 6.5 }),
      S('drift', '2026-07-23', '2026-08-21', { gainPct: 26, adr: 6.5, vol: 2.0 }),
      S('base',  '2026-08-24', '2026-09-04', { depthPct: 8, adrStart: 6.0, adrEnd: 5.0, vol: 1.1, liftPct: 0.6 }),
      S('drift', '2026-09-08', '2026-09-11', { gainPct: 7, adr: 6.0, vol: 1.6 })
    ]
  },

  /* ============================================== 3. PARABOLIC SHORT WIN = */
  {
    symbol: 'ADVX', name: 'Specialty semiconductor substrates (archetype)',
    sector: 'Semiconductors', setupLabel: 'Parabolic short',
    outcomeLabel: 'WIN', seed: 33217, startPrice: 14.0, baseVolume: 1.8e6, marketCap: 1.7e9,
    triggerDate: '2026-08-10',
    context: 'Small-cap AI-adjacent names went vertical through late July 2026 on the back of the ' +
      'memory/AI capex theme. On 10 August the real tape handed the short side its catalyst: the S&P ' +
      'posted back-to-back losses on a tech sell-off, and the most extended names broke first.',
    lesson: 'The discipline is in the waiting. Five up days, +118% in ten sessions and 7 ADRs above the ' +
      '20-day EMA is not a short — it is a watch-list entry. The trade only existed once the stock made a ' +
      'lower high and closed below the prior day’s low, which put the stop at the day’s high, 0.9 ADR away.',
    segments: [
      S('drift', '2025-06-02', '2025-12-31', { gainPct: 22, adr: 5.0, vol: 0.9 }),
      S('drift', '2026-01-02', '2026-04-30', { gainPct: 35, adr: 5.5, vol: 1.0 }),
      S('base',  '2026-05-01', '2026-06-26', { depthPct: 14, adrStart: 5.5, adrEnd: 4.5, vol: 0.7, liftPct: 0.5 }),
      S('drift', '2026-06-29', '2026-07-24', { gainPct: 28, adr: 6.0, vol: 1.4 }),
      S('parabolic', '2026-07-27', '2026-08-07', { gainPct: 118, adr: 9.0, vol: 3.0 }),
      B1('reversal', '2026-08-10', { gapPct: 1.5, highPct: 4.6, lowPct: -10.2, closePct: -9.0,
                                     shortEntryPct: 0.2, adr: 11, vol: 4.0 }),
      S('drop',  '2026-08-11', '2026-08-21', { lossPct: 27, adr: 10, vol: 2.6 }),
      S('base',  '2026-08-24', '2026-09-11', { depthPct: 12, adrStart: 8.0, adrEnd: 6.0, vol: 1.3, liftPct: 0.4 })
    ]
  },

  /* ============================================== 4. BREAKOUT FAILURE ==== */
  {
    symbol: 'HLTQ', name: 'Health-care rotation winner (archetype)',
    sector: 'Health Care', setupLabel: 'Breakout (continuation flag)',
    outcomeLabel: 'LOSS', seed: 44311, startPrice: 42.0, baseVolume: 1.2e6, marketCap: 7.8e9,
    triggerDate: '2026-07-23',
    context: 'Health care was one of the June 2026 leadership groups as money left tech. This name did ' +
      'everything right on the chart and then broke out on 23 July — one session before the 24 July tape, ' +
      'when capex fears knocked the Nasdaq and the Russell 2000 lower and every fresh breakout in the ' +
      'market got sold.',
    lesson: 'A textbook −1R. Nothing about the setup was wrong; the tape was. This is what 70% of trades ' +
      'look like and why the stop is non-negotiable: the gap-down through the breakout-day low is exactly ' +
      'the event the 1-ADR rule is sized for. No averaging down, no "giving it room", no re-entry until a ' +
      'new base forms.',
    segments: [
      S('drift', '2025-06-02', '2025-12-31', { gainPct: 10, adr: 3.8, vol: 0.9 }),
      S('drift', '2026-01-02', '2026-03-31', { gainPct: 6, adr: 4.0, vol: 0.9 }),
      S('drift', '2026-04-01', '2026-05-15', { gainPct: 8, adr: 4.2, vol: 1.0 }),
      S('drift', '2026-05-18', '2026-06-26', { gainPct: 44, adr: 5.5, vol: 1.5 }),
      S('base',  '2026-06-29', '2026-07-22', { depthPct: 11, adrStart: 5.5, adrEnd: 4.0, vol: 0.6, liftPct: 0.65, coilPct: 2.4 }),
      B1('breakout', '2026-07-23', { overPivotPct: 2.6, lodBelowPivotPct: 1.9, adr: 6.0, vol: 2.2 }),
      B1('reversal', '2026-07-24', { gapPct: -5.5, highPct: -4.4, lowPct: -10.8, closePct: -8.6, adr: 7.0, vol: 2.8 }),
      S('drop',  '2026-07-27', '2026-08-14', { lossPct: 14, adr: 5.0, vol: 1.1 }),
      S('base',  '2026-08-17', '2026-09-11', { depthPct: 9, adrStart: 4.5, adrEnd: 4.0, vol: 0.8, liftPct: 0.5 })
    ]
  },

  /* ==================================================== 5. EP FAILURE ==== */
  {
    symbol: 'SPCX', name: 'Small-cap momentum name (archetype)',
    sector: 'Industrials', setupLabel: 'Episodic pivot',
    outcomeLabel: 'LOSS (and a screen reject)', seed: 55407, startPrice: 8.6, baseVolume: 1.6e6, marketCap: 0.9e9,
    triggerDate: '2026-08-11',
    context: 'Mid-August 2026 looked benign — the VIX printed its 2026 low of 14.2 on 17 August with the ' +
      'indices at record highs — but single-stock volatility was at a record spread to index volatility. ' +
      'Quiet index, violent individual names: the exact tape in which a weak gap gets sold.',
    lesson: 'Two rules were broken before the trade was ever taken. Volume was 1.9x average, not the 3x+ ' +
      'the setup demands, and the stock was not dormant — it had already run 60% and round-tripped inside a ' +
      '40%-wide range, so there was trapped supply everywhere above. The screener rejects it outright; ' +
      'traded anyway, it broke the opening-range low for a clean −1R.',
    segments: [
      S('drift', '2025-06-02', '2025-10-31', { gainPct: -18, adr: 6.0, vol: 0.9 }),
      S('base',  '2025-11-03', '2026-02-27', { depthPct: 20, adrStart: 6.0, adrEnd: 5.5, vol: 0.8, liftPct: 0.35 }),
      S('drift', '2026-03-02', '2026-06-12', { gainPct: 62, adr: 7.0, vol: 1.3 }),
      S('drift', '2026-06-15', '2026-07-10', { gainPct: -19, adr: 7.0, vol: 1.1 }),
      S('drift', '2026-07-13', '2026-08-10', { gainPct: 8, adr: 6.5, vol: 1.0 }),
      B1('gap',  '2026-08-11', { gapPct: 14, highPct: 4.0, lowPct: -6.5, closeAtPct: 18,
                                 orhPct: 1.5, orlPct: -1.25, vol: 1.9 }),
      S('drop',  '2026-08-12', '2026-08-21', { lossPct: 16, adr: 8.0, vol: 1.4 }),
      S('base',  '2026-08-24', '2026-09-11', { depthPct: 12, adrStart: 7.0, adrEnd: 6.0, vol: 1.0, liftPct: 0.4 })
    ]
  }
];

/* ---------------------------------------------------------------- index --- */
/* Shaped to the real 2026 tape: strong Q2, a soft June for tech, a flat and
 * rotational July with a late-month wobble, then record highs through August. */
export const INDEX = {
  symbol: 'SPX-PROXY', name: 'Broad-market index proxy', seed: 90210,
  startPrice: 5980, baseVolume: 2.4e9, isIndex: true,
  segments: [
    S('drift', '2025-06-02', '2025-10-31', { gainPct: 7, adr: 1.1, vol: 1.0 }),
    S('base',  '2025-11-03', '2026-01-09', { depthPct: 6, adrStart: 1.3, adrEnd: 1.0, vol: 1.0, liftPct: 0.5 }),
    S('drift', '2026-01-12', '2026-03-31', { gainPct: 6, adr: 1.2, vol: 1.0 }),
    S('drift', '2026-04-01', '2026-05-22', { gainPct: 11, adr: 1.4, vol: 1.1 }),
    S('drift', '2026-05-26', '2026-06-30', { gainPct: -1.1, adr: 1.2, vol: 1.0 }),
    S('drift', '2026-07-01', '2026-07-23', { gainPct: 1.8, adr: 1.0, vol: 0.95 }),
    S('drop',  '2026-07-24', '2026-07-31', { lossPct: 2.2, adr: 1.5, vol: 1.2 }),
    S('drift', '2026-08-03', '2026-08-07', { gainPct: 1.6, adr: 1.0, vol: 1.0 }),
    S('drop',  '2026-08-10', '2026-08-12', { lossPct: 1.7, adr: 1.4, vol: 1.2 }),
    S('drift', '2026-08-13', '2026-09-11', { gainPct: 4.4, adr: 0.9, vol: 0.9 })
  ]
};

/* ------------------------------------------------- extra screener universe -
 * Names shaped to be interesting AS OF the last bar (2026-09-11), so the
 * bundled demo shows live candidates as well as instructive rejects.        */
export const UNIVERSE = [
  { symbol: 'VLTA', name: 'Grid & electrical equipment', sector: 'Industrials', seed: 601,
    startPrice: 31, baseVolume: 2.4e6, marketCap: 12e9, note: 'breakout triggered today',
    segments: [
      S('drift', '2025-06-02', '2025-12-31', { gainPct: 14, adr: 3.9, vol: 0.9 }),
      S('drift', '2026-01-02', '2026-04-30', { gainPct: 22, adr: 4.4, vol: 1.0 }),
      S('drift', '2026-05-01', '2026-07-17', { gainPct: 62, adr: 5.8, vol: 1.4 }),
      S('base',  '2026-07-20', '2026-09-09', { depthPct: 13, adrStart: 5.8, adrEnd: 4.4, vol: 0.55, liftPct: 0.62, coilPct: 2.6 }),
      B1('breakout', '2026-09-10', { overPivotPct: 3.0, lodBelowPivotPct: 2.0, adr: 7.0, vol: 2.9 }),
      B1('drift', '2026-09-11', { gainPct: 1.4, adr: 5.5, vol: 1.6 })
    ] },
  { symbol: 'QNTH', name: 'Quantum / advanced compute', sector: 'Technology', seed: 602,
    startPrice: 12, baseVolume: 4.1e6, marketCap: 5.2e9, note: 'high-ADR breakout, tight 9-day flag',
    segments: [
      S('drift', '2025-06-02', '2025-12-31', { gainPct: 8, adr: 6.5, vol: 1.0 }),
      S('drift', '2026-01-02', '2026-05-15', { gainPct: 40, adr: 7.5, vol: 1.1 }),
      S('drift', '2026-05-18', '2026-08-14', { gainPct: 128, adr: 9.5, vol: 1.8 }),
      S('base',  '2026-08-17', '2026-09-10', { depthPct: 17, adrStart: 9.0, adrEnd: 6.0, vol: 0.6, liftPct: 0.6, coilPct: 3.4 }),
      B1('breakout', '2026-09-11', { overPivotPct: 4.5, lodBelowPivotPct: 3.0, adr: 11.0, vol: 3.4 })
    ] },
  { symbol: 'ORCX', name: 'Enterprise software', sector: 'Technology', seed: 603,
    startPrice: 58, baseVolume: 1.9e6, marketCap: 18e9, note: 'ready — pivot within 1 ADR',
    segments: [
      S('drift', '2025-06-02', '2025-12-31', { gainPct: 12, adr: 3.6, vol: 0.9 }),
      S('drift', '2026-01-02', '2026-05-01', { gainPct: 18, adr: 4.0, vol: 1.0 }),
      S('drift', '2026-05-04', '2026-07-31', { gainPct: 48, adr: 5.0, vol: 1.3 }),
      S('base',  '2026-08-03', '2026-09-11', { depthPct: 10, adrStart: 5.0, adrEnd: 3.9, vol: 0.55, liftPct: 0.72 })
    ] },
  { symbol: 'BIOM', name: 'Clinical-stage biotech', sector: 'Health Care', seed: 604,
    startPrice: 21, baseVolume: 2.8e6, marketCap: 3.1e9, note: 'ready, high ADR',
    segments: [
      S('drift', '2025-06-02', '2026-01-30', { gainPct: -8, adr: 6.0, vol: 0.9 }),
      S('drift', '2026-02-02', '2026-04-30', { gainPct: 26, adr: 7.0, vol: 1.1 }),
      S('drift', '2026-05-01', '2026-08-21', { gainPct: 86, adr: 7.8, vol: 1.5 }),
      S('base',  '2026-08-24', '2026-09-11', { depthPct: 14, adrStart: 7.8, adrEnd: 5.6, vol: 0.6, liftPct: 0.68 })
    ] },
  { symbol: 'GRDX', name: 'Capital goods', sector: 'Industrials', seed: 605,
    startPrice: 74, baseVolume: 1.1e6, marketCap: 9e9, note: 'lower-ADR but valid',
    segments: [
      S('drift', '2025-06-02', '2026-02-27', { gainPct: 16, adr: 3.4, vol: 0.9 }),
      S('drift', '2026-03-02', '2026-06-30', { gainPct: 38, adr: 4.3, vol: 1.2 }),
      S('base',  '2026-07-01', '2026-09-11', { depthPct: 11, adrStart: 4.3, adrEnd: 3.6, vol: 0.6, liftPct: 0.6 })
    ] },
  { symbol: 'NEWSX', name: 'Med-tech, FDA clearance', sector: 'Health Care', seed: 606,
    startPrice: 16.5, baseVolume: 1.4e6, marketCap: 2.2e9, note: 'clean EP two days ago',
    segments: [
      S('drift', '2025-06-02', '2025-11-28', { gainPct: -12, adr: 4.6, vol: 0.9 }),
      S('base',  '2025-12-01', '2026-04-30', { depthPct: 18, adrStart: 4.6, adrEnd: 4.2, vol: 0.8, liftPct: 0.3 }),
      S('drift', '2026-05-01', '2026-09-09', { gainPct: 7, adr: 4.4, vol: 0.85 }),
      B1('gap',  '2026-09-10', { gapPct: 23, highPct: 9.0, lowPct: -1.4, closeAtPct: 80,
                                 orhPct: 1.6, orlPct: -1.2, vol: 7.5 }),
      B1('drift', '2026-09-11', { gainPct: 4.5, adr: 8.0, vol: 3.2 })
    ] },
  { symbol: 'FADEB', name: 'Consumer products, weak gap', sector: 'Consumer', seed: 607,
    startPrice: 28, baseVolume: 0.9e6, marketCap: 1.9e9, note: 'EP reject: volume too light',
    segments: [
      S('drift', '2025-06-02', '2026-03-31', { gainPct: -6, adr: 3.9, vol: 0.9 }),
      S('base',  '2026-04-01', '2026-09-08', { depthPct: 14, adrStart: 4.0, adrEnd: 3.8, vol: 0.8, liftPct: 0.3 }),
      B1('gap',  '2026-09-09', { gapPct: 12, highPct: 3.0, lowPct: -4.0, closeAtPct: 30,
                                 orhPct: 1.1, orlPct: -1.0, vol: 1.6 }),
      S('drift', '2026-09-10', '2026-09-11', { gainPct: -3, adr: 5.0, vol: 1.2 })
    ] },
  { symbol: 'VERTQ', name: 'AI-adjacent small cap, vertical', sector: 'Technology', seed: 608,
    startPrice: 8.4, baseVolume: 3.6e6, marketCap: 1.4e9, note: 'parabolic short, first crack today',
    segments: [
      S('drift', '2025-06-02', '2026-02-27', { gainPct: 18, adr: 6.5, vol: 0.9 }),
      S('drift', '2026-03-02', '2026-07-31', { gainPct: 45, adr: 7.0, vol: 1.1 }),
      S('base',  '2026-08-03', '2026-08-27', { depthPct: 13, adrStart: 7.0, adrEnd: 5.5, vol: 0.7, liftPct: 0.5 }),
      S('parabolic', '2026-08-28', '2026-09-10', { gainPct: 104, adr: 10.0, vol: 3.2 }),
      B1('reversal', '2026-09-11', { gapPct: 2.0, highPct: 4.8, lowPct: -9.2, closePct: -8.0,
                                     shortEntryPct: 0.4, adr: 12, vol: 4.2 })
    ] },
  { symbol: 'STILLUP', name: 'Momentum name still going vertical', sector: 'Technology', seed: 609,
    startPrice: 19, baseVolume: 2.1e6, marketCap: 3.4e9, note: 'parabolic but no weakness yet — watch only',
    segments: [
      S('drift', '2025-06-02', '2026-03-31', { gainPct: 22, adr: 5.5, vol: 0.9 }),
      S('drift', '2026-04-01', '2026-08-14', { gainPct: 52, adr: 6.5, vol: 1.1 }),
      S('base',  '2026-08-17', '2026-08-28', { depthPct: 10, adrStart: 6.5, adrEnd: 5.2, vol: 0.7, liftPct: 0.5 }),
      S('parabolic', '2026-08-31', '2026-09-11', { gainPct: 74, adr: 9.5, vol: 3.0 })
    ] },
  { symbol: 'CHSE', name: 'Broke out nine sessions ago', sector: 'Technology', seed: 610,
    startPrice: 44, baseVolume: 1.6e6, marketCap: 6.6e9, note: 'reject: too extended to chase',
    segments: [
      S('drift', '2025-06-02', '2026-02-27', { gainPct: 15, adr: 4.2, vol: 0.9 }),
      S('drift', '2026-03-02', '2026-06-30', { gainPct: 44, adr: 5.4, vol: 1.2 }),
      S('base',  '2026-07-01', '2026-08-28', { depthPct: 12, adrStart: 5.4, adrEnd: 4.2, vol: 0.6, liftPct: 0.6, coilPct: 2.5 }),
      B1('breakout', '2026-08-31', { overPivotPct: 3.0, lodBelowPivotPct: 2.0, adr: 7.0, vol: 2.8 }),
      S('drift', '2026-09-01', '2026-09-11', { gainPct: 26, adr: 6.0, vol: 1.6 })
    ] },
  { symbol: 'DEEPB', name: 'Deep, sloppy consolidation', sector: 'Consumer', seed: 611,
    startPrice: 26, baseVolume: 1.5e6, marketCap: 2.8e9, note: 'reject: base too deep for its ADR',
    segments: [
      S('drift', '2025-06-02', '2026-01-30', { gainPct: 12, adr: 4.5, vol: 0.9 }),
      S('drift', '2026-02-02', '2026-07-17', { gainPct: 58, adr: 5.5, vol: 1.3 }),
      S('base',  '2026-07-20', '2026-09-11', { depthPct: 33, adrStart: 6.0, adrEnd: 5.6, vol: 1.0, liftPct: 0.12 })
    ] },
  { symbol: 'WIDEB', name: 'Lower lows through the base', sector: 'Materials', seed: 612,
    startPrice: 37, baseVolume: 1.3e6, marketCap: 4.1e9, note: 'reject: lows are falling, not rising',
    segments: [
      S('drift', '2025-06-02', '2026-02-27', { gainPct: 9, adr: 4.0, vol: 0.9 }),
      S('drift', '2026-03-02', '2026-06-05', { gainPct: 52, adr: 5.2, vol: 1.3 }),
      S('drift', '2026-06-08', '2026-09-11', { gainPct: -16, adr: 5.0, vol: 0.9 })
    ] },
  { symbol: 'NOLEG', name: 'Tight base, no prior move', sector: 'Utilities', seed: 613,
    startPrice: 63, baseVolume: 1.2e6, marketCap: 8e9, note: 'reject: prior leg only ~12%',
    segments: [
      S('drift', '2025-06-02', '2026-03-31', { gainPct: 6, adr: 4.4, vol: 0.9 }),
      S('drift', '2026-04-01', '2026-06-30', { gainPct: 12, adr: 4.6, vol: 1.0 }),
      S('base',  '2026-07-01', '2026-09-11', { depthPct: 8, adrStart: 4.6, adrEnd: 4.0, vol: 0.7, liftPct: 0.6 })
    ] },
  { symbol: 'UTLQ', name: 'Low-volatility utility', sector: 'Utilities', seed: 614,
    startPrice: 88, baseVolume: 1.8e6, marketCap: 22e9, note: 'reject: ADR below the floor',
    segments: [
      S('drift', '2025-06-02', '2026-04-30', { gainPct: 14, adr: 1.7, vol: 1.0 }),
      S('drift', '2026-05-01', '2026-07-31', { gainPct: 12, adr: 1.9, vol: 1.0 }),
      S('base',  '2026-08-03', '2026-09-11', { depthPct: 4, adrStart: 1.9, adrEnd: 1.6, vol: 0.8, liftPct: 0.6 })
    ] },
  { symbol: 'MICRX', name: 'Thin micro cap', sector: 'Technology', seed: 615,
    startPrice: 11, baseVolume: 6.0e4, marketCap: 1.4e8, note: 'reject: turnover far too thin',
    segments: [
      S('drift', '2025-06-02', '2026-03-31', { gainPct: 20, adr: 7.0, vol: 0.9 }),
      S('drift', '2026-04-01', '2026-07-31', { gainPct: 72, adr: 8.5, vol: 1.2 }),
      S('base',  '2026-08-03', '2026-09-11', { depthPct: 16, adrStart: 8.0, adrEnd: 6.5, vol: 0.6, liftPct: 0.6 })
    ] },
  { symbol: 'PENNY', name: 'Sub-$5 name', sector: 'Consumer', seed: 616,
    startPrice: 2.4, baseVolume: 5.0e6, marketCap: 2.6e8, note: 'reject: below the $5 price floor',
    segments: [
      S('drift', '2025-06-02', '2026-04-30', { gainPct: 10, adr: 8.0, vol: 1.0 }),
      S('drift', '2026-05-01', '2026-07-31', { gainPct: 44, adr: 9.0, vol: 1.3 }),
      S('base',  '2026-08-03', '2026-09-11', { depthPct: 18, adrStart: 9.0, adrEnd: 7.0, vol: 0.7, liftPct: 0.6 })
    ] },
  { symbol: 'BRKN', name: 'Broken former leader', sector: 'Consumer', seed: 617,
    startPrice: 54, baseVolume: 2.0e6, marketCap: 5.5e9, note: 'reject: below the 50MA, negative RS',
    segments: [
      S('drift', '2025-06-02', '2026-01-30', { gainPct: 46, adr: 5.0, vol: 1.2 }),
      S('drift', '2026-02-02', '2026-09-11', { gainPct: -42, adr: 5.5, vol: 1.1 })
    ] },
  { symbol: 'STDY', name: 'Steady compounder', sector: 'Financials', seed: 618,
    startPrice: 120, baseVolume: 1.4e6, marketCap: 30e9, note: 'context name',
    segments: [
      S('drift', '2025-06-02', '2026-09-11', { gainPct: 26, adr: 2.4, vol: 1.0 })
    ] },
  { symbol: 'MIDQ', name: 'Mid-trend, mid-quality', sector: 'Materials', seed: 619,
    startPrice: 46, baseVolume: 1.7e6, marketCap: 6e9, note: 'context name',
    segments: [
      S('drift', '2025-06-02', '2026-05-29', { gainPct: 18, adr: 4.0, vol: 1.0 }),
      S('drift', '2026-06-01', '2026-09-11', { gainPct: 22, adr: 4.6, vol: 1.1 })
    ] },
  { symbol: 'LAGQ', name: 'Laggard', sector: 'Energy', seed: 620,
    startPrice: 33, baseVolume: 1.5e6, marketCap: 4e9, note: 'context name',
    segments: [
      S('drift', '2025-06-02', '2026-09-11', { gainPct: -8, adr: 4.2, vol: 1.0 })
    ] }
];
