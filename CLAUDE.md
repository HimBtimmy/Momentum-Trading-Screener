# Momentum Trading Screener — working notes

Read this before changing anything. It records the decisions that a diff cannot
explain: things that look like bugs but are deliberate, and things that look
harmless to change but are load-bearing.

## What this is

A dependency-free browser app that screens a universe of daily bars with **two**
momentum methods over **one** dataset:

* **Qullamaggie (KQ)** — Kristjan Kullamägi's breakouts, episodic pivots and
  parabolic shorts. Rules in `docs/executive-summary.md`.
* **Minervini (MM)** — the Trend Template, A/B/C tiers, VCP shape, and the
  leader-breakdown short. Rules and scoring in `docs/scoring.md` §5.

Data reaches it three ways: the bundled demo universe, a CSV import, or the
local Python backend that pulls from yfinance.

## Layout

| Path | What it is |
|---|---|
| `app/engine.js` | Both screening engines. No DOM, no dependencies. Runs in the browser *and* under `require`. |
| `app/app.js` | All UI: state, rendering, filters, sorting, the backend client. |
| `app/chart.js` | Inline-SVG candle charts. Caller owns the level list via `opt.levels`. |
| `app/index.html` | Markup, styles, copy. |
| `app/datasets.js` | Generated demo universe. Rebuild with `tools/gen-datasets.mjs`. |
| `tools/fetch_vti_universe.py` | The data pipeline: resolve universe → download bars → validate → gate → write. |
| `tools/server.py` | Local HTTP server. Serves the app and wraps the pipeline as a job API. |
| `tests/` | The suite. See below. |
| `docs/scoring.md` | Every score, grade, tier and gate, component by component. |

## Running it

```bash
python3 tools/server.py --open        # app + live data on http://127.0.0.1:8765
open app/index.html                   # demo and CSV import only, no server needed
```

## Running the tests

```bash
python3 tests/run.py                  # everything (~2 min, needs a browser)
python3 tests/run.py --quick          # skip the browser tests (~5 s)
python3 tests/run.py test_backend -v  # one test, streaming its output
```

**Run `--quick` before every commit and the full suite before pushing.** Tests
that cannot run on a machine (no Playwright, no browser, no pandas) report SKIP
and do not fail the run, so a partial toolchain still gets a useful signal.

No network is ever required: the price vendor is stubbed by
`tests/stub_yfinance.py`, which returns the exact MultiIndex frame shape that
`yf.download(..., group_by="ticker")` returns. See `tests/README.md`.

## Invariants — do not "fix" these

1. **One feature pass, two screens.** `screen()` calls `computeFeatures()` once
   per symbol (`app/engine.js:1606`) and both screeners read that same object.
   Adding a second pass for the Minervini side would double the work and let the
   two screens silently disagree about the same bar.

2. **Criteria are tri-state: `true` / `false` / `null`.** `null` means *not
   assessable*, not *failed*. Unassessable criteria are excluded from the
   denominator (`items.filter(x => x.pass !== null)`) and cap the grade at A
   instead of A+. Coercing `null` to `false` would fail every name that simply
   has no fundamentals attached. This shows up at engine.js:726, 1212 and 1406.

3. **RS is a percentile, so it needs a universe.** Below `RANKABLE = 20` symbols
   (engine.js:1619) no RS rating is produced at all, and both screens report it
   as unassessable. This is deliberate: a "94 RS" out of eight names is noise,
   and the two screens previously gave opposite ratings on tiny universes.
   The two methods use different definitions — IBD-weighted (`2×3m + 6m + 9m +
   12m`) for Minervini, min-of-1m/3m/6m percentile for Kullamägi — and both are
   computed in pass 2 of `screen()`.

4. **The Minervini side has no take-profit, on purpose.** The Python source this
   was ported from used a fixed 2.5R target. It was not carried over: profit
   taking follows Kullamägi's schedule (partials after 3–5 sessions, breakeven
   stop, 10/20-day MA trail) for both screens. `plan.takeProfit` is absent, and
   a test asserts it stays absent. Rationale in `docs/scoring.md` §5.

5. **`server.py` delegates; it does not reimplement.** It calls
   `vti.build_dataset`, `vti.ma_stack_symbols`, `vti.fetch_fundamentals` and
   `vti.write_csv`. Keep the pipeline in one place — the CLI and the web
   backend must not drift apart.

6. **`engine.js` and `chart.js` are UMD and must stay that way.** They load as
   `window.QM` / `window.QMChart` in the browser and via `require` in Node and
   in the tests. No ES module syntax, no build step, no dependencies, and the
   existing `var`-and-function style throughout — there is no transpiler.

7. **`[hidden] { display: none !important }` in `index.html` is load-bearing.**
   An author rule that sets `display` (e.g. `.qm-tip { display: grid }`)
   outranks the browser's own `[hidden]` rule, which left the chart tooltip
   stuck on screen. `tests/test_ui_tooltip.py` guards this.

8. **The app must keep working from `file://`** with no server at all. The
   backend is optional. The Backend URL field may be left blank in every normal
   case — same-origin when served, default port when opened from disk.
   `tests/test_backend_url.py` pins the whole matrix.

9. **The vendor socket is the one untested link.** Yahoo is unreachable from the
   sandbox this was built in, so every test runs against a stub. If a change
   touches the real `yfinance` call, say so plainly rather than implying it was
   verified end to end.

## Conventions

* Comments explain *why*, not *what*. Match the density already in the file.
* Every tunable threshold lives in `QM.DEFAULTS` and is exposed in the UI where
  a user would reasonably want to change it.
* User-facing copy names both methods. The page title stays **Momentum Setup
  Screener**.
* When scoring or grading changes, update `docs/scoring.md` in the same commit.

## Working with more than one person on this

A session started by Claude sees only what is pushed — there is no memory
between sessions. So:

* Branch from the repository's default branch, and merge back through a pull
  request. Put the *why* in the PR description; it is the only channel through
  which reasoning reaches a later session.
* Record any deliberate departure from the rules above **in this file**, in the
  same commit that makes it. Otherwise the next session will read it as a bug
  and undo it.
* `git log <last-known-commit>..origin/<default-branch>` is the catch-up.
