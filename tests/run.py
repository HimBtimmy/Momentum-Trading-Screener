#!/usr/bin/env python3
"""Run the whole test suite.

    python3 tests/run.py              # everything
    python3 tests/run.py --quick      # skip the browser tests (a few seconds)
    python3 tests/run.py -v           # stream each test's own output
    python3 tests/run.py test_fetch   # just the ones whose name matches

A test that cannot run here — no Playwright, no browser, no pandas — reports
SKIP and does not fail the run. A test that runs and fails does.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _harness                                     # noqa: E402

# name, command, needs-a-browser
SUITE = [
    ("test_fetch",      [sys.executable, "test_fetch.py"],       False),
    ("test_engine_mm",  ["node", "test_engine_mm.js"],           False),
    ("test_backend",    [sys.executable, "test_backend.py"],     False),
    ("test_ui",         [sys.executable, "test_ui.py"],          True),
    ("test_ui_tooltip", [sys.executable, "test_ui_tooltip.py"],  True),
    ("test_ui_backend", [sys.executable, "test_ui_backend.py"],  True),
    ("test_backend_url", [sys.executable, "test_backend_url.py"], True),
]

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
COLOUR = {PASS: "\033[32m", FAIL: "\033[31m", SKIP: "\033[33m"}


def paint(word: str, tty: bool) -> str:
    return f"{COLOUR[word]}{word}\033[0m" if tty else word


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Run the momentum screener test suite.")
    ap.add_argument("match", nargs="*", help="only run tests whose name contains this")
    ap.add_argument("--quick", action="store_true", help="skip the browser tests")
    ap.add_argument("-v", "--verbose", action="store_true", help="stream each test's output")
    args = ap.parse_args(argv)

    tty = sys.stdout.isatty()
    chosen = [t for t in SUITE
              if (not args.match or any(m in t[0] for m in args.match))
              and not (args.quick and t[2])]
    if not chosen:
        print("nothing matched")
        return 1

    results, started = [], time.time()
    for name, cmd, _browser in chosen:
        if cmd[0] == "node" and not shutil.which("node"):
            results.append((name, SKIP, 0.0, "node is not installed"))
            print(f"{paint(SKIP, tty)}  {name:<17}   0.0s  node is not installed")
            continue

        t0 = time.time()
        if tty and not args.verbose:
            print(f"....  {name}", end="", flush=True)     # overwritten by the verdict
        proc = subprocess.run(cmd, cwd=_harness.TESTS,
                              capture_output=not args.verbose, text=True)
        secs = time.time() - t0
        out = "" if args.verbose else (proc.stdout or "") + (proc.stderr or "")

        if proc.returncode == 0:
            verdict, note = PASS, last_line(out, "checks")
        elif proc.returncode == _harness.SKIP:
            verdict, note = SKIP, last_line(out, "SKIP").replace("SKIP", "").strip()
        else:
            verdict, note = FAIL, last_line(out, "FAILURES")

        results.append((name, verdict, secs, note))
        erase = "\r\033[2K" if tty and not args.verbose else ""
        print(f"{erase}{paint(verdict, tty)}  {name:<17} {secs:5.1f}s  {note}")
        if verdict == FAIL and not args.verbose:
            print(indent(out))

    failed = [r for r in results if r[1] == FAIL]
    skipped = [r for r in results if r[1] == SKIP]
    print(f"\n{len(results) - len(failed) - len(skipped)} passed, "
          f"{len(failed)} failed, {len(skipped)} skipped "
          f"in {time.time() - started:.1f}s")
    return 1 if failed else 0


def last_line(out: str, needle: str) -> str:
    """The test's own summary line, for the one-line-per-test report."""
    hits = [l.strip() for l in out.splitlines() if needle in l]
    return hits[-1][:100] if hits else ""


def indent(out: str) -> str:
    tail = out.strip().splitlines()[-40:]
    return "\n".join("    | " + l for l in tail) + "\n"


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
