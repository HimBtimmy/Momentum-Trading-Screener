# The Qullamaggie Playbook

Momentum breakouts, episodic pivots and parabolic shorts — the rules, the arithmetic, and five trades from the June–August 2026 tape.

*Strategy desk note · September 2026*

> The charts for the five case studies are in [docs/executive-summary.html](executive-summary.html); this file is the same document in plain text.

## One idea, three expressions

*The edge*

Kristjan Kullamägi — "Qullamaggie" — compounded a roughly $5,000 account into a peak of about $100 million between 2011 and 2021 while **losing on around seven of every ten trades**. That combination is the whole strategy in one sentence: he is not trying to be right, he is trying to be positioned in the handful of stocks each year that move 50–200% in a few months, with risk so tightly defined that being wrong costs a fixed, trivial fraction of the account.

Everything else is machinery in service of that asymmetry. Three setups supply the entries, one volatility measure (ADR) sizes the risk, and one exit discipline (partial into strength, then trail a moving average) converts the rare 10–20R winner into realised profit instead of a round trip.

> **The arithmetic that makes a 25–30% win rate work**
>
> At a 30% win rate, losers at −1R and winners averaging +5R return +0.8R per trade. At the same win rate with winners averaging +2R, the system returns −0.1R and bleeds. The entire edge lives in the size of the right tail, which is why every rule below is built to keep losses at exactly one unit and to avoid capping winners.

**Setup 1 — Breakout** — A leader that has already moved 30–100%+, consolidates in an orderly flag for two weeks to two months, then expands out of the range. The bread and butter.

**Setup 2 — Episodic pivot** — A dormant stock gaps 10%+ on a genuine catalyst with enormous volume. The least frequent and the best reward-to-risk of the three; clustered in 3–4 week windows each quarter around earnings.

**Setup 3 — Parabolic short** — A stock that has gone vertical (50–100%+ for a large cap, 300–1000%+ for a small cap) over 3–5+ consecutive up days, sold on the first crack. Targets the 10- and 20-day moving averages. Roughly 5–10R when it works.

## The screen: find the leaders, then wait

*Stage 1*

The universe is not "stocks I like" — it is a ranked list rebuilt every day. He scans for the **top 1–2% of performers over one month, three months and six months**. A stock that appears on all three lists is, by definition, what institutions are accumulating right now. Roughly 6,000 tickers reduce to a couple of hundred; the chart work happens only on those.

| Filter | Threshold | Why it exists |
|---|---|---|
| Relative strength | Top 1–2% over 1m / 3m / 6m | Momentum persists; laggards break out and fail. |
| ADR% | ≥ 3.5% floor, 5–6%+ preferred | ADR is the average daily range in percent over the past 20 sessions. If a stock cannot travel, a 3–5R move takes months instead of days. |
| Liquidity | Enough turnover to hold 5–25% of the account | Position sizes run 10–15% of equity; an illiquid name cannot be exited on the day the thesis breaks. |
| Price | Above ~$5 | Avoids the structurally broken and the manipulated. |
| Trend structure | Above rising 10/20/50-day MAs, near 52-week highs | The setup is continuation, not reversal. Nothing below the 50-day qualifies. |

The screen produces candidates, not trades. A name can sit on the list for weeks before its consolidation tightens into something with a definable risk point — and most never get there.

## The breakout: a leg, a flag, a range expansion

*Setup 1*

The pattern has three parts, in strict order. First, **the leg**: a 30–100%+ advance that usually takes a few days to a few weeks — evidence that something real changed. Second, **the flag**: two weeks to two months of sideways digestion in which price "surfs" the rising 10- and 20-day (sometimes 50-day) moving average. Third, **the expansion**: a decisive break above the consolidation high on expanded volume.

What separates a tradeable flag from a topping pattern is measurable, and the screener in this repository measures all four:

**Higher lows** — Buyers step in at progressively higher prices. The lowest low of the back half of the base should sit above the lowest low of the front half.

**Contracting range** — Average daily range in the last third of the base should be smaller than in the first third. Volatility compression is stored energy.

**Volume dry-up** — Volume through the base should be below the volume of the advance that preceded it. Heavy volume in a sideways range is distribution, not accumulation.

**Depth proportional to ADR** — A 4% ADR stock has no business correcting 30%. Depth is judged against the stock's own volatility and the length of the base, not against a fixed percentage.

> **The tightness is the trade**
>
> The purpose of the flag is not the pattern — it is that a tight range puts a logical stop within one ADR of the entry. All three setups are, in his words, about "finding low risk entries on fast moving stocks by finding tight, high probability areas to enter." If the stop cannot be tight, there is no trade, however good the chart looks.

## The trigger: opening-range highs, not closing prices

*Stage 2*

This is the mechanic most people get wrong. He does not buy a daily close above resistance and he does not set a resting order at the pivot. He buys **the break of the opening range high** on the day the stock expands: the high of the first 1-minute candle, the first 5-minute candle, or the first 60-minute candle — on the hourly chart the first bar covers 9:30–10:00 only. Any of them, or a combination, scaling in as each higher timeframe confirms.

**Why the opening range** — It is the tightest defensible structure available on a big volume day. The risk point is the low of that same range, often 1–3% away on a stock with a 6% ADR.

**Which timeframe** — Faster, higher-ADR stocks justify the 1-minute range; slower names need the 5- or 60-minute range to filter noise.

**If it does not trigger, there is no trade** — A stock that cannot take out its early high on a breakout day is showing you the demand is not there. He skips it rather than buying lower.

**Gaps through the pivot** — When the stock gaps above the pivot, the entry becomes the opening-range high above the open — never a chase into the middle of a range-expansion bar.

## The stop: the low of the day, capped at one ADR

*Stage 3*

Two rules, and the second one governs:

**Structural stop** — The low of the entry day (for an opening-range entry, the low of that opening range). Hard stop, resting in the market — and a market order, not a limit order, when it triggers.

**The 1× ADR ceiling** — The stop is **never wider than one ADR**, 1.5× at the absolute most. If a stock has a 5% ADR, the stop is not more than 5% away. When the logical structural stop is wider than that, the trade is skipped — not resized, not "given room".

The reason is arithmetic, not superstition. Risk of 1 ADR means one average day in your favour returns roughly 1R; risk of 3 ADR means the same move returns 0.3R, and the right tail that pays for the whole system disappears. The ADR cap is what converts a good chart into a good trade.

> **Stops are jumped, not honoured**
>
> A hard stop defines intent, not outcome. When a stock gaps down through the level overnight the fill is the open, and a planned −1R becomes −1.5R or worse — see the HLTQ case below, which filled at −1.52R. This is why position size is capped at 5–25% of equity (typically 10–15%) and why he holds no more than 30% of the account overnight in a single name.

## Taking profit: half into strength, trail the rest

*Stage 4*

The exit rule is fixed and mechanical, which is what makes it survivable:

**1. Sell 1/3 to 1/2 after 3–5 days** — Into the initial burst of strength, while the move is still vertical. This is where the win rate comes from — it banks the part of the move that is most likely to be given back.

**2. Move the stop to breakeven** — The remaining position now cannot lose money. Psychologically this is what allows a trade to be held for weeks.

**3. Trail the balance on the 10- or 20-day MA** — The 10-day for fast, high-ADR movers; the 20-day for slower names. Exit the remainder on the **first close below** it — a close, not an intraday touch.

Target guidance is 3–5R and up; in strong markets the trailing leg routinely produces 10–20R. For parabolic shorts the target is explicit rather than trailed: cover into the 10- and 20-day moving averages, where these stocks find their first real bounce.

## Episodic pivots: buying a repricing

*Setup 2*

An episodic pivot is not a chart pattern, it is a **change in the facts**. A stock gaps 10% or more on news, with volume so heavy that it trades its entire average daily volume in the first 15–20 minutes. He learned the setup from Pradeep Bonde (Stockbee), and it is the highest reward-to-risk of the three — and the rarest, concentrated in 3–4 week windows each quarter.

| Condition | Requirement |
|---|---|
| Gap | ≥ 10% above the prior close |
| Volume | Average daily volume traded in the first 15–20 minutes; 3×+ normal on the day |
| Prior behaviour | Flat, dormant, ignored for 3–6 months before the catalyst |
| Catalyst type | Earnings or guidance; FDA / biotech; contracts and partnerships; political or regulatory; sector-wide news |
| Entry | Break of the 1-minute opening-range high, adding on the 5-minute high |
| Stop | The low of the day (in practice, the opening-range low), within 1–1.5× ADR |

Dormancy is the feature. A stock nobody owns has no trapped supply overhead, so a genuine surprise forces institutions to build a position in the market rather than into sellers — which is why these gaps trend for weeks instead of filling. A gap on a stock that has already doubled is the opposite trade: that is supply, and it is the failure case shown in SMLQ below.

## Parabolic shorts: patience, then the first crack

*Setup 3*

The setup is a stock that has gone vertical: 50–100%+ in days or weeks for a large cap, 300–1000%+ for a small cap, ideally accelerating into the final stretch, with 3–5+ consecutive up days.

**Never day one, rarely day two** — He waits for day three, four or five, when the move is clearly extended **and** the first sign of weakness has appeared. Shorting strength is how accounts die.

**Three triggers** — A break of the opening-range low on the 1- or 5-minute chart; the first red 5-minute candle after a gap up; or — his preferred trigger — a failed bounce back into VWAP.

**Stop** — The high of the day, or a reclaim of VWAP if VWAP was the trigger. Same 1× ADR ceiling as the long book.

**Target** — The 10- and 20-day moving averages. Successful parabolic shorts fall 50–60%+ within days, which is where the 5–10R comes from.

> **The $140,000 lesson**
>
> His own worst documented loss came from shorting a stock up 240% in two weeks that had gapped into resistance — but on earnings, and it held above its opening price. Instead of breaking it traded a "range of death" all day, faking breakdowns and ripping back, while he scaled in and out with size. The rule that came out of it: a gap that holds above its open is not a short, whatever the chart says, and scaling into a losing short is not a strategy.

## Sizing and portfolio risk

*Stage 5*

| Parameter | Rule |
|---|---|
| Risk per trade | 0.25–1% of equity; typically 0.3–0.5%. Beginners: 0.5% until consistently profitable. Rarely above 1%, even on high conviction. |
| Position size | 5–25% of the account, most often 10–15%, scaled by liquidity, conviction and the riskiness of the stock. |
| Overnight concentration | Never more than 30% of the account overnight in one stock or ETF. Intraday can be larger, because there is no gap risk. |
| Order type | Hard stops in the market. Market orders on exit, never limits — a limit order in a fast break is a position you still own. |
| Small accounts | He risked more (0.5–1.5%) when his account was small; that is a function of rebuilding capacity, not of edge. |

Note the two-layer structure: the **stop** defines risk per trade as a fixed fraction of equity, while the **position cap** defines exposure to a single overnight gap. A 0.5% risk on a 3%-wide stop implies a 17% position; the same 0.5% on a 1%-wide stop would imply 50%, which the position cap refuses. Both constraints bind, and the tighter one wins.

## Market regime: the on/off switch

*Stage 6*

Breakouts are a leveraged bet on market breadth. In downtrending markets they fail, and his own instruction is blunt: sit in cash, trade less, and if you trade at all, trade smaller. The common systematisation — and the one implemented in the screener here — is to take new long entries only while the index holds above its 200-day moving average, cutting size when it is below the 50-day but above the 200-day, and standing down below the 200-day, where the short book becomes the better expression.

The June–August 2026 tape is a useful illustration. June was a down month for technology — the S&P 500 fell 1.1% and the Nasdaq 2.8%, capping a second quarter that had gained 15.2%, the strongest in six years — with leadership rotating into health care, industrials and financials. July was close to flat at index level while the Russell 2000 lost 3.1%, and the 24 July session knocked fresh breakouts across the tape on technology capex fears. August took the indices to record highs, with the VIX printing its 2026 low of 14.2 on 17 August — while the spread between index volatility and single-stock volatility sat at a record. A quiet index with violent individual names is the exact regime in which a disciplined breakout book prints, and an undisciplined one gets picked off.

## Five trades, June–August 2026

*Evidence*

> **About the price data in these five charts**
>
> This analysis was produced in a sandboxed environment whose network policy blocks every market-data host (Yahoo, Stooq, Polygon, Tiingo, FMP, Finnhub, Nasdaq, the SEC and qullamaggie.com itself all return 403 at the egress gateway). Real June–August 2026 OHLCV could not be fetched, so rather than attribute invented prices to real companies, the five case studies use **synthetic price series with archetype tickers**, generated by `tools/build-datasets.mjs` and laid out on the real NYSE trading calendar. The market backdrop described around them is real and sourced; the bars are not. Everything else — the rules, the screening logic, the entry and stop arithmetic and the trade simulation — is real code that runs on real data the moment you import a CSV into the screener. See `data/DATA.md`.

Three winners and two losers, each evaluated **only on the information available on the trigger date** and then managed forward by the rules above — sell half after 3–5 sessions, stop to breakeven, trail the 10- or 20-day MA, exit on the first close below. Every number in the captions and tables is computed by the engine in this repository, not asserted: the entry is the screener's entry, the stop is the screener's stop, and the R-multiples come from replaying the management rules bar by bar.

### MEMQ — Breakout (continuation flag) · WINNER +12.07R

*Memory / storage momentum leader (archetype). Trigger 2026-07-02. ADR 5.7%. Entry 52.92 · stop 51.31 · risk 3.05% (0.54× ADR) · max favourable excursion 27.3R.*

The dominant theme of 2026 was the memory shortage — DRAM/NAND names led every momentum list in the real tape. June 2026 was a down month for tech (Nasdaq −2.8%), which is exactly what turns a vertical leg into a tradeable flag: the leader stops going up but refuses to break, while the index does the correcting for it.

**Why it was flagged.** MEMQ trades at $54.56 with a 5.7% ADR (leader-grade) and $90M of average daily turnover, so it is volatile enough to pay multiples of risk in days and liquid enough to get size in and out. It is up 9.5% over one month, 115.4% over three and 162.6% over six, and it sits 2% off its 52-week high. The pattern is the textbook continuation setup: a 112.9% advance over 41 sessions beginning 2026-03-23, followed by 29 sessions of orderly consolidation since 2026-05-20. That base is only 11.9% deep against the 24.6% its ADR would allow, lows are rising (+0.3% back-half vs front-half), the daily range has contracted to 0.64x what it was at the start of the base, and volume has dried up to 0.46x the volume of the advance. Price spent 100% of the base above a rising 50-day MA while hugging the 20-day EMA - the "surfing" behaviour that marks institutional accumulation rather than distribution. It cleared the 52.87 pivot on 2026-07-02 on 7x average volume with a 1.6x range expansion, which is the trigger.

**The plan.** Entry: Buy-stop on a break of the 1-min / 5-min / 60-min opening-range high once price clears 52.87. Reference level $52.92. Stop: $51.31 - Hard stop at the low of the breakout day (2026-07-02, 51.31). That is 3% of price, 0.54x ADR. Targets: 3R at $57.76, 5R at $60.99; then trail the balance on the 10-day EMA. Management: Sell 1/3 to 1/2 into strength after 3-5 days and move the stop to breakeven; trail the remainder on the 10-day moving average and exit on the first close below it. Size: 310 shares ($16.4K, 16.4% of equity) risks $499.99 = 0.5% of the account.

**Fills.**

| Date | Size | Price | R | Why |
|---|---|---|---|---|
| 2026-07-09 | 50% | 59.82 | +4.28R | sold 50% into strength after 4 sessions |
| 2026-08-19 | 50% | 84.97 | +19.87R | first close below the 10-day MA |

**Lesson.** The A+ version of the setup: a real leg, six weeks of orderly digestion on drying volume while the index corrected, then a range expansion out of a tight pivot area. Because the stock coiled right underneath its pivot, the entry-day low sat barely half an ADR below the trigger — which is the only reason a move of this size converts into double-digit R rather than low single digits.

*Chart: see [docs/executive-summary.html](executive-summary.html#case-MEMQ).*

---

### NRGX — Episodic pivot (contract + guidance gap) · WINNER +8.76R

*Oilfield-services re-rating (archetype). Trigger 2026-07-22. ADR 4.5%. Entry 15.68 · stop 15.28 · risk 2.52% (0.56× ADR) · max favourable excursion 14.4R.*

July 2026 was a rotation month: the S&P was roughly flat while leadership moved out of mega-cap tech into energy, financials and materials. Energy-services names were the real-tape example of this — one of them was up over 400% on a one-year view by August. EPs cluster in earnings season, and this one lands in the last week of July.

**Why it was flagged.** NRGX trades at $16.41 with a 4.5% ADR (workable) and $35.7M of average daily turnover, so it is volatile enough to pay multiples of risk in days and liquid enough to get size in and out. This is an episodic pivot, not a chart pattern: NRGX gapped 19% on 2026-07-22 on 7x its average volume, after spending the prior 90 sessions in a 35.3% range. Dormancy is the feature, not a bug - the best EPs come out of stocks nobody was watching, because the gap forces a repricing that institutions then have to chase for weeks. It closed in the top 16% of the gap day's range, so buyers held the gap into the bell rather than selling it. It is up 40.7% over one month, 56.6% over three and 72.4% over six, and it sits 1.3% off its 52-week high. Levels come from the opening range of 2026-07-22 (ORH 15.66 / ORL 15.28); the full day spans 1.8 ADRs, which is why the opening range, not the day, defines the risk.

**The plan.** Entry: Buy-stop on a break of the opening-range high (1-min, then add on the 5-min ORH) once price clears 15.66. Reference level $15.68. Stop: $15.28 - Hard stop at the low of the entry day (structural low 15.28). That is 2.5% of price, 0.56x ADR. Targets: 3R at $16.86, 5R at $17.65; then trail the balance on the 20-day EMA. Management: Sell 1/3 to 1/2 into strength after 3-5 days and move the stop to breakeven; trail the remainder on the 20-day moving average and exit on the first close below it. Size: 1,263 shares ($19.8K, 19.8% of equity) risks $499.72 = 0.5% of the account.

**Fills.**

| Date | Size | Price | R | Why |
|---|---|---|---|---|
| 2026-07-28 | 50% | 17.54 | +4.71R | sold 50% into strength after 4 sessions |
| 2026-09-11 | 50% | 20.74 | +12.80R | still open at the end of the window |

**Lesson.** Dormancy is the feature. Four and a half months of chopping inside a wide, directionless range means nobody is positioned and there is no trapped supply immediately overhead, so a 19% gap on 7x volume forces a repricing that institutions then spend weeks chasing. Note where the risk came from: the gap day itself spanned several ADRs, so a full-day stop would have been unusable — it was the opening-range low that made the risk half an ADR.

*Chart: see [docs/executive-summary.html](executive-summary.html#case-NRGX).*

---

### ADVX — Parabolic short · WINNER +5.28R

*Specialty semiconductor substrates (archetype). Trigger 2026-08-10. ADR 8.8%. Entry 65.30 · stop 68.24 · risk 4.49% (0.51× ADR) · max favourable excursion 6.7R.*

Small-cap AI-adjacent names went vertical through late July 2026 on the back of the memory/AI capex theme. On 10 August the real tape handed the short side its catalyst: the S&P posted back-to-back losses on a tech sell-off, and the most extended names broke first.

**Why it was flagged.** ADVX trades at $59.37 with a 8.8% ADR (very high) and $233.2M of average daily turnover, so it is volatile enough to pay multiples of risk in days and liquid enough to get size in and out. ADVX has gone parabolic: 97.8% at its fastest over the last 5-20 sessions, 10 consecutive up closes, RSI(14) at 96, and price stretched 4 ADRs above its 20-day EMA. Moves like this end in a vacuum, not a rounded top. The first crack has appeared - it closed red and closed in the bottom third of its range - which is the only condition under which this setup is tradeable. Never short day one or two of a parabolic move. First cover zone is the 10-day EMA at 49.95 and the 20-day EMA at 43.76 (26.3% below here).

**The plan.** Entry: Failed reclaim of VWAP on 2026-08-10 (reference 65.37), which is his preferred trigger; the alternatives are the 1- or 5-min opening-range low and the first red 5-min candle after a gap up. Never on day one of the move. Reference level $65.3. Stop: $68.24 - Hard stop at the high of 2026-08-10 (68.24). That is 4.5% of price, 0.51x ADR. Targets: the 10-day EMA at $49.95 and the 20-day EMA at $43.76 (3R at $56.5). Management: Cover into the 10- and 20-day moving averages, taking the first tranche once the stock is down 2-3 ADRs from entry. These are day-to-three-day trades, not positions to marry. Size: 170 shares ($11.1K, 11.1% of equity) risks $499.01 = 0.5% of the account.

**Fills.**

| Date | Size | Price | R | Why |
|---|---|---|---|---|
| 2026-08-13 | 50% | 52.31 | +4.43R | covered into the 10-day MA |
| 2026-08-18 | 50% | 47.29 | +6.14R | covered the balance into the 20-day MA |

**Lesson.** The discipline is in the waiting. A vertical run, a string of up closes and an RSI in the nineties is not a short — it is a watch-list entry, and the screener says so explicitly until the first crack appears. The trade only existed once the stock failed back through VWAP, which is what put the stop at that session's high, inside half an ADR. Shorting the same stock two days earlier, with the stop several ADRs away, is the same idea with no edge.

*Chart: see [docs/executive-summary.html](executive-summary.html#case-ADVX).*

---

### HLTQ — Breakout (continuation flag) · LOSER -1.52R

*Health-care rotation winner (archetype). Trigger 2026-07-23. ADR 5.0%. Entry 93.26 · stop 91.46 · risk 1.93% (0.39× ADR) · max favourable excursion 0.0R.*

Health care was one of the June 2026 leadership groups as money left tech. This name did everything right on the chart and then broke out on 23 July — one session before the 24 July tape, when capex fears knocked the Nasdaq and the Russell 2000 lower and every fresh breakout in the market got sold.

**Why it was flagged.** HLTQ trades at $95.79 with a 5% ADR (leader-grade) and $79.3M of average daily turnover, so it is volatile enough to pay multiples of risk in days and liquid enough to get size in and out. It is up 9.8% over one month, 72.3% over three and 103.5% over six, and it sits 1.5% off its 52-week high. The pattern is the textbook continuation setup: a 75.5% advance over 59 sessions beginning 2026-04-02, followed by 17 sessions of orderly consolidation since 2026-06-29. That base is only 10.4% deep against the 16.6% its ADR would allow, lows are rising (+1.9% back-half vs front-half), the daily range has contracted to 0.74x what it was at the start of the base, and volume has dried up to 0.4x the volume of the advance. Price spent 100% of the base above a rising 50-day MA while hugging the 20-day EMA - the "surfing" behaviour that marks institutional accumulation rather than distribution. It cleared the 93.17 pivot on 2026-07-23 on 3x average volume with a 1.6x range expansion, which is the trigger.

**The plan.** Entry: Buy-stop on a break of the 1-min / 5-min / 60-min opening-range high once price clears 93.17. Reference level $93.26. Stop: $91.46 - Hard stop at the low of the breakout day (2026-07-23, 91.46). That is 1.9% of price, 0.39x ADR. Targets: 3R at $98.67, 5R at $102.28; then trail the balance on the 10-day EMA. Management: Sell 1/3 to 1/2 into strength after 3-5 days and move the stop to breakeven; trail the remainder on the 10-day moving average and exit on the first close below it. Size: 214 shares ($20K, 20% of equity) risks $385.88 = 0.39% of the account; size capped by the 20% max-position rule, so realised risk is below 0.5%.

**Fills.**

| Date | Size | Price | R | Why |
|---|---|---|---|---|
| 2026-07-24 | 100% | 90.52 | -1.52R | initial stop hit — gapped through, filled at the open |

**Lesson.** A textbook −1R. Nothing about the setup was wrong; the tape was. This is what 70% of trades look like and why the stop is non-negotiable: the gap-down through the breakout-day low is exactly the event the 1-ADR rule is sized for. No averaging down, no "giving it room", no re-entry until a new base forms.

*Chart: see [docs/executive-summary.html](executive-summary.html#case-HLTQ).*

---

### SMLQ — Episodic pivot · LOSER -1.00R

*Small-cap momentum name (archetype). Trigger 2026-08-11. ADR 7.0%. Entry 8.45 · stop 8.21 · risk 2.82% (0.40× ADR) · max favourable excursion 0.8R.*

Mid-August 2026 looked benign — the VIX printed its 2026 low of 14.2 on 17 August with the indices at record highs — but single-stock volatility was at a record spread to index volatility. Quiet index, violent individual names: the exact tape in which a weak gap gets sold.

**Why it was flagged.** SMLQ trades at $7.93 with a 7% ADR (leader-grade) and $14.1M of average daily turnover, so it is volatile enough to pay multiples of risk in days and liquid enough to get size in and out. This is an episodic pivot, not a chart pattern: SMLQ gapped 14% on 2026-08-11 on 1.6x its average volume, after spending the prior 90 sessions in a 55.2% range. Dormancy is the feature, not a bug - the best EPs come out of stocks nobody was watching, because the gap forces a repricing that institutions then have to chase for weeks. It closed in the top 82% of the gap day's range, so buyers held the gap into the bell rather than selling it. It is up 6.7% over one month, 4.3% over three and 58% over six, and it sits 13.5% off its 52-week high. Levels come from the opening range of 2026-08-11 (ORH 8.44 / ORL 8.21); the full day spans 1.6 ADRs, which is why the opening range, not the day, defines the risk.

**The plan.** Entry: Buy-stop on a break of the opening-range high (1-min, then add on the 5-min ORH) once price clears 8.44. Reference level $8.45. Stop: $8.21 - Hard stop at the low of the entry day (structural low 8.21). That is 2.8% of price, 0.4x ADR. Targets: 3R at $9.16, 5R at $9.64; then trail the balance on the 10-day EMA. Management: Sell 1/3 to 1/2 into strength after 3-5 days and move the stop to breakeven; trail the remainder on the 10-day moving average and exit on the first close below it. Size: 2,096 shares ($17.7K, 17.7% of equity) risks $499.77 = 0.5% of the account.

**Fills.**

| Date | Size | Price | R | Why |
|---|---|---|---|---|
| 2026-08-11 | 100% | 8.21 | -1.00R | lost the opening range the same session — stopped out intraday |

**Lesson.** Three criteria failed before the trade was ever taken. Volume was 1.6x average, not the 3x+ the setup demands; the stock was not dormant — it had round-tripped inside a 55%-wide range, leaving trapped supply at every level above; and it closed in the bottom fifth of the gap day's range, meaning the buyers who created the gap were gone by the bell. The screener rejects it outright. Traded anyway, it lost the opening range the same session for a clean −1R.

*Chart: see [docs/executive-summary.html](executive-summary.html#case-SMLQ).*

The scorecard below is the point of the whole document. Two of five trades lost. The five together returned **+23.59R**, and one trade produced 51% of it. At 0.5% risk per trade that is a +11.8% account gain from a sample in which the majority of positions were closed at a loss.

| Symbol | Setup | Trigger | Risk (ADR) | Result | MFE | Equity @0.5% |
|---|---|---|---|---|---|---|
| MEMQ | Breakout | 2026-07-02 | 0.54× | +12.07R | 27.3R | 6.04% |
| NRGX | Episodic pivot | 2026-07-22 | 0.56× | +8.76R | 14.4R | 4.38% |
| ADVX | Parabolic short | 2026-08-10 | 0.51× | +5.28R | 6.7R | 2.64% |
| HLTQ | Breakout | 2026-07-23 | 0.39× | -1.52R | 0.0R | -0.76% |
| SMLQ | Episodic pivot | 2026-08-11 | 0.40× | -1.00R | 0.8R | -0.50% |
| **Total** | | | | **+23.59R** | | **+11.8%** |

> **What the failures are for**
>
> HLTQ was a textbook setup that broke out one session before a market-wide risk-off day; nothing in the process was wrong and it still lost 1.52R on a gap through the stop. SMLQ was never eligible — the screener rejected it on three separate criteria before the trade existed. Those are the two ways money is lost in this system: the unavoidable cost of a fixed-risk loss, and the entirely avoidable cost of overriding a filter.

## What the screener does with all this

*Implementation*

The companion web app in `app/index.html` implements the rules above as code. For every symbol it computes ADR%, turnover, relative-strength percentiles over 21/63/126 sessions, the full moving-average structure, and then searches every plausible consolidation ending in the last sessions, scoring each on depth-versus-ADR, higher lows, range contraction, volume dry-up and MA adherence. It reports:

- the setup type and its state — `triggered`, `ready` (pivot within one ADR), `building`, or `extended` (the low-risk entry is already gone);
- a pass/fail line for every individual criterion, so a rejection is explainable rather than a black box;
- a justification paragraph written from the computed facts;
- the entry trigger, the hard stop, the risk in percent **and in ADR multiples**, 3R/5R targets, the trailing MA to use, and a share count from your account size and risk tolerance — capped by the position limit and by a share of the stock's average volume;
- a market-regime banner that sizes the whole book down, or off, when the index structure says so.

It reads real data three ways: a bundled demo universe, CSV import (`symbol,date,open,high,low,close,volume`), or a live provider API with your own key. An "as of" control replays any date in the loaded history, which is how the five cases above were produced.

## Sources

- [Qullamaggie — 3 timeless setups that have made me tens of millions](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/)
- [Qullamaggie — How to master a setup: Episodic Pivots](https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/)
- [Qullamaggie — Frequently Asked Questions](https://qullamaggie.com/faq/)
- [Qullamaggie — Lessons from a $140K loss](https://qullamaggie.com/lessons-from-a-140k-loss/)
- [Qullamaggie — Stockbee on trading Episodic Pivots](https://qullamaggie.net/stockbee-on-trading-episodic-pivots/)
- [Grokipedia — Qullamaggie's Breakout Entry Strategy](https://grokipedia.com/page/Qullamaggies_Breakout_Entry_Strategy)
- [Grokipedia — Profit-taking rules of Minervini, Zanger and Qullamaggie](https://grokipedia.com/page/Profit-taking_rules_of_Minervini_Zanger_and_Qullamaggie)
- [Stonks Capital — Systemizing Kullamägi's parabolic short setup](https://stonkscapital.substack.com/p/systemizing-kullamagis-parabolic)
- [ChartMill — Mastering the Qullamaggie episodic pivot setup](https://www.chartmill.com/documentation/stock-screener/technical-analysis-trading-strategies/494-Mastering-the-Qullamaggie-Episodic-Pivot-Setup-A-Flexible-Stock-Screening-Approach)
- [Deepvue — Qullamaggie screens](https://deepvue.com/screener/qullamaggie-screens/)
- [Breakouts Happen — How to trade like Qullamaggie: setups, strategy and screener](https://breakoutshappen.com/stock-news/how-to-trade-like-qullamaggie-setups-strategy-and-screener)
- [Financial Wisdom — Qullamaggie breakout setup case study: the top 100 winning stocks](https://www.financialwisdomtv.com/post/qullamaggie-breakout-setup-case-study-what-the-top-100-winning-stocks-reveal)
- [Trading Resource Hub — Qullamaggie on Chat With Traders (interview notes)](https://tradingresourcehub.substack.com/p/interview-qullamaggie-chat-with-traders-part1)
- [Quant for Free — Rebuilding the Qullamaggie strategy with a 200-day regime filter](https://quant4free.com/analysis/qullamaggie-strategy-improved/)
- [TradingView — how ADR% and ATR% are calculated](https://www.tradingview.com/support/solutions/43000734653-how-are-adr-and-atr-calculated/)
- [YCharts — Monthly market wrap, July 2026](https://get.ycharts.com/resources/blog/monthly-market-wrap/)
- [CNBC — VIX hits 2026 low as stocks sit at record highs (17 August 2026)](https://www.cnbc.com/2026/08/17/stock-market-volatility-vix-wall-street.html)
- [CNBC — S&P 500 posts back-to-back losses on a tech sell-off (10 August 2026)](https://www.cnbc.com/2026/08/10/stock-market-today-live-updates.html)
- [TheStreet — Nasdaq and Russell 2000 close lower on capex fears (24 July 2026)](https://www.thestreet.com/stock-market-today/stock-market-today-july-24-2026-dow-futures-rebound-as-oil-retreats-after-market-sell-off)
- [Penn Mutual AM — The S&P 500 index is calm, its stocks aren't (20 August 2026)](https://www.pennmutualam.com/market-insights-news/blogs/chart-of-the-week/2026-08-20-the-sp-500-index-is-calm-its-stocks-aren-t)

---

*Rules compiled from Kristjan Kullamägi's own published writing and interviews. Price series in the case studies are synthetic — see the provenance note. Nothing here is investment advice.*
