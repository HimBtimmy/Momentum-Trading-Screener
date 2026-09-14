# Momentum Trading Screener — the Qullamaggie method

A written strategy analysis and a working screener for Kristjan Kullamägi's
("Qullamaggie") three momentum setups: **breakouts**, **episodic pivots** and
**parabolic shorts**.

| | |
|---|---|
| **[docs/executive-summary.html](docs/executive-summary.html)** | The full analysis — screening criteria, entry mechanics, stop-loss logic, profit-taking rules, position sizing, market-regime gating, and five annotated case studies from the June–August 2026 window (3 winners, 2 losers). Open it in a browser; the charts are inline SVG. |
| **[docs/executive-summary.md](docs/executive-summary.md)** | The same document as plain text. |
| **[docs/scoring.md](docs/scoring.md)** | How both screeners score and grade: the setup score, the A+/A/B/C quality grades, Minervini's trend template and tiers, the RS ratings, and the eligibility gates, component by component. |
| **[app/index.html](app/index.html)** | The screener. Open it in a browser for the bundled demo and CSV import — no build step, nothing to install. Live US-market data needs the local backend below. |

## Quick start — screen the live US market

Run this on your own machine. A published copy of the page is sandboxed and cannot reach
a server on your computer, so use the copy the backend serves.

```bash
git clone https://github.com/HimBtimmy/Momentum-Trading-Screener
cd Momentum-Trading-Screener
git checkout claude/gallant-archimedes-jovbix
pip install -r tools/requirements.txt
python3 tools/server.py --open
```

Then, in the page that opens:

1. Open the **Backend (yfinance)** tab and check the status line says *Backend up*.
2. Set **Universe** `Auto`, **Symbol cap** `300`, **Sessions** `252`.
3. Click **Fetch from yfinance** and wait for the progress bar. Tick **Fetch earnings
   growth** too if you want the Minervini screen's fundamental test scored (one extra
   request per name, so leave it off for a first run).

The results render on their own: constituents resolved, a year of daily bars downloaded,
every setup scored on both screens, with no CSV anywhere in the loop.

Worth knowing:

* **Symbol cap `0`** downloads the whole ~3,500-name universe. That takes several minutes;
  get the 300-name run working first.
* **The same fetch twice is instant** — results are cached for the day. Tick *Ignore
  today's cache* to force a fresh download.
* **Empty batches mean Yahoo is rate-limiting you.** Restart with
  `python3 tools/server.py --sleep 3`.
* **No backend?** The app still works standalone: open `app/index.html` for the bundled
  demo universe, or import a CSV built by `tools/fetch_vti_universe.py`.

### If `python3 tools/server.py` looks like it did nothing

The server prints a short banner and then **stays open, doing nothing visible** — that is
what running means. Your prompt will not come back until you press Ctrl-C. Check it from a
second terminal:

```bash
python3 tools/server.py --check      # asks a running server whether it is alive
```

If that says nothing is answering:

| Symptom | Cause |
| --- | --- |
| No output at all, prompt returns instantly | On Windows, `python3` is a Microsoft Store stub that exits silently. Use `py -3 tools/server.py` or `python tools/server.py`. |
| `can't open file .../server.py` | Wrong directory — run it from the repository root. |
| `No such file or directory` for `server.py` | Older checkout: `git pull` on `claude/gallant-archimedes-jovbix`. |
| `Address already in use` | It is already running. Open the URL, or use `--port 8766`. |
| Banner appears, browser does not | `--open` cannot always find a browser (SSH, WSL, headless). Open the printed URL yourself. |

## The strategy in one table

| | Breakout | Episodic pivot | Parabolic short |
|---|---|---|---|
| **Precondition** | 30–100%+ prior leg, then a 2-week to 2-month orderly flag with higher lows, contracting range and drying volume, surfing the rising 10/20/50-day MA | Dormant 3–6 months, then a ≥10% gap on a real catalyst with the day's average volume traded in the first 15–20 minutes | Up 50–100%+ (large cap) or 300–1000%+ (small cap) in days to weeks, 3–5+ consecutive up days, far extended from the 20-day MA |
| **Trigger** | Break of the 1-min / 5-min / 60-min opening-range high on the range-expansion day | Break of the 1-min opening-range high, adding on the 5-min high | First crack only: opening-range-low break, first red 5-min candle after the gap, or a failed bounce into VWAP |
| **Stop** | Low of the entry day, never wider than 1× ADR (1.5× absolute max) | Opening-range low, same ADR ceiling | High of the day, or a VWAP reclaim |
| **Exit** | Sell 1/3–1/2 into strength after 3–5 sessions, stop to breakeven, trail the rest on the 10- or 20-day MA, out on the first close below | Same | Cover into the 10- and 20-day MAs |
| **Risk** | 0.25–1% of equity per trade (typically 0.3–0.5%); position 5–25% (usually 10–15%); never more than 30% overnight in one name | | |

Win rate is 25–30%. The edge is entirely in the right tail, which is why the 1× ADR stop
rule matters more than any pattern-recognition detail.

## Two screeners, one dataset

Bars are loaded once — demo, CSV, the yfinance backend, or a live API — and every symbol is
put through **both** screens:

* **Qullamaggie** — is there a tradeable flag, gap or parabolic extension right now?
* **Minervini** — is this a Stage 2 leader setting up, by the Trend Template?

A **Both** tab lists the intersection. Every card carries both verdicts in their own
sections, each with its own grade, justification, plan and criteria, and a **Levels** toggle
on the chart switches between the two pivots — they are rarely the same price: his is the
high of a short flag, Minervini's is the high of the whole base.

The Minervini side ports the Trend Template, its A/B/C tiers, the base-high pivot (one tick
above the 60-session base high, excluding the last 3 bars) and the 1.5 × ADR stop. It does
**not** port the fixed 2.5R target: profit-taking follows Kullamägi — a third to a half into
strength after 3–5 sessions, breakeven stop, trail the rest on a moving average. Mixing a
fixed target with a trailed runner would mean neither set of numbers describes the result.

Its one non-technical test — did the latest quarter grow EPS *and* sales — needs earnings
data, which price bars do not carry. Tick **Fetch earnings growth** in the backend tab (or
pass `--fundamentals` to the CSV builder) and the criterion is scored; without it the test
is left unassessed rather than failed, and the grade is capped at A.

## What the screener does

For every symbol it computes ADR%, 20-day turnover, relative-strength percentiles over
21/63/126 sessions, the full moving-average structure and 52-week position; searches every
plausible consolidation ending in the last sessions and scores each on depth-versus-ADR,
higher lows, range contraction, volume dry-up and MA adherence; then detects which of the
three setups is present and what state it is in (`triggered`, `ready`, `building`,
`extended`, `watch`).

For each candidate it reports:

* a **pass/fail line for every individual criterion**, so a rejection is explainable;
* a **justification paragraph** written from the computed facts;
* the **entry trigger**, the **hard stop**, the risk in percent *and in ADR multiples*,
  3R/5R targets, which MA to trail, and a **share count** derived from your account size
  and risk tolerance — capped by the position limit and by a share of the stock's average
  volume;
* a **market-regime banner** that cuts size, or stands the book down, based on the index's
  own structure.

An *as of* control replays any date in the loaded history, which is how the five case
studies in the summary were produced.

The **table view** lists everything screened, rejects included, with columns that follow the
screener you are on. Click a symbol for its chart, criteria and both plans; filter by setup,
by any combination of statuses, and by eligibility; drag the slicers to band score and RS;
and click a Grade, Score, RS or Mkt cap header to sort (best first, then reversed, then back
to the engine's own ranking). Rows with no value for the sorted column stay at the bottom
either way.

## Data

The bundled universe is **synthetic** — clearly labelled in the app and generated by
`tools/build-datasets.mjs` on the real 2025–26 trading calendar, because every market-data
host was blocked by the build environment's network policy.

For real data, the shortest path is the **local backend** — no CSV in the middle:

```bash
pip install -r tools/requirements.txt
python3 tools/server.py --open          # serves the app and does the downloading
```

The page it opens has a **Backend (yfinance)** tab: pick a universe, press *Fetch from
yfinance*, watch the progress bar. The server resolves the constituent list, downloads
daily bars, applies the liquidity gates and hands the browser JSON; the screening still
happens in the browser, so `app/engine.js` stays the only place the strategy is defined.
Results are cached for the day, so the second fetch is instant, and a build can be
cancelled mid-download. It binds to `127.0.0.1` and serves only `app/`, `docs/` and
`data/`.

A backend is needed because yfinance is a Python client for Yahoo endpoints that send no
CORS headers — a browser cannot call them directly, whatever key you have.

The same pipeline still runs as a one-shot CSV build:

```bash
python3 tools/fetch_vti_universe.py --out data/vti-universe.csv   # VTI constituents, 252 sessions
python3 tools/fetch_vti_universe.py --top 500 --out data/top500.csv   # quick first run
python3 tools/fetch_vti_universe.py --universe snapshot --top 300 --out data/quick.csv  # no universe lookup
```

Then open the screener → **Import CSV**. The script resolves VTI's constituents — from
Vanguard's own holdings API, or from a daily-updated US exchange listing filtered to the
CRSP common-stock universe when Vanguard is unreachable (`--universe`) — downloads a year
of daily bars per name, applies the screener's own liquidity gates, and appends SPY for the
regime filter. `data/vti-constituents.csv` is a committed snapshot of that universe: 3,500
symbols, within 0.6% of VTI's published holding count. You can also import any CSV of
`symbol,date,open,high,low,close,volume` rows (130+ sessions per symbol), or use the
live-API tab with your own vendor key. See **[data/DATA.md](data/DATA.md)**.

## Layout

```
app/
  index.html          the screener UI (open this)
  engine.js           both strategy engines — indicators, base detection, the three
                      Qullamaggie setups, the Minervini trend template and its
                      short side, trade plans, sizing, justification text, over one
                      pass of shared features (no dependencies)
  chart.js            annotated candlestick SVG, shared with the summary build
  app.js              UI wiring, CSV import, backend client, live-API adapters
  datasets.js         generated: the bundled demo universe
docs/
  executive-summary.html / .md    generated: the written analysis
  scoring.md          how every score, grade and gate is computed
data/
  DATA.md             provenance and how to load real bars
  vti-constituents.csv  snapshot of the resolved VTI universe (3,500 symbols)
  demo-universe.json  generated
  examples-2026.json  generated: the five case-study series
  case-results.json   generated: engine output + simulated outcome per case
tools/
  fetch_vti_universe.py   resolves the universe and downloads bars; writes the CSV (Python)
  server.py               local backend: serves the app and drives that pipeline
                          on demand for the Backend tab (standard library only)
  requirements.txt        their dependencies
  gen-datasets.mjs    trading calendar + the synthetic bar generator
  scenarios.mjs       the hand-shaped scenarios
  simulate.mjs        replays his management rules to produce R-multiples
  build-datasets.mjs  builds every dataset; prints a screen as a smoke test
  summary-content.mjs the executive summary as structured content
  build-summary.mjs   renders the summary to HTML and Markdown
```

Regenerate everything:

```bash
node tools/build-datasets.mjs
node tools/build-summary.mjs
```

## Not investment advice

A strategy that loses on 7 of 10 trades produces long losing streaks. Position sizing is
the only thing that makes such a streak survivable, and none of this has been validated
against real market data in this repository. Do your own work.
