"""Run tools/server.py with the price vendor stubbed, so the UI can be driven offline.

Used as a subprocess by the browser tests. Takes every flag tools/server.py takes,
plus --cache-dir, so a test run never writes into the repository's data/cache.

    python3 tests/stub_server.py --port 8765 --cache-dir tests/.tmp/cache
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _harness                                     # noqa: E402
import stub_yfinance                                # noqa: E402

# Trending names, so the screeners actually find setups to render.
VENDOR = stub_yfinance.install(price_step=11, drift=0.0012, noise=0.045, wick=0.025,
                               vol_base=3_000_000, vol_span=2_000_000)

_harness.on_path()
import server                                       # noqa: E402


def _take(argv, flag):
    """Pull `--flag value` out of argv and return the value, or None."""
    if flag not in argv:
        return None
    i = argv.index(flag)
    value = argv[i + 1]
    del argv[i:i + 2]
    return value


argv = sys.argv[1:]

cache_dir = _take(argv, "--cache-dir")
if cache_dir:
    server.CACHE_DIR = pathlib.Path(cache_dir)

# Per-batch stall, so a test can reliably cancel a run mid-flight.
delay = _take(argv, "--vendor-delay")
if delay:
    VENDOR.delay = float(delay)

sys.exit(server.serve(argv))
