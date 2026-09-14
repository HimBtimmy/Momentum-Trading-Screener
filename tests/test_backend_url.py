"""Does the Backend URL field need filling in? Test every way of opening the page.

The answer the page is supposed to give: leave it blank. Served from the backend
it resolves same-origin; opened from disk it falls back to the default port. The
field only exists for a backend moved off 8765. This test pins that behaviour so
the on-screen hint and the code cannot drift apart.
"""
import socket
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

# The real default port, so this mirrors what the user actually runs. If
# something is already listening there we cannot test the blank-field default.
PORT = 8765
probe_sock = socket.socket()
if probe_sock.connect_ex(("127.0.0.1", PORT)) == 0:
    probe_sock.close()
    _harness.skip(f"port {PORT} is already in use — stop the other server and re-run")
probe_sock.close()

proc = subprocess.Popen([sys.executable, str(_harness.TESTS / "stub_server.py"),
                         "--port", str(PORT),
                         "--cache-dir", str(_harness.tmpdir("url-cache", fresh=True))],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

SERVED = f"http://127.0.0.1:{PORT}/app/index.html"
FROM_DISK = _harness.file_url(_harness.APP / "index.html")

try:
    with sync_playwright() as pw:
        b = _harness.launch_chromium(pw)

        def probe(url, paste, label, expect_up):
            pg = b.new_page(viewport={"width": 1200, "height": 900})
            pg.goto(url)
            pg.wait_for_timeout(2200)
            pg.click("#tab-backend")
            pg.wait_for_timeout(400)
            if paste is not None:
                pg.fill("#be-url", paste)
                pg.dispatch_event("#be-url", "change")
                pg.wait_for_timeout(1200)
            else:
                pg.wait_for_timeout(900)
            cls = (pg.locator("#be-status").get_attribute("class") or "").split()
            txt = (pg.locator("#be-status").text_content() or "").strip()
            up = "up" in cls
            pg.close()
            check(f"{label} -> {'up' if expect_up else 'down'}", up == expect_up, txt[:70])

        print("\nOpened from the server (same-origin)")
        probe(SERVED, None, "blank field resolves same-origin", True)
        probe(SERVED, f"http://127.0.0.1:{PORT}", "pasted in full", True)
        probe(SERVED, f"http://localhost:{PORT}", "pasted as localhost", True)
        probe(SERVED, f"http://127.0.0.1:{PORT}/", "pasted with a trailing slash", True)
        probe(SERVED, f"http://127.0.0.1:{PORT}/api", "pasted with /api, which is wrong", False)

        print("\nOpened from disk (file://, cross-origin)")
        probe(FROM_DISK, None, "blank field falls back to the default port", True)
        probe(FROM_DISK, f"http://127.0.0.1:{PORT}", "pasted in full", True)
        probe(FROM_DISK, "http://127.0.0.1:9999", "pasted with the wrong port", False)

        b.close()
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()

check.finish("ALL BACKEND-URL CHECKS PASSED")
