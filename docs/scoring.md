# How the screener scores a setup

Three numbers appear against every candidate, and they answer different questions:

| | Range | Question it answers |
|---|---|---|
| **Setup score** | 0–100 | How well does this match the mechanics of the setup? |
| **Quality grade** | A+ / A / B / C | Is the stock behind the pattern actually a momentum leader? |
| **Trend template** | n/8 | How does it read against Minervini's eight-point structural test? |

A stock can score 85 and still grade B. That is the point: Qullamaggie's screen is about
the *shape of the trade*, and a shape can be perfect on a stock whose longer-term structure
is still repairing. The screener never hides those names — his rules would take them — but
it says so in the justification instead of calling everything textbook.

**Provenance of the numbers.** The *thresholds* (ADR ≥ 3.5%, gap ≥ 10%, volume ≥ 3×, stop
≤ 1× ADR, base 2 weeks–2 months, 3–5+ up days …) are Kullamägi's, sourced in
[the playbook](executive-summary.md). The *weights* that turn those tests into a single
number are this implementation's engineering choice — they are a ranking convenience, not
part of his method, and every one of them is exposed in `QM.DEFAULTS` for tuning. All of it
lives in `app/engine.js`.

---

## 1. Setup score

### Breakout — `detectBreakout()`

| Component | Max | How it is computed |
|---|---|---|
| Relative strength | 25 | `(100 − best RS percentile) / 100 × 25` when a universe is loaded. Screening a lone symbol falls back to absolute returns: 1-month capped at 25% (8 pts), 3-month at 60% (9), 6-month at 100% (8). |
| Prior leg | 15 | `min(leg% / 100, 1) × 15` — a 100%+ advance maxes it out. |
| Base quality | 30 | The sub-score below, scaled. |
| Trend structure | 15 | Above 10EMA (3), above 20EMA (3), above 50MA (4), 50MA rising over 10 sessions (3), above 200MA (2). |
| ADR fit | 6 | `min((ADR − 3.5) / 5, 1) × 6` — full marks at 8.5% ADR. |
| Turnover | 4 | `min(log₁₀(turnover / $5M) / 1.5, 1) × 4` — full marks around $150M/day. |
| Trigger state | 5 | Triggered 5 · ready 4 · triggered-on-thin-volume 2 · building or extended 0. |

**Base quality (0–100), from `scoreBase()`** — the four things he names, measured:

| Component | Max | Measured as |
|---|---|---|
| Tightness | 32 | `1 − depth / depthCap`, where `depthCap = clamp(1.8 × ADR × √(len/5), 5%, 35%)`. Depth is judged against the stock's own volatility and the base's length, never a fixed percentage. |
| Higher lows | 22 | All-or-nothing: lowest low of the back half ≥ 99.5% of the front half's. |
| Range contraction | 20 | `(1.15 − contraction) / 0.55`, where contraction = mean daily range of the last third ÷ the first third. |
| Volume dry-up | 14 | `(1.05 − volRatio) / 0.55`, where volRatio = base volume ÷ the volume of the advance. |
| Above a rising 50MA | 7 | Fraction of base sessions closing above the 50-day. |
| Surfing the 20EMA | 5 | Fraction of sessions closing within `max(2%, ADR)` of the 20-day EMA. |
| *Freshness penalty* | −1.5/bar | Subtracted per session between the end of the base and today, so a stale base ranks below a live one. |

Every plausible base is scored — lengths of 5 to 60 sessions, ending anywhere from today to
four sessions ago — and the highest-scoring one wins. Searching past end-dates is what lets
the engine recognise "the base ended, and *this* bar is the breakout".

### Episodic pivot — `detectEP()`

| Component | Max | How |
|---|---|---|
| Gap size | 22 | `min(gap% / 30, 1) × 22` |
| Relative volume | 20 | `min(rvol / 8, 1) × 20` |
| Dormancy | 16 | `1 − baseRange / 45%` over the 90 sessions before the gap |
| Gap held into the close | 12 | Close's position in the day's range |
| Relative strength | 15 | 60% of the RS component above |
| Trend structure | 6 | 40% of the breakout's trend score |
| ADR fit | 5 | As above |

### Parabolic short — `detectParabolic()`

| Component | Max | How |
|---|---|---|
| Size of the move | 30 | `min(move / (2 × threshold), 1) × 30`; the threshold is 50% for large caps, 200% for sub-$500M |
| Extension | 25 | `min(ADRs above the 20EMA / 10, 1) × 25` |
| RSI(14) | 15 | `(RSI − 60) / 40` |
| Consecutive up days | 15 | `min(days / 6, 1) × 15`, counted **into the recent peak**, not into today |
| First crack | 15 | All-or-nothing: a red close, a close under the prior day's low, a lower high, or a close in the bottom third |

---

## 2. Eligibility

The score ranks; these gates decide. Failing any of them keeps a name off the actionable
list, and the card shows exactly which one failed.

**All setups** — price ≥ $5, ADR ≥ 3.5%, 20-day turnover ≥ $5M, and (when set) inside the
market-cap band. **Breakout** — a prior leg ≥ 30%, base quality ≥ 45, not more than 1.5 ADR
past the pivot, and either triggered or within 2 ADR of the pivot. **Episodic pivot** — gap
≥ 10%, volume ≥ 1.8× average, prior 90-session range ≤ 54%. **Parabolic short** — 3+ up
days into the peak, ≥ 80% of the move threshold, ≥ 2.4 ADRs extended, **and** a first sign
of weakness; without that last one it is a watch-list entry, never a trade.

### Status values

`triggered` · `triggered-lowvol` (through the pivot without volume expansion) · `ready`
(pivot within 1 ADR) · `building` · `extended` (the low-risk entry is gone) · `fresh` (a
recent EP gap) · `watch` (parabolic, no crack yet).

---

## 3. Quality grade

Computed by `assessQuality()` after a setup is detected. It combines the trend template,
the setup score, base quality, and a catalogue of specific caveats.

| Grade | Awarded when |
|---|---|
| **A+ — textbook** | Every measurable trend-template test passes, setup score ≥ 72, base quality ≥ 62, and at most one substantive caveat |
| **A — high quality** | At most one trend-template failure, setup score ≥ 62, at most three caveats |
| **B — tradeable, second tier** | At least 60% of the trend-template tests pass |
| **C — mechanically qualifies only** | Below that |

A+ is downgraded to A when the structural stop is wider than one ADR: a setup nobody can
enter cheaply is not textbook, whatever the chart says.

### The Minervini trend template

Eight structural tests, applied alongside the Qullamaggie mechanics:

1. Price above both the 150- and 200-day MA
2. 150-day MA above the 200-day
3. 200-day MA rising over the last 20 sessions
4. 50-day MA above both the 150- and 200-day
5. Price above the 50-day MA
6. At least 30% above the 52-week low
7. Within 25% of the 52-week high
8. RS rating ≥ 70

A test that **cannot be measured** is excluded from the denominator rather than counted as
a failure — screening a single symbol gives no universe to rank RS against, so those
candidates are scored out of 7 and the justification says the RS test went unscored.

### RS rating

Percentile of the best of the 1-, 3- and 6-month returns across the screened universe,
expressed in the familiar **1–99** convention: **99 is the strongest name in the universe**,
1 the weakest. Minervini's floor is 70; leadership generally lives at 80–90+. With fewer
symbols loaded the percentile is coarser — RS from a 25-name demo universe is not
comparable to RS from 3,500 VTI constituents.

### The caveat catalogue

Caveats are generated from measured facts, not from the grade, and each names its number:

* failed trend-template tests, listed individually
* RS below 70 — "a momentum setup on a stock that is not yet a momentum leader"
* ADR below 5% — the same R takes longer to arrive
* more than 25% below the 52-week high — a repair pattern, not a leadership breakout
* base: flat or falling lows · volume not drying up · range widening · depth within 85% of
  its cap · a prior leg under 40%
* breakout on thin volume · already extended past the pivot
* EP: volume under 3× · closed in the lower half of the gap day · not dormant beforehand
* parabolic: no crack yet
* a structural stop wider than 1 ADR
* an index regime that is not an uptrend, for long setups

When none apply, the justification says so explicitly rather than staying silent.

---

## 4. Tuning

Everything above reads from `QM.DEFAULTS` in `app/engine.js`; the UI exposes the gates that
matter most (risk, position cap, ADR floor, turnover floor, price floor, market-cap band)
and passes them straight through to `QM.screen()`. Changing a weight changes only the
ranking; changing a threshold changes what qualifies.

**On "let an LLM judge it".** The grading here is deterministic on purpose: it runs offline
over thousands of symbols in the browser, gives the same answer twice, and can be audited
line by line against the tables above — none of which a model call at screening time would
give you. The judgement is in *which* facts get measured and how they are weighed, and that
is written down here rather than hidden in a prompt.
