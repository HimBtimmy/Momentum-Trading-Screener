"""Offline end-to-end test for tools/server.py.

The price vendor is replaced by tests/stub_yfinance.py, which returns a frame
shaped exactly the way `yf.download(..., group_by="ticker")` shapes one.
Everything else — the batching, the MultiIndex unpacking, the bar validation,
the quality gates, the job lifecycle, the HTTP layer — is the real code.
"""
import json
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _harness                                     # noqa: E402

_harness.need("pandas", "pip install -r tools/requirements.txt")

import stub_yfinance                                # noqa: E402

VENDOR = stub_yfinance.install(illiquid=["LOWV"])

_harness.on_path()
import fetch_vti_universe as vti                    # noqa: E402
import server                                       # noqa: E402

ROOT = str(_harness.ROOT)
check = _harness.Checks()
TMP = _harness.tmpdir("backend", fresh=True)

# a small, fixed universe file so the test never touches the network
UNI = TMP / "mini-constituents.csv"
UNI.write_text(
    "symbol,name,exchange_or_type,market_cap,weight_pct\n"
    "AAPL,Apple Inc.,nasdaq,3400000000000,5.6\n"
    "MSFT,\"Microsoft Corp., Class A\",nasdaq,3100000000000,4.2\n"
    "NVDA,NVIDIA Corp,nasdaq,2900000000000,6.1\n"
    "TSLA,Tesla Inc,nasdaq,900000000000,1.5\n"
    "LOWV,Tiny Illiquid Co,amex,50000000,0.001\n"
)

# ------------------------------------------------------------ the server
PORT = _harness.free_port()
BASE = f"http://127.0.0.1:{PORT}"
args = server.build_parser().parse_args(["--port", str(PORT), "--sessions", "252"])
server.Handler.defaults = server.cli_defaults(args)
server.Handler.defaults.constituents_file = UNI
server.CACHE_DIR = TMP / "cache"          # never the repository's data/cache
shutil.rmtree(server.CACHE_DIR, ignore_errors=True)

from http.server import ThreadingHTTPServer        # noqa: E402

httpd = ThreadingHTTPServer(("127.0.0.1", PORT), server.Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
time.sleep(0.3)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


RAW = urllib.request.build_opener(NoRedirect)


def get(path, expect=200):
    req = urllib.request.Request(BASE + path, headers={"Accept-Encoding": "gzip"})
    try:
        with RAW.open(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                import gzip
                raw = gzip.decompress(raw)
            return r.status, raw, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def post(path, obj=None):
    body = json.dumps(obj or {}).encode()
    req = urllib.request.Request(BASE + path, data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


print("\n1. health and config")
code, raw, _ = get("/api/health")
health = json.loads(raw)
check("health 200", code == 200, str(code))
check("reports yfinance importable", health.get("ready") is True, json.dumps(health.get("missing", "")))
check("reports the committed snapshot", health.get("snapshot") is True)
code, raw, _ = get("/api/config")
cfg = json.loads(raw)
check("config lists universes", "snapshot" in cfg["universes"] and "yfinance" in cfg["sources"], str(cfg))

print("\n2. static files")
code, _, hdrs = get("/", expect=302)
check("/ redirects into the app", code == 302 and hdrs.get("Location") == "/app/index.html",
      f"{code} {hdrs.get('Location')}")
code, raw, _ = get("/app/engine.js")
check("serves engine.js", code == 200 and b"QM" in raw, str(code))
code, _, _ = get("/tools/server.py")
check("refuses to serve tools/", code == 403, str(code))
code, _, _ = get("/../../etc/passwd")
check("refuses traversal", code in (403, 404), str(code))
code, _, _ = get("/app/../../etc/passwd")
check("refuses encoded traversal", code in (403, 404), str(code))

print("\n3. a build, end to end")
req = {"universe": "snapshot", "source": "yfinance", "sessions": 252, "top": 0,
       "minPrice": 5, "minTurnover": 5, "chunkSize": 2, "sleep": 0}
code, started = post("/api/fetch", req)
check("fetch accepted", code == 202 and "id" in started, json.dumps(started))
job_id = started["id"]
# 252 sessions needs a year of calendar plus slack for holidays; 2y is the ask.
check("period covers the sessions asked for", started["options"]["period"] == "2y",
      started["options"]["period"])

phases, status = set(), {}
for _ in range(300):
    code, raw, _ = get(f"/api/jobs/{job_id}")
    status = json.loads(raw)
    phases.add(status.get("phase"))
    if status["state"] in ("done", "error", "cancelled"):
        break
    time.sleep(0.1)
check("job finished", status.get("state") == "done", json.dumps(status)[:300])
check("phases reported are all known",
      phases <= {"starting", "universe", "prices", "validate", "packing"}, str(sorted(phases)))
check("batched by chunk size", VENDOR.batches == 3, f"{VENDOR.batches} batches")
check("index proxy requested", "SPY" in VENDOR.tickers, str(VENDOR.tickers))
check("adjusted prices by default", VENDOR.kwargs["auto_adjust"] is True, str(VENDOR.kwargs))

code, raw, hdrs = get(f"/api/jobs/{job_id}/data")
data = json.loads(raw)
check("data 200", code == 200, str(code))
check("gzip on the wire", hdrs.get("Content-Encoding") == "gzip", str(hdrs.get("Content-Encoding")))
syms = {s["symbol"] for s in data["symbols"]}
check("liquid names kept", {"AAPL", "MSFT", "NVDA", "TSLA"} <= syms, str(sorted(syms)))
check("illiquid name dropped by the gates", "LOWV" not in syms, str(sorted(syms)))
check("drop reason recorded", "turnover" in data["provenance"]["dropped"].get("LOWV", ""),
      json.dumps(data["provenance"]["dropped"]))
check("index served separately", data["index"] and data["index"]["symbol"] == "SPY"
      and "SPY" not in syms, str(data["index"] and data["index"]["symbol"]))
first = data["symbols"][0]
check("252 sessions per symbol", all(len(s["bars"]) == 252 for s in data["symbols"]),
      str({s["symbol"]: len(s["bars"]) for s in data["symbols"]}))
check("bars are compact arrays", isinstance(first["bars"][0], list) and len(first["bars"][0]) == 6,
      str(first["bars"][0]))
check("bars ascend by date", all(a[0] < b[0] for a, b in zip(first["bars"], first["bars"][1:])))
check("OHLC is coherent",
      all(b[2] >= max(b[1], b[4]) and b[3] <= min(b[1], b[4]) for b in first["bars"]))
check("market cap carried through",
      next(s for s in data["symbols"] if s["symbol"] == "AAPL")["marketCap"] == 3400000000000)
check("company name carried through, comma and all",
      next(s for s in data["symbols"] if s["symbol"] == "MSFT")["name"] == "Microsoft Corp., Class A")
check("asOf is the last session", data["asOf"] == first["bars"][-1][0], data["asOf"])
check("provenance names the source",
      data["provenance"]["universe_source"] == "constituents-snapshot"
      and data["provenance"]["price_source"] == "yfinance", json.dumps(data["provenance"])[:200])

print("\n3b. progress and cancellation, called directly")
# Polling a build that finishes in 100ms cannot reliably sample every phase, so
# the callback contract is asserted against the pipeline itself.
snapshot = (VENDOR.batches, list(VENDOR.tickers))
seen = []
recorded = server.options_from_request(
    {"universe": "snapshot", "sessions": 252, "chunkSize": 2, "sleep": 0},
    server.Handler.defaults)
vti.build_dataset(recorded, lambda ph, d, t, m="": seen.append((ph, d, t)))
check("every phase reports progress",
      {"universe", "prices", "validate"} <= {p for p, _, _ in seen},
      str(sorted({p for p, _, _ in seen})))
check("download progress is monotonic and bounded",
      all(0 <= d <= t for p, d, t in seen if p == "prices" and t)
      and [d for p, d, _ in seen if p == "prices"] == sorted(d for p, d, _ in seen if p == "prices"),
      str([(p, d, t) for p, d, t in seen if p == "prices"]))

def cancel_on_prices(phase, done, total, message=""):
    if phase == "prices":
        raise vti.Cancelled()
try:
    vti.build_dataset(recorded, cancel_on_prices)
    check("Cancelled propagates out of the pipeline", False, "no exception raised")
except vti.Cancelled:
    check("Cancelled propagates out of the pipeline", True)

def boom(phase, done, total, message=""):
    raise RuntimeError("reporting is broken")
try:
    vti.build_dataset(recorded, boom)
    check("a broken progress callback does not kill the build", True)
except Exception as exc:
    check("a broken progress callback does not kill the build", False, repr(exc))
VENDOR.batches, VENDOR.tickers = snapshot   # the direct calls are not HTTP traffic

print("\n4. caching and concurrency")
batches_before = VENDOR.batches
code, again = post("/api/fetch", req)
job2 = again["id"]
for _ in range(100):
    code, raw, _ = get(f"/api/jobs/{job2}")
    st2 = json.loads(raw)
    if st2["state"] in ("done", "error"):
        break
    time.sleep(0.05)
check("second identical build is cached", st2["state"] == "done" and st2["cached"] is True,
      json.dumps(st2)[:200])
check("cache means no new downloads", VENDOR.batches == batches_before,
      f"{batches_before} -> {VENDOR.batches}")

# slow the vendor down so the collision is deterministic rather than a race
VENDOR.delay = 0.5
code, fresh = post("/api/fetch", dict(req, refresh=True, top=2, chunkSize=1))
check("refresh starts a real build", code == 202, json.dumps(fresh))
code, busy = post("/api/fetch", req)
check("a second concurrent build is refused", code == 409, json.dumps(busy))
VENDOR.delay = 0.0
for _ in range(200):
    code, raw, _ = get(f"/api/jobs/{fresh['id']}")
    if json.loads(raw)["state"] in ("done", "error", "cancelled"): break
    time.sleep(0.05)

print("\n5. cancelling")
VENDOR.delay = 0.6
code, slow = post("/api/fetch", dict(req, refresh=True, chunkSize=1))
time.sleep(0.5)
code, cancelled = post(f"/api/jobs/{slow['id']}/cancel")
check("cancel accepted", code == 200, json.dumps(cancelled))
for _ in range(200):
    code, raw, _ = get(f"/api/jobs/{slow['id']}")
    st3 = json.loads(raw)
    if st3["state"] in ("done", "error", "cancelled"): break
    time.sleep(0.1)
check("job reports cancelled", st3["state"] == "cancelled", json.dumps(st3)[:200])
code, _, _ = get(f"/api/jobs/{slow['id']}/data")
check("cancelled job has no data", code == 409, str(code))
VENDOR.delay = 0.0

print("\n6. bad input is clamped, not fatal")
code, weird = post("/api/fetch", {"universe": "../etc", "sessions": "abc", "top": -5,
                                  "index": "'; DROP TABLE", "source": "nonsense",
                                  "refresh": True, "chunkSize": 50, "sleep": 0})
check("nonsense request still starts", code == 202, json.dumps(weird))
opts = weird.get("options", {})
check("universe falls back to auto", opts.get("universe") == "auto", str(opts))
check("source falls back to yfinance", opts.get("source") == "yfinance", str(opts))
check("sessions falls back to the default", opts.get("sessions") == 252, str(opts))
check("index falls back to SPY", opts.get("index") == "SPY", str(opts))
code, _ = post("/api/jobs/nope/cancel")
check("unknown job 404s", code == 404, str(code))
code, raw, _ = get("/api/jobs/nope")
check("unknown job status 404s", code == 404, str(code))

# that last one ran with universe=auto, which needs the network: let it fail
for _ in range(100):
    code, raw, _ = get(f"/api/jobs/{weird['id']}")
    if json.loads(raw)["state"] in ("done", "error", "cancelled"): break
    time.sleep(0.1)

print("\n6b. fundamentals for the Minervini screen")
stack = vti.ma_stack_symbols(
    [b for b in vti.build_dataset(recorded).rows])
check("the MA-stack prescreen returns a subset, not everything",
      isinstance(stack, list) and len(stack) <= 6, str(stack))

funds = vti.fetch_fundamentals(["AAPL", "SHRINK", "NODATA"])
check("growth is read from the quarterly statement",
      round(funds["AAPL"]["sales_yoy"]) == 25 and round(funds["AAPL"]["eps_yoy"]) == 25,
      json.dumps(funds.get("AAPL")))
check("the reported quarter comes back", funds["AAPL"]["quarter"] == "2026-06-30",
      funds["AAPL"]["quarter"])
check("a shrinking quarter reports negative growth",
      round(funds["SHRINK"]["sales_yoy"]) == -20, json.dumps(funds.get("SHRINK")))
check("a ticker with no statement is skipped, not faked", "NODATA" not in funds, str(list(funds)))

VENDOR.fundamentals = []
code, fjob = post("/api/fetch", dict(req, refresh=True, fundamentals=True, top=4))
for _ in range(300):
    code, raw, _ = get(f"/api/jobs/{fjob['id']}")
    st4 = json.loads(raw)
    if st4["state"] in ("done", "error", "cancelled"): break
    time.sleep(0.1)
check("a build with fundamentals completes", st4["state"] == "done", json.dumps(st4)[:200])
code, raw, _ = get(f"/api/jobs/{fjob['id']}/data")
fdata = json.loads(raw)
withf = [s for s in fdata["symbols"] if s.get("fundamentals")]
check("fundamentals ride along with the bars", len(withf) > 0,
      json.dumps(withf[0]["fundamentals"]) if withf else "none")
check("only MA-stack names were asked for",
      len(VENDOR.fundamentals) <= len(fdata["symbols"]) + 1,
      f"{len(VENDOR.fundamentals)} requests for {len(fdata['symbols'])} symbols")
check("provenance counts them", fdata["provenance"].get("fundamentals") == len(withf),
      str(fdata["provenance"].get("fundamentals")))
check("a fundamentals build caches separately from one without",
      server.cache_key(server.options_from_request({"universe": "snapshot", "fundamentals": True},
                                                   server.Handler.defaults))
      != server.cache_key(server.options_from_request({"universe": "snapshot"},
                                                      server.Handler.defaults)))

print("\n7. the payload feeds the engine")
payload_path = str(TMP / "payload.json")
json.dump(data, open(payload_path, "w"))
import subprocess
node = subprocess.run(["node", "-e", f"""
global.window = {{}};
const QM = require('{ROOT}/app/engine.js');
const data = require('{payload_path}');
const uni = data.symbols.map(s => ({{
  symbol: s.symbol, name: s.name, marketCap: s.marketCap,
  bars: s.bars.map(b => ({{date:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}}))
}}));
const idx = data.index.bars.map(b => ({{date:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}}));
const res = QM.screen(uni, {{indexBars: idx, accountEquity: 100000, riskPctPerTrade: 0.5}});
console.log(JSON.stringify({{n: res.results.length, regime: !!res.regime,
  hasFeatures: res.results.every(r => r.f && isFinite(r.f.adr)),
  bothScreens: res.results.every(r => !r.f || (r.mm && r.mm.quality))}}));
"""], capture_output=True, text=True)
try:
    out = json.loads(node.stdout.strip().splitlines()[-1])
except Exception:
    out = {}
    print(node.stdout[-800:], node.stderr[-800:])
check("engine screens the backend payload", out.get("n") == len(data["symbols"]), str(out))
check("engine computed features from it", out.get("hasFeatures") is True, str(out))
check("regime read from the index bars", out.get("regime") is True, str(out))
check("both screeners ran on the backend payload", out.get("bothScreens") is True, str(out))

httpd.shutdown()
check.finish("ALL BACKEND CHECKS PASSED")
