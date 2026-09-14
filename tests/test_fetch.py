"""Offline checks for tools/fetch_vti_universe.py — no network.

Ticker cleaning, the holdings-envelope shapes the vendor has been seen to return,
the bar validator, the quality gates, and one end-to-end CSV build against a
stubbed price source.
"""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _harness                                     # noqa: E402

_harness.need("pandas", "pip install -r tools/requirements.txt")
_harness.on_path()

import pandas as pd                                 # noqa: E402
import fetch_vti_universe as F                      # noqa: E402

check = _harness.Checks()
TMP = _harness.tmpdir("fetch", fresh=True)

print("\n1. ticker cleaning")
cases = {
    "AAPL": "AAPL", " msft ": "MSFT", "BRK.B": "BRK-B", "BF.B": "BF-B",
    "CASH": None, "": None, "N/A": None, "--": None, "TOTALFUND12": None,
    "9988": None, "BRK/B": "BRK-B", None: None, "GOOG.": "GOOG",
}
for raw, want in cases.items():
    got = F.clean_ticker(raw)
    check(f"clean_ticker({raw!r}) -> {got!r}", got == want, f"expected {want!r}")

print("\n2. holdings extraction across plausible envelope shapes")
entity = [
    {"ticker": "AAPL", "longName": "Apple Inc.", "percentWeight": "6.12", "holdingType": "Stock"},
    {"ticker": "MSFT", "longName": "Microsoft Corp.", "percentWeight": "5.48", "holdingType": "Stock"},
    {"ticker": "BRK.B", "longName": "Berkshire Hathaway Inc. Class B", "percentWeight": "1.42"},
    {"ticker": "CASH", "longName": "Cash and other", "percentWeight": "0.31"},
    {"ticker": "AAPL", "longName": "Apple Inc. (dup line)", "percentWeight": "0.01"},
]
shapes = {
    "fund.entity":           {"fund": {"entity": entity}},
    "top-level list":        entity,
    "data.holdings":         {"data": {"holdings": entity, "asOfDate": "2026-08-31"}},
    "snake_case weights":    {"fund": {"entity": [{"symbol": h["ticker"],
                                                   "name": h.get("longName", ""),
                                                   "percent_weight": h["percentWeight"]} for h in entity]}},
    "nested + decoys":       {"meta": [{"id": 1}, {"id": 2}], "portfolio": {"stock": {"entity": entity}}},
}
for label, payload in shapes.items():
    hs = F.extract_holdings(payload)
    tickers = [h.ticker for h in hs]
    check(f"{label}: 3 equities, deduped, CASH dropped", tickers == ["AAPL", "MSFT", "BRK-B"], str(tickers))
    if label == "fund.entity":
        check("  weight parsed from a string", abs(hs[0].weight - 6.12) < 1e-9, str(hs[0].weight))
        check("  dedupe keeps the larger weight", hs[0].name.startswith("Apple Inc."), hs[0].name)

try:
    F.extract_holdings({"nothing": "useful"})
    check("unrecognised payload raises", False)
except ValueError as e:
    check("unrecognised payload raises a clear error", "response shape has changed" in str(e))

print("\n3. weight filters")
hs = F.extract_holdings({"fund": {"entity": entity}})
check("--top 2", [h.ticker for h in F.filter_holdings(hs, 2, 0.0)] == ["AAPL", "MSFT"])
check("--min-weight 2.0", [h.ticker for h in F.filter_holdings(hs, 0, 2.0)] == ["AAPL", "MSFT"])

print("\n4. frame -> bars: trimming, bad rows, dedupe")
idx = pd.to_datetime([f"2026-0{m}-{d:02d}" for m in (1, 2) for d in range(1, 16)])
random.seed(7)
px = 100.0
rows = []
for _ in idx:
    px *= 1 + random.uniform(-0.02, 0.025)
    rows.append([px * 0.995, px * 1.02, px * 0.98, px, 2_000_000])
frame = pd.DataFrame(rows, columns=["Open", "High", "Low", "Close", "Volume"], index=idx)
frame.iloc[3, frame.columns.get_loc("Close")] = float("nan")   # missing close
frame.iloc[5, frame.columns.get_loc("Low")] = 1e6              # impossible bar: low above high
bars = F.frame_to_bars("TEST", frame, sessions=252)
check("bad rows dropped", len(bars) == len(idx) - 2, f"{len(bars)} of {len(idx)}")
check("dates ascending, ISO", bars[0].date < bars[-1].date and len(bars[0].date) == 10, bars[0].date)
check("sessions cap honoured", len(F.frame_to_bars("TEST", frame, sessions=10)) == 10)
check("all bars self-consistent",
      all(b.high >= max(b.open, b.close) and b.low <= min(b.open, b.close) > 0 for b in bars))

print("\n5. quality gates")
def synth_bars(n, price, vol):
    return [F.Bar("X", f"2026-01-{i%28+1:02d}", price, price, price, price, vol) for i in range(n)]
check("too few sessions rejected", F.screen_filters(synth_bars(40, 50, 1e6), 130, 5, 5) is not None)
check("penny stock rejected", F.screen_filters(synth_bars(200, 2.0, 1e7), 130, 5, 5) is not None)
check("illiquid rejected", F.screen_filters(synth_bars(200, 50, 1000), 130, 5, 5) is not None)
check("liquid leader passes", F.screen_filters(synth_bars(200, 50, 1e6), 130, 5, 5) is None)

print("\n6. end-to-end with a stubbed price vendor")
def fake_fetch(tickers, **kw):
    out = {}
    for seed, t in enumerate(tickers):
        random.seed(seed + 1)
        dates = pd.bdate_range("2025-09-15", periods=300)
        p, rs = 40.0, []
        for _ in dates:
            p *= 1 + random.uniform(-0.02, 0.023)
            rs.append([p * 0.996, p * 1.018, p * 0.985, p, random.randint(800_000, 4_000_000)])
        out[t] = pd.DataFrame(rs, columns=["Open", "High", "Low", "Close", "Volume"], index=dates)
    return out

F.SOURCES["stub"] = fake_fetch
tick_file = TMP / "tickers.txt"
tick_file.write_text("AAPL\nMSFT\nBRK.B\nNVDA\nCASH\n")
out = TMP / "out.csv"
rc = F.main(["--tickers-file", str(tick_file), "--source", "stub", "--out", str(out),
             "--sessions", "252", "--index", "SPY"])
check("exit code 0", rc == 0, f"rc={rc}")
text = out.read_text().splitlines()
check("header exact",
      text[0] == "symbol,date,open,high,low,close,volume,market_cap,name,eps_yoy,sales_yoy,fund_quarter",
      text[0])
syms = sorted({l.split(",")[0] for l in text[1:]})
check("SPY appended, CASH dropped", syms == ["AAPL", "BRK-B", "MSFT", "NVDA", "SPY"], str(syms))
per = {s: sum(1 for l in text[1:] if l.startswith(s + ",")) for s in syms}
check("252 sessions each", set(per.values()) == {252}, str(per))

check.finish("ALL FETCH CHECKS PASSED")
