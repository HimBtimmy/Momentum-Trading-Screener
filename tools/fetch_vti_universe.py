#!/usr/bin/env python3
"""Build a screener-ready OHLCV CSV from the VTI constituent list.

Two stages:

1. **Universe** — pull the holdings of Vanguard Total Stock Market ETF (VTI)
   from Vanguard's own profile API, clean the tickers, and apply weight filters.
2. **Prices** — download daily bars for each surviving ticker, trim to the last
   N sessions (252 = one trading year), validate them, and write one long-format
   CSV that ``app/index.html`` can import directly.

Output columns are exactly what the screener's CSV importer expects::

    symbol,date,open,high,low,close,volume

Quick start
-----------
::

    pip install -r tools/requirements.txt

    # everything VTI holds, filtered to what the screener would actually trade
    python3 tools/fetch_vti_universe.py --out data/vti-universe.csv

    # a fast first run: the 500 largest weights only
    python3 tools/fetch_vti_universe.py --top 500 --out data/vti-top500.csv

Then open ``app/index.html`` → **Import CSV** → pick the file.

Notes
-----
* Bars are **split and dividend adjusted** by default (``--no-adjust`` to turn
  that off). Consistency matters more than rawness here: an unadjusted split
  prints a 50% overnight gap, which the episodic-pivot detector would happily
  flag as a catalyst.
* ``SPY`` is always appended (see ``--index``) because the screener treats a
  symbol named SPY, QQQ or IWM as the market index for its regime filter
  instead of screening it. It bypasses the liquidity filters.
* VTI holds roughly 3,600 names. All of them, at 252 sessions, is around
  900,000 rows and ~55 MB of CSV — fine for the engine, slow to hand to a
  browser. The default ``--min-turnover``/``--min-price`` filters mirror the
  screener's own gates and cut that down to the tradeable subset.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import math
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

LOG = logging.getLogger("vti")

# --------------------------------------------------------------------------- #
# Progress reporting
#
# A download of 3,500 tickers takes minutes, so every long stage reports where
# it is. The CLI ignores this (it logs instead); ``tools/server.py`` turns it
# into a progress bar in the browser. A callback may raise ``Cancelled`` to
# stop the build — that is how the app's Cancel button works.
# --------------------------------------------------------------------------- #

ProgressFn = "Callable[[str, int, int, str], None]"


class Cancelled(Exception):
    """Raised through a progress callback to abandon a build in flight."""


def _tick(progress, phase: str, done: int, total: int, message: str = "") -> None:
    """Report progress, letting Cancelled through and swallowing nothing else.

    A reporting bug must never take down a download that is halfway through a
    3,500-symbol universe, so anything other than Cancelled is logged and
    dropped.
    """
    if progress is None:
        return
    try:
        progress(phase, done, total, message)
    except Cancelled:
        raise
    except Exception as exc:  # noqa: BLE001
        LOG.debug("progress callback failed: %s", exc)

# --------------------------------------------------------------------------- #
# Universe provider 1: Vanguard's own holdings API (authoritative)
# --------------------------------------------------------------------------- #

VANGUARD_URL = (
    "https://investor.vanguard.com/investment-products/etfs/profile/api/"
    "{fund}/portfolio-holding/stock"
)
VANGUARD_REFERER = "https://investor.vanguard.com/investment-products/etfs/profile/{fund}"

# Vanguard's edge rejects obvious bots, so look like a browser tab.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}

# The response envelope has changed shape more than once, so rather than hard-code
# a path we look for the biggest list of dicts that carries a ticker-ish key.
TICKER_KEYS = ("ticker", "symbol", "tickersymbol", "holdingticker", "secticker")
NAME_KEYS = ("longname", "shortname", "name", "securityname", "holdingname", "issuename")
WEIGHT_KEYS = ("percentweight", "percentweighting", "weight", "portfolioweight", "percentofnav")
TYPE_KEYS = ("holdingtype", "sectype", "secmaintype", "assetclass", "securitytype")

# Placeholders Vanguard uses for cash, futures and unlisted lines.
NON_EQUITY = {
    "CASH", "CASH&OTHER", "USD", "N/A", "NA", "--", "-", "", "TOTAL", "OTHER",
    "CMDTY", "FUTURE", "FUTURES", "SWAP", "REPO",
}
TICKER_OK = re.compile(r"^[A-Z][A-Z.\-]{0,7}$")


def _norm_key(key: str) -> str:
    """``"percentWeight"`` and ``"percent_weight"`` both become ``percentweight``."""
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def _pick(row: dict, keys: Sequence[str]) -> Any:
    normalised = {_norm_key(k): v for k, v in row.items()}
    for key in keys:
        value = normalised.get(key)
        if value not in (None, ""):
            return value
    return None


@dataclass
class Holding:
    """One constituent, as read from the fund's holdings feed."""

    ticker: str          # cleaned, e.g. BRK-B
    raw_ticker: str      # as published, e.g. BRK.B
    name: str
    weight: float        # percent of the fund, 0.0 when the feed omits it
    kind: str = ""       # instrument type (Vanguard) or exchange (listing mirror)
    market_cap: float = 0.0

    def __str__(self) -> str:  # pragma: no cover - logging sugar
        return f"{self.ticker} ({self.weight:.3f}%)"


def fetch_holdings_json(
    fund: str,
    url: str | None = None,
    timeout: float = 30.0,
    retries: int = 3,
) -> Any:
    """GET the holdings feed, retrying transient failures with backoff."""
    import requests  # imported lazily so --holdings-file works without it

    endpoint = url or VANGUARD_URL.format(fund=fund)
    headers = dict(BROWSER_HEADERS, Referer=VANGUARD_REFERER.format(fund=fund))
    last_error: Exception | None = None

    for attempt in range(1, retries + 1):
        try:
            LOG.info("GET %s (attempt %d/%d)", endpoint, attempt, retries)
            response = requests.get(endpoint, headers=headers, timeout=timeout)
            if response.status_code in (401, 403, 429):
                raise PermissionError(
                    f"Vanguard returned HTTP {response.status_code}. Their edge blocks "
                    "some clients and networks outright.\n"
                    "Workaround: open\n"
                    f"  {endpoint}\n"
                    "in a browser, save the JSON, and re-run with "
                    "--holdings-file <saved.json>."
                )
            response.raise_for_status()
            return response.json()
        except PermissionError:
            raise
        except Exception as exc:  # noqa: BLE001 - retry anything transient
            last_error = exc
            LOG.warning("holdings request failed: %s", exc)
            if attempt < retries:
                delay = 2 ** attempt
                LOG.info("retrying in %ds", delay)
                time.sleep(delay)

    raise RuntimeError(f"could not fetch {endpoint}: {last_error}")


def _iter_dict_lists(node: Any) -> Iterator[list[dict]]:
    """Yield every list-of-dicts anywhere in a nested JSON structure."""
    if isinstance(node, list):
        if node and all(isinstance(item, dict) for item in node):
            yield node
        for item in node:
            yield from _iter_dict_lists(item)
    elif isinstance(node, dict):
        for value in node.values():
            yield from _iter_dict_lists(value)


def extract_holdings(payload: Any) -> list[Holding]:
    """Find the holdings array in the payload and parse it.

    Shape-tolerant on purpose: we take the largest list of dicts in which most
    entries carry a ticker-like key, so a change to the response envelope does
    not break the script.
    """
    best: list[dict] = []
    for candidate in _iter_dict_lists(payload):
        with_ticker = sum(1 for row in candidate if _pick(row, TICKER_KEYS) is not None)
        if with_ticker >= max(3, 0.5 * len(candidate)) and len(candidate) > len(best):
            best = candidate

    if not best:
        raise ValueError(
            "no holdings array found in the payload — the response shape has changed. "
            "Inspect it with --holdings-out and pass the right list, or open an issue."
        )

    holdings: list[Holding] = []
    for row in best:
        raw = _pick(row, TICKER_KEYS)
        ticker = clean_ticker(raw)
        if not ticker:
            continue
        weight = _to_float(_pick(row, WEIGHT_KEYS))
        holdings.append(
            Holding(
                ticker=ticker,
                raw_ticker=str(raw).strip(),
                name=str(_pick(row, NAME_KEYS) or ticker).strip(),
                weight=weight if weight is not None else 0.0,
                kind=str(_pick(row, TYPE_KEYS) or "").strip(),
            )
        )

    # A ticker can appear twice (multiple share classes of one line item).
    deduped: dict[str, Holding] = {}
    for holding in holdings:
        existing = deduped.get(holding.ticker)
        if existing is None or holding.weight > existing.weight:
            deduped[holding.ticker] = holding
    return sorted(deduped.values(), key=lambda h: (-h.weight, h.ticker))


def clean_ticker(raw: Any) -> str | None:
    """Normalise a published ticker to the form price vendors expect.

    Class shares use a dot at Vanguard (``BRK.B``) and a hyphen at Yahoo and
    Stooq (``BRK-B``). Cash lines, futures and anything that does not look like
    a US listing are dropped.
    """
    if raw is None:
        return None
    ticker = str(raw).strip().upper()
    ticker = re.sub(r"\s+", "", ticker)
    if ticker in NON_EQUITY or len(ticker) > 8:
        return None
    ticker = ticker.replace(".", "-").replace("/", "-")
    ticker = ticker.rstrip("-")
    if not TICKER_OK.match(ticker):
        return None
    return ticker


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = re.sub(r"[,%$\s]", "", str(value))
    try:
        return float(text)
    except ValueError:
        return None


def filter_holdings(holdings: list[Holding], top: int, min_weight: float) -> list[Holding]:
    kept = [h for h in holdings if h.weight >= min_weight]
    if top > 0:
        kept = kept[:top]
    return kept


# --------------------------------------------------------------------------- #
# Universe provider 2: the US exchange listing mirror on GitHub
#
# Vanguard's API is the authoritative source, but it is unreachable from many
# networks (their edge blocks some clients; corporate proxies and CI sandboxes
# often block the host outright). VTI tracks the CRSP US Total Market Index,
# which is, by construction, essentially every US-incorporated common stock
# listed on NASDAQ/NYSE/NYSE American above a small float threshold — so a
# filtered exchange listing reproduces the constituent list closely without
# touching Vanguard at all.
#
# rreichel3/US-Stock-Symbols mirrors the NASDAQ screener dump for all three
# exchanges and is regenerated daily by CI. Fields used: symbol, name, country,
# marketCap.
# --------------------------------------------------------------------------- #

GITHUB_BASE = "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main"
GITHUB_EXCHANGES = ("nasdaq", "nyse", "amex")

# VTI's own published holding count, for a calibration note in the log. From
# Vanguard's fund page / holdings aggregators, September 2026.
VTI_PUBLISHED_HOLDINGS = 3480

# The constituent snapshot committed to the repo, used by --universe snapshot.
DEFAULT_SNAPSHOT = Path(__file__).resolve().parent.parent / "data" / "vti-constituents.csv"

# The $40M floor was calibrated against that count: with the instrument and
# domicile filters below, it yields ~3,500 names, i.e. within ~1% of VTI.
DEFAULT_MIN_MARKET_CAP = 40_000_000

# Instrument types CRSP's US indexes exclude.
NON_COMMON_NAME = re.compile(
    r"\b(warrants?|rights?|units?|preferred|depositary|debenture|subordinated|"
    r"notes?|bonds?|when[- ]issued|convertible)\b",
    re.I,
)
# Funds, ETFs, ETNs and pre-merger blank-check vehicles.
FUND_NAME = re.compile(
    r"\b(etf|etn|fund|funds|portfolio|index|proshares|ishares|spdr|direxion|"
    r"invesco|vaneck|global x|wisdomtree|first trust|closed[- ]end|"
    r"acquisition corp)\b",
    re.I,
)
# NASDAQ's fifth letter: W warrant, R right, U unit.
FIFTH_LETTER = re.compile(r"^[A-Z]{4}[WRU]$")


def fetch_us_listings(
    base_url: str = GITHUB_BASE,
    exchanges: Sequence[str] = GITHUB_EXCHANGES,
    timeout: float = 30.0,
    retries: int = 3,
) -> list[dict]:
    """Download the listing dump for each exchange and tag every row with it."""
    import requests

    records: list[dict] = []
    for exchange in exchanges:
        url = f"{base_url.rstrip('/')}/{exchange}/{exchange}_full_tickers.json"
        last_error: Exception | None = None
        for attempt in range(1, retries + 1):
            try:
                LOG.info("GET %s (attempt %d/%d)", url, attempt, retries)
                response = requests.get(url, headers=BROWSER_HEADERS, timeout=timeout)
                response.raise_for_status()
                rows = response.json()
                for row in rows:
                    row["exchange"] = exchange.upper()
                records.extend(rows)
                LOG.info("  %s: %d listings", exchange, len(rows))
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                LOG.warning("listing request failed: %s", exc)
                if attempt < retries:
                    time.sleep(2 ** attempt)
        else:
            raise RuntimeError(f"could not fetch {url}: {last_error}")
    return records


def listings_to_holdings(
    records: Sequence[dict],
    min_market_cap: float = DEFAULT_MIN_MARKET_CAP,
) -> tuple[list[Holding], list[tuple[str, int, int]]]:
    """Filter an exchange listing down to a CRSP-style common-stock universe.

    Returns the holdings plus a step-by-step audit of what each filter removed,
    so the log can show how the constituent list was arrived at.
    """
    audit: list[tuple[str, int, int]] = []
    current = list(records)

    def step(label: str, keep) -> None:
        nonlocal current
        before = len(current)
        current = [row for row in current if keep(row)]
        audit.append((label, before - len(current), len(current)))

    step("warrants / units / rights / preferred / notes",
         lambda r: not NON_COMMON_NAME.search(str(r.get("name", ""))))
    step("NASDAQ fifth-letter W/R/U symbols",
         lambda r: not FIFTH_LETTER.match(str(r.get("symbol", ""))))
    step("ETFs, funds and blank-check vehicles",
         lambda r: not FUND_NAME.search(str(r.get("name", ""))))
    step("non-US domicile (CRSP US indexes are US-only)",
         lambda r: str(r.get("country", "")) in ("United States", ""))
    step("no reported market cap",
         lambda r: (_to_float(r.get("marketCap")) or 0.0) > 0)
    step(f"market cap below ${min_market_cap / 1e6:,.0f}M",
         lambda r: (_to_float(r.get("marketCap")) or 0.0) >= min_market_cap)

    holdings: dict[str, Holding] = {}
    total_cap = sum((_to_float(r.get("marketCap")) or 0.0) for r in current) or 1.0
    for row in current:
        ticker = clean_ticker(row.get("symbol"))
        if not ticker:
            continue
        cap = _to_float(row.get("marketCap")) or 0.0
        holding = Holding(
            ticker=ticker,
            raw_ticker=str(row.get("symbol", "")).strip(),
            name=str(row.get("name", ticker)).strip(),
            weight=cap / total_cap * 100.0,   # cap weight stands in for fund weight
            kind=str(row.get("exchange", "")),
            market_cap=cap,
        )
        existing = holdings.get(ticker)
        if existing is None or holding.market_cap > existing.market_cap:
            holdings[ticker] = holding

    audit.append(("unusable / duplicate symbols", len(current) - len(holdings), len(holdings)))
    ordered = sorted(holdings.values(), key=lambda h: (-h.weight, h.ticker))
    return ordered, audit


# --------------------------------------------------------------------------- #
# Prices
# --------------------------------------------------------------------------- #

@dataclass
class Bar:
    symbol: str
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


def _chunks(items: Sequence[str], size: int) -> Iterator[list[str]]:
    for start in range(0, len(items), size):
        yield list(items[start:start + size])


def fetch_prices_yfinance(
    tickers: Sequence[str],
    period: str = "2y",
    chunk_size: int = 100,
    adjust: bool = True,
    sleep: float = 1.0,
    retries: int = 2,
    progress: ProgressFn | None = None,
    **_ignored: Any,   # providers share one call signature; ignore the rest
):
    """Download daily bars in batches. Returns ``{ticker: DataFrame}``."""
    import pandas as pd
    import yfinance as yf

    frames: dict[str, "pd.DataFrame"] = {}
    batches = list(_chunks(tickers, chunk_size))
    done = 0

    for index, batch in enumerate(batches, start=1):
        LOG.info("prices %d/%d — %d tickers", index, len(batches), len(batch))
        _tick(progress, "prices", done, len(tickers),
              f"downloading batch {index} of {len(batches)}")
        raw = None
        for attempt in range(1, retries + 1):
            try:
                raw = yf.download(
                    batch,
                    period=period,
                    interval="1d",
                    auto_adjust=adjust,
                    group_by="ticker",
                    threads=True,
                    progress=False,
                    timeout=30,
                )
                break
            except Exception as exc:  # noqa: BLE001
                LOG.warning("batch %d failed (%s)", index, exc)
                if attempt < retries:
                    time.sleep(2 ** attempt)
        if raw is None or raw.empty:
            LOG.warning("batch %d returned nothing", index)
            continue

        if isinstance(raw.columns, pd.MultiIndex):
            for ticker in batch:
                if ticker in raw.columns.get_level_values(0):
                    frames[ticker] = raw[ticker].dropna(how="all")
        elif len(batch) == 1:
            frames[batch[0]] = raw.dropna(how="all")

        done += len(batch)
        _tick(progress, "prices", done, len(tickers),
              f"{len(frames)} symbols returned so far")
        if sleep and index < len(batches):
            time.sleep(sleep)

    return frames


def fetch_prices_stooq(
    tickers: Sequence[str],
    sessions: int = 252,
    sleep: float = 0.4,
    progress: ProgressFn | None = None,
    **_ignored: Any,
):
    """No-key fallback: one CSV per symbol from stooq.com.

    Slower (a request per ticker) but needs no account. Stooq prices are
    split-adjusted; dividends are not.
    """
    import pandas as pd
    import requests

    frames: dict[str, "pd.DataFrame"] = {}
    for index, ticker in enumerate(tickers, start=1):
        symbol = ticker.lower() + ".us"
        url = f"https://stooq.com/q/d/l/?s={symbol}&i=d"
        try:
            response = requests.get(url, headers=BROWSER_HEADERS, timeout=20)
            response.raise_for_status()
            text = response.text.strip()
            if not text or text.lower().startswith("no data"):
                LOG.debug("%s: no data from stooq", ticker)
                continue
            frame = pd.read_csv(io.StringIO(text))
            frame.columns = [c.strip().title() for c in frame.columns]
            frame = frame.rename(columns={"Date": "date"}).set_index("date")
            frames[ticker] = frame.tail(sessions + 30)
        except Exception as exc:  # noqa: BLE001
            LOG.debug("%s: %s", ticker, exc)
        if index % 50 == 0:
            LOG.info("prices %d/%d (stooq)", index, len(tickers))
        _tick(progress, "prices", index, len(tickers), f"{len(frames)} symbols returned so far")
        if sleep:
            time.sleep(sleep)
    return frames


SOURCES = {"yfinance": fetch_prices_yfinance, "stooq": fetch_prices_stooq}


# --------------------------------------------------------------------------- #
# Validation and output
# --------------------------------------------------------------------------- #

def frame_to_bars(symbol: str, frame, sessions: int) -> list[Bar]:
    """Trim one vendor frame to the last ``sessions`` clean daily bars."""
    import pandas as pd

    columns = {str(c).strip().lower(): c for c in frame.columns}
    needed = ("open", "high", "low", "close")
    if not all(name in columns for name in needed):
        return []

    frame = frame.sort_index()
    bars: list[Bar] = []
    for stamp, row in frame.iterrows():
        try:
            values = [float(row[columns[name]]) for name in needed]
        except (TypeError, ValueError):
            continue
        if any(math.isnan(v) or v <= 0 for v in values):
            continue
        open_, high, low, close = values
        if high < low or high < max(open_, close) or low > min(open_, close):
            continue  # impossible bar: vendor glitch
        volume = row[columns["volume"]] if "volume" in columns else 0.0
        try:
            volume = float(volume)
        except (TypeError, ValueError):
            volume = 0.0
        if math.isnan(volume) or volume < 0:
            volume = 0.0

        date = stamp.strftime("%Y-%m-%d") if hasattr(stamp, "strftime") else str(stamp)[:10]
        bars.append(Bar(symbol, date, open_, high, low, close, volume))

    # de-duplicate dates, keeping the last occurrence
    unique: dict[str, Bar] = {bar.date: bar for bar in bars}
    ordered = [unique[date] for date in sorted(unique)]
    return ordered[-sessions:]


def screen_filters(
    bars: list[Bar],
    min_sessions: int,
    min_price: float,
    min_turnover_musd: float,
) -> str | None:
    """Return a rejection reason, or None when the symbol passes.

    Mirrors the screener's own universe gates so the CSV does not carry rows
    the engine will reject anyway.
    """
    if len(bars) < min_sessions:
        return f"only {len(bars)} sessions"
    if bars[-1].close < min_price:
        return f"last close {bars[-1].close:.2f} below {min_price:g}"
    window = bars[-20:]
    turnover = sum(b.close * b.volume for b in window) / len(window)
    if turnover < min_turnover_musd * 1e6:
        return f"turnover ${turnover / 1e6:.1f}M below ${min_turnover_musd:g}M"
    return None


def write_csv(path: Path, rows: Iterable[Bar], meta: dict[str, Holding] | None = None) -> int:
    """Write the long-format CSV the screener imports.

    Market cap and company name are written once per symbol, on its first row,
    and left blank on the rest: the screener reads them as per-symbol metadata,
    and repeating them on every bar would add megabytes for nothing.
    """
    meta = meta or {}
    path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    seen: set[str] = set()
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["symbol", "date", "open", "high", "low", "close", "volume",
                         "market_cap", "name"])
        for bar in rows:
            first = bar.symbol not in seen
            holding = meta.get(bar.symbol) if first else None
            seen.add(bar.symbol)
            writer.writerow([
                bar.symbol, bar.date,
                f"{bar.open:.4f}", f"{bar.high:.4f}", f"{bar.low:.4f}", f"{bar.close:.4f}",
                int(round(bar.volume)),
                f"{holding.market_cap:.0f}" if holding and holding.market_cap else "",
                holding.name if holding and holding.name != bar.symbol else "",
            ])
            written += 1
    return written


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    universe = parser.add_argument_group("universe")
    universe.add_argument(
        "--universe", choices=("auto", "vanguard", "github", "snapshot", "file", "tickers"),
        default="auto",
        help="where the constituent list comes from. vanguard: the fund's own holdings API "
             "(exact holdings and weights). github: a daily-updated US exchange listing "
             "mirror, filtered to a CRSP-style common-stock universe (works when Vanguard "
             "is unreachable). snapshot: the constituent list committed to this repo, no "
             "network at all. auto (default): vanguard, falling back to github.")
    universe.add_argument("--constituents-file", type=Path,
                          help="read the universe from a snapshot written by --constituents-out")
    universe.add_argument("--fund", default="VTI", help="fund ticker on Vanguard's API (default: VTI)")
    universe.add_argument("--holdings-url", help="override the holdings endpoint entirely")
    universe.add_argument("--holdings-file", type=Path,
                          help="read the holdings JSON from disk instead of the network")
    universe.add_argument("--holdings-out", type=Path, help="save the raw holdings JSON here")
    universe.add_argument("--tickers-file", type=Path,
                          help="skip the holdings feed: one ticker per line")
    universe.add_argument("--tickers-out", type=Path, help="save the cleaned ticker list here")
    universe.add_argument("--constituents-out", type=Path,
                          help="save the resolved constituent table (symbol, name, exchange, "
                               "market cap, weight) as CSV — useful on its own, and re-usable "
                               "later with --tickers-file")
    universe.add_argument("--top", type=int, default=0,
                          help="keep only the N largest weights (0 = all, the default)")
    universe.add_argument("--min-weight", type=float, default=0.0,
                          help="drop holdings below this percent of the fund")
    universe.add_argument("--min-market-cap", type=float, default=DEFAULT_MIN_MARKET_CAP,
                          help="github provider only: market-cap floor in dollars. The default "
                               f"(${DEFAULT_MIN_MARKET_CAP / 1e6:,.0f}M) is calibrated so the "
                               f"universe lands within ~1%% of VTI's published "
                               f"{VTI_PUBLISHED_HOLDINGS:,} holdings")
    universe.add_argument("--listing-base-url", default=GITHUB_BASE,
                          help="github provider only: base URL of the listing mirror")

    prices = parser.add_argument_group("prices")
    prices.add_argument("--source", choices=sorted(SOURCES), default="yfinance",
                        help="price vendor (default: yfinance)")
    prices.add_argument("--sessions", type=int, default=252,
                        help="trading sessions to keep per symbol (default: 252)")
    prices.add_argument("--period", default="2y",
                        help="history to request before trimming (default: 2y)")
    prices.add_argument("--chunk-size", type=int, default=100,
                        help="tickers per batch request (default: 100)")
    prices.add_argument("--sleep", type=float, default=1.0,
                        help="seconds between batches (default: 1.0)")
    prices.add_argument("--no-adjust", action="store_true",
                        help="keep raw prices instead of split/dividend adjusted")
    prices.add_argument("--index", default="SPY",
                        help="index proxy to include for the regime filter, or '' to skip "
                             "(default: SPY)")

    quality = parser.add_argument_group("quality gates (mirror the screener's own)")
    quality.add_argument("--min-sessions", type=int, default=130,
                         help="drop symbols with fewer clean bars (default: 130)")
    quality.add_argument("--min-price", type=float, default=5.0,
                         help="drop symbols closing below this (default: 5)")
    quality.add_argument("--min-turnover", type=float, default=5.0,
                         help="drop symbols under this 20-day average turnover, $M "
                              "(default: 5)")

    output = parser.add_argument_group("output")
    output.add_argument("--out", type=Path, default=Path("data/vti-universe.csv"),
                        help="CSV to write (default: data/vti-universe.csv)")
    output.add_argument("--dry-run", action="store_true",
                        help="resolve the universe and stop, without downloading prices")
    output.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    return parser


def _universe_from_vanguard(args: argparse.Namespace) -> list[Holding]:
    payload = fetch_holdings_json(args.fund, args.holdings_url)
    if args.holdings_out:
        args.holdings_out.parent.mkdir(parents=True, exist_ok=True)
        args.holdings_out.write_text(json.dumps(payload), encoding="utf-8")
        LOG.info("saved raw holdings to %s", args.holdings_out)
    holdings = extract_holdings(payload)
    LOG.info("Vanguard holdings feed: %d constituents with weights", len(holdings))
    if args.fund.upper() == "VTI" and len(holdings) < 500:
        LOG.warning(
            "VTI holds ~%s names but the feed yielded %d — the endpoint may be paginated or "
            "truncated. Inspect the raw JSON with --holdings-out.",
            f"{VTI_PUBLISHED_HOLDINGS:,}", len(holdings),
        )
    return holdings


def _universe_from_github(args: argparse.Namespace) -> list[Holding]:
    records = fetch_us_listings(args.listing_base_url)
    LOG.info("listing mirror: %d raw listings across %d exchanges",
             len(records), len(GITHUB_EXCHANGES))
    holdings, audit = listings_to_holdings(records, args.min_market_cap)
    LOG.info("filtering to a CRSP-style common-stock universe:")
    for label, dropped, left in audit:
        LOG.info("    -%-6d %-48s -> %d", dropped, label, left)
    delta = (len(holdings) - VTI_PUBLISHED_HOLDINGS) / VTI_PUBLISHED_HOLDINGS * 100
    LOG.info("universe: %d names vs VTI's published %s holdings (%+.1f%%)",
             len(holdings), f"{VTI_PUBLISHED_HOLDINGS:,}", delta)
    if abs(delta) > 10:
        LOG.warning(
            "that is more than 10%% off the published count — tune --min-market-cap "
            "(higher floor = fewer names) if you need a closer match."
        )
    LOG.warning(
        "This is a PROXY for VTI's constituents, not the fund's holdings file: it is the "
        "US common-stock universe the CRSP index is drawn from, weighted by market cap "
        "rather than by the fund's own float-adjusted weights."
    )
    return holdings


def _universe_from_tickers(args: argparse.Namespace) -> list[Holding]:
    lines = args.tickers_file.read_text(encoding="utf-8").split()
    holdings = []
    for line in lines:
        ticker = clean_ticker(line)
        if ticker:
            holdings.append(Holding(ticker=ticker, raw_ticker=line, name=ticker, weight=0.0))
    LOG.info("read %d tickers from %s", len(holdings), args.tickers_file)
    return holdings


def _universe_from_constituents(path: Path) -> list[Holding]:
    """Read a constituent snapshot written by ``--constituents-out``.

    Columns: symbol, name, exchange_or_type, market_cap, weight_pct. The repo
    ships one at ``data/vti-constituents.csv`` so a run can start from a known
    universe without touching the network at all — useful when the listing
    mirror is blocked, and the fastest path for a repeat build.
    """
    holdings: list[Holding] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            ticker = clean_ticker(row.get("symbol"))
            if not ticker:
                continue
            holdings.append(Holding(
                ticker=ticker,
                raw_ticker=(row.get("symbol") or ticker).strip(),
                name=(row.get("name") or ticker).strip(),
                weight=_to_float(row.get("weight_pct")) or 0.0,
                kind=(row.get("exchange_or_type") or "").strip(),
                market_cap=_to_float(row.get("market_cap")) or 0.0,
            ))
    if not holdings:
        raise ValueError(f"{path} has no usable rows")
    LOG.info("read %d constituents from %s", len(holdings), path)
    return holdings


def _universe_from_file(args: argparse.Namespace) -> list[Holding]:
    payload = json.loads(args.holdings_file.read_text(encoding="utf-8"))
    LOG.info("read holdings JSON from %s", args.holdings_file)
    holdings = extract_holdings(payload)
    LOG.info("parsed %d constituents", len(holdings))
    return holdings


def load_universe(args: argparse.Namespace) -> tuple[list[Holding], str]:
    """Resolve the constituent list. Returns the holdings and the source used."""
    # An explicit local input always wins over the network providers.
    if args.tickers_file:
        return _universe_from_tickers(args), "tickers-file"
    if args.holdings_file:
        return _universe_from_file(args), "holdings-file"
    if getattr(args, "constituents_file", None):
        return _universe_from_constituents(args.constituents_file), "constituents-snapshot"

    choice = args.universe
    if choice == "snapshot":
        return _universe_from_constituents(DEFAULT_SNAPSHOT), "constituents-snapshot"

    if choice == "vanguard":
        return _universe_from_vanguard(args), "vanguard"
    if choice == "github":
        return _universe_from_github(args), "listing-mirror"
    if choice in ("file", "tickers"):
        raise SystemExit(
            f"--universe {choice} needs "
            f"{'--holdings-file' if choice == 'file' else '--tickers-file'}"
        )

    # auto: the authoritative source first, the proxy only if it is unreachable
    try:
        return _universe_from_vanguard(args), "vanguard"
    except Exception as exc:  # noqa: BLE001
        LOG.warning("Vanguard holdings unavailable (%s)", exc)
        LOG.warning("falling back to the US listing mirror — pass --universe vanguard to "
                    "make this a hard failure instead")
        return _universe_from_github(args), "listing-mirror (Vanguard unreachable)"


# --------------------------------------------------------------------------- #
# The pipeline, callable
#
# ``main`` is a thin shell over these two: the local server in tools/server.py
# runs the identical code path, so the app and the CLI can never drift.
# --------------------------------------------------------------------------- #

@dataclass
class Universe:
    holdings: list[Holding]
    tickers: list[str]          # holdings + the index proxy
    index_symbol: str
    source: str


@dataclass
class BuildResult:
    rows: list[Bar]             # sorted by (symbol, date)
    universe: Universe
    dropped: dict[str, str]     # ticker -> why it was not written
    kept: int
    seconds: float


def resolve_universe(args: argparse.Namespace, progress=None) -> Universe:
    """Stage 1: the constituent list, filtered, with the index proxy appended."""
    _tick(progress, "universe", 0, 0, "resolving the constituent list")
    holdings, source = load_universe(args)
    holdings = filter_holdings(holdings, args.top, args.min_weight)
    if not holdings:
        raise ValueError("no holdings survived the weight filters")

    tickers = [h.ticker for h in holdings]
    index_symbol = (args.index or "").strip().upper()
    if index_symbol and index_symbol not in tickers:
        tickers.append(index_symbol)

    LOG.info("universe: %d symbols%s", len(tickers),
             f" (+{index_symbol} as the index proxy)" if index_symbol else "")
    _tick(progress, "universe", len(tickers), len(tickers),
          f"{len(tickers):,} symbols from {source}")
    return Universe(holdings, tickers, index_symbol, source)


def download_bars(args: argparse.Namespace, universe: Universe, progress=None) -> BuildResult:
    """Stage 2: the bars, trimmed, validated and put through the quality gates."""
    fetch = SOURCES[args.source]
    started = time.time()
    frames = fetch(
        universe.tickers,
        period=args.period,
        chunk_size=args.chunk_size,
        adjust=not args.no_adjust,
        sleep=args.sleep,
        sessions=args.sessions,
        progress=progress,
    )
    elapsed = time.time() - started
    LOG.info("downloaded %d/%d symbols in %.0fs", len(frames), len(universe.tickers), elapsed)
    if not frames:
        raise ValueError("no price data returned — check connectivity and the --source choice")

    _tick(progress, "validate", 0, len(universe.tickers), "trimming and validating bars")
    rows: list[Bar] = []
    dropped: dict[str, str] = {}
    kept = 0
    for done, ticker in enumerate(universe.tickers, start=1):
        frame = frames.get(ticker)
        if frame is None or len(frame) == 0:
            dropped[ticker] = "no data returned"
            continue
        bars = frame_to_bars(ticker, frame, args.sessions)
        if not bars:
            dropped[ticker] = "no usable bars"
            continue
        if ticker != universe.index_symbol:
            reason = screen_filters(bars, args.min_sessions, args.min_price, args.min_turnover)
            if reason:
                dropped[ticker] = reason
                continue
        elif len(bars) < args.min_sessions:
            LOG.warning("index %s has only %d sessions — the regime filter needs ~210 for "
                        "a 200-day average", ticker, len(bars))
        rows.extend(bars)
        kept += 1
        if done % 250 == 0:
            _tick(progress, "validate", done, len(universe.tickers), f"{kept} symbols kept")

    _tick(progress, "validate", len(universe.tickers), len(universe.tickers),
          f"{kept} symbols passed the quality gates")
    if not rows:
        raise ValueError("every symbol failed the quality gates")

    rows.sort(key=lambda b: (b.symbol, b.date))
    return BuildResult(rows, universe, dropped, kept, elapsed)


def build_dataset(args: argparse.Namespace, progress=None) -> BuildResult:
    """Both stages. What the server calls."""
    return download_bars(args, resolve_universe(args, progress), progress)


def build_meta(args: argparse.Namespace, result: BuildResult) -> dict:
    """Provenance for the dataset — written beside the CSV and served by the API."""
    span = sorted({b.date for b in result.rows})
    return {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "universe_source": result.universe.source,
        "fund": args.fund,
        "price_source": args.source,
        "adjusted": not args.no_adjust,
        "sessions_requested": args.sessions,
        "symbols_written": result.kept,
        "rows": len(result.rows),
        "session_span": [span[0], span[-1]],
        "filters": {
            "top": args.top, "min_weight": args.min_weight,
            "min_market_cap": args.min_market_cap,
            "min_sessions": args.min_sessions, "min_price": args.min_price,
            "min_turnover_musd": args.min_turnover,
        },
        "index_symbol": result.universe.index_symbol or None,
        "dropped": result.dropped,
    }


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-7s %(message)s",
        stream=sys.stderr,
    )

    if args.sessions < 230:
        LOG.warning(
            "--sessions %d leaves the 200-day average barely defined: the trend test and the "
            "index regime filter need ~220 sessions. 252 is the practical minimum; 300+ is "
            "comfortable.", args.sessions,
        )

    try:
        universe = resolve_universe(args)
    except PermissionError as exc:
        LOG.error("%s", exc)
        return 2
    except Exception as exc:  # noqa: BLE001
        LOG.error("could not resolve the universe: %s", exc)
        if not args.holdings_file and not args.tickers_file:
            LOG.error(
                "If the network blocks investor.vanguard.com (corporate proxy, VPN, or "
                "Vanguard's own edge), open the endpoint in a browser, save the JSON, and "
                "re-run with --holdings-file <saved.json>. --tickers-file also works with a "
                "plain list of symbols, and --universe snapshot uses the constituent list "
                "committed to this repo."
            )
        return 2

    holdings, tickers, index_symbol = universe.holdings, universe.tickers, universe.index_symbol
    if args.tickers_out:
        args.tickers_out.parent.mkdir(parents=True, exist_ok=True)
        args.tickers_out.write_text("\n".join(tickers) + "\n", encoding="utf-8")
        LOG.info("saved ticker list to %s", args.tickers_out)

    if args.constituents_out:
        args.constituents_out.parent.mkdir(parents=True, exist_ok=True)
        with args.constituents_out.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["symbol", "name", "exchange_or_type", "market_cap", "weight_pct"])
            for holding in holdings:
                writer.writerow([
                    holding.ticker, holding.name, holding.kind,
                    f"{holding.market_cap:.0f}" if holding.market_cap else "",
                    f"{holding.weight:.6f}",
                ])
        LOG.info("saved %d constituents to %s", len(holdings), args.constituents_out)

    if args.dry_run:
        preview = ", ".join(f"{h.ticker}:{h.weight:.2f}%" for h in holdings[:15])
        LOG.info("dry run — first 15: %s", preview)
        return 0

    try:
        result = download_bars(args, universe)
    except Exception as exc:  # noqa: BLE001
        LOG.error("%s", exc)
        return 1

    rows, dropped, kept, source = result.rows, result.dropped, result.kept, universe.source
    written = write_csv(args.out, rows, {h.ticker: h for h in holdings})
    size_mb = args.out.stat().st_size / 1e6
    span = sorted({b.date for b in rows})
    meta = build_meta(args, result)
    meta_path = args.out.with_suffix(args.out.suffix + ".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    LOG.info("—" * 62)
    LOG.info("universe source : %s", source)
    LOG.info("symbols written : %d (of %d requested)", kept, len(tickers))
    LOG.info("rows written    : %d", written)
    LOG.info("sessions        : %d distinct, %s to %s", len(span), span[0], span[-1])
    LOG.info("file            : %s (%.1f MB)", args.out, size_mb)
    LOG.info("provenance      : %s", meta_path)
    if dropped:
        LOG.info("dropped         : %d", len(dropped))
        for ticker, reason in list(dropped.items())[:10]:
            LOG.info("    %-8s %s", ticker, reason)
        if len(dropped) > 10:
            LOG.info("    … and %d more (use -v for all)", len(dropped) - 10)
            LOG.debug("all drops: %s", json.dumps(dropped, indent=2))
    LOG.info("—" * 62)
    LOG.info("Next: open app/index.html → Import CSV → %s", args.out)
    if size_mb > 25:
        LOG.warning("%.0f MB is a lot for a browser to parse; consider --top 750 or a "
                    "higher --min-turnover", size_mb)
    return 0


if __name__ == "__main__":
    sys.exit(main())
