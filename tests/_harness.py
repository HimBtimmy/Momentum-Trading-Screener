"""Shared plumbing for the test suite.

Every test is a plain script: it prints a PASS/FAIL line per assertion and exits
non-zero if any failed. There is no test framework to install. What lives here
is the handful of things they all need — where the repository is, a scratch
directory, a tally, and a Chromium launcher that *skips* rather than fails when
no browser is installed, so a contributor without Playwright still gets a useful
run out of the rest of the suite.
"""
from __future__ import annotations

import glob
import os
import shutil
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
APP = ROOT / "app"
TESTS = Path(__file__).resolve().parent
TMP = TESTS / ".tmp"

SKIP = 77          # exit code the runner reads as "skipped", not "failed"


def tmpdir(name: str, fresh: bool = False) -> Path:
    """A scratch directory under tests/.tmp/, which is gitignored."""
    d = TMP / name
    if fresh:
        shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)
    return d


def on_path() -> None:
    """Make `import server` / `import fetch_vti_universe` work."""
    if str(TOOLS) not in sys.path:
        sys.path.insert(0, str(TOOLS))


def file_url(path) -> str:
    return Path(path).resolve().as_uri()


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Checks:
    """Tally of assertions. Call it to assert; call .finish() to exit."""

    def __init__(self) -> None:
        self.failed: list[str] = []
        self.passed = 0

    def __call__(self, name: str, cond, detail: str = "") -> bool:
        ok = bool(cond)
        print(("  PASS  " if ok else "  FAIL  ") + name + (f"   {detail}" if detail else ""))
        if ok:
            self.passed += 1
        else:
            self.failed.append(name)
        return ok

    def finish(self, banner: str = "ALL CHECKS PASSED") -> None:
        if self.failed:
            print(f"\n{len(self.failed)} FAILURES: {self.failed}")
            sys.exit(1)
        print(f"\n{banner} ({self.passed} checks)")
        sys.exit(0)


def skip(reason: str) -> None:
    """Bail out of a test that cannot run here. Not a failure."""
    print(f"  SKIP  {reason}")
    sys.exit(SKIP)


def need(module: str, hint: str) -> None:
    try:
        __import__(module)
    except ImportError:
        skip(f"{module} is not installed — {hint}")


# Chromium search paths, in preference order. The first entry is whatever
# Playwright installed for itself; the rest cover a preinstalled browser.
_CHROME_GLOBS = (
    "/opt/pw-browsers/chromium-*/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)


def launch_chromium(pw, **kw):
    """Launch Chromium however this machine has one, or skip the test."""
    args = list(kw.pop("args", []))
    if getattr(os, "geteuid", lambda: 1)() == 0 and "--no-sandbox" not in args:
        args.append("--no-sandbox")     # Chromium refuses to run as root otherwise
    try:
        return pw.chromium.launch(args=args, **kw)
    except Exception as first:
        for pattern in _CHROME_GLOBS:
            hits = sorted(glob.glob(pattern))
            if hits:
                return pw.chromium.launch(executable_path=hits[-1], args=args, **kw)
        skip(f"no Chromium available ({type(first).__name__}) — run: playwright install chromium")
