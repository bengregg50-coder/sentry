"""Research-a views: Research Overview, Discovery, Hypotheses, Experiments.

Empty mode must display no values; fixture mode must render the declared
records verbatim (states keep their tones, origins stay separate, LOST
evidence and reconstructed records are labelled).
"""

from __future__ import annotations

import json

import pytest

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit
from .conftest import start_server

pytestmark = pytest.mark.browser

ROUTES = {
    "/research": "research-overview",
    "/research/discovery": "research-discovery",
    "/research/hypotheses": "research-hypotheses",
    "/research/experiments": "research-experiments",
}
FOCUS_ROUTE = "/research/hypotheses?focus=FX-H004"


def _stat_value(page, label: str) -> str:
    loc = page.locator(f'.view .stat:has(.stat__label:text-is("{label}")) .stat__value')
    assert loc.count() == 1, f"expected exactly one stat labelled {label!r}, found {loc.count()}"
    return loc.inner_text().strip()


def _row(page, attr: str, ident: str):
    return page.locator(f'.view tr:has([{attr}="{ident}"])')


@pytest.fixture
def served(state_factory):
    """Start a server on a mutated copy of the fixture; yields base URL factory.

    ``raw`` maps a document key to text written verbatim (e.g. unparseable JSON)."""
    servers = []

    def make(mutations=None, drop=(), raw=None):
        state = state_factory(mutations, drop)
        for key, text in (raw or {}).items():
            (state / f"{key}.json").write_text(text)
        url, server = start_server(state)
        servers.append(server)
        return url

    yield make
    for s in servers:
        s.should_exit = True


# --------------------------------------------------------------------------- empty mode


def test_empty_routes_show_no_values(browser, empty_url):
    page = new_page(browser, empty_url)
    for route, module in [*ROUTES.items(), (FOCUS_ROUTE, "research-hypotheses")]:
        v = visit(page, route)
        assert v.clean, v.describe()
        assert v.module == module
        assert present_values(page) == [], route
        assert fake_value_hits(view_text(page)) == [], route
    page.close()


def test_empty_overview_keeps_full_structure(browser, empty_url):
    page = new_page(browser, empty_url)
    v = visit(page, "/research")
    assert v.clean, v.describe()
    # seven research roles, all honestly not connected
    states = page.eval_on_selector_all(".rsa-role", "els => els.map(e => e.dataset.state)")
    assert len(states) == 7 and set(states) == {"NOT_CONNECTED"}
    # full pipeline with its terminal lanes, unavailable
    assert page.get_attribute(".pipeline", "data-pipeline-available") == "0"
    text = view_text(page).upper()
    for lane in ("REJECTED", "BLOCKED BY DATA", "PENDING", "ABANDONED", "RETIRED"):
        assert lane in text
    # programmes frame keeps its column headers, with the reason inside
    headers = page.eval_on_selector_all(".rsa-frame th", "els => els.map(e => e.textContent.trim().toUpperCase())")
    assert "EVALUATION WINDOWS" in headers and "STATUS · UNIVERSE · OUTCOME" in headers
    assert "SPECIFICATION · FROZEN · SEALED" in headers
    assert "NOT CONNECTED" in text
    assert page.get_attribute('a[data-link="research-history"]', "href") == "#/research/history"
    page.close()


def test_empty_discovery_hypotheses_experiments_structure(browser, empty_url):
    page = new_page(browser, empty_url)
    visit(page, "/research/discovery")
    cols = page.eval_on_selector_all(".rsa-board__col", "els => els.map(e => e.dataset.areaStatus)")
    assert cols == ["CANDIDATE_AREA", "ACTIVE", "DEFERRED", "EXHAUSTED"]
    assert page.locator(".rsa-area").count() == 0  # never invents research areas
    assert page.locator(".rsa-board__col.tone-muted").count() == 4  # no colour without records

    visit(page, "/research/hypotheses")
    assert page.locator(".rsa-life__node").count() == 8
    assert page.locator(".rsa-life__node.tone-muted").count() == 8

    visit(page, "/research/experiments")
    kinds = page.eval_on_selector_all(".rsa-matrix__row[data-key]", "els => els.map(e => e.dataset.key)")
    assert "COST_SENSITIVITY" in kinds and "MONTE_CARLO" in kinds and "VOID" in kinds and "LOST" in kinds
    assert "EXPERIMENT LEDGER NOT CONNECTED" in view_text(page).upper()
    page.close()


# --------------------------------------------------------------------------- fixture mode


def test_fixture_routes_render_clean(browser, fixture_url):
    page = new_page(browser, fixture_url)
    for route, module in [*ROUTES.items(), (FOCUS_ROUTE, "research-hypotheses")]:
        v = visit(page, route)
        assert v.clean, v.describe()
        assert v.module == module
        assert present_values(page), f"{route} rendered no values from the fixture"
    page.close()


def test_hypothesis_rows_keep_state_tones(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/hypotheses")
    rejected = _row(page, "data-hyp", "FX-H001").locator('.badge[data-state="REJECTED"]').first
    assert rejected.inner_text().strip() == "REJECTED"
    cls = rejected.get_attribute("class")
    assert "tone-bad" in cls and "tone-ok" not in cls
    blocked = _row(page, "data-hyp", "FX-H003").locator('.badge[data-state="BLOCKED_BY_DATA"]').first
    assert blocked.inner_text().strip() == "BLOCKED BY DATA"
    assert "tone-warn" in blocked.get_attribute("class")
    # the reconstructed hypothesis carries its origin badge
    assert _row(page, "data-hyp", "FX-H002").locator('.badge[data-state="RECONSTRUCTED"]').count() == 1
    # a hypothesis with no terminal is shown as open, not as an empty value
    assert "OPEN" in _row(page, "data-hyp", "FX-H007").inner_text().upper()
    page.close()


def test_hypothesis_focus_detail(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, FOCUS_ROUTE)
    assert v.clean, v.describe()
    detail = page.locator('[data-rsa-detail="FX-H004"]')
    assert detail.count() == 1
    text = detail.inner_text()
    assert "FIXTURE volatility-conditioned breakout (synthetic statement)" in text
    assert "FIXTURE: awaiting cost-sensitivity rerun" in text
    # its own pipeline track, and its trials linking into research history
    assert detail.locator('.tracks__row[data-item="FX-H004"]').count() == 1
    assert detail.locator('a[data-trial="FX-T005"]').get_attribute("href") == "#/research/history?focus=FX-T005"
    assert detail.locator('a[data-trial="FX-T006"]').count() == 1
    # the register row is highlighted
    focused = page.locator("tr.rsa-row--focus")
    assert focused.count() == 1 and focused.locator('[data-hyp="FX-H004"]').count() == 1
    page.close()


def test_hypothesis_focus_on_validated_shows_strategy_track(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/hypotheses?focus=FX-H005")
    detail = page.locator('[data-rsa-detail="FX-H005"]')
    assert detail.locator('.tracks__row[data-item="FX-S003"] a').get_attribute("href") == "#/strategy/FX-S003"
    page.close()


def test_hypothesis_focus_unknown_id(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/research/hypotheses?focus=NOPE-1")
    assert v.clean, v.describe()
    assert page.locator('[data-empty-state="hypothesis-not-found"]').count() == 1
    assert "NOPE-1" in view_text(page)
    page.close()


def test_hypothesis_status_filter(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/hypotheses?status=REJECTED")
    ids = page.eval_on_selector_all(".rsa-register [data-hyp]", "els => els.map(e => e.dataset.hyp)")
    assert ids == ["FX-H001", "FX-H002"]
    assert page.locator('.tab[aria-selected="true"]').inner_text().upper().startswith("REJECTED")
    page.close()


def test_experiments_origin_evidence_and_metrics(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/research/experiments")
    assert v.clean, v.describe()
    t004 = _row(page, "data-trial", "FX-T004")
    assert t004.locator('.badge[data-state="RECONSTRUCTED"]').count() == 1
    lost = t004.locator('.badge[data-state="LOST"]')
    assert lost.inner_text().strip() == "EVIDENCE LOST" and "tone-warn" in lost.get_attribute("class")
    # running trial highlighted
    assert "rsa-row--running" in (_row(page, "data-trial", "FX-T010").get_attribute("class") or "")
    assert page.locator('.rsa-running a[href="#/research/history?focus=FX-T010"]').count() == 1
    # gross / cost / net each carry a basis chip; the cost line carries its multiplier
    t001 = _row(page, "data-trial", "FX-T001").locator(".rsa-metrics__row")
    assert t001.count() == 3
    lines = [t001.nth(i).inner_text() for i in range(3)]
    assert all("IS" in line for line in lines)
    assert "GROSS" in lines[0] and "COST" in lines[1] and "1× COST" in lines[1] and "NET" in lines[2]
    # outcome summary per origin, never merged: FAIL = 1 original + 2 reconstructed
    fail_row = page.locator('.rsa-matrix__row[data-key="FAIL"]').first
    nums = fail_row.locator(".rsa-matrix__n").all_inner_texts()
    assert [n.strip() for n in nums] == ["1", "2"]
    page.close()


def test_experiments_kind_filter(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/experiments?kind=OOS")
    ids = page.eval_on_selector_all(".rsa-register [data-trial]", "els => els.map(e => e.dataset.trial)")
    assert ids == ["FX-T003", "FX-T008"]
    page.close()


def test_overview_trial_accounting_separate(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/research")
    assert v.clean, v.describe()
    assert _stat_value(page, "Reconstructed baseline") == "5"
    assert _stat_value(page, "Live-recorded") == "9"
    assert _stat_value(page, "Global (declared)") == "14"
    # record counts by origin are shown side by side, never as one total
    hyps = _stat_value(page, "Hypotheses")
    assert "7" in hyps and "RECON" in hyps and "8" not in hyps
    trials = _stat_value(page, "Trial records")
    assert "9" in trials and "2" in trials and "11" not in trials
    page.close()


def test_overview_programmes_pipeline_and_focus(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research")
    p02 = _row(page, "data-programme", "FX-P02").inner_text().upper()
    assert "SPEC FROZEN" in p02 and "UNIVERSE PROVISIONAL" in p02
    assert "PRIMARY EVIDENCE" in p02 and "CONFIRMATION" in p02 and "2000-01-01" in p02
    assert "SEALED" in _row(page, "data-programme", "FX-P01").inner_text().upper()
    assert "DEFERRED" in _row(page, "data-programme", "FX-P04").inner_text().upper()
    assert page.get_attribute(".pipeline", "data-pipeline-available") == "1"
    assert page.get_attribute('.tracks__row[data-item="FX-H001"] a', "href") == "#/research/hypotheses?focus=FX-H001"
    assert page.get_attribute('.tracks__row[data-item="FX-S003"] a', "href") == "#/strategy/FX-S003"
    focus = page.locator('[data-focus-kind="HYPOTHESIS"]').inner_text()
    assert "FX-H007" in focus and "FIXTURE term-structure carry" in focus
    roles = page.eval_on_selector_all(".rsa-role", "els => Object.fromEntries(els.map(e => [e.dataset.role, e.dataset.state]))")
    assert len(roles) == 7 and roles["BACKTESTER"] == "BLOCKED" and roles["GOVERNANCE"] == "NOT_BUILT"
    # ?programme= highlights that programme's row
    visit(page, "/research?programme=FX-P02")
    assert page.locator('tr.rsa-row--focus [data-programme="FX-P02"]').count() == 1
    # ...and brings it into view (the shell resets scroll after mount; the view re-scrolls once)
    assert page.evaluate("document.querySelector('.main').scrollTop") > 0
    box = page.locator("tr.rsa-row--focus").bounding_box()
    assert box is not None and 0 <= box["y"] <= page.viewport_size["height"]
    page.close()


def test_discovery_lists_only_declared_areas(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/research/discovery")
    assert v.clean, v.describe()
    areas = page.eval_on_selector_all(".rsa-area", "els => els.map(e => e.dataset.area)")
    assert sorted(areas) == ["FX-A1", "FX-A2", "FX-A3", "FX-A4"]
    assert page.locator('[data-area-status="EXHAUSTED"] [data-area="FX-A3"]').count() == 1
    assert page.locator('[data-area-status="ACTIVE"] [data-area="FX-A1"]').count() == 1
    # queue: at DISCOVERY / HYPOTHESIS with no terminal
    queue = page.locator('.panel:has(.panel__code:text-is("DSC-03")) [data-hyp]').evaluate_all("els => els.map(e => e.dataset.hyp)")
    assert queue == ["FX-H007"]
    stopped = page.locator('.panel:has(.panel__code:text-is("DSC-04")) [data-hyp]').evaluate_all("els => els.map(e => e.dataset.hyp)")
    assert stopped == ["FX-H003", "FX-H006"]
    # families: the reconstructed hypothesis is its own row, not merged into the original count
    fam = page.locator('.panel:has(.panel__code:text-is("DSC-05"))')
    assert fam.locator("tr.rsa-fam-row--sub .badge[data-state='RECONSTRUCTED']").count() == 1
    page.close()


# --------------------------------------------------------------------------- source edge cases


def _blank_research(doc):
    doc["data"] = {
        "focus": None,
        "programmes": [],
        "hypotheses": [],
        "trials": [],
        "trial_accounting": None,
        "integrity_notices": [],
        "research_areas": [],
        "roles": [],
    }


def test_connected_but_empty_research(browser, served):
    url = served({"research": _blank_research})
    page = new_page(browser, url)
    for route in ROUTES:
        v = visit(page, route)
        assert v.clean, v.describe()
    visit(page, "/research")
    text = view_text(page).upper()
    assert "NO PROGRAMMES DECLARED" in text and "NO FOCUS DECLARED" in text and "TRIAL ACCOUNTING NOT DECLARED" in text
    roles = page.eval_on_selector_all(".rsa-role", "els => els.map(e => e.dataset.state)")
    assert set(roles) == {"NOT_REPORTED"}
    visit(page, "/research/hypotheses")
    assert "NO HYPOTHESES REGISTERED" in view_text(page).upper()
    assert page.locator(".rsa-life__node.tone-muted").count() == 8
    visit(page, "/research/discovery")
    assert page.locator(".rsa-board__none:text-is('NONE DECLARED')").count() == 4
    visit(page, "/research/experiments")
    assert "NO TRIALS RECORDED" in view_text(page).upper()
    page.close()


def test_invalid_research_source_is_reported(browser, served):
    def corrupt(doc):
        doc["data"]["unexpected_field"] = True

    url = served({"research": corrupt})
    page = new_page(browser, url)
    for route in [*ROUTES, FOCUS_ROUTE]:
        v = visit(page, route)
        assert v.clean, v.describe()
        assert page.locator('.view [data-empty-state="source-research-INVALID"]').count() >= 1, route
        assert page.locator(".rsa-area, .rsa-role[data-state='ACTIVE'], [data-rsa-detail]").count() == 0
        # a rejected document is a failure, not an absent source: never "not connected", always the bad tone
        assert "NOT CONNECTED" not in view_text(page).upper(), route
        assert page.locator(".view .rsa-src-bad.tone-bad [data-empty-state='source-research-INVALID']").count() >= 1, route
        assert "REJECTED BY THE CONTRACT" in view_text(page).upper(), route
    visit(page, "/research")
    off = page.locator('.view .rsa-off[data-source-off="INVALID"]')
    assert off.count() >= 3 and all("tone-bad" in (c or "") for c in off.evaluate_all("els => els.map(e => e.className)"))
    assert set(off.all_inner_texts()) == {"CONTRACT ERROR"}
    roles = page.eval_on_selector_all(".rsa-role", "els => els.map(e => e.dataset.state)")
    assert roles == ["INVALID"] * 7
    assert page.locator('.rsa-role .badge[data-state="INVALID"].tone-bad').count() == 7
    visit(page, "/research/discovery")
    assert page.locator('.rsa-board__none .rsa-off[data-source-off="INVALID"]').count() == 4
    # the status label wraps in narrow tiles instead of being cut to "CONTRACT ER…"
    clipped = page.evaluate("[...document.querySelectorAll('.view .stat__hint')].filter(e => e.scrollWidth > e.clientWidth + 1).length")
    assert clipped == 0
    page.close()


# --------------------------------------------------------------------------- honesty: nulls are not facts


def _set_hyp(hyp_id, **fields):
    def fn(doc):
        for h in doc["data"]["hypotheses"]:
            if h["hypothesis_id"] == hyp_id:
                h.update(fields)

    return fn


def test_null_prereg_timestamp_is_not_declared_not_negative(browser, served):
    # FX-H008 is TESTING and FX-H007 PREREGISTERED; a null timestamp says nothing about whether
    # they were preregistered, so it must never read "NOT PREREGISTERED".
    def mutate(doc):
        _set_hyp("FX-H008", preregistered_at=None)(doc)
        _set_hyp("FX-H007", preregistered_at=None)(doc)

    url = served({"research": mutate})
    page = new_page(browser, url)
    for route in ("/research/hypotheses", "/research/discovery", "/research/hypotheses?focus=FX-H008"):
        v = visit(page, route)
        assert v.clean, v.describe()
        assert "NOT PREREGISTERED" not in view_text(page).upper(), route
        assert page.locator('.view [data-state="NOT_PREREGISTERED"]').count() == 0, route
    visit(page, "/research/hypotheses")
    for hid in ("FX-H007", "FX-H008"):
        row = _row(page, "data-hyp", hid).inner_text().upper()
        assert "PREREG DATE NOT DECLARED" in row
    # a declared timestamp still shows as PREREGISTERED with its date
    assert "PREREGISTERED" in _row(page, "data-hyp", "FX-H001").locator('.badge[data-state="PREREGISTERED"]').inner_text()
    page.close()


def _checks(page):
    return page.eval_on_selector_all(".rsa-xc__row", "els => Object.fromEntries(els.map(e => [e.dataset.check, e.dataset.checkState]))")


def test_accounting_crosschecks_fixture(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research")
    assert _checks(page) == {
        "GLOBAL_SUM": "NO_DISCREPANCY",
        "RECONSTRUCTED_RECORDS": "FLAGGED",
        "LIVE_RECORDS": "NO_DISCREPANCY",
        "SEALED_SEPARATE": "NO_DISCREPANCY",
    }
    flagged = page.locator('.rsa-xc__row[data-check="RECONSTRUCTED_RECORDS"] .badge')
    assert "tone-ok" not in flagged.get_attribute("class")
    assert page.locator('[data-finding="RECONSTRUCTED_RECORDS_INCOMPLETE"]').count() == 1
    assert page.locator('[data-empty-state="accounting-consistent"]').count() == 0
    page.close()


def test_no_accounting_claims_no_consistency(browser, served):
    def drop(doc):
        doc["data"]["trial_accounting"] = None

    url = served({"research": drop})
    page = new_page(browser, url)
    visit(page, "/research")
    text = view_text(page).upper()
    assert "TRIAL ACCOUNTING NOT DECLARED" in text
    assert "NO ACCOUNTING DISCREPANCIES" not in text and "CONSISTENT WITH" not in text
    assert page.locator('[data-empty-state="accounting-checks-not-run"]').count() == 1
    assert page.locator(".rsa-xc__row").count() == 0
    page.close()


def test_partial_accounting_is_partially_checked(browser, served):
    def partial(doc):
        doc["data"]["trial_accounting"]["global_count"] = None
        doc["data"]["trial_accounting"]["sealed_evidence_separate"] = None

    url = served({"research": partial})
    page = new_page(browser, url)
    visit(page, "/research")
    checks = _checks(page)
    assert checks["GLOBAL_SUM"] == "NOT_RUN" and checks["SEALED_SEPARATE"] == "NOT_RUN"
    assert "global_count not declared" in page.locator('.rsa-xc__row[data-check="GLOBAL_SUM"]').inner_text()
    assert page.get_attribute(".rsa-xc", "data-checks-run") == "2"
    assert "PARTIALLY CHECKED" in view_text(page).upper()
    assert page.locator('[data-empty-state="accounting-consistent"]').count() == 0
    page.close()


def test_full_accounting_without_findings_is_consistent(browser, served):
    def consistent(doc):
        ta = doc["data"]["trial_accounting"]
        ta.update(reconstructed_baseline=2, live_recorded=9, global_count=11, sealed_evidence_separate=True)

    url = served({"research": consistent})
    page = new_page(browser, url)
    visit(page, "/research")
    assert set(_checks(page).values()) == {"NO_DISCREPANCY"}
    assert page.locator('[data-empty-state="accounting-consistent"]').count() == 1
    page.close()


# --------------------------------------------------------------------------- long registers


def _many_trials(n):
    def fn(doc):
        base = doc["data"]["trials"][0]
        for i in range(n):
            t = json.loads(json.dumps(base))
            t.update(trial_id=f"BIG-T{i:04d}", trial_number=1000 + i, origin="RECONSTRUCTED" if i % 5 == 0 else "ORIGINAL")
            if t["origin"] == "RECONSTRUCTED":
                t["evidence_state"] = "RECONSTRUCTED"
            doc["data"]["trials"].append(t)

    return fn


def test_experiment_register_is_paged_without_changing_counts(browser, served):
    url = served({"research": _many_trials(250)})  # 261 records: 209 original + 52 reconstructed
    page = new_page(browser, url)
    v = visit(page, "/research/experiments")
    assert v.clean, v.describe()
    assert page.locator(".rsa-register tbody tr").count() == 100
    pager = page.locator(".rsa-pager")
    assert pager.get_attribute("data-rows-shown") == "100" and pager.get_attribute("data-rows-hidden") == "161"
    # rows not shown are reported per origin, never as one merged total
    rest = pager.locator(".rsa-pager__rest").inner_text()
    assert "original" in rest and "reconstructed" in rest
    # displayed counts come from the full ledger, not the page
    records = _stat_value(page, "Trial records")
    assert "209" in records and "52" in records
    assert "rows 1–100 shown" in page.locator('.panel:has(.panel__code:text-is("EXP-05")) .panel__sub').inner_text()
    page.locator('.rsa-pager a[data-pager="more-100"]').click()
    page.wait_for_function("() => document.querySelectorAll('.rsa-register tbody tr').length === 200")
    page.locator('.rsa-pager a[data-pager="all"]').click()
    page.wait_for_function("() => document.querySelectorAll('.rsa-register tbody tr').length === 261")
    assert page.locator(".rsa-pager").count() == 0
    # changing the kind filter starts from the first page again
    href = page.locator('.rsa-tabs .tab:has-text("Oos")').first.get_attribute("href")
    assert "rows=" not in href
    page.close()


# --------------------------------------------------------------------------- layout


@pytest.mark.parametrize("width", [1280, 1440, 1920])
def test_lifecycle_lanes_share_column_edges(browser, fixture_url, width):
    page = new_page(browser, fixture_url, width=width)
    visit(page, "/research/hypotheses")
    box = "els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] })"
    flow = page.eval_on_selector_all(".rsa-life__flow .rsa-life__node", box)
    stops = page.eval_on_selector_all(".rsa-life__stops .rsa-life__node", box)
    assert len(flow) == len(stops) == 4
    assert flow == stops, f"lanes misaligned at {width}: {flow} vs {stops}"
    page.close()


@pytest.mark.parametrize("width", [1024, 1440, 1920, 2560])
def test_roles_grid_leaves_no_orphan(browser, fixture_url, width):
    page = new_page(browser, fixture_url, width=width)
    visit(page, "/research")
    tops = page.eval_on_selector_all(".rsa-role", "els => els.map(e => Math.round(e.getBoundingClientRect().top))")
    rows = [tops.count(t) for t in sorted(set(tops))]
    assert sum(rows) == 7
    assert rows in ([7], [4, 3], [1] * 7), f"roles laid out as {rows} at {width}px"
    page.close()


@pytest.mark.parametrize("width", [1440, 1920])
def test_identifying_text_not_clipped(browser, fixture_url, width):
    page = new_page(browser, fixture_url, width=width)
    clipped = "sel => [...document.querySelectorAll(sel)].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent)"
    visit(page, "/research")
    assert page.evaluate(clipped, ".rsa-tracks .tracks__title") == []
    visit(page, "/research/experiments")
    # evidence paths keep their distinguishing file name; the directory takes the ellipsis
    bases = page.eval_on_selector_all(".rsa-path__base", "els => els.map(e => e.textContent)")
    assert "T001.json" in bases
    assert page.evaluate(clipped, ".rsa-path__base") == []
    assert page.locator('.rsa-path[title="fixture/evidence/T001.json"]').count() == 1
    page.close()


@pytest.mark.parametrize("width", [1280, 2200])
def test_no_page_level_horizontal_overflow(browser, fixture_url, width):
    page = new_page(browser, fixture_url, width=width)
    for route in [*ROUTES, FOCUS_ROUTE]:
        v = visit(page, route)
        assert v.clean, v.describe()
        over = page.evaluate("() => { const m = document.querySelector('.main'); return m.scrollWidth - m.clientWidth }")
        assert over <= 1, f"{route} overflows horizontally by {over}px at {width}px"
    page.close()


# --------------------------------------------------------------------------- round 2: status-accurate wording


def _panel(page, code):
    return page.locator(f'.panel:has(.panel__code:text-is("{code}"))')


@pytest.mark.parametrize(
    ("variant", "status", "short", "title"),
    [
        ("missing", "MISSING", "NOT PRODUCED", "NOT PRODUCED"),
        ("unreadable", "UNREADABLE", "UNREADABLE", "UNREADABLE"),
    ],
)
def test_unavailable_research_wording_follows_source_status(browser, served, variant, status, short, title):
    # A research.json that was never produced, or cannot be parsed, is not "not connected".
    url = served(drop=("research",)) if variant == "missing" else served(raw={"research": "{ not json"})
    page = new_page(browser, url)
    for route in [*ROUTES, FOCUS_ROUTE]:
        v = visit(page, route)
        assert v.clean, v.describe()
        text = view_text(page).upper()
        assert "NOT CONNECTED" not in text, route
        assert page.locator(f'.view [data-empty-state="source-research-{status}"]').count() >= 1, route
    visit(page, "/research")
    text = view_text(page).upper()
    assert f"RESEARCH FOCUS {title}" in text and f"PROGRAMMES {title}" in text and f"TRIAL LEDGER {title}" in text
    off = page.locator(f'.view .rsa-off[data-source-off="{status}"]')
    assert off.count() >= 3 and set(off.all_inner_texts()) == {short}
    roles = page.eval_on_selector_all(".rsa-role", "els => els.map(e => e.dataset.state)")
    assert roles == [{"MISSING": "NOT_PRODUCED", "UNREADABLE": "UNREADABLE"}[status]] * 7
    # an unreadable document is a failure and takes the bad tone; a missing one stays muted
    broken = page.locator(".view .rsa-src-bad.tone-bad").count()
    assert (broken >= 1) if status == "UNREADABLE" else (broken == 0)
    # the pipeline built from strategies alone says hypotheses are missing, in status words
    gap = page.locator("[data-pipeline-gap]").first.inner_text()
    assert "hypotheses not included" in gap and f"research.json {short.lower()}" in gap
    page.close()


def test_invalid_strategies_pipeline_gap_and_strategy_track(browser, served):
    def corrupt(doc):
        doc["data"]["unexpected_field"] = True

    url = served({"strategies": corrupt})
    page = new_page(browser, url)
    v = visit(page, "/research")
    assert v.clean, v.describe()
    gaps = page.locator("[data-pipeline-gap]")
    assert gaps.count() == 2  # RES-03 and RES-04
    assert "strategies not included: strategies.json contract error" in gaps.first.inner_text()
    assert "tone-bad" in (gaps.first.get_attribute("class") or "")
    assert page.locator('.tracks__row[data-item^="FX-S"]').count() == 0
    # FX-H005 became FX-S003; with the registry rejected the reason is the contract error,
    # never "not present in the strategy registry"
    visit(page, "/research/hypotheses?focus=FX-H005")
    note = page.locator("[data-strategy-gap]")
    assert note.get_attribute("data-strategy-gap") == "INVALID"
    assert "strategies.json contract error" in note.inner_text()
    assert "NOT PRESENT" not in view_text(page).upper()
    page.close()


def test_strategy_absent_from_connected_registry(browser, served):
    def drop_s003(doc):
        doc["data"]["strategies"] = [s for s in doc["data"]["strategies"] if s["strategy_id"] != "FX-S003"]

    url = served({"strategies": drop_s003})
    page = new_page(browser, url)
    visit(page, "/research/hypotheses?focus=FX-H005")
    note = page.locator("[data-strategy-gap]")
    assert note.get_attribute("data-strategy-gap") == "NOT_IN_REGISTRY"
    assert "lists no strategy with this id" in note.inner_text()
    assert page.locator("[data-pipeline-gap]").count() == 0
    page.close()


def test_fixture_pipeline_is_not_marked_partial(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research")
    assert page.locator("[data-pipeline-gap]").count() == 0
    page.close()


# --------------------------------------------------------------------------- round 2: current research family


def test_focus_family_not_declared_shows_record_families_separately(browser, fixture_url):
    # The fixture focus declares no family; its programme (FIXTURE-trend) and hypothesis
    # (FIXTURE-carry) disagree, so neither may stand in for the focus family.
    page = new_page(browser, fixture_url)
    visit(page, "/research")
    fam = page.locator("[data-focus-family]")
    assert fam.get_attribute("data-focus-family") == ""
    assert fam.locator(".rsa-focus__famv [data-v].is-empty").count() == 1
    assert "NOT DECLARED IN FOCUS" in fam.inner_text().upper()
    recs = fam.locator("[data-family-of]")
    assert recs.count() == 2
    assert "FIXTURE-trend" in fam.locator('[data-family-of="PROGRAMME"]').inner_text()
    assert "FIXTURE-carry" in fam.locator('[data-family-of="HYPOTHESIS"]').inner_text()
    page.close()


def test_focus_family_declared(browser, served):
    def set_family(doc):
        doc["data"]["focus"]["family"] = "FIXTURE-carry"

    url = served({"research": set_family})
    page = new_page(browser, url)
    visit(page, "/research")
    fam = page.locator("[data-focus-family]")
    assert fam.get_attribute("data-focus-family") == "FIXTURE-carry"
    assert fam.locator(".rsa-focus__famname").inner_text() == "FIXTURE-carry"
    assert fam.locator(".rsa-focus__famv .is-empty").count() == 0
    page.close()


def test_focus_with_only_a_family_is_a_declared_focus(browser, served):
    def only_family(doc):
        doc["data"]["focus"] = {"family": "FIXTURE-trend"}

    url = served({"research": only_family})
    page = new_page(browser, url)
    visit(page, "/research")
    assert "NO FOCUS DECLARED" not in view_text(page).upper()
    assert page.locator("[data-focus-family]").get_attribute("data-focus-family") == "FIXTURE-trend"
    assert page.locator("[data-family-of]").count() == 0
    page.close()


# --------------------------------------------------------------------------- round 2: origins never merged


def _recon_only_family(doc):
    for h in doc["data"]["hypotheses"]:
        if h["hypothesis_id"] == "FX-H002":  # the RECONSTRUCTED hypothesis
            h["family"] = "FIXTURE-recon-only"
    for t in doc["data"]["trials"]:
        if t["origin"] == "RECONSTRUCTED":
            t["family"] = "FIXTURE-recon-only"


def _split(page, label):
    stat = page.locator(f'.view .stat:has(.stat__label:text-is("{label}")) .stat__value')
    return {
        o: stat.locator(f'.rsa-split__n[data-origin="{o}"] [data-v]').inner_text().strip()
        for o in ("ORIGINAL", "RECONSTRUCTED")
        if stat.locator(f'.rsa-split__n[data-origin="{o}"]').count()
    }


def test_family_counts_are_per_origin(browser, served):
    # 6 families on original records + 1 only on the reconstructed record: a merged
    # headline would read 7; the split reads 6 · 1 RECON.
    url = served({"research": _recon_only_family})
    page = new_page(browser, url)
    visit(page, "/research")
    assert _split(page, "Families") == {"ORIGINAL": "6", "RECONSTRUCTED": "1"}
    chip = page.locator('.rsa-famchip[data-family="FIXTURE-recon-only"]')
    assert chip.locator(".rsa-split__tag").inner_text() == "RECON"
    assert page.locator('.rsa-famchip[data-family="FIXTURE-trend"] .rsa-split__tag').count() == 0
    visit(page, "/research/discovery")
    assert _split(page, "Families") == {"ORIGINAL": "6", "RECONSTRUCTED": "1"}
    page.close()


def test_fixture_family_split(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research")
    # FIXTURE-intraday is on both original and reconstructed records: counted in each, never added
    assert _split(page, "Families") == {"ORIGINAL": "6", "RECONSTRUCTED": "1"}
    page.close()


def _many_hypotheses(n):
    def fn(doc):
        base = doc["data"]["hypotheses"][6]  # FX-H007, open
        for i in range(n):
            h = json.loads(json.dumps(base))
            h.update(hypothesis_id=f"BIG-H{i:04d}", title=f"bulk {i}", origin="RECONSTRUCTED" if i % 4 == 0 else "ORIGINAL", trial_numbers=[])
            doc["data"]["hypotheses"].append(h)

    return fn


def test_tracks_and_register_are_paged_per_origin(browser, served):
    url = served({"research": _many_hypotheses(150)})  # 158 hypotheses: 120 + 7 original, 38 + 1 reconstructed
    page = new_page(browser, url)
    v = visit(page, "/research")
    assert v.clean, v.describe()
    res04 = _panel(page, "RES-04")
    assert res04.locator(".tracks__row").count() == 40
    rest = res04.locator(".rsa-pager__rest").inner_text()
    assert "original" in rest and "reconstructed" in rest and "items" in rest
    # the shared component's merged "+N more items" line is never used
    assert "MORE ITEMS" not in res04.inner_text().upper().replace("SHOW", "")
    res04.locator('a[data-pager="more-40"]').click()
    page.wait_for_function("() => document.querySelectorAll('.rsa-tracks .tracks__row').length === 80")
    assert page.evaluate("document.querySelector('.main').scrollTop") > 0  # same route keeps the scroll position

    v = visit(page, "/research/hypotheses")
    assert v.clean, v.describe()
    assert page.locator(".rsa-register tbody tr").count() == 100
    pager = page.locator(".rsa-register .rsa-pager")
    assert pager.get_attribute("data-rows-hidden") == "58"
    assert "original" in pager.inner_text() and "reconstructed" in pager.inner_text()
    assert "rows 1–100 shown" in _panel(page, "HYP-02").locator(".panel__sub").inner_text()
    # lifecycle counts come from the full register, per origin
    node = page.locator('.rsa-life__node[data-life="PREREGISTERED"]')
    assert node.locator('[data-origin="ORIGINAL"] [data-v]').inner_text() == "113"
    assert node.locator('[data-origin="RECONSTRUCTED"] [data-v]').inner_text() == "38"

    # discovery: the queue (151 open hypotheses at HYPOTHESIS stage) is paged; its count is not
    v = visit(page, "/research/discovery")
    assert v.clean, v.describe()
    queue = _panel(page, "DSC-03")
    assert queue.locator("tbody tr").count() == 100
    assert queue.locator(".rsa-pager").get_attribute("data-rows-hidden") == "51"
    assert _split(page, "Queue") == {"ORIGINAL": "113", "RECONSTRUCTED": "38"}
    # a family row lists a capped number of ids; the remainder is within that one family and origin
    carry = _panel(page, "DSC-05").locator("tr.rsa-fam-row").filter(has_text="FIXTURE-carry").first
    assert carry.locator("a.ref[href^='#/research/hypotheses']").count() == 12
    assert carry.locator("[data-ids-hidden]").get_attribute("data-ids-hidden") == "101"
    page.close()


# --------------------------------------------------------------------------- round 2: nulls are not negative facts


def test_null_fields_read_not_declared(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research")
    roles = view_text(page).upper()
    # QUANT_RESEARCHER etc. declare no last_activity_at: that is not "no activity"
    assert "NO ACTIVITY RECORDED" not in roles and "LAST ACTIVITY NOT DECLARED" in roles
    assert "NO HASH" not in roles and "ROLE NOT SET" not in roles
    # FX-H003 declares no programme: "programme not declared", never "no programme"
    for route in ("/research/hypotheses", "/research/discovery"):
        visit(page, route)
        text = view_text(page).lower()
        assert "no programme" not in text and "programme not declared" in text, route
        assert "no decision date" not in text, route
    visit(page, "/research/experiments")
    text = view_text(page).upper()
    assert "RUNNING NOW" not in text and "DECLARED RUNNING" in text
    assert "NO HYPOTHESIS" not in text and "NO PROGRAMME" not in text
    # the hypothesis and programme sit in the trial cell; the recorded time in the outcome cell
    row = _row(page, "data-trial", "FX-T001")
    assert row.locator('a[href="#/research/hypotheses?focus=FX-H001"]').count() == 1
    assert row.locator('a[href="#/research?programme=FX-P01"]').count() == 1
    assert "RECORDED" in row.locator("td.rsa-col-outcome").inner_text().upper()
    page.close()


def test_programme_outcome_and_spec_cells(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research")
    p01 = _row(page, "data-programme", "FX-P01")
    assert p01.locator('[data-outcome="NO APPROVED STRATEGY"]').count() == 1
    p03 = _row(page, "data-programme", "FX-P03")
    assert p03.locator('[data-outcome=""] [data-v].is-empty').count() == 1
    assert "specification not declared" in p03.inner_text()
    p02 = _row(page, "data-programme", "FX-P02").inner_text()
    assert "fixture/spec.md" in p02 and "2026-01-05" in p02
    page.close()


# --------------------------------------------------------------------------- round 2: CSS honesty + 1024 layout


def test_metric_value_colour_never_overrides_empty(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/research/experiments")
    colours = page.evaluate(
        """() => {
          const host = document.querySelector('.view');
          const probe = document.createElement('div');
          probe.innerHTML = '<div class="rsa-metrics"><div class="rsa-metrics__row"><span class="v is-empty" data-v>—</span><span class="v" data-v>1</span></div></div><span class="v is-empty" id="plain-empty">—</span>';
          host.appendChild(probe);
          const [empty, full] = probe.querySelectorAll('.rsa-metrics__row .v');
          const out = [getComputedStyle(empty).color, getComputedStyle(probe.querySelector('#plain-empty')).color, getComputedStyle(full).color];
          probe.remove();
          return out;
        }"""
    )
    assert colours[0] == colours[1], "an empty metric value must keep the faint empty colour"
    assert colours[2] != colours[1]


@pytest.mark.parametrize("mode", ["empty", "fixture"])
def test_tracks_fit_at_1024(browser, empty_url, fixture_url, mode):
    page = new_page(browser, fixture_url if mode == "fixture" else empty_url, width=1024)
    for route in ("/research", "/research/hypotheses?focus=FX-H004"):
        visit(page, route)
        if mode == "empty" and "focus" in route:
            continue
        tracks = page.locator(".rsa-tracks .tracks").first
        over = tracks.evaluate("e => e.scrollWidth - e.clientWidth")
        assert over <= 1, f"{route}: tracks scroll by {over}px at 1024"
        # the OUTCOME column is inside the panel, not behind a horizontal scroll
        head = tracks.locator(".tracks__head .tracks__stage").last
        box, wrap = head.bounding_box(), tracks.bounding_box()
        assert box["x"] + box["width"] <= wrap["x"] + wrap["width"] + 1
        if mode == "fixture":
            outcome = tracks.locator(".tracks__outcome .badge").first.bounding_box()
            assert outcome["x"] + outcome["width"] <= wrap["x"] + wrap["width"] + 1
    page.close()


def test_registers_fit_at_1024(browser, fixture_url):
    page = new_page(browser, fixture_url, width=1024)
    for route in [*ROUTES, FOCUS_ROUTE]:
        v = visit(page, route)
        assert v.clean, v.describe()
        over = page.evaluate("[...document.querySelectorAll('.view .table-wrap, .view .tracks')].map(e => e.scrollWidth - e.clientWidth).filter(d => d > 1)")
        assert over == [], f"{route}: horizontal scroll inside panels at 1024: {over}"
        page_over = page.evaluate("() => { const m = document.querySelector('.main'); return m.scrollWidth - m.clientWidth }")
        assert page_over <= 1
    page.close()
