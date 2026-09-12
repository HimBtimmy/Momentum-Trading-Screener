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

### CSV import (works everywhere, including the published artifact)

Open the screener, choose **Import CSV**, and supply daily bars:

```csv
symbol,date,open,high,low,close,volume
NVDA,2026-03-02,121.40,124.10,120.85,123.55,214320000
NVDA,2026-03-03,123.60,126.20,123.10,125.90,198450000
...
```

* `date` and `close` are required; `symbol`, `open`, `high`, `low` and `volume` are used
  when present. Row order does not matter.
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
