/* ============================================================================
 * summary-content.mjs — the executive summary, as structured content.
 * Rendered to HTML (docs/executive-summary.html) and Markdown
 * (docs/executive-summary.md) from this single source.
 *
 * Inline markup supported: **bold**, `code`, [text](url).
 * ==========================================================================*/

export const META = {
  title: 'The Qullamaggie Playbook',
  tagline: 'Momentum breakouts, episodic pivots and parabolic shorts — the rules, ' +
           'the arithmetic, and five trades from the June–August 2026 tape.',
  byline: 'Strategy desk note',
  dateLine: 'September 2026'
};

export const SECTIONS = [
  /* ------------------------------------------------------------------ 1 --- */
  {
    id: 'thesis', eyebrow: 'The edge', title: 'One idea, three expressions',
    blocks: [
      { p: 'Kristjan Kullamägi — "Qullamaggie" — compounded a roughly $5,000 account into a peak of about ' +
           '$100 million between 2011 and 2021 while **losing on around seven of every ten trades**. That ' +
           'combination is the whole strategy in one sentence: he is not trying to be right, he is trying to ' +
           'be positioned in the handful of stocks each year that move 50–200% in a few months, with risk so ' +
           'tightly defined that being wrong costs a fixed, trivial fraction of the account.' },
      { p: 'Everything else is machinery in service of that asymmetry. Three setups supply the entries, one ' +
           'volatility measure (ADR) sizes the risk, and one exit discipline (partial into strength, then trail ' +
           'a moving average) converts the rare 10–20R winner into realised profit instead of a round trip.' },
      { callout: { kind: 'note', title: 'The arithmetic that makes a 25–30% win rate work',
        text: 'At a 30% win rate, losers at −1R and winners averaging +5R return +0.8R per trade. At the same ' +
              'win rate with winners averaging +2R, the system returns −0.1R and bleeds. The entire edge lives in ' +
              'the size of the right tail, which is why every rule below is built to keep losses at exactly one ' +
              'unit and to avoid capping winners.' } },
      { rules: [
        { label: 'Setup 1 — Breakout', text: 'A leader that has already moved 30–100%+, consolidates in an ' +
          'orderly flag for two weeks to two months, then expands out of the range. The bread and butter.' },
        { label: 'Setup 2 — Episodic pivot', text: 'A dormant stock gaps 10%+ on a genuine catalyst with ' +
          'enormous volume. The least frequent and the best reward-to-risk of the three; clustered in 3–4 week ' +
          'windows each quarter around earnings.' },
        { label: 'Setup 3 — Parabolic short', text: 'A stock that has gone vertical (50–100%+ for a large cap, ' +
          '300–1000%+ for a small cap) over 3–5+ consecutive up days, sold on the first crack. Targets the ' +
          '10- and 20-day moving averages. Roughly 5–10R when it works.' }
      ] }
    ]
  },

  /* ------------------------------------------------------------------ 2 --- */
  {
    id: 'screen', eyebrow: 'Stage 1', title: 'The screen: find the leaders, then wait',
    blocks: [
      { p: 'The universe is not "stocks I like" — it is a ranked list rebuilt every day. He scans for the ' +
           '**top 1–2% of performers over one month, three months and six months**. A stock that appears on all ' +
           'three lists is, by definition, what institutions are accumulating right now. Roughly 6,000 tickers ' +
           'reduce to a couple of hundred; the chart work happens only on those.' },
      { table: { head: ['Filter', 'Threshold', 'Why it exists'], rows: [
        ['Relative strength', 'Top 1–2% over 1m / 3m / 6m', 'Momentum persists; laggards break out and fail.'],
        ['ADR%', '≥ 3.5% floor, 5–6%+ preferred', 'ADR is the average daily range in percent over the past 20 ' +
          'sessions. If a stock cannot travel, a 3–5R move takes months instead of days.'],
        ['Liquidity', 'Enough turnover to hold 5–25% of the account', 'Position sizes run 10–15% of equity; ' +
          'an illiquid name cannot be exited on the day the thesis breaks.'],
        ['Price', 'Above ~$5', 'Avoids the structurally broken and the manipulated.'],
        ['Trend structure', 'Above rising 10/20/50-day MAs, near 52-week highs', 'The setup is continuation, ' +
          'not reversal. Nothing below the 50-day qualifies.']
      ] } },
      { p: 'The screen produces candidates, not trades. A name can sit on the list for weeks before its ' +
           'consolidation tightens into something with a definable risk point — and most never get there.' }
    ]
  },

  /* ------------------------------------------------------------------ 3 --- */
  {
    id: 'breakout', eyebrow: 'Setup 1', title: 'The breakout: a leg, a flag, a range expansion',
    blocks: [
      { p: 'The pattern has three parts, in strict order. First, **the leg**: a 30–100%+ advance that usually ' +
           'takes a few days to a few weeks — evidence that something real changed. Second, **the flag**: two ' +
           'weeks to two months of sideways digestion in which price "surfs" the rising 10- and 20-day ' +
           '(sometimes 50-day) moving average. Third, **the expansion**: a decisive break above the ' +
           'consolidation high on expanded volume.' },
      { p: 'What separates a tradeable flag from a topping pattern is measurable, and the screener in this ' +
           'repository measures all four:' },
      { rules: [
        { label: 'Higher lows', text: 'Buyers step in at progressively higher prices. The lowest low of the ' +
          'back half of the base should sit above the lowest low of the front half.' },
        { label: 'Contracting range', text: 'Average daily range in the last third of the base should be ' +
          'smaller than in the first third. Volatility compression is stored energy.' },
        { label: 'Volume dry-up', text: 'Volume through the base should be below the volume of the advance ' +
          'that preceded it. Heavy volume in a sideways range is distribution, not accumulation.' },
        { label: 'Depth proportional to ADR', text: 'A 4% ADR stock has no business correcting 30%. Depth is ' +
          'judged against the stock\'s own volatility and the length of the base, not against a fixed percentage.' }
      ] },
      { callout: { kind: 'warn', title: 'The tightness is the trade',
        text: 'The purpose of the flag is not the pattern — it is that a tight range puts a logical stop within ' +
              'one ADR of the entry. All three setups are, in his words, about "finding low risk entries on fast ' +
              'moving stocks by finding tight, high probability areas to enter." If the stop cannot be tight, ' +
              'there is no trade, however good the chart looks.' } }
    ]
  },

  /* ------------------------------------------------------------------ 4 --- */
  {
    id: 'entry', eyebrow: 'Stage 2', title: 'The trigger: opening-range highs, not closing prices',
    blocks: [
      { p: 'This is the mechanic most people get wrong. He does not buy a daily close above resistance and he ' +
           'does not set a resting order at the pivot. He buys **the break of the opening range high** on the day ' +
           'the stock expands: the high of the first 1-minute candle, the first 5-minute candle, or the first ' +
           '60-minute candle — on the hourly chart the first bar covers 9:30–10:00 only. Any of them, or a ' +
           'combination, scaling in as each higher timeframe confirms.' },
      { rules: [
        { label: 'Why the opening range', text: 'It is the tightest defensible structure available on a big ' +
          'volume day. The risk point is the low of that same range, often 1–3% away on a stock with a 6% ADR.' },
        { label: 'Which timeframe', text: 'Faster, higher-ADR stocks justify the 1-minute range; slower names ' +
          'need the 5- or 60-minute range to filter noise.' },
        { label: 'If it does not trigger, there is no trade', text: 'A stock that cannot take out its early ' +
          'high on a breakout day is showing you the demand is not there. He skips it rather than buying lower.' },
        { label: 'Gaps through the pivot', text: 'When the stock gaps above the pivot, the entry becomes the ' +
          'opening-range high above the open — never a chase into the middle of a range-expansion bar.' }
      ] }
    ]
  },

  /* ------------------------------------------------------------------ 5 --- */
  {
    id: 'stop', eyebrow: 'Stage 3', title: 'The stop: the low of the day, capped at one ADR',
    blocks: [
      { p: 'Two rules, and the second one governs:' },
      { rules: [
        { label: 'Structural stop', text: 'The low of the entry day (for an opening-range entry, the low of ' +
          'that opening range). Hard stop, resting in the market — and a market order, not a limit order, when ' +
          'it triggers.' },
        { label: 'The 1× ADR ceiling', text: 'The stop is **never wider than one ADR**, 1.5× at the absolute ' +
          'most. If a stock has a 5% ADR, the stop is not more than 5% away. When the logical structural stop is ' +
          'wider than that, the trade is skipped — not resized, not "given room".' }
      ] },
      { p: 'The reason is arithmetic, not superstition. Risk of 1 ADR means one average day in your favour ' +
           'returns roughly 1R; risk of 3 ADR means the same move returns 0.3R, and the right tail that pays for ' +
           'the whole system disappears. The ADR cap is what converts a good chart into a good trade.' },
      { callout: { kind: 'warn', title: 'Stops are jumped, not honoured',
        text: 'A hard stop defines intent, not outcome. When a stock gaps down through the level overnight the ' +
              'fill is the open, and a planned −1R becomes −1.5R or worse — see the HLTQ case below, which filled ' +
              'at −1.52R. This is why position size is capped at 5–25% of equity (typically 10–15%) and why he ' +
              'holds no more than 30% of the account overnight in a single name.' } }
    ]
  },

  /* ------------------------------------------------------------------ 6 --- */
  {
    id: 'exit', eyebrow: 'Stage 4', title: 'Taking profit: half into strength, trail the rest',
    blocks: [
      { p: 'The exit rule is fixed and mechanical, which is what makes it survivable:' },
      { rules: [
        { label: '1. Sell 1/3 to 1/2 after 3–5 days', text: 'Into the initial burst of strength, while the move ' +
          'is still vertical. This is where the win rate comes from — it banks the part of the move that is most ' +
          'likely to be given back.' },
        { label: '2. Move the stop to breakeven', text: 'The remaining position now cannot lose money. ' +
          'Psychologically this is what allows a trade to be held for weeks.' },
        { label: '3. Trail the balance on the 10- or 20-day MA', text: 'The 10-day for fast, high-ADR movers; ' +
          'the 20-day for slower names. Exit the remainder on the **first close below** it — a close, not an ' +
          'intraday touch.' }
      ] },
      { p: 'Target guidance is 3–5R and up; in strong markets the trailing leg routinely produces 10–20R. ' +
           'For parabolic shorts the target is explicit rather than trailed: cover into the 10- and 20-day moving ' +
           'averages, where these stocks find their first real bounce.' }
    ]
  },

  /* ------------------------------------------------------------------ 7 --- */
  {
    id: 'ep', eyebrow: 'Setup 2', title: 'Episodic pivots: buying a repricing',
    blocks: [
      { p: 'An episodic pivot is not a chart pattern, it is a **change in the facts**. A stock gaps 10% or more ' +
           'on news, with volume so heavy that it trades its entire average daily volume in the first 15–20 ' +
           'minutes. He learned the setup from Pradeep Bonde (Stockbee), and it is the highest reward-to-risk of ' +
           'the three — and the rarest, concentrated in 3–4 week windows each quarter.' },
      { table: { head: ['Condition', 'Requirement'], rows: [
        ['Gap', '≥ 10% above the prior close'],
        ['Volume', 'Average daily volume traded in the first 15–20 minutes; 3×+ normal on the day'],
        ['Prior behaviour', 'Flat, dormant, ignored for 3–6 months before the catalyst'],
        ['Catalyst type', 'Earnings or guidance; FDA / biotech; contracts and partnerships; political or ' +
          'regulatory; sector-wide news'],
        ['Entry', 'Break of the 1-minute opening-range high, adding on the 5-minute high'],
        ['Stop', 'The low of the day (in practice, the opening-range low), within 1–1.5× ADR']
      ] } },
      { p: 'Dormancy is the feature. A stock nobody owns has no trapped supply overhead, so a genuine surprise ' +
           'forces institutions to build a position in the market rather than into sellers — which is why these ' +
           'gaps trend for weeks instead of filling. A gap on a stock that has already doubled is the opposite ' +
           'trade: that is supply, and it is the failure case shown in SMLQ below.' }
    ]
  },

  /* ------------------------------------------------------------------ 8 --- */
  {
    id: 'short', eyebrow: 'Setup 3', title: 'Parabolic shorts: patience, then the first crack',
    blocks: [
      { p: 'The setup is a stock that has gone vertical: 50–100%+ in days or weeks for a large cap, 300–1000%+ ' +
           'for a small cap, ideally accelerating into the final stretch, with 3–5+ consecutive up days.' },
      { rules: [
        { label: 'Never day one, rarely day two', text: 'He waits for day three, four or five, when the move is ' +
          'clearly extended **and** the first sign of weakness has appeared. Shorting strength is how accounts die.' },
        { label: 'Three triggers', text: 'A break of the opening-range low on the 1- or 5-minute chart; the ' +
          'first red 5-minute candle after a gap up; or — his preferred trigger — a failed bounce back into VWAP.' },
        { label: 'Stop', text: 'The high of the day, or a reclaim of VWAP if VWAP was the trigger. Same 1× ADR ' +
          'ceiling as the long book.' },
        { label: 'Target', text: 'The 10- and 20-day moving averages. Successful parabolic shorts fall 50–60%+ ' +
          'within days, which is where the 5–10R comes from.' }
      ] },
      { callout: { kind: 'warn', title: 'The $140,000 lesson',
        text: 'His own worst documented loss came from shorting a stock up 240% in two weeks that had gapped into ' +
              'resistance — but on earnings, and it held above its opening price. Instead of breaking it traded a ' +
              '"range of death" all day, faking breakdowns and ripping back, while he scaled in and out with size. ' +
              'The rule that came out of it: a gap that holds above its open is not a short, whatever the chart ' +
              'says, and scaling into a losing short is not a strategy.' } }
    ]
  },

  /* ------------------------------------------------------------------ 9 --- */
  {
    id: 'risk', eyebrow: 'Stage 5', title: 'Sizing and portfolio risk',
    blocks: [
      { table: { head: ['Parameter', 'Rule'], rows: [
        ['Risk per trade', '0.25–1% of equity; typically 0.3–0.5%. Beginners: 0.5% until consistently profitable. ' +
          'Rarely above 1%, even on high conviction.'],
        ['Position size', '5–25% of the account, most often 10–15%, scaled by liquidity, conviction and the ' +
          'riskiness of the stock.'],
        ['Overnight concentration', 'Never more than 30% of the account overnight in one stock or ETF. Intraday ' +
          'can be larger, because there is no gap risk.'],
        ['Order type', 'Hard stops in the market. Market orders on exit, never limits — a limit order in a fast ' +
          'break is a position you still own.'],
        ['Small accounts', 'He risked more (0.5–1.5%) when his account was small; that is a function of ' +
          'rebuilding capacity, not of edge.']
      ] } },
      { p: 'Note the two-layer structure: the **stop** defines risk per trade as a fixed fraction of equity, ' +
           'while the **position cap** defines exposure to a single overnight gap. A 0.5% risk on a 3%-wide stop ' +
           'implies a 17% position; the same 0.5% on a 1%-wide stop would imply 50%, which the position cap ' +
           'refuses. Both constraints bind, and the tighter one wins.' }
    ]
  },

  /* ----------------------------------------------------------------- 10 --- */
  {
    id: 'regime', eyebrow: 'Stage 6', title: 'Market regime: the on/off switch',
    blocks: [
      { p: 'Breakouts are a leveraged bet on market breadth. In downtrending markets they fail, and his own ' +
           'instruction is blunt: sit in cash, trade less, and if you trade at all, trade smaller. The common ' +
           'systematisation — and the one implemented in the screener here — is to take new long entries only ' +
           'while the index holds above its 200-day moving average, cutting size when it is below the 50-day but ' +
           'above the 200-day, and standing down below the 200-day, where the short book becomes the better ' +
           'expression.' },
      { p: 'The June–August 2026 tape is a useful illustration. June was a down month for technology — the ' +
           'S&P 500 fell 1.1% and the Nasdaq 2.8%, capping a second quarter that had gained 15.2%, the strongest ' +
           'in six years — with leadership rotating into health care, industrials and financials. July was close ' +
           'to flat at index level while the Russell 2000 lost 3.1%, and the 24 July session knocked fresh ' +
           'breakouts across the tape on technology capex fears. August took the indices to record highs, with ' +
           'the VIX printing its 2026 low of 14.2 on 17 August — while the spread between index volatility and ' +
           'single-stock volatility sat at a record. A quiet index with violent individual names is the exact ' +
           'regime in which a disciplined breakout book prints, and an undisciplined one gets picked off.' }
    ]
  },

  /* ----------------------------------------------------------------- 11 --- */
  {
    id: 'cases', eyebrow: 'Evidence', title: 'Five trades, June–August 2026',
    blocks: [
      { dataNotice: true },
      { p: 'Three winners and two losers, each evaluated **only on the information available on the trigger ' +
           'date** and then managed forward by the rules above — sell half after 3–5 sessions, stop to breakeven, ' +
           'trail the 10- or 20-day MA, exit on the first close below. Every number in the captions and tables is ' +
           'computed by the engine in this repository, not asserted: the entry is the screener\'s entry, the stop ' +
           'is the screener\'s stop, and the R-multiples come from replaying the management rules bar by bar.' },
      { figures: true },
      { p: 'The scorecard below is the point of the whole document. Two of five trades lost. The five together ' +
           'returned **{{TOTAL_R}}**, and one trade produced {{TOP_SHARE}} of it. At 0.5% risk per trade that is ' +
           'a {{EQUITY_GAIN}} account gain from a sample in which the majority of positions were closed at a loss.' },
      { scorecard: true },
      { callout: { kind: 'note', title: 'What the failures are for',
        text: 'HLTQ was a textbook setup that broke out one session before a market-wide risk-off day; nothing in ' +
              'the process was wrong and it still lost {{HLTQ_R}} on a gap through the stop. SMLQ was never eligible — ' +
              'the screener rejected it on three separate criteria before the trade existed. Those are the two ' +
              'ways money is lost in this system: the unavoidable cost of a fixed-risk loss, and the entirely ' +
              'avoidable cost of overriding a filter.' } }
    ]
  },

  /* ----------------------------------------------------------------- 12 --- */
  {
    id: 'screener', eyebrow: 'Implementation', title: 'What the screener does with all this',
    blocks: [
      { p: 'The companion web app in `app/index.html` implements the rules above as code. For every symbol it ' +
           'computes ADR%, turnover, relative-strength percentiles over 21/63/126 sessions, the full moving-average ' +
           'structure, and then searches every plausible consolidation ending in the last sessions, scoring each ' +
           'on depth-versus-ADR, higher lows, range contraction, volume dry-up and MA adherence. It reports:' },
      { list: [
        'the setup type and its state — `triggered`, `ready` (pivot within one ADR), `building`, or `extended` ' +
          '(the low-risk entry is already gone);',
        'a pass/fail line for every individual criterion, so a rejection is explainable rather than a black box;',
        'a justification paragraph written from the computed facts;',
        'the entry trigger, the hard stop, the risk in percent **and in ADR multiples**, 3R/5R targets, the ' +
          'trailing MA to use, and a share count from your account size and risk tolerance — capped by the ' +
          'position limit and by a share of the stock\'s average volume;',
        'a market-regime banner that sizes the whole book down, or off, when the index structure says so.'
      ] },
      { p: 'It reads real data three ways: a bundled demo universe, CSV import (`symbol,date,open,high,low,close,volume`), ' +
           'or a live provider API with your own key. An "as of" control replays any date in the loaded history, ' +
           'which is how the five cases above were produced.' }
    ]
  }
];

export const SOURCES = [
  ['Qullamaggie — 3 timeless setups that have made me tens of millions', 'https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/'],
  ['Qullamaggie — How to master a setup: Episodic Pivots', 'https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/'],
  ['Qullamaggie — Frequently Asked Questions', 'https://qullamaggie.com/faq/'],
  ['Qullamaggie — Lessons from a $140K loss', 'https://qullamaggie.com/lessons-from-a-140k-loss/'],
  ['Qullamaggie — Stockbee on trading Episodic Pivots', 'https://qullamaggie.net/stockbee-on-trading-episodic-pivots/'],
  ['Grokipedia — Qullamaggie\'s Breakout Entry Strategy', 'https://grokipedia.com/page/Qullamaggies_Breakout_Entry_Strategy'],
  ['Grokipedia — Profit-taking rules of Minervini, Zanger and Qullamaggie', 'https://grokipedia.com/page/Profit-taking_rules_of_Minervini_Zanger_and_Qullamaggie'],
  ['Stonks Capital — Systemizing Kullamägi\'s parabolic short setup', 'https://stonkscapital.substack.com/p/systemizing-kullamagis-parabolic'],
  ['ChartMill — Mastering the Qullamaggie episodic pivot setup', 'https://www.chartmill.com/documentation/stock-screener/technical-analysis-trading-strategies/494-Mastering-the-Qullamaggie-Episodic-Pivot-Setup-A-Flexible-Stock-Screening-Approach'],
  ['Deepvue — Qullamaggie screens', 'https://deepvue.com/screener/qullamaggie-screens/'],
  ['Breakouts Happen — How to trade like Qullamaggie: setups, strategy and screener', 'https://breakoutshappen.com/stock-news/how-to-trade-like-qullamaggie-setups-strategy-and-screener'],
  ['Financial Wisdom — Qullamaggie breakout setup case study: the top 100 winning stocks', 'https://www.financialwisdomtv.com/post/qullamaggie-breakout-setup-case-study-what-the-top-100-winning-stocks-reveal'],
  ['Trading Resource Hub — Qullamaggie on Chat With Traders (interview notes)', 'https://tradingresourcehub.substack.com/p/interview-qullamaggie-chat-with-traders-part1'],
  ['Quant for Free — Rebuilding the Qullamaggie strategy with a 200-day regime filter', 'https://quant4free.com/analysis/qullamaggie-strategy-improved/'],
  ['TradingView — how ADR% and ATR% are calculated', 'https://www.tradingview.com/support/solutions/43000734653-how-are-adr-and-atr-calculated/'],
  ['YCharts — Monthly market wrap, July 2026', 'https://get.ycharts.com/resources/blog/monthly-market-wrap/'],
  ['CNBC — VIX hits 2026 low as stocks sit at record highs (17 August 2026)', 'https://www.cnbc.com/2026/08/17/stock-market-volatility-vix-wall-street.html'],
  ['CNBC — S&P 500 posts back-to-back losses on a tech sell-off (10 August 2026)', 'https://www.cnbc.com/2026/08/10/stock-market-today-live-updates.html'],
  ['TheStreet — Nasdaq and Russell 2000 close lower on capex fears (24 July 2026)', 'https://www.thestreet.com/stock-market-today/stock-market-today-july-24-2026-dow-futures-rebound-as-oil-retreats-after-market-sell-off'],
  ['Penn Mutual AM — The S&P 500 index is calm, its stocks aren\'t (20 August 2026)', 'https://www.pennmutualam.com/market-insights-news/blogs/chart-of-the-week/2026-08-20-the-sp-500-index-is-calm-its-stocks-aren-t']
];
