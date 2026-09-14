# Tests

Plain scripts, no test framework. Each one prints a `PASS`/`FAIL` line per
assertion and exits non-zero if any failed.

```bash
python3 tests/run.py                   # everything (~2 min)
python3 tests/run.py --quick           # skip the browser tests (~5 s)
python3 tests/run.py test_ui -v        # one test, streaming its own output
python3 tests/test_backend.py          # or just run a file directly
```

## What each one covers

| Test | Needs | Covers |
|---|---|---|
| `test_fetch.py` | pandas | Ticker cleaning, the holdings-envelope shapes the vendor returns, weight filters, the bar validator, the quality gates, one end-to-end CSV build. |
| `test_engine_mm.js` | node | The Minervini overlay: pivot and stop arithmetic, tiers, grade caps, the absent take-profit, the short side, and that both screens share one pass. |
| `test_backend.py` | pandas | `tools/server.py` end to end over real HTTP: health, static serving, path-traversal refusals, a full build, progress and cancellation, caching, concurrency, input clamping, fundamentals, and feeding the payload to the engine. |
| `test_ui.py` | Playwright | The page in a real browser: cards, table, filters, sorting, the detail overlay, both screener tabs, the pivot picker, the tooltip. |
| `test_ui_tooltip.py` | Playwright | Regression guard for the chart tooltip that would not go away. |
| `test_ui_backend.py` | Playwright + pandas | The whole chain the user actually runs: browser → server → pipeline → engine → rendered results, including cancel and cache. |
| `test_backend_url.py` | Playwright + pandas | Every way of opening the page × every way of filling the Backend URL field. Needs port 8765 free; skips if something is already on it. |

## No network, ever

`stub_yfinance.py` replaces the `yfinance` package for the whole process. Its
`download()` returns a DataFrame with a column MultiIndex of `(ticker, field)`
over a `DatetimeIndex` — exactly what `yf.download(..., group_by="ticker")`
returns, and exactly what the pipeline unpacks. Everything downstream of that
call is the real code.

Series are seeded from `zlib.crc32(ticker)` rather than `hash()`, because Python
salts string hashes per process and fixtures have to be reproducible.

`stub_server.py` runs the real `tools/server.py` with that stub installed. It
takes every flag the server takes, plus `--cache-dir` (so a run never writes
into `data/cache`) and `--vendor-delay` (a per-batch stall, so a test can cancel
a build without racing it).

## Missing tools skip, they do not fail

A test that cannot run here — no Playwright, no browser, no pandas — exits with
code 77 and the runner reports `SKIP`. Installing everything:

```bash
pip install -r tools/requirements.txt
pip install playwright && playwright install chromium
```

Scratch files go to `tests/.tmp/`, which is gitignored.
