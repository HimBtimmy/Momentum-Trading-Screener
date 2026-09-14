"""The OHLCV tooltip must disappear when the cursor leaves the chart.

Regression guard: an author rule setting `display` on .qm-tip outranks the
browser's own [hidden] rule, which left the tooltip stuck on screen forever.
app/index.html carries a global `[hidden] { display: none !important }` for it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _harness                                     # noqa: E402

_harness.need("playwright", "pip install playwright && playwright install chromium")
from playwright.sync_api import sync_playwright     # noqa: E402

URL = _harness.file_url(_harness.APP / "index.html")
check = _harness.Checks()
TMP = _harness.tmpdir("ui")

with sync_playwright() as pw:
    b = _harness.launch_chromium(pw)
    pg = b.new_page(viewport={"width": 1300, "height": 1000})
    pg.goto(URL); pg.wait_for_timeout(2400)

    def tip_visible():
        return pg.evaluate("""() => {
            const t = document.querySelector('.qm-tip');
            if (!t) return false;
            return getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().width > 0;
        }""")
    def cross_visible():
        return pg.evaluate("""() => {
            const l = document.querySelector('.qm-cross');
            return !!l && l.style.display !== 'none';
        }""")

    chart = pg.locator("article.card .chart svg").first
    chart.scroll_into_view_if_needed()
    pg.wait_for_timeout(300)
    box = chart.bounding_box()

    print("\n1. hovering a chart")
    pg.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.4)
    pg.wait_for_timeout(300)
    check("tooltip appears on hover", tip_visible())
    check("crosshair appears on hover", cross_visible())

    print("\n2. moving the cursor off the chart")
    pg.mouse.move(20, 20)                      # the masthead, far from any chart
    pg.wait_for_timeout(400)
    check("tooltip disappears", not tip_visible())
    check("crosshair disappears", not cross_visible())

    print("\n3. the chart re-rendering under the cursor")
    chart.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
    box = chart.bounding_box()
    pg.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.4)
    pg.wait_for_timeout(250)
    check("tooltip back on hover", tip_visible())
    pg.locator("article.card button.pp[data-pivot='mm']").first.click()
    pg.wait_for_timeout(700)
    check("tooltip does not survive a re-render", not tip_visible())

    print("\n4. moving between two charts")
    charts = pg.locator("article.card .chart svg")
    if charts.count() > 1:
        charts.nth(0).scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        b1 = charts.nth(0).bounding_box()
        charts.nth(1).scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        b2 = charts.nth(1).bounding_box()
        b1 = charts.nth(0).bounding_box()
        pg.mouse.move(b1["x"] + 60, b1["y"] + 40); pg.wait_for_timeout(200)
        pg.mouse.move(b2["x"] + 60, b2["y"] + 40); pg.wait_for_timeout(250)
        check("only one tooltip exists", pg.locator(".qm-tip").count() == 1,
              str(pg.locator(".qm-tip").count()))
        check("tooltip still shown over the second chart", tip_visible())
        pg.mouse.move(20, 20); pg.wait_for_timeout(300)
        check("and hides after leaving that one too", not tip_visible())

    print("\n5. scrolling away while hovering")
    chart.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
    box = chart.bounding_box()
    pg.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.4)
    pg.wait_for_timeout(250)
    pg.mouse.wheel(0, 1400)
    pg.wait_for_timeout(500)
    check("tooltip is not left floating after a scroll", not tip_visible())

    b.close()

check.finish("ALL TOOLTIP CHECKS PASSED")
