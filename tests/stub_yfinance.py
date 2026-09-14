"""A stand-in for the `yfinance` package, so the suite never touches the network.

The shape is the part that matters: `download(..., group_by="ticker")` returns a
DataFrame with a column MultiIndex of (ticker, field) over a DatetimeIndex, which
is exactly what the real call returns and exactly what tools/fetch_vti_universe.py
unpacks. Everything downstream of this — batching, validation, the quality gates,
the job lifecycle, the HTTP layer — is the real code.

Series are seeded with zlib.crc32 of the ticker rather than hash(), because
Python salts string hashes per process and the fixtures have to be reproducible.
"""
from __future__ import annotations

import random
import time
import types
import zlib

import numpy as np
import pandas as pd


class Stub:
    """The fake vendor, plus the knobs a test needs to poke at it."""

    def __init__(self, price_step=7.0, drift=0.0, noise=0.04, wick=0.02,
                 vol_base=2_000_000, vol_span=1_000_000, illiquid=(), end="2026-09-11",
                 periods=320):
        self.price_step, self.drift, self.noise, self.wick = price_step, drift, noise, wick
        self.vol_base, self.vol_span = vol_base, vol_span
        self.illiquid = set(illiquid)
        self.end, self.periods = end, periods
        # observations, for tests that assert on how the vendor was called
        self.batches = 0
        self.tickers: list[str] = []
        self.kwargs: dict | None = None
        self.fundamentals: list[str] = []
        self.delay = 0.0          # set >0 to make a collision deterministic

    # ---------------------------------------------------------------- prices
    def download(self, tickers, period="2y", interval="1d", auto_adjust=True,
                 group_by="ticker", threads=True, progress=False, timeout=30):
        self.batches += 1
        self.kwargs = dict(period=period, interval=interval,
                           auto_adjust=auto_adjust, group_by=group_by)
        self.tickers.extend(tickers)
        if self.delay:
            time.sleep(self.delay)

        days = pd.bdate_range(end=self.end, periods=self.periods)
        frames = {}
        for i, t in enumerate(tickers):
            rnd = random.Random(zlib.crc32(t.encode()))
            px = 20 + i * self.price_step
            # a few names trend, so the screeners have something to find
            base = 1 + (i % 4) * self.drift
            closes = []
            for _ in days:
                px *= base + (rnd.random() - 0.5) * self.noise
                closes.append(px)
            close = np.array(closes)
            high = close * (1 + np.array([rnd.random() * self.wick for _ in days]))
            low = close * (1 - np.array([rnd.random() * self.wick for _ in days]))
            vol = np.array([self.vol_base + rnd.random() * self.vol_span for _ in days])
            if t in self.illiquid:
                vol = vol / 5000          # must be dropped by the turnover gate
            frames[t] = pd.DataFrame({"Open": (high + low) / 2, "High": high,
                                      "Low": low, "Close": close, "Volume": vol},
                                     index=days)
        return pd.concat(frames, axis=1)          # -> MultiIndex (ticker, field)

    # ---------------------------------------------------------- fundamentals
    def ticker_class(stub):
        class FakeTicker:
            """Just enough of yf.Ticker for the fundamentals path."""

            def __init__(self, symbol):
                self.symbol = symbol

            @property
            def quarterly_income_stmt(self):
                stub.fundamentals.append(self.symbol)
                if self.symbol == "NODATA":
                    return pd.DataFrame()
                cols = pd.to_datetime(["2026-06-30", "2026-03-31", "2025-12-31",
                                       "2025-09-30", "2025-06-30", "2025-03-31"])
                # year-on-year factor: quarters four apart differ by `grow`
                grow = 0.8 if self.symbol == "SHRINK" else 1.25
                return pd.DataFrame(
                    {c: [100.0 * (grow ** ((5 - i) / 4)), 1.00 * (grow ** ((5 - i) / 4))]
                     for i, c in enumerate(cols)},
                    index=["Total Revenue", "Diluted EPS"])
        return FakeTicker

    def install(self):
        """Register this stub as the `yfinance` module for the whole process."""
        import sys
        mod = types.ModuleType("yfinance")
        mod.__version__ = "0.2.stub"
        mod.download = self.download
        mod.Ticker = self.ticker_class()
        sys.modules["yfinance"] = mod
        return self


def install(**kw) -> Stub:
    return Stub(**kw).install()
