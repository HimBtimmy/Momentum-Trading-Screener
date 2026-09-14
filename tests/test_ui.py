"""Drives the whole page in a real browser: cards, table, filters, sorting,
the two screener tabs, the pivot picker, and the chart tooltip."""
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
    pg = b.new_page(viewport={"width": 1400, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append("console." + m.type + ": " + m.text)
             if m.type == "error" and "net::" not in m.text else None)
    pg.goto(URL); pg.wait_for_timeout(2500)

    print("\n1. cards view")
    check("no JS errors on load", not errors, "; ".join(errors[:3]))
    check("cards rendered", pg.locator("article.card").count() > 0, str(pg.locator("article.card").count()))
    keys = pg.locator("article.card").first.locator(".metrics .k").all_text_contents()
    check("card shows Mkt cap / 1D / 5D / RS", all(k in keys for k in ["Mkt cap", "1D", "5D", "RS"]), str(keys))
    check("grade badge present", pg.locator("article.card .grade").count() > 0,
          pg.locator("article.card .grade").first.text_content() or "")
    check("trend template shown", pg.locator(".trendtpl .ttscore").count() > 0,
          pg.locator(".trendtpl .ttscore").first.text_content() or "")
    stop = pg.locator("article.card .plan .row.bad dd").first.text_content()
    check("hard stop rendered", stop.startswith("$"), stop)

    print("\n2. table view")
    pg.click("#view-table"); pg.wait_for_timeout(600)
    rows = pg.locator("table.results tbody tr")
    total = rows.count()
    check("table rows include rejects", total > 12, f"{total} rows")
    hdrs = [t.strip().rstrip("\u2195\u25b2\u25bc") for t in
            pg.locator("table.results thead th").all_text_contents()]
    check("RS column present", "RS" in hdrs, str(hdrs))
    check("four sortable headers", pg.locator("table.results thead th.sortable").count() == 4,
          str([t.strip() for t in pg.locator("table.results thead th.sortable").all_text_contents()]))
    check("filters + slicers present",
          pg.locator("#f-setup").count() and pg.locator("#f-status").count()
          and pg.locator("#f-score-min").count() and pg.locator("#f-rs-min").count())

    print("\n3. filtering")
    pg.select_option("#f-setup", "breakout"); pg.wait_for_timeout(400)
    after = pg.locator("table.results tbody tr").count()
    setups = set(pg.locator("table.results tbody tr td:nth-child(2)").all_text_contents())
    check("setup filter narrows to breakouts", setups == {"Breakout"}, str(setups))
    pg.select_option("#f-setup", ""); pg.wait_for_timeout(300)

    pg.select_option("#f-elig", "rejected"); pg.wait_for_timeout(400)
    elig = set(pg.locator("table.results tbody tr td:nth-child(4)").all_text_contents())
    check("eligibility filter works", elig == {"rejected"}, str(elig))
    pg.select_option("#f-elig", "all"); pg.wait_for_timeout(300)

    pg.eval_on_selector("#f-score-min", "el => { el.value = 70; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }")
    pg.wait_for_timeout(500)
    scores = [int(t) for t in pg.locator("table.results tbody tr td:nth-child(6)").all_text_contents() if t.strip().isdigit()]
    check("score slicer filters", scores and min(scores) >= 70, f"min={min(scores) if scores else 'n/a'}")
    check("slicer label updates", "70" in (pg.locator("#f-score-val").text_content() or ""),
          pg.locator("#f-score-val").text_content())

    pg.eval_on_selector("#f-score-min", "el => { el.value = 0; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }")
    pg.wait_for_timeout(400)
    pg.eval_on_selector("#f-rs-max", "el => { el.value = 60; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }")
    pg.wait_for_timeout(500)
    rs = [int(t) for t in pg.locator("table.results tbody tr td:nth-child(7)").all_text_contents() if t.strip().isdigit()]
    check("RS slicer filters", rs and max(rs) <= 60, f"max={max(rs) if rs else 'n/a'}")
    pg.eval_on_selector("#f-rs-max", "el => { el.value = 99; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }")
    pg.wait_for_timeout(400)

    chips = pg.locator("#f-status .chip")
    check("status chips replace the single select", chips.count() >= 3, f"{chips.count()} chips")
    # chips carry the short label; the title attribute holds the full wording
    # that the Status column prints.
    first_lbl = (chips.nth(1).get_attribute("title") or "").strip()
    second_lbl = (chips.nth(2).get_attribute("title") or "").strip()
    chips.nth(1).click(); pg.wait_for_timeout(400)
    st1 = set(t.strip() for t in pg.locator("table.results tbody tr td:nth-child(3)").all_text_contents())
    n1 = pg.locator("table.results tbody tr").count()
    check("one status ticked filters to it", st1 == {first_lbl}, f"{st1} vs {first_lbl}")
    check("All chip de-selects when a status is picked",
          "on" not in (pg.locator("#f-status .chip.all").get_attribute("class") or ""))
    chips.nth(2).click(); pg.wait_for_timeout(400)
    st2 = set(t.strip() for t in pg.locator("table.results tbody tr td:nth-child(3)").all_text_contents())
    n2 = pg.locator("table.results tbody tr").count()
    check("second status adds rows, union only", st2 == {first_lbl, second_lbl} and n2 > n1,
          f"{st2} n={n1}->{n2}")
    chips.nth(1).click(); chips.nth(2).click(); pg.wait_for_timeout(400)
    check("un-ticking the last chip falls back to All",
          pg.locator("table.results tbody tr").count() == total
          and "on" in (pg.locator("#f-status .chip.all").get_attribute("class") or ""),
          str(pg.locator("table.results tbody tr").count()))
    chips.nth(1).click(); pg.wait_for_timeout(300)
    pg.locator("#f-status .chip.all").click(); pg.wait_for_timeout(400)
    check("All chip clears the status filter", pg.locator("table.results tbody tr").count() == total)

    pg.click("#f-reset"); pg.wait_for_timeout(500)
    check("clear filters restores rows", pg.locator("table.results tbody tr").count() == total)

    print("\n3b. sorting")
    def col(n):
        return [t.strip() for t in pg.locator(f"table.results tbody tr td:nth-child({n})").all_text_contents()]
    def caps(vals):
        out = []
        for t in vals:
            if t == "\u2014": out.append(None); continue
            mult = {"T": 1e12, "B": 1e9, "M": 1e6}.get(t[-1], 1)
            out.append(float(t.strip("$TBM").replace(",", "")) * mult)
        return out
    natural = col(1)

    def hdr(label):
        return pg.locator("table.results thead th .sortbtn", has_text=label).first

    hdr("Score").click(); pg.wait_for_timeout(400)
    sc = [int(x) for x in col(6)]
    check("Score sorts descending on first click", sc == sorted(sc, reverse=True), str(sc[:6]))
    check("sorted header is marked", pg.locator("table.results thead th.sorted").count() == 1,
          pg.locator("table.results thead th.sorted").first.get_attribute("aria-sort") or "")
    hdr("Score").click(); pg.wait_for_timeout(400)
    sc = [int(x) for x in col(6)]
    check("Score reverses on second click", sc == sorted(sc), str(sc[:6]))
    hdr("Score").click(); pg.wait_for_timeout(400)
    check("third click restores the engine order", col(1) == natural,
          f"{col(1)[:4]} vs {natural[:4]}")

    hdr("RS").click(); pg.wait_for_timeout(400)
    rsv = [int(x) for x in col(7) if x.isdigit()]
    check("RS sorts descending", rsv == sorted(rsv, reverse=True), str(rsv[:6]))

    hdr("Mkt cap").click(); pg.wait_for_timeout(400)
    cv = caps(col(8))
    known = [x for x in cv if x is not None]
    check("Mkt cap sorts descending", known == sorted(known, reverse=True), str(col(8)[:5]))
    check("unknown market caps sink to the bottom",
          all(x is not None for x in cv[:len(known)]), str(col(8)))

    hdr("Grade").click(); pg.wait_for_timeout(400)
    rank = {"A+": 4, "A": 3, "B": 2, "C": 1, "\u2014": 0}
    gv = [rank.get(x, -1) for x in col(5)]
    check("Grade sorts best-first", gv == sorted(gv, reverse=True), str(col(5)[:8]))
    hdr("Grade").click(); pg.wait_for_timeout(400)
    gv2 = [rank.get(x, -1) for x in col(5)]
    check("Grade reverses", gv2 == sorted(gv2), str(col(5)[:8]))

    pg.click("#f-reset"); pg.wait_for_timeout(500)
    check("clear also resets the sort",
          col(1) == natural and pg.locator("table.results thead th.sorted").count() == 0)

    print("\n4. click-through detail, including a rejected name")
    pg.select_option("#f-elig", "rejected"); pg.wait_for_timeout(400)
    sym = pg.locator("table.results tbody tr .symlink").first.text_content()
    pg.locator("table.results tbody tr .symlink").first.click()
    pg.wait_for_timeout(1200)
    check("overlay opened", pg.locator("#detail").is_visible())
    check("detail card is the clicked symbol",
          (pg.locator("#detail-body article.card h3").text_content() or "").strip() == sym.strip(),
          f"clicked {sym}")
    check("rejection banner shown", pg.locator("#detail-body .reject-banner").count() > 0)
    check("chart rendered in the overlay", pg.locator("#detail-body .chart svg .qm-candle").count() > 50,
          str(pg.locator("#detail-body .chart svg .qm-candle").count()) + " candles")
    check("criteria list shown", pg.locator("#detail-body ul.checks li").count() > 5)
    pg.screenshot(path=str(TMP / "detail.png"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    check("Escape closes the overlay", not pg.locator("#detail").is_visible())

    print("\n5. market-cap filter")
    pg.click("#view-table"); pg.wait_for_timeout(400)
    pg.select_option("#f-elig", "all"); pg.wait_for_timeout(400)   # clear step 4's filter
    pg.click("#tab-settings"); pg.wait_for_timeout(300)
    pg.fill("#mcaptop", "20"); pg.dispatch_event("#mcaptop", "change"); pg.wait_for_timeout(900)
    pg.click("#view-table"); pg.wait_for_timeout(500)
    elig_now = pg.locator("table.results tbody tr.elig").count()
    pg.click("#tab-settings"); pg.fill("#mcaptop", "100"); pg.dispatch_event("#mcaptop", "change"); pg.wait_for_timeout(900)
    pg.click("#view-table"); pg.wait_for_timeout(500)
    elig_all = pg.locator("table.results tbody tr.elig").count()
    check("market-cap band reduces eligible set", elig_now < elig_all, f"top20%={elig_now} vs all={elig_all}")

    check("still no JS errors", not errors, "; ".join(errors[:3]))

    print("\n6. two screeners on one dataset")
    pg.click("#f-reset"); pg.click("#view-cards"); pg.wait_for_timeout(700)
    card = pg.locator("article.card").first
    check("a card carries both strategy sections",
          card.locator("section.strat.kq").count() == 1 and card.locator("section.strat.mm").count() == 1)
    heads = [t.strip() for t in card.locator("section.strat .strat-head h4").all_text_contents()]
    check("each section names its screener",
          any("Qullamaggie" in h for h in heads) and any("Minervini" in h for h in heads), str(heads))
    check("the header shows both grades",
          card.locator(".card-head .grade").count() == 2,
          str(card.locator(".card-head .grade").all_text_contents()))
    check("each section has its own plan and criteria",
          card.locator("section.strat .plan").count() == 2 and card.locator("section.strat .criteria").count() == 2)
    mm_rows = card.locator("section.strat.mm .plan dl .row dt").all_text_contents()
    check("the Minervini plan has an entry and a stop",
          any("Pivot entry" in t or "Entry" in t for t in mm_rows) and any("Hard stop" in t for t in mm_rows),
          str(mm_rows))
    check("and no fixed take-profit — profit-taking is Kullamaggie's",
          not any("take profit" in t.lower() for t in mm_rows), str(mm_rows))

    kq_n = pg.locator("article.card").count()
    pg.click("#scr-mm"); pg.wait_for_timeout(800)
    mm_n = pg.locator("article.card").count()
    check("the Minervini screen lists its own candidates", mm_n != kq_n or mm_n == 0, f"kq={kq_n} mm={mm_n}")
    pg.click("#scr-both"); pg.wait_for_timeout(800)
    both_n = pg.locator("article.card").count()
    check("the both tab is the intersection", both_n <= min(kq_n, mm_n), f"both={both_n}")
    if both_n:
        check("names on both screens are marked", pg.locator(".bothtag").count() == both_n)
    summary = " ".join(pg.locator("#summary .stat").all_text_contents())
    check("the summary counts each screen", "Qullamaggie" in summary and "Minervini" in summary
          and "Both screens" in summary, summary[:120])

    print("\n7. which pivot the chart draws")
    pg.click("#scr-kq"); pg.wait_for_timeout(800)
    card = pg.locator("article.card").first
    card.locator("button.pp[data-pivot='kq']").click(); pg.wait_for_timeout(600)
    kq_levels = pg.locator("article.card").first.locator(".qm-level-tag text").all_text_contents()
    check("Qullamaggie levels only", all(t.startswith("KQ") for t in kq_levels) and kq_levels, str(kq_levels))
    pg.locator("article.card").first.locator("button.pp[data-pivot='mm']").click(); pg.wait_for_timeout(600)
    mm_levels = pg.locator("article.card").first.locator(".qm-level-tag text").all_text_contents()
    check("Minervini levels only", all(t.startswith("MM") for t in mm_levels) and mm_levels, str(mm_levels))
    pg.locator("article.card").first.locator("button.pp[data-pivot='both']").click(); pg.wait_for_timeout(600)
    both_levels = pg.locator("article.card").first.locator(".qm-level-tag text").all_text_contents()
    check("both, and the two pivots differ",
          len(both_levels) == len(kq_levels) + len(mm_levels), str(both_levels))
    check("the choice sticks across a re-render",
          pg.locator("article.card").first.locator("button.pp.on").get_attribute("data-pivot") == "both")

    print("\n8. the table follows the screener")
    pg.click("#view-table"); pg.wait_for_timeout(700)
    hdrs = [t.strip().rstrip("\u2195\u25b2\u25bc") for t in pg.locator("table.results thead th").all_text_contents()]
    check("Qullamaggie columns by default", "Score" in hdrs and "MM score" not in hdrs, str(hdrs))
    pg.click("#scr-mm"); pg.wait_for_timeout(700)
    hdrs = [t.strip().rstrip("\u2195\u25b2\u25bc") for t in pg.locator("table.results thead th").all_text_contents()]
    check("Minervini columns when that screen is active",
          "MM score" in hdrs and "MM entry" in hdrs, str(hdrs))
    pg.locator("table.results thead th .sortbtn", has_text="MM score").first.click()
    pg.wait_for_timeout(500)
    idx = hdrs.index("MM score") + 1
    vals = [int(t) for t in pg.locator(f"table.results tbody tr td:nth-child({idx})").all_text_contents() if t.strip().isdigit()]
    check("MM score sorts", vals == sorted(vals, reverse=True), str(vals[:6]))
    pg.locator("table.results tbody tr td.sym button").first.click()
    pg.wait_for_timeout(900)
    check("the detail overlay shows both sections too",
          pg.locator("#detail-body section.strat.kq").count() == 1 and
          pg.locator("#detail-body section.strat.mm").count() == 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

    print("\n9. the chart tooltip puts itself away")
    pg.click("#scr-kq"); pg.click("#view-cards"); pg.wait_for_timeout(700)
    svg = pg.locator("article.card .chart svg").first
    svg.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    box = svg.bounding_box()
    shown = lambda: pg.evaluate("""() => {
        const t = document.querySelector('.qm-tip');
        return !!t && getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().width > 0;
    }""")
    pg.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.4)
    pg.wait_for_timeout(300)
    check("tooltip appears over a chart", shown())
    pg.mouse.move(12, 12); pg.wait_for_timeout(350)
    # An author rule setting `display` outranks the browser's [hidden]; without a
    # global [hidden] rule the tooltip stays on screen forever.
    check("tooltip hides when the cursor leaves", not shown())
    check("global [hidden] rule is present",
          pg.evaluate("() => { const d = document.createElement('div');"
                      "d.style.cssText='display:grid'; d.hidden = true;"
                      "document.body.appendChild(d);"
                      "const v = getComputedStyle(d).display; d.remove(); return v; }") == "none")

    check("no JS errors after all of that", not errors, "; ".join(errors[:3]))
    b.close()

check.finish("ALL UI CHECKS PASSED")
