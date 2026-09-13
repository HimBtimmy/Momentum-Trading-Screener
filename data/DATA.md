# Data provenance, and how to load real bars

## What ships in this repository

`data/demo-universe.json`, `data/examples-2026.json` and `app/datasets.js` contain
**synthetic daily bars**. They are generated deterministically by
`tools/build-datasets.mjs` from the scenarios in `tools/scenarios.mjs`, laid out on the
**real NYSE trading calendar** from 2025-06-02 to 2026-09-11 (322 sessions, with the
2025–26 holiday closures removed, including the 3 July 2026 observance of Independence
Day and the 19 June Juneteenth closes).

They are **not the price history of any company**, and the tickers are archetypes, not
real symbols.

### Why

This repository was built in a sandboxed environment whose network policy denies every
market-data host at the egress gateway (HTTP 403 on CONNECT). That included
`query1.finance.yahoo.com`, `stooq.com`, `financialmodelingprep.com`, `api.polygon.io`,
`api.tiingo.com`, `finnhub.io`, `api.twelvedata.com`, `eodhd.com`, `www.alphavantage.co`,
`api.marketdata.app`, `api.nasdaq.com`, `www.sec.gov`, `data.sec.gov` — and
`qullamaggie.com` itself. Real June–August 2026 OHLCV could not be fetched, and inventing
prices and attributing them to real companies would be worse than labelling synthetic
series honestly.

Everything that is *not* price data is real: the strategy rules (sourced, see the
executive summary), the screening logic, the ADR and risk arithmetic, and the trade
simulation. Point them at real bars and they produce real output.

### What the synthetic series are for

Each scenario was shaped to exercise a specific branch of the screen so the logic could be
verified end to end — a valid flag breakout, an episodic pivot out of a dormant base, a
parabolic short, a breakout that fails on a market-wide down day, and a gap that fails the
volume and dormancy tests. The market backdrop described around them in the executive
summary is real and cited; the bars are not.

## Loading real data

### The local backend (the easy route)

```bash
pip install -r tools/requirements.txt
python3 tools/server.py --open
```

That serves the app at `http://127.0.0.1:8765/app/index.html` and adds a working
**Backend (yfinance)** tab to it: pick a universe, a symbol cap and a session count, press
**Fetch from yfinance**, and the bars arrive as JSON — no file in the middle.

**Why a backend is needed at all.** `yfinance` is a Python client for Yahoo's chart
endpoints, and those endpoints send no `Access-Control-Allow-Origin` header. A browser
therefore cannot call them, from any page, with or without a key. The backend is the one
piece that has to run outside the browser; it does not screen anything, it only fetches.
`app/engine.js` remains the single definition of the strategy, in the browser, for demo
data and live data alike.

| Endpoint | What it does |
| --- | --- |
| `GET /api/health` | whether `yfinance` imports, versions, cache size |
| `GET /api/config` | the defaults the form prefills from |
| `POST /api/fetch` | starts a build, returns a job id |
| `GET /api/jobs/<id>` | phase, done/total, message, state |
| `GET /api/jobs/<id>/data` | the finished dataset (gzipped when accepted) |
| `POST /api/jobs/<id>/cancel` | stops a download in flight |

Notes that matter in practice:

* **The whole universe is ~3,500 tickers** and takes several minutes on the first run.
  Start with a symbol cap of 300. Yahoo rate-limits aggressively; if batches come back
  empty, raise `--sleep`.
* **Results are cached for the day**, keyed by the options you chose, under `data/cache/`
  (git-ignored). The second fetch of the same thing is instant. Tick *Ignore today's
  cache* to force a re-download.
* **Bars travel as arrays** — `["2026-09-11", open, high, low, close, volume]`. Named keys
  would repeat the same six words across a few hundred thousand bars.
* **Scope.** It binds to `127.0.0.1`, serves only `app/`, `docs/` and `data/`, refuses a
  public bind unless you set `QM_ALLOW_PUBLIC=1`, and accepts cross-origin API calls only
  from `file://` and localhost pages. It holds no credentials — it is a development tool,
  not a service.
* **A published artifact cannot use it.** That page is sandboxed and cannot open a socket
  to your machine; the tab says so and points at the CSV route instead.

### The VTI universe script (the CSV route)

`tools/fetch_vti_universe.py` builds a screener-ready CSV from the constituents of
Vanguard Total Stock Market ETF (VTI) — about 3,600 US listings, i.e. effectively the
whole investable market — with one year of daily bars each.

```bash
pip install -r tools/requirements.txt

# the full VTI universe, 252 sessions, filtered to what the screener would trade
python3 tools/fetch_vti_universe.py --out data/vti-universe.csv

# a fast first run: the 500 largest weights
python3 tools/fetch_vti_universe.py --top 500 --out data/vti-top500.csv
```

Then open the screener → **Import CSV** → pick the file.

What it does:

1. **Universe** — resolves the constituent list through one of two providers
   (`--universe`, default `auto`):

   * **`vanguard`** — the fund's own holdings API,
     `investor.vanguard.com/investment-products/etfs/profile/api/VTI/portfolio-holding/stock`,
     requested with browser headers. This is the authoritative source: exact holdings with
     the fund's own float-adjusted weights. The holdings array is parsed
     *shape-tolerantly* — the script finds the largest list of objects carrying a
     ticker-like key rather than hard-coding a JSON path, so a change to the response
     envelope does not break it.
   * **`github`** — a daily-rebuilt mirror of the NASDAQ/NYSE/NYSE-American listing dump
     ([rreichel3/US-Stock-Symbols](https://github.com/rreichel3/US-Stock-Symbols)),
     filtered down to a CRSP-style common-stock universe. VTI tracks the **CRSP US Total
     Market Index**, which by construction is essentially every US-incorporated common
     stock listed on those three exchanges above a small float threshold — so the filtered
     listing reproduces the constituent list closely without touching Vanguard.
   * **`auto`** tries Vanguard first and falls back to the mirror, saying loudly that it
     did. `--universe vanguard` makes an unreachable Vanguard a hard failure instead.

   The `github` filter chain, and what each step removes from the 7,162 raw listings:

   | step | dropped | left |
   |---|---|---|
   | warrants / units / rights / preferred / notes | 1,559 | 5,603 |
   | NASDAQ fifth-letter W/R/U symbols | 1 | 5,602 |
   | ETFs, funds and blank-check vehicles | 431 | 5,171 |
   | non-US domicile (CRSP US indexes are US-only) | 1,025 | 4,146 |
   | no reported market cap | 162 | 3,984 |
   | market cap below $40M (`--min-market-cap`) | 483 | 3,501 |
   | unusable / duplicate symbols | 1 | **3,500** |

   VTI publishes **3,480** holdings (September 2026), so the proxy lands **+0.6%** off.
   The $40M floor is calibrated to that count; raise it for fewer names, drop it to 0 to
   keep every listed common stock. Two caveats: weights are **market-cap** weights, not
   the fund's float-adjusted ones, and both classes of a dual-class company can appear
   where the fund holds only the liquid one. Neither matters for screening — weights only
   drive `--top` ordering — and the price-stage liquidity gate removes most of the
   difference.

2. **Prices** — batches of 100 tickers from yfinance (default, no key) or one-by-one from
   Stooq (`--source stooq`), retried with backoff, trimmed to the last `--sessions` (252)
   clean bars. Bars are split- and dividend-adjusted by default, because an unadjusted
   split prints a 50% overnight gap that the episodic-pivot detector would read as a
   catalyst.
3. **Quality gates** — mirrors the screener's own universe filters (`--min-sessions 130`,
   `--min-price 5`, `--min-turnover 5` $M of 20-day average turnover) so the CSV does not
   carry rows the engine would reject anyway. This is also what keeps the file from
   reaching ~55 MB.
4. **Index** — appends `SPY` (`--index`), exempt from the gates, because the screener
   treats SPY/QQQ/IWM as the market-regime series rather than a candidate.
5. **Metadata** — writes each symbol's market cap and company name onto its first row, so
   the screener can rank by market cap and label the cards.

It prints a report: the universe source, symbols written, rows, the session span, file
size, and every dropped symbol with its reason, and writes a `<out>.meta.json` sidecar
recording the provenance, the filters used and the drop list.

### The constituent snapshot in this repository

`data/vti-constituents.csv` is a committed snapshot of the resolved universe — 3,500
symbols with names, exchange, market cap and cap weight, dated 12 September 2026. Re-run

```bash
python3 tools/fetch_vti_universe.py --universe github --dry-run \
    --constituents-out data/vti-constituents.csv
```

to refresh it, or feed it straight to the price stage without re-resolving the universe:

```bash
cut -d, -f1 data/vti-constituents.csv | tail -n +2 > /tmp/tickers.txt
python3 tools/fetch_vti_universe.py --tickers-file /tmp/tickers.txt --out data/vti-universe.csv
```

If the holdings request fails — Vanguard's edge blocks some clients, and corporate proxies
and VPNs block the host outright — the script says so and names the fallback: open the
endpoint in a browser, save the JSON, and pass `--holdings-file saved.json`. A plain
`--tickers-file symbols.txt` also works and skips Vanguard entirely.

**What was and was not verified.** The `github` universe provider was exercised against
live data: it resolved 3,500 real constituents with current market caps (NVDA 6.11%,
AAPL 5.63%, GOOGL 4.81% …), which is how the filter chain above was calibrated. The
holdings parser, ticker normalisation, weight filters, bar validation, session trimming,
quality gates, CSV writing and the full CLI were tested offline against fixtures, and a
generated CSV was round-tripped through this repository's own engine (`QM.parseCSV` →
`QM.screen`) to confirm the screener reads it and picks SPY up as the index.

Two things could **not** be exercised here, because this environment's egress policy
blocks the hosts: Vanguard's own API (`investor.vanguard.com` — 403 at the gateway, which
is exactly why the `github` provider exists) and every price vendor (Yahoo and Stooq both
403). The `vanguard` provider's fallback paths are tested; its happy path is not. Both
price providers fail with an actionable error rather than a traceback.

### CSV import (the manual route, works everywhere, including the published artifact)

Open the screener, choose **Import CSV**, and supply daily bars:

```csv
symbol,date,open,high,low,close,volume
NVDA,2026-03-02,121.40,124.10,120.85,123.55,214320000
NVDA,2026-03-03,123.60,126.20,123.10,125.90,198450000
...
```

* `date` and `close` are required; `symbol`, `open`, `high`, `low` and `volume` are used
  when present. Row order does not matter. Quoted fields containing commas are handled.
* Two optional per-symbol columns are read as metadata: `market_cap` (drives the market-cap
  band filter and the figure on the card) and `name`. They only need a value on one row per
  symbol — `fetch_vti_universe.py` writes them on the first row and leaves the rest blank.
* **At least 130 sessions per symbol** — the six-month relative-strength lookback needs
  126, and the 200-day MA regime context needs more. 300+ sessions is comfortable.
* A symbol named `SPY`, `QQQ` or `IWM` is treated as the index for the market-regime
  filter instead of being screened.
* Everything runs in the browser. Nothing is uploaded.

Typical sources for a CSV in this shape: a broker export, `yfinance`
(`yf.download(tickers, period="2y")` → `to_csv`), Nasdaq Data Link, Norgate, or any
screener's export.

### Live API (works when the page is served from this repository)

Open `app/index.html` locally (`python3 -m http.server` in the repo root, then
`http://localhost:8000/app/`) and use the **Live API** tab with your own key for
Financial Modeling Prep, Tiingo or Polygon.io. The key is stored in that browser's
local storage and sent only to the vendor.

This tab cannot work inside a published artifact — the artifact content-security policy
blocks all outbound requests — and it was never exercised in the build environment,
because the vendor hosts were blocked there too. If a provider changes its response
shape, the adapters are three small functions at the top of `app/app.js` (`PROVIDERS`).

### Regenerating the bundled datasets

```bash
node tools/build-datasets.mjs    # datasets + case-study results
node tools/build-summary.mjs     # docs/executive-summary.{html,md}
```

`tools/build-datasets.mjs` prints the screen of the demo universe and the five case
studies with their computed risk and R-multiples, which is the quickest smoke test that
the engine still behaves after a change.
