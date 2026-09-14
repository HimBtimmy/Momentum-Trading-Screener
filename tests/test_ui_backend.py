"""Drive the Backend tab in a real browser against a real server (stubbed vendor).

This is the one test that exercises the whole chain the user actually runs:
browser -> tools/server.py -> fetch_vti_universe -> engine -> rendered results.
"""
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _harness                                     # noqa: E402

_harness.need("playwright", "pip install playwright && playwright install chromium")
_harness.need("pandas", "pip install -r tools/requirements.txt")
from playwright.sync_api import sync_playwright     # noqa: E402

check = _harness.Checks()
CACHE = _harness.tmpdir("be-cache", fresh=True)

PORT = _harness.free_port()
proc = subprocess.Popen([sys.executable, str(_harness.TESTS / "stub_server.py"),
                         "--port", str(PORT), "--cache-dir", str(CACHE)],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
time.sleep(1.5)
URL = f"http://127.0.0.1:{PORT}/app/index.html"

try:
    with sync_playwright() as pw:
        b = _harness.launch_chromium(pw)
        pg = b.new_page(viewport={"width": 1400, "height": 1000})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append("console." + m.type + ": " + m.text)
                 if m.type == "error" and "net::" not in m.text else None)
        # Name the URL behind a bad response; "Failed to load resource" alone
        # is not enough to act on.
        pg.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}")
                 if r.status >= 400 else None)
        pg.goto(URL); pg.wait_for_timeout(2500)

        print("\n1. the page is served by the backend")
        check("app loaded over http", pg.url.startswith("http://127.0.0.1"), pg.url)
        check("demo still renders first", pg.locator("article.card").count() > 0)

        print("\n2. backend detection")
        pg.click("#tab-backend"); pg.wait_for_timeout(800)
        status = pg.locator("#be-status")
        check("status says the backend is up", "up" in (status.get_attribute("class") or ""),
              (status.text_content() or "").strip()[:120])
        check("status names the vendor version", "yfinance" in (status.text_content() or ""),
              (status.text_content() or "").strip()[:120])
        check("fetch button enabled", not pg.locator("#be-fetch").is_disabled())

        print("\n3. a real fetch, end to end")
        pg.select_option("#be-universe", "snapshot")
        pg.fill("#be-top", "6")
        pg.fill("#be-sessions", "252")
        pg.click("#be-fetch")
        pg.wait_for_selector("#be-progress:not([hidden])", timeout=5000)
        check("progress bar appears", pg.locator("#be-progress").is_visible())
        check("cancel offered while running", pg.locator("#be-cancel").is_visible())
        pg.wait_for_selector("#be-msg:not([hidden])", timeout=90000)
        pg.wait_for_timeout(1200)
        msg = (pg.locator("#be-msg").text_content() or "").strip()
        check("reports what it loaded", msg.startswith("Loaded") and "symbols" in msg, msg)
        check("nothing is dropped when every name clears the gates",
              "dropped before screening" not in msg, msg)
        check("progress hidden again", not pg.locator("#be-progress").is_visible())

        prov = (pg.locator("#provenance").text_content() or "").strip()
        check("provenance switches to live data", prov.startswith("Live data"), prov[:150])
        check("provenance names the universe source", "constituents-snapshot" in prov, prov[:200])
        check("provenance reports adjustment", "adjusted" in prov, prov[:200])
        check("regime filter picked up the index", "regime filter is off" not in prov, prov[:200])

        summary = pg.locator("#summary .stat").all_text_contents()
        check("summary strip counts the new universe", any("6" in t for t in summary), str(summary))
        check("engine ran on backend data", pg.locator("article.card").count() > 0
              or "Nothing qualifies" in (pg.locator("#results").text_content() or ""),
              (pg.locator("#results").text_content() or "")[:80])

        print("\n3b. why names get dropped")
        # Raise the turnover floor so some of the universe fails it, and check the
        # message names the reason instead of calling every drop "liquidity".
        pg.click("#tab-settings"); pg.wait_for_timeout(300)
        pg.fill("#mindv", "150")
        pg.dispatch_event("#mindv", "change")
        pg.wait_for_timeout(400)
        pg.click("#tab-backend"); pg.wait_for_timeout(300)
        pg.click("#be-fetch")
        pg.wait_for_selector("#be-progress:not([hidden])", timeout=5000)
        for _ in range(300):
            m = (pg.locator("#be-msg").text_content() or "")
            if m.startswith("Loaded"): break
            pg.wait_for_timeout(100)
        msg2 = (pg.locator("#be-msg").text_content() or "").strip()
        check("a higher turnover floor drops names", "dropped before screening" in msg2, msg2)
        check("and the reason is named, not called 'liquidity'",
              "turnover floor" in msg2 and "liquidity gates" not in msg2, msg2)
        # put it back so the later sections screen the same universe as before
        pg.click("#tab-settings"); pg.wait_for_timeout(200)
        pg.fill("#mindv", "5"); pg.dispatch_event("#mindv", "change"); pg.wait_for_timeout(300)
        pg.click("#tab-backend"); pg.wait_for_timeout(200)

        print("\n4. the second fetch is served from cache")
        t0 = time.time()
        pg.click("#be-fetch")
        pg.wait_for_timeout(300)
        for _ in range(100):
            m = (pg.locator("#be-msg").text_content() or "")
            if "cache" in m: break
            pg.wait_for_timeout(100)
        elapsed = time.time() - t0
        check("cache hit reported", "cache" in (pg.locator("#be-msg").text_content() or ""),
              (pg.locator("#be-msg").text_content() or "")[:120])
        check("cache hit is fast", elapsed < 8, f"{elapsed:.1f}s")

        print("\n5. cancelling a run")
        # The stub is fast enough that a cancel can lose the race against a
        # build that has already finished. So this section talks to a second
        # server started with a per-batch stall and a chunk size of one, which
        # makes the run slow enough to cancel deterministically.
        slow_port = _harness.free_port()
        slow = subprocess.Popen([sys.executable, str(_harness.TESTS / "stub_server.py"),
                                 "--port", str(slow_port), "--chunk-size", "1",
                                 "--vendor-delay", "0.4",
                                 "--cache-dir", str(_harness.tmpdir("be-cache-slow", fresh=True))],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            time.sleep(1.5)
            pg.fill("#be-url", f"http://127.0.0.1:{slow_port}")
            pg.dispatch_event("#be-url", "change")
            pg.wait_for_timeout(1200)
            check("the slow backend is reachable",
                  "up" in (pg.locator("#be-status").get_attribute("class") or ""),
                  (pg.locator("#be-status").text_content() or "")[:90])
            pg.check("#be-refresh")
            pg.fill("#be-top", "40")
            pg.click("#be-fetch")
            pg.wait_for_selector("#be-progress:not([hidden])", timeout=8000)
            check("a long run is still running when we reach for cancel",
                  pg.locator("#be-cancel").is_visible())
            # Deliberately click the instant the button appears. That is a
            # moment before the server has handed back the job id, and an
            # early click used to be dropped on the floor in silence.
            pg.click("#be-cancel")
            for _ in range(150):
                if "Cancel" in (pg.locator("#be-msg").text_content() or ""):
                    break
                pg.wait_for_timeout(100)
            check("cancel reported to the user",
                  "Cancel" in (pg.locator("#be-msg").text_content() or ""),
                  (pg.locator("#be-msg").text_content() or "")[:120])
            check("controls restored after cancel",
                  not pg.locator("#be-fetch").is_disabled()
                  and not pg.locator("#be-cancel").is_visible())
        finally:
            slow.terminate()
            try:
                slow.wait(timeout=5)
            except Exception:
                slow.kill()

        print("\n6. a missing backend is explained, not silent")
        pg.fill("#be-url", f"http://127.0.0.1:{PORT + 1}")
        pg.dispatch_event("#be-url", "change")
        pg.wait_for_timeout(1200)
        txt = (pg.locator("#be-status").text_content() or "")
        check("offline backend reported", "down" in (pg.locator("#be-status").get_attribute("class") or ""),
              txt[:140])
        check("tells the user the command", "tools/server.py" in txt, txt[:200])
        check("fetch disabled with no backend", pg.locator("#be-fetch").is_disabled())

        check("no JS errors throughout", not errors, "; ".join(errors[:3]))
        b.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except Exception: proc.kill()

check.finish("ALL BACKEND-UI CHECKS PASSED")
