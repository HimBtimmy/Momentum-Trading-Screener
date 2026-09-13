#!/usr/bin/env python3
"""Local backend for the screener: yfinance in, JSON out.

Run it, open the page it prints, press **Fetch from yfinance**. The browser
gets the same universe ``fetch_vti_universe.py`` builds on the command line —
same constituent resolution, same download, same quality gates — without a CSV
in the middle::

    pip install -r tools/requirements.txt
    python3 tools/server.py

    # a fast first run
    python3 tools/server.py --open --default-top 300

Why a backend at all
--------------------
yfinance is a Python client for Yahoo's endpoints, which do not send CORS
headers, so a browser cannot call them directly. The screening logic stays in
the browser (``app/engine.js`` is the single source of truth for the strategy);
this process does the one thing the browser cannot, which is fetch the data.

What it serves
--------------
``/``                      the app, so everything is same-origin
``GET  /api/health``       whether yfinance is importable, and what is cached
``GET  /api/config``       defaults for the form
``POST /api/fetch``        start a build; returns a job id
``GET  /api/jobs/<id>``    progress: phase, done/total, message, state
``GET  /api/jobs/<id>/data``  the finished dataset (gzipped when accepted)
``POST /api/jobs/<id>/cancel``  stop a download in flight

Scope
-----
Binds to 127.0.0.1. It is a single-user development tool: it holds no
credentials, but it will happily spend your bandwidth, so do not put it on a
public interface (``--host 0.0.0.0`` warns and asks you to mean it).
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import logging
import mimetypes
import os
import re
import sys
import threading
import time
import uuid
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fetch_vti_universe as vti  # noqa: E402

LOG = logging.getLogger("server")

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "cache"

# Only these trees are served. The repo also holds a .git directory, and a
# localhost web server has no business handing that to anything.
SERVE_DIRS = ("app", "docs", "data")

MAX_BODY = 1 << 20          # 1 MB of JSON is a very generous request
JOB_TTL = 3600.0            # finished jobs are forgotten after an hour


# --------------------------------------------------------------------------- #
# Jobs
# --------------------------------------------------------------------------- #

@dataclass
class Job:
    id: str
    params: dict
    state: str = "queued"               # queued | running | done | error | cancelled
    phase: str = "starting"             # universe | prices | validate | packing
    done: int = 0
    total: int = 0
    message: str = ""
    error: str = ""
    started: float = field(default_factory=time.time)
    finished: float = 0.0
    payload: dict | None = None         # the dataset, once built
    cached: bool = False
    saved_csv: str = ""
    cancel: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def status(self) -> dict:
        with self.lock:
            out = {
                "id": self.id, "state": self.state, "phase": self.phase,
                "done": self.done, "total": self.total, "message": self.message,
                "elapsed": round((self.finished or time.time()) - self.started, 1),
                "cached": self.cached,
            }
            if self.error:
                out["error"] = self.error
            if self.state == "done" and self.payload:
                out["summary"] = self.payload["provenance"]
                out["savedCsv"] = self.saved_csv
            return out


JOBS: dict[str, Job] = {}
JOBS_LOCK = threading.Lock()
# yfinance is rate-limited and pandas is memory-hungry; one build at a time.
BUILD_LOCK = threading.Lock()


def reap_jobs() -> None:
    cutoff = time.time() - JOB_TTL
    with JOBS_LOCK:
        for job_id in [j for j, job in JOBS.items()
                       if job.finished and job.finished < cutoff]:
            JOBS.pop(job_id, None)


# --------------------------------------------------------------------------- #
# Request -> CLI options
#
# The server does not reimplement the pipeline; it builds the same argparse
# Namespace the CLI would and hands it to fetch_vti_universe. Anything the CLI
# grows, the app gets for free.
# --------------------------------------------------------------------------- #

def _num(value: Any, default: float, low: float, high: float) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if out != out:                      # NaN
        return default
    return max(low, min(high, out))


def options_from_request(body: dict, defaults: argparse.Namespace) -> argparse.Namespace:
    """Validate the request and turn it into CLI options.

    Every field is clamped rather than rejected: the form is the only caller
    that matters, and a screener that refuses to run because a number was out
    of range is less useful than one that runs with a sane number.
    """
    args = argparse.Namespace(**vars(defaults))

    universe = str(body.get("universe") or defaults.universe)
    if universe not in ("auto", "vanguard", "github", "snapshot"):
        universe = "auto"
    args.universe = universe

    source = str(body.get("source") or "yfinance")
    args.source = source if source in vti.SOURCES else "yfinance"

    args.sessions = int(_num(body.get("sessions"), defaults.sessions, 130, 2000))
    args.top = int(_num(body.get("top"), 0, 0, 10000))
    args.min_price = _num(body.get("minPrice"), defaults.min_price, 0, 1e4)
    args.min_turnover = _num(body.get("minTurnover"), defaults.min_turnover, 0, 1e5)
    args.min_market_cap = _num(body.get("minMarketCap"), defaults.min_market_cap, 0, 1e13)
    args.chunk_size = int(_num(body.get("chunkSize"), defaults.chunk_size, 1, 500))
    args.sleep = _num(body.get("sleep"), defaults.sleep, 0, 30)
    args.no_adjust = bool(body.get("noAdjust", False))

    index = str(body.get("index") or defaults.index).strip().upper()
    args.index = index if re.fullmatch(r"[A-Z0-9.\-]{1,10}", index or "") else "SPY"

    # yfinance's `period` has to cover the requested sessions with room for
    # holidays, or the trim silently returns short symbols.
    years = max(1, int(args.sessions / 252 + 0.999) + 1)
    args.period = f"{years}y"
    return args


def cache_key(args: argparse.Namespace) -> str:
    """Same options on the same day means the same data."""
    ident = json.dumps({
        "universe": args.universe, "source": args.source, "sessions": args.sessions,
        "top": args.top, "min_price": args.min_price, "min_turnover": args.min_turnover,
        "min_market_cap": args.min_market_cap, "index": args.index,
        "adjust": not args.no_adjust, "day": time.strftime("%Y-%m-%d"),
    }, sort_keys=True)
    return hashlib.sha1(ident.encode()).hexdigest()[:16]


# --------------------------------------------------------------------------- #
# Dataset payload
# --------------------------------------------------------------------------- #

def to_payload(result: vti.BuildResult, args: argparse.Namespace) -> dict:
    """Pack the build into the compact JSON the app loads.

    Bars are arrays, not objects: ``["2026-09-11", o, h, l, c, v]``. At a few
    hundred thousand bars the difference between that and named keys is tens of
    megabytes, all of it the same six words repeated.
    """
    meta = vti.build_meta(args, result)
    by_symbol: dict[str, list] = {}
    for bar in result.rows:
        by_symbol.setdefault(bar.symbol, []).append([
            bar.date, round(bar.open, 4), round(bar.high, 4),
            round(bar.low, 4), round(bar.close, 4), int(round(bar.volume)),
        ])

    holdings = {h.ticker: h for h in result.universe.holdings}
    index_symbol = result.universe.index_symbol
    symbols = []
    for ticker, bars in sorted(by_symbol.items()):
        if ticker == index_symbol:
            continue
        holding = holdings.get(ticker)
        symbols.append({
            "symbol": ticker,
            "name": holding.name if holding and holding.name != ticker else "",
            "marketCap": round(holding.market_cap) if holding and holding.market_cap else 0,
            "bars": bars,
        })

    last_dates = [s["bars"][-1][0] for s in symbols if s["bars"]]
    return {
        "asOf": max(last_dates) if last_dates else "",
        "provenance": meta,
        "index": ({"symbol": index_symbol, "bars": by_symbol[index_symbol]}
                  if index_symbol in by_symbol else None),
        "symbols": symbols,
    }


def run_job(job: Job, args: argparse.Namespace, save_csv: bool) -> None:
    """Build one dataset, reporting progress into the job record."""

    def progress(phase: str, done: int, total: int, message: str = "") -> None:
        if job.cancel:
            raise vti.Cancelled()
        with job.lock:
            job.phase, job.done, job.total, job.message = phase, done, total, message

    key = cache_key(args)
    cached = CACHE_DIR / f"{key}.json"
    try:
        if not job.params.get("refresh") and cached.exists():
            payload = json.loads(cached.read_text(encoding="utf-8"))
            with job.lock:
                job.payload, job.cached, job.state = payload, True, "done"
                job.finished, job.message = time.time(), "served from today's cache"
            LOG.info("job %s served from cache %s", job.id, cached.name)
            return

        with BUILD_LOCK:
            if job.cancel:
                raise vti.Cancelled()
            result = vti.build_dataset(args, progress)
            progress("packing", result.kept, result.kept, "packing the dataset")
            payload = to_payload(result, args)

        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps(payload), encoding="utf-8")

        if save_csv:
            out = ROOT / "data" / f"universe-{time.strftime('%Y%m%d')}.csv"
            vti.write_csv(out, result.rows, {h.ticker: h for h in result.universe.holdings})
            with job.lock:
                job.saved_csv = str(out.relative_to(ROOT))
            LOG.info("wrote %s", out)

        with job.lock:
            job.payload, job.state, job.finished = payload, "done", time.time()
            job.done = job.total = payload["provenance"]["symbols_written"]
            job.message = (f"{payload['provenance']['symbols_written']} symbols, "
                           f"{payload['provenance']['rows']:,} bars")
        LOG.info("job %s done — %s", job.id, job.message)

    except vti.Cancelled:
        with job.lock:
            job.state, job.finished, job.message = "cancelled", time.time(), "cancelled"
        LOG.info("job %s cancelled", job.id)
    except Exception as exc:  # noqa: BLE001
        LOG.exception("job %s failed", job.id)
        with job.lock:
            job.state, job.finished = "error", time.time()
            job.error = f"{type(exc).__name__}: {exc}"


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

class Handler(BaseHTTPRequestHandler):
    server_version = "QMScreener/1.0"
    protocol_version = "HTTP/1.1"
    defaults: argparse.Namespace                     # set by serve()

    # -- plumbing ----------------------------------------------------------
    def log_message(self, fmt: str, *fmt_args: Any) -> None:   # quieter default
        LOG.debug("%s - %s", self.address_string(), fmt % fmt_args)

    def _cors(self) -> None:
        """Allow file:// and localhost origins only.

        Opening app/index.html straight off disk is a normal way to use this,
        and that origin is "null"; a page on the open internet is not, and does
        not get to drive a build on someone's machine.
        """
        origin = self.headers.get("Origin")
        if origin and (origin == "null"
                       or re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin)):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        gzipped = (len(body) > 4096
                   and "gzip" in (self.headers.get("Accept-Encoding") or ""))
        if gzipped:
            body = gzip.compress(body, 6)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj: Any) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json; charset=utf-8",
                   {"Cache-Control": "no-store"})

    def _fail(self, code: int, message: str) -> None:
        self._json(code, {"error": message})

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("request body too large")
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"malformed JSON: {exc}") from exc
        return parsed if isinstance(parsed, dict) else {}

    # -- verbs -------------------------------------------------------------
    def do_OPTIONS(self) -> None:                    # noqa: N802
        self.send_response(204)
        self.send_header("Allow", "GET, POST, HEAD, OPTIONS")
        self._cors()
        self.end_headers()

    def do_HEAD(self) -> None:                       # noqa: N802
        self.do_GET()

    def do_GET(self) -> None:                        # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self.api_get(path)
        return self.static(path)

    def do_POST(self) -> None:                       # noqa: N802
        path = urlparse(self.path).path
        try:
            body = self._body()
        except ValueError as exc:
            return self._fail(400, str(exc))

        if path == "/api/fetch":
            return self.start_fetch(body)
        match = re.fullmatch(r"/api/jobs/([\w-]+)/cancel", path)
        if match:
            job = JOBS.get(match.group(1))
            if not job:
                return self._fail(404, "no such job")
            job.cancel = True
            return self._json(200, {"ok": True, "id": job.id})
        return self._fail(404, "unknown endpoint")

    # -- API ---------------------------------------------------------------
    def api_get(self, path: str) -> None:
        if path == "/api/health":
            return self._json(200, self.health())
        if path == "/api/config":
            return self._json(200, self.config())

        match = re.fullmatch(r"/api/jobs/([\w-]+)", path)
        if match:
            job = JOBS.get(match.group(1))
            return self._json(200, job.status()) if job else self._fail(404, "no such job")

        match = re.fullmatch(r"/api/jobs/([\w-]+)/data", path)
        if match:
            job = JOBS.get(match.group(1))
            if not job:
                return self._fail(404, "no such job")
            if job.state != "done" or not job.payload:
                return self._fail(409, f"job is {job.state}")
            return self._send(200, json.dumps(job.payload).encode(),
                              "application/json; charset=utf-8", {"Cache-Control": "no-store"})

        return self._fail(404, "unknown endpoint")

    def health(self) -> dict:
        info: dict[str, Any] = {"ok": True, "version": self.server_version}
        for module in ("yfinance", "pandas", "requests"):
            try:
                info[module] = __import__(module).__version__
            except Exception as exc:  # noqa: BLE001
                info[module] = None
                info.setdefault("missing", []).append(f"{module}: {exc}")
        info["ready"] = bool(info.get("yfinance") and info.get("pandas"))
        if not info["ready"]:
            info["hint"] = "pip install -r tools/requirements.txt"
        caches = sorted(CACHE_DIR.glob("*.json")) if CACHE_DIR.exists() else []
        info["cache"] = {"entries": len(caches),
                         "bytes": sum(p.stat().st_size for p in caches)}
        info["snapshot"] = vti.DEFAULT_SNAPSHOT.exists()
        with JOBS_LOCK:
            info["jobs"] = {"running": sum(1 for j in JOBS.values() if j.state == "running"),
                            "total": len(JOBS)}
        return info

    def config(self) -> dict:
        d = self.defaults
        return {
            "sessions": d.sessions, "top": d.default_top, "index": d.index,
            "minPrice": d.min_price, "minTurnover": d.min_turnover,
            "minMarketCap": d.min_market_cap, "chunkSize": d.chunk_size, "sleep": d.sleep,
            "sources": sorted(vti.SOURCES),
            "universes": ["auto", "vanguard", "github", "snapshot"],
            "publishedHoldings": vti.VTI_PUBLISHED_HOLDINGS,
        }

    def start_fetch(self, body: dict) -> None:
        reap_jobs()
        with JOBS_LOCK:
            running = [j for j in JOBS.values() if j.state in ("queued", "running")]
        if running:
            return self._fail(409, f"a build is already running (job {running[0].id})")

        args = options_from_request(body, self.defaults)
        job = Job(id=uuid.uuid4().hex[:12], params=body, state="running")
        with JOBS_LOCK:
            JOBS[job.id] = job
        thread = threading.Thread(target=run_job, args=(job, args, bool(body.get("saveCsv"))),
                                  name=f"build-{job.id}", daemon=True)
        thread.start()
        LOG.info("job %s started — universe=%s top=%s sessions=%s",
                 job.id, args.universe, args.top or "all", args.sessions)
        self._json(202, {"id": job.id, "state": job.state,
                         "options": {"universe": args.universe, "source": args.source,
                                     "sessions": args.sessions, "top": args.top,
                                     "index": args.index, "period": args.period}})

    # -- static files ------------------------------------------------------
    def static(self, path: str) -> None:
        if path == "/favicon.ico":
            # Browsers ask unprompted; a 403 here is just console noise.
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/app/index.html")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        try:
            target = (ROOT / path.lstrip("/")).resolve()
            rel = target.relative_to(ROOT)                 # no escaping the repo
        except (ValueError, OSError):
            return self._fail(403, "forbidden")
        if not rel.parts or rel.parts[0] not in SERVE_DIRS:
            return self._fail(403, "forbidden")
        if not target.is_file():
            return self._fail(404, "not found")

        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype, {"Cache-Control": "no-cache"})


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1",
                        help="interface to bind (default: 127.0.0.1, i.e. this machine only)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="open the app in a browser")
    parser.add_argument("--default-top", type=int, default=0,
                        help="prefill the symbol cap in the form (0 = the whole universe)")
    parser.add_argument("--sessions", type=int, default=252)
    parser.add_argument("--index", default="SPY")
    parser.add_argument("--min-price", type=float, default=5.0)
    parser.add_argument("--min-turnover", type=float, default=5.0)
    parser.add_argument("--min-market-cap", type=float, default=vti.DEFAULT_MIN_MARKET_CAP)
    parser.add_argument("--min-sessions", type=int, default=130)
    parser.add_argument("--chunk-size", type=int, default=100)
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser


def cli_defaults(args: argparse.Namespace) -> argparse.Namespace:
    """The CLI Namespace every request starts from."""
    base = vti.build_parser().parse_args([])
    for name in ("sessions", "index", "min_price", "min_turnover", "min_market_cap",
                 "min_sessions", "chunk_size", "sleep"):
        setattr(base, name, getattr(args, name))
    base.default_top = max(0, args.default_top)
    return base


def serve(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(message)s", stream=sys.stderr)

    if args.host not in ("127.0.0.1", "localhost", "::1") and not os.environ.get("QM_ALLOW_PUBLIC"):
        LOG.error("refusing to bind %s: this server runs builds on demand and is meant for "
                  "one machine. Set QM_ALLOW_PUBLIC=1 if you really mean it.", args.host)
        return 2

    Handler.defaults = cli_defaults(args)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/app/index.html"

    try:
        import yfinance  # noqa: F401
        ready = "yfinance ready"
    except Exception as exc:  # noqa: BLE001
        ready = f"yfinance NOT importable ({exc}) — pip install -r tools/requirements.txt"

    print(f"\n  Momentum screener backend\n  {url}\n  {ready}\n"
          f"  Ctrl-C to stop\n", file=sys.stderr)
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("", file=sys.stderr)
        LOG.info("stopping")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(serve())
