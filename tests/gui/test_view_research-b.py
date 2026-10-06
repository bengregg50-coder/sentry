"""Research-b views: Backtests, Robustness, Out-of-Sample, Validation, Research History.

Invariants: nothing is displayed without a source; failures stay visible; LOST and
RECONSTRUCTED evidence is labelled as such; sealed programmes are marked SEALED;
validation checks are shown exactly as reported (NOT REPORTED where null, never
coloured as a pass); counts of different origins are never merged.
"""

from __future__ import annotations

import pytest

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit
from .conftest import start_server

pytestmark = pytest.mark.browser

ROUTES = [
    "/research/backtests",
    "/research/robustness",
    "/research/oos",
    "/research/validation",
    "/research/history",
    "/research/history?focus=FX-T003",
]
MODULES = {
    "/research/backtests": "research-backtests",
    "/research/robustness": "research-robustness",
    "/research/oos": "research-oos",
    "/research/validation": "research-validation",
    "/research/history": "research-history",
}


def _module(route: str) -> str:
    return MODULES[route.split("?")[0]]


def _split(page, sel: str) -> list[list[str]]:
    """[[state, n], ...] of a reported-check-state split, with the badge tone checked against the state."""
    items = page.eval_on_selector_all(
        f"{sel} [data-check-state]",
        "els => els.map(e => [e.dataset.checkState, e.dataset.n, e.querySelector('.badge').className])",
    )
    for state, _, cls in items:
        assert ("tone-ok" in cls) == (state == "PASS"), (state, cls)
    return [[state, n] for state, n, _ in items]


def _cell(page, strategy: str, check: str) -> tuple[str | None, str]:
    sel = f'.rsb-mx--val tr[data-strategy="{strategy}"] .rsb-cell[data-check="{check}"]'
    return page.get_attribute(sel, "data-state"), page.get_attribute(sel, "class") or ""


# ---------------------------------------------------------------- empty mode


@pytest.mark.parametrize("route", ROUTES)
def test_empty_routes_clean_and_show_no_values(browser, empty_url, route):
    page = new_page(browser, empty_url)
    v = visit(page, route)
    assert v.clean, v.describe()
    assert v.module == _module(route)
    assert present_values(page) == []
    assert fake_value_hits(view_text(page)) == []
    # every panel explains itself: at least one "not connected" empty state is rendered
    assert page.locator('[data-empty-state^="source-"]').count() >= 1
    page.close()


def test_empty_structure_is_complete(browser, empty_url):
    page = new_page(browser, empty_url)
    visit(page, "/research/validation")
    # gate status says unknown, never zero
    assert page.get_attribute(".rsb-gate", "data-gate") == "unknown"
    # thirteen check names are listed, each NOT CONNECTED
    states = page.eval_on_selector_all(".rsb-checks__row .rsb-cell", "els => els.map(e => e.dataset.state)")
    assert len(states) == 13 and set(states) == {"NOT_CONNECTED"}
    # the matrix keeps its thirteen check columns
    assert page.locator(".rsb-mx--val th.rsb-mx__h").count() == 13
    assert "NO EDGE FOUND IS BETTER THAN A FAKE EDGE FOUND" in view_text(page).upper()

    visit(page, "/research/robustness")
    assert page.locator(".rsb-bat").count() == 5
    assert page.locator(".rsb-mx th.rsb-mx__h").count() == 5

    visit(page, "/research/oos")
    assert page.get_attribute(".rsb-tl-frame", "data-timeline") == "0"
    assert page.locator(".rsb-tl-legend span").count() == 6

    visit(page, "/research/history")
    assert page.locator(".rsb-filter.is-empty [data-filter-outcome]").count() == 7
    assert "FAILED ≠ LOST" in view_text(page).upper()

    visit(page, "/research/backtests")
    assert "AN IN-SAMPLE BACKTEST IS NOT VALIDATION" in view_text(page).upper()
    page.close()


# ---------------------------------------------------------------- fixture: clean render


@pytest.mark.parametrize("route", ROUTES)
def test_fixture_routes_clean(browser, fixture_url, route):
    page = new_page(browser, fixture_url)
    v = visit(page, route)
    assert v.clean, v.describe()
    assert v.module == _module(route)
    assert page.locator('[data-empty-state^="source-"]').count() == 0
    page.close()


@pytest.mark.parametrize("width", [1024, 1280, 2200])
def test_fixture_routes_do_not_overflow_page(browser, fixture_url, width):
    """Wide registers scroll inside their own frame; the page itself never scrolls sideways."""
    page = new_page(browser, fixture_url, width=width, height=900)
    for route in ROUTES:
        v = visit(page, route)
        assert v.clean, v.describe()
        over = page.evaluate("() => { const v = document.querySelector('.view'); return v.scrollWidth - v.clientWidth }")
        assert over <= 1, f"{route} overflows by {over}px at {width}px"
    page.close()


# ---------------------------------------------------------------- history


def test_history_failed_trial_stays_visible_with_reason(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/history")
    row = page.locator('tr[data-trial="FX-T003"]')
    assert row.count() == 1
    assert row.get_attribute("data-outcome") == "FAIL"
    badge = row.locator('[data-outcome="FAIL"] .badge')
    assert "tone-bad" in badge.get_attribute("class")
    assert "FIXTURE: OOS net expectancy negative" in row.inner_text()
    # every fixture trial is listed, failures included
    ids = page.eval_on_selector_all("tr[data-trial]", "els => els.map(e => e.dataset.trial)")
    assert len(ids) == 11 and "FX-T-RECON-LOST" in ids
    assert "FAILED ≠ LOST" in view_text(page).upper()
    page.close()


def test_history_lost_evidence_marked_for_reconstructed_trials(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/history")
    lost = page.eval_on_selector_all('tr[data-evidence="LOST"]', "els => els.map(e => e.dataset.trial)")
    assert sorted(lost) == ["FX-T-RECON-LOST", "FX-T004"]
    for tid in lost:
        row = page.locator(f'tr[data-trial="{tid}"]')
        ev = row.locator('[data-evidence-state="LOST"] .badge')
        assert ev.inner_text().strip() == "LOST"
        assert "tone-warn" in ev.get_attribute("class")
        assert row.locator('.badge[data-state="RECONSTRUCTED"]').count() == 1
    # the integrity notice (lost originals, with its reconstruction reference) is at the top
    notice = page.locator(".rsb-notices .notice")
    assert notice.count() == 1
    assert "fixture/reconstruction.md" in notice.inner_text()
    page.close()


def test_history_programme_sealed_and_accounting_split(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/history")
    head = page.locator('.rsb-gh[data-programme="FX-P01"]')
    assert head.get_attribute("data-programme-status") == "SEALED"
    assert "SEALED" in head.locator(".badge").first.inner_text()
    assert "tone-ok" not in head.locator(".badge").first.get_attribute("class")
    opt = page.locator('[data-filter-programme="FX-P01"]')
    assert "SEALED" in opt.inner_text()
    # trial accounting: reconstructed baseline and live-recorded are separate figures
    text = view_text(page).upper()
    assert "RECONSTRUCTED BASELINE" in text and "LIVE-RECORDED" in text
    recs = page.eval_on_selector_all(".rsb-recs__item", "els => els.map(e => [e.dataset.origin, e.querySelector('[data-v]').textContent.trim()])")
    assert ["ORIGINAL", "9"] in recs and ["RECONSTRUCTED", "2"] in recs
    page.close()


def test_history_focus_marks_and_scrolls_row(browser, fixture_url):
    page = new_page(browser, fixture_url, height=700)
    visit(page, "/research/history?focus=FX-T009", settle_ms=600)
    focused = page.eval_on_selector_all('tr[data-focus="1"]', "els => els.map(e => e.dataset.trial)")
    assert focused == ["FX-T009"]
    assert page.locator('[data-focus-bar="FX-T009"]').count() == 1
    in_view = page.evaluate(
        """() => { const r = document.querySelector('tr[data-focus="1"]').getBoundingClientRect();
                   return r.top >= 0 && r.bottom <= window.innerHeight }"""
    )
    assert in_view
    visit(page, "/research/history?focus=FX-T003")
    assert page.eval_on_selector_all('tr[data-focus="1"]', "els => els.map(e => e.dataset.trial)") == ["FX-T003"]
    # an unknown focus id is reported, not invented
    visit(page, "/research/history?focus=FX-NOPE")
    assert page.locator('tr[data-focus="1"]').count() == 0
    assert "FX-NOPE NOT FOUND" in view_text(page).upper()
    page.close()


def test_history_outcome_and_programme_filters(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/history?outcome=FAIL")
    outs = page.eval_on_selector_all("tr[data-trial]", "els => els.map(e => e.dataset.outcome)")
    assert outs and set(outs) == {"FAIL"} and len(outs) == 3
    visit(page, "/research/history?programme=FX-P02")
    groups = page.eval_on_selector_all("tbody.rsb-group", "els => els.map(e => e.dataset.group)")
    assert groups == ["FX-P02"]
    # focus hidden by a filter is explained, with a way back
    visit(page, "/research/history?outcome=PASS&focus=FX-T003")
    assert page.locator('tr[data-focus="1"]').count() == 0
    assert "HIDDEN BY THE CURRENT FILTER" in view_text(page).upper()
    page.close()


def test_history_terminated_hypotheses_with_reasons(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/history")
    hyps = page.eval_on_selector_all("tr[data-hypothesis]", "els => els.map(e => e.dataset.hypothesis)")
    assert sorted(hyps) == ["FX-H001", "FX-H002", "FX-H003", "FX-H006"]  # PENDING (FX-H004) is not terminated
    row = page.locator('tr[data-hypothesis="FX-H003"]')
    assert row.locator('[data-terminal="BLOCKED_BY_DATA"]').count() == 1
    assert "FIXTURE: requires unpurchased data" in row.inner_text()
    page.close()


def _linked(page, hyp: str) -> list[str]:
    return page.eval_on_selector_all(f'tr[data-hypothesis="{hyp}"] [data-linked-trial]', "els => els.map(e => e.dataset.linkedTrial)")


def test_history_terminated_trials_include_those_linked_by_hypothesis_id(browser, fixture_url, state_factory):
    """Trials linked only through trial.hypothesis_id are listed; an empty link set never claims 'none run'."""
    page = new_page(browser, fixture_url)
    visit(page, "/research/history")
    assert _linked(page, "FX-H001") == ["FX-T001", "FX-T002", "FX-T003"]
    assert _linked(page, "FX-H002") == ["FX-T004"]
    none = page.locator('tr[data-hypothesis="FX-H003"] [data-trials-linked="0"]')
    assert none.inner_text().strip() == "NO TRIALS LINKED"
    assert "NONE RUN" not in view_text(page).upper()
    page.close()

    def unlink(doc):
        for h in doc["data"]["hypotheses"]:
            if h["hypothesis_id"] == "FX-H001":
                h["trial_numbers"] = []  # trials still carry hypothesis_id FX-H001
            if h["hypothesis_id"] == "FX-H002":
                h["trial_numbers"] = [4, 99]  # 99 has no trial record

    url, server = start_server(state_factory({"research": unlink}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/research/history")
        assert v.clean, v.describe()
        row = page.locator('tr[data-hypothesis="FX-H001"]')
        assert _linked(page, "FX-H001") == ["FX-T001", "FX-T002", "FX-T003"]
        assert row.locator('[data-trials-linked="0"]').count() == 0
        assert "NONE RUN" not in row.inner_text().upper() and "NO TRIALS LINKED" not in row.inner_text().upper()
        # a declared number without a record stays visible, unlinked
        assert _linked(page, "FX-H002") == ["FX-T004"]
        missing = page.locator('tr[data-hypothesis="FX-H002"] [data-missing-trial]')
        assert missing.count() == 1 and missing.get_attribute("data-missing-trial") == "99"
        page.close()
    finally:
        server.should_exit = True


# ---------------------------------------------------------------- validation


def test_validation_matrix_shows_checks_as_reported(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/validation")
    state, cls = _cell(page, "FX-S002", "cost_sensitivity")
    assert state == "FAIL" and "tone-bad" in cls
    state, cls = _cell(page, "FX-S002", "out_of_sample")
    assert state == "PENDING" and "tone-warn" in cls
    state, cls = _cell(page, "FX-S003", "regime_analysis")
    assert state == "INCONCLUSIVE" and "tone-warn" in cls
    state, cls = _cell(page, "FX-S003", "monte_carlo")
    assert state == "NOT_RUN" and "tone-ok" not in cls
    state, cls = _cell(page, "FX-S001", "economic_rationale")
    assert state == "NOT_REPORTED" and "tone-ok" not in cls
    # 5 strategies x 13 checks; green only where the reported state is PASS
    cells = page.eval_on_selector_all(".rsb-mx--val .rsb-cell", "els => els.map(e => [e.dataset.state, e.className])")
    assert len(cells) == 65
    assert all(s == "PASS" for s, c in cells if "tone-ok" in c)
    # validation status per strategy and multiple-testing figures as reported
    assert page.get_attribute('.rsb-mx--val tr[data-strategy="FX-S002"] [data-validation-status]', "data-validation-status") == "IN_PROGRESS"
    mt = page.locator('tr[data-strategy="FX-S003"]').filter(has_text="FIXTURE deflated Sharpe").inner_text()
    assert "0.35" in mt and "14" in mt
    page.close()


@pytest.mark.parametrize("width", [1280, 1440, 1920])
def test_validation_not_reported_cells_and_mt_columns_are_legible(browser, fixture_url, width):
    page = new_page(browser, fixture_url, width=width, height=900)
    visit(page, "/research/validation")
    muted = page.evaluate("() => { const e = document.createElement('i'); e.style.color = 'var(--muted)'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; }")
    styles = page.eval_on_selector_all(
        '.rsb-mx--val .rsb-cell[data-state="NOT_REPORTED"]',
        "els => els.map(e => [parseFloat(getComputedStyle(e).fontSize), getComputedStyle(e).color, e.textContent.trim()])",
    )
    assert styles
    for size, color, text in styles:
        assert text.upper() == "NOT REPORTED"
        assert size >= 9 and color == muted, (size, color)
    # VAL-06: the left-aligned Detail column is separated from the right-aligned Deflated Sharpe column
    gap = page.evaluate(
        """() => { const t = document.querySelector('.rsb-mt table'); const ths = [...t.querySelectorAll('thead th')];
           const i = ths.findIndex(th => th.textContent.trim().toUpperCase() === 'DETAIL');
           const text = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
           const out = [[ths[i - 1], ths[i]]];
           for (const tr of t.querySelectorAll('tbody tr')) out.push([tr.children[i - 1], tr.children[i]]);
           return Math.min(...out.map(([a, b]) => text(b).left - text(a).right)); }"""
    )
    assert gap >= 16, f"Deflated Sharpe and Detail run together ({gap:.1f}px)"
    page.close()


def test_validation_check_detail_follows_query(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/validation?strategy=FX-S003")
    assert page.get_attribute(".rsb-checks", "data-strategy") == "FX-S003"
    assert page.get_attribute('.rsb-checks__row[data-check-row="monte_carlo"] .rsb-cell', "data-state") == "NOT_RUN"
    assert page.get_attribute('.rsb-mx--val tr.is-selected', "data-strategy") == "FX-S003"
    page.close()


def test_validation_states_plainly_when_nothing_is_validated(browser, state_factory):
    def unvalidate(doc):
        for s in doc["data"]["strategies"]:
            for v in s["versions"]:
                v["validation_status"] = "IN_PROGRESS"

    url, server = start_server(state_factory({"strategies": unvalidate}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/research/validation")
        assert v.clean, v.describe()
        assert page.get_attribute(".rsb-gate", "data-gate") == "none"
        assert "NO VALIDATED STRATEGY" in page.locator(".rsb-gate").inner_text().upper()
        # FX-S003 is DEPLOYED_SIM without validation: the derived finding is shown, not hidden
        assert page.locator('[data-finding="DEPLOYED_WITHOUT_VALIDATION"]').count() >= 1
        page.close()
    finally:
        server.should_exit = True


# ---------------------------------------------------------------- backtests / robustness / oos


def test_backtests_register_reports_gross_cost_net_with_basis(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/backtests")
    ids = page.eval_on_selector_all(".rsb-reg tr[data-trial]", "els => els.map(e => e.dataset.trial)")
    assert ids == ["FX-T001", "FX-T004", "FX-T005", "FX-T007", "FX-T010"]
    row = page.locator('tr[data-trial="FX-T001"]').inner_text()
    assert "3.80" in row and "-1.20" in row and "2.60" in row
    assert "IS" in row and "1× COST" in row
    # reconstructed backtest with lost evidence: no metrics invented
    lost = page.locator('tr[data-trial="FX-T004"]')
    assert lost.locator(".rsb-cmp .v:not(.is-empty)").count() == 0
    assert "FIXTURE: net of costs < 0" in lost.inner_text()
    # in-sample figures from the registry are labelled IS, not presented as validation
    assert page.locator('.rsb-reg tr[data-strategy="FX-S002"]').count() == 2
    assert "AN IN-SAMPLE BACKTEST IS NOT VALIDATION" in view_text(page).upper()
    page.close()


def test_robustness_battery_matrix_and_kind_filter(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/robustness")
    assert page.eval_on_selector_all(".rsb-bat", "els => els.map(e => e.dataset.kind)") == [
        "ROBUSTNESS",
        "COST_SENSITIVITY",
        "PARAMETER_STABILITY",
        "REGIME",
        "MONTE_CARLO",
    ]
    sel = '.rsb-mx tr[data-strategy="FX-S003"] .rsb-cell[data-check="regime_analysis"]'
    assert page.get_attribute(sel, "data-state") == "INCONCLUSIVE"
    sel = '.rsb-mx tr[data-strategy="FX-S002"] .rsb-cell[data-check="cost_sensitivity"]'
    assert page.get_attribute(sel, "data-state") == "FAIL"
    ids = page.eval_on_selector_all("tr[data-trial][data-kind]", "els => els.map(e => e.dataset.trial)")
    assert ids == ["FX-T002", "FX-T006"]
    assert "NO REGIME RESULTS REPORTED" in view_text(page).upper()
    # battery tiles: the matching check is counted as REPORTED (any state), never as a bare
    # n/m that reads as passes, and each reported state is shown beside it
    cost = page.locator('.rsb-bat[data-kind="COST_SENSITIVITY"]')
    assert " ".join(cost.locator('[data-check-reported="cost_sensitivity"]').inner_text().split()) == "REPORTED 3/5"
    assert _split(page, '.rsb-bat[data-kind="COST_SENSITIVITY"] [data-check-split]') == [["PASS", "2"], ["FAIL", "1"]]
    assert _split(page, '.rsb-bat[data-kind="MONTE_CARLO"] [data-check-split]') == [["NOT_RUN", "2"]]
    assert _split(page, '.rsb-bat[data-kind="REGIME"] [data-check-split]') == [["INCONCLUSIVE", "2"]]
    assert "CHECK 3/5" not in view_text(page).upper()
    visit(page, "/research/robustness?kind=COST_SENSITIVITY")
    ids = page.eval_on_selector_all("tr[data-trial][data-kind]", "els => els.map(e => e.dataset.trial)")
    assert ids == ["FX-T002"]
    page.close()


def test_oos_timeline_drawn_from_declared_windows(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/oos")
    roles = page.eval_on_selector_all("[data-window-role]", "els => els.map(e => e.dataset.windowRole)")
    assert sorted(roles) == ["CONFIRMATION", "PRIMARY_EVIDENCE"]
    trials = page.eval_on_selector_all("[data-trial-window]", "els => els.map(e => e.dataset.trialWindow)")
    assert sorted(trials) == ["FX-T003", "FX-T008", "FX-T009"]
    assert page.locator('[data-note="windows-fixed"]').count() == 1
    assert page.get_attribute('.rsb-sep[data-check="oos_separation"]', "data-state") == "PASS"
    assert page.get_attribute('tr[data-trial="FX-T003"]', "data-oos-state") == "FAIL"
    s5 = page.locator('.rsb-reg tr[data-strategy="FX-S005"] .rsb-cell[data-check="out_of_sample"]')
    assert s5.get_attribute("data-state") == "FAIL"
    page.close()


def test_oos_strategy_checks_split_by_reported_state(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/oos")
    stat = page.locator(".stat").filter(has=page.locator('[data-check-reported="out_of_sample"]'))
    assert "OOS CHECKS REPORTED" in stat.inner_text().upper()
    assert " ".join(stat.locator('[data-check-reported="out_of_sample"]').inner_text().split()) == "4/ 5"
    # 4 of 5 report it, and only 2 of those passed: the split says so plainly
    assert _split(page, '[data-check-split="out_of_sample"]') == [["PASS", "2"], ["FAIL", "1"], ["PENDING", "1"]]
    page.close()


@pytest.mark.parametrize("nav", ["expanded", "collapsed"])
@pytest.mark.parametrize("width", [1024, 1280, 1376, 1440, 1480, 1600, 2560])
def test_robustness_battery_rows_have_no_empty_track(browser, fixture_url, width, nav):
    """Five cards in five columns, or 3 + 2 when narrow: never a trailing empty column."""
    page = new_page(browser, fixture_url, width=width, height=900)
    page.evaluate("v => localStorage.setItem('sentry-cc:navCollapsed', v)", "true" if nav == "collapsed" else "false")
    page.reload()
    page.wait_for_selector(".view[data-module]")
    visit(page, "/research/robustness")
    g = page.evaluate(
        """() => { const g = document.querySelector('.rsb-bats'); const gr = g.getBoundingClientRect();
           const cards = [...g.children].map(c => c.getBoundingClientRect());
           const row1 = cards.filter(r => Math.abs(r.top - cards[0].top) < 1);
           return { tracks: getComputedStyle(g).gridTemplateColumns.split(' ').length, n: cards.length,
                    row1: row1.length, gap: gr.right - row1[row1.length - 1].right,
                    overflow: [...g.children].some(c => c.scrollWidth > c.clientWidth + 1) }; }"""
    )
    assert g["n"] == 5 and g["tracks"] in (3, 5) and g["row1"] == g["tracks"], g
    assert g["gap"] <= 1, f"empty space at the end of the battery row: {g}"
    assert not g["overflow"], g
    page.close()


def test_producer_strings_are_escaped(browser, state_factory):
    def inject(doc):
        doc["data"]["trials"][0]["experiment"] = '<img id="rsb-xss" src="x">'
        doc["data"]["trials"][0]["rejection_reason"] = '<b id="rsb-xss2">x</b>'

    url, server = start_server(state_factory({"research": inject}))
    try:
        page = new_page(browser, url)
        for route in ("/research/history", "/research/backtests"):
            v = visit(page, route)
            assert v.clean, v.describe()
            assert page.locator("#rsb-xss, #rsb-xss2").count() == 0
            assert '<img id="rsb-xss"' in view_text(page)
        page.close()
    finally:
        server.should_exit = True


def test_oos_undated_window_is_listed_not_drawn(browser, state_factory):
    """A window without both dates is never plotted (null must not become the 1970 epoch)."""

    def add_windows(doc):
        windows = doc["data"]["programmes"][1]["evaluation_windows"]
        windows.append({"label": "FIXTURE holdout", "role": "HOLDOUT", "start": "2025-01-01", "end": "2025-06-30"})
        windows.append({"label": "FIXTURE undated", "role": "OUT_OF_SAMPLE"})

    url, server = start_server(state_factory({"research": add_windows}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/research/oos")
        assert v.clean, v.describe()
        roles = page.eval_on_selector_all("[data-window-role]", "els => els.map(e => e.dataset.windowRole)")
        assert sorted(roles) == ["CONFIRMATION", "HOLDOUT", "PRIMARY_EVIDENCE"]
        listed = page.eval_on_selector_all('tr[data-programme="FX-P02"]', "els => els.map(e => e.dataset.role)")
        assert sorted(listed) == ["CONFIRMATION", "HOLDOUT", "OUT_OF_SAMPLE", "PRIMARY_EVIDENCE"]
        years = page.eval_on_selector_all(".rsb-tl svg text[data-v]", "els => els.map(e => e.textContent)")
        assert "1970" not in years and years[0] == "2000"
        page.close()
    finally:
        server.should_exit = True
