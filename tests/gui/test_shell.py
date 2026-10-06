"""App shell: navigation architecture, status surfaces, tones, escaping, layout."""

from __future__ import annotations

import json

import pytest

from .browser_helpers import new_page, visit
from .conftest import start_server

pytestmark = pytest.mark.browser

NAV_EXPECTED = [
    "Command Centre", "System Map",
    "Research Overview", "Discovery", "Hypotheses", "Experiments", "Backtests", "Robustness", "Out-of-Sample", "Validation", "Research History",
    "Agent Overview", "Agent 01", "Agent 02", "Agent 03", "Agent 04", "Agent 05",
    "Strategy Library", "Candidates", "Validated", "Deployed", "Retired",
    "Memory Overview", "Knowledge Graph", "Findings", "Lessons", "Evidence", "Agent Memories",
    "Portfolio", "Risk", "Execution", "Live Engine",
    "Datasets", "State Sources",
    "Governance", "Insights",
]


def test_navigation_contains_complete_architecture(browser, empty_url):
    page = new_page(browser, empty_url)
    labels = page.eval_on_selector_all(".nav__label", "els => els.map(e => e.textContent.trim())")
    assert labels == NAV_EXPECTED
    hrefs = page.eval_on_selector_all(".nav__link", "els => els.map(e => e.getAttribute('href'))")
    for href in hrefs:
        v = visit(page, href.lstrip("#"), settle_ms=100)
        assert v.clean, v.describe()
        current = page.eval_on_selector('.nav__link[aria-current="page"]', "e => e.getAttribute('href')")
        assert current == href
    page.close()


def test_status_surfaces(browser, empty_url, fixture_url):
    page = new_page(browser, empty_url)
    pills = page.eval_on_selector_all(".sys-pill", "els => els.map(e => [e.dataset.subsystem, e.dataset.state])")
    assert [p[0] for p in pills] == ["research_engine", "trading_engine", "agent_network", "data", "governance", "memory"]
    assert {p[1] for p in pills} == {"NOT_CONNECTED"}
    assert "READ-ONLY" in page.inner_text(".topbar")
    assert "not configured" in page.inner_text("#statusbar")
    page.close()
    page = new_page(browser, fixture_url)
    assert "CRITICAL" in page.inner_text("#alert-chip")
    assert "12/12 OK" in page.inner_text("#statusbar")
    page.close()


def test_unknown_route(browser, empty_url):
    page = new_page(browser, empty_url)
    page.evaluate("location.hash = '#/definitely/not/a/route'")
    page.wait_for_selector('[data-empty-state="not-found"]')
    page.close()


def test_tone_semantics(browser, empty_url):
    page = new_page(browser, empty_url)
    result = page.evaluate(
        """async () => {
            const t = await import('/cc/static/js/core/tones.js');
            const probe = ['PASS','VALIDATED','APPROVED','DIFFERS','RECONSTRUCTED','PENDING','BLOCKED_BY_DATA',
                           'FAIL','REJECTED','VIOLATION','NOT_CONNECTED','SOMETHING_NEW','SLEEPING','LIVE','SEALED'];
            const out = {}; for (const s of probe) out[s] = t.toneOf(s);
            const ok = new Set(t.TONE_TABLE.OK);
            const overlap = [...t.TONE_TABLE.WARN, ...t.TONE_TABLE.BAD].filter(s => ok.has(s));
            return {out, overlap};
        }"""
    )
    out = result["out"]
    assert result["overlap"] == []
    assert {out[s] for s in ("PASS", "VALIDATED", "APPROVED")} == {"ok"}
    assert {out[s] for s in ("DIFFERS", "RECONSTRUCTED", "PENDING", "BLOCKED_BY_DATA")} == {"warn"}
    assert {out[s] for s in ("FAIL", "REJECTED", "VIOLATION")} == {"bad"}
    assert out["SOMETHING_NEW"] == "muted" and out["NOT_CONNECTED"] == "muted" and out["SLEEPING"] == "muted"
    page.close()


def test_state_strings_are_escaped(browser, state_factory):
    payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>'

    def inject_research(doc):
        doc["data"]["hypotheses"][0]["title"] = payload
        doc["data"]["integrity_notices"][0]["title"] = payload

    def inject_strategies(doc):
        doc["data"]["strategies"][0]["name"] = payload

    def inject_memory(doc):
        doc["data"]["memories"][0]["title"] = payload

    state = state_factory({"research": inject_research, "strategies": inject_strategies, "memory": inject_memory})
    url, server = start_server(state)
    try:
        page = new_page(browser, url)
        for route in ("/", "/research", "/research/hypotheses", "/research/history", "/strategies", "/memory", "/memory/findings", "/memory/graph", "/governance"):
            v = visit(page, route, settle_ms=150)
            assert v.clean, v.describe()
            assert page.evaluate("window.__pwned === undefined"), route
            assert page.evaluate("document.querySelectorAll('.view img[src=\"x\"], .view script').length") == 0, route
        page.close()
    finally:
        server.should_exit = True


@pytest.mark.parametrize("width", [1024, 1280, 1920, 2560])
def test_no_horizontal_page_overflow(browser, fixture_url, width):
    page = new_page(browser, fixture_url, width=width, height=900)
    for route in ("/", "/research", "/agents/2", "/strategy/FX-S003", "/memory", "/governance", "/data"):
        visit(page, route, settle_ms=150)
        overflow = page.evaluate(
            "() => { const m = document.getElementById('main'); return m.scrollWidth - m.clientWidth }"
        )
        assert overflow <= 1, f"{route} overflows horizontally by {overflow}px at {width}px"
    page.close()


def test_invalid_source_shown_as_contract_error(browser, state_factory):
    state = state_factory({"governance": lambda d: json.loads(json.dumps(d)) | {"data": {"checks": [{"key": "referee", "state": "GREEN"}]}}})
    url, server = start_server(state)
    try:
        page = new_page(browser, url)
        visit(page, "/governance")
        assert page.eval_on_selector('[data-source="governance"]', "e => e.dataset.sourceStatus") == "INVALID"
        assert "CONTRACT ERROR" in page.inner_text(".view")
        # a contract-invalid source must never be displayed as passing
        assert page.eval_on_selector_all(".view .gov-check .tone-ok", "els => els.length") == 0
        page.close()
    finally:
        server.should_exit = True


def _meta(origin="ORIGINAL"):
    return {"schema_version": "1", "producer": "t", "generated_at": "2026-01-01T00:00:00Z", "origin": origin}


def _chip(page):
    return page.get_attribute("#alert-chip a", "data-alert-state"), page.inner_text("#alert-chip").strip()


def test_alert_chip_never_says_no_findings_when_nothing_is_connected(browser, empty_url, tmp_path):
    page = new_page(browser, empty_url)
    state, text = _chip(page)
    assert state == "NOT_CONNECTED" and "NOT CONNECTED" in text and "NO FINDINGS" not in text
    assert "tone-ok" not in (page.get_attribute("#alert-chip a", "class") or "")
    page.close()

    # INFO-only findings are shown, not hidden behind "no findings"
    info_dir = tmp_path / "info"
    info_dir.mkdir()
    (info_dir / "research.json").write_text(json.dumps({"meta": _meta(), "data": {"trial_accounting": {"reconstructed_baseline": 3}}}))
    url, server = start_server(info_dir)
    try:
        page = new_page(browser, url)
        state, text = _chip(page)
        assert state == "INFO" and "1 INFO" in text
        assert "tone-info" in page.get_attribute("#alert-chip a", "class")
        page.close()
    finally:
        server.should_exit = True

    # connected, zero findings: NO FINDINGS (muted, never green), scoped to the checks that ran
    ok_dir = tmp_path / "ok"
    ok_dir.mkdir()
    (ok_dir / "system.json").write_text(json.dumps({"meta": _meta(), "data": {"subsystems": []}}))
    url, server = start_server(ok_dir)
    try:
        page = new_page(browser, url)
        state, text = _chip(page)
        assert state == "NO_FINDINGS" and text.endswith("NO FINDINGS")
        assert "checks that ran" in page.get_attribute("#alert-chip a", "title")
        assert "tone-ok" not in (page.get_attribute("#alert-chip a", "class") or "")
        page.close()
    finally:
        server.should_exit = True


def test_complete_is_not_a_pass_outside_handoff_steps(browser, empty_url):
    page = new_page(browser, empty_url)
    out = page.evaluate(
        """async () => {
            const t = await import('/cc/static/js/core/tones.js');
            return {complete: t.toneOf('COMPLETE'), stepComplete: t.stepTone('COMPLETE'), running: t.stepTone('RUNNING'),
                    failed: t.stepTone('FAILED'), withdrawn: t.stepTone('WITHDRAWN'), notStarted: t.stepTone('NOT_STARTED'),
                    eligible: t.toneOf('ELIGIBLE'), low: t.toneOf('LOW'), medium: t.toneOf('MEDIUM'), sourceError: t.toneOf('SOURCE_ERROR')};
        }"""
    )
    assert out["complete"] != "ok"  # a programme can COMPLETE with a null result
    assert out["stepComplete"] == "ok" and out["running"] == "info"
    assert out["failed"] == "bad" and out["withdrawn"] == "muted" and out["notStarted"] == "muted"
    assert out["eligible"] == "ok"
    assert out["low"] == "warn" and out["medium"] == "warn"  # uncertainty is never calmer than MEDIUM
    assert out["sourceError"] == "bad"
    page.close()


def test_unknown_and_malformed_routes_replace_the_page(browser, empty_url):
    page = new_page(browser, empty_url)
    visit(page, "/governance")
    for bad in ("/nope", "/strategy/%E0%A4%A", "/memory/item/%"):
        page.evaluate("h => { location.hash = h }", "#" + bad)
        page.wait_for_selector('.view[data-module="not-found"]')
        assert page.get_attribute(".view", "data-route") != "/governance"
        assert "GOVERNANCE" not in page.inner_text("#crumbs").upper()
        assert page.title().startswith("Unknown route")
        assert not [e for e in page._cc_errors if "URI malformed" in e], page._cc_errors
        visit(page, "/governance")
    page.close()


def test_collapsed_navigation_keeps_every_route_reachable(browser, fixture_url):
    page = new_page(browser, fixture_url, width=1024, height=820)
    visit(page, "/research/backtests")
    assert page.evaluate("() => [...document.querySelectorAll('.nav__label')].filter(e => e.offsetParent).length") == 0
    page.hover('.nav__group[data-group="research"] .nav__link >> nth=0')
    shown = page.evaluate("() => [...document.querySelectorAll('.nav__fly-link')].filter(a => a.offsetParent).map(a => a.textContent.trim())")
    assert {"Backtests", "Robustness", "Out-of-Sample", "Validation"} <= set(shown)
    assert page.eval_on_selector('.nav__fly-link[aria-current="page"]', "e => e.textContent.trim()") == "Backtests"
    page.mouse.move(700, 500)
    page.click("#nav-toggle")
    assert page.evaluate("document.getElementById('app').dataset.nav") == "open"
    assert page.is_visible('.nav__link[href="#/research/oos"]')
    page.click('.nav__link[href="#/research/oos"]')
    page.wait_for_function("location.hash === '#/research/oos'")
    assert page.evaluate("document.getElementById('app').dataset.nav") != "open"
    # status bar: nothing cut mid-token, the POLL segment stays visible
    sw, cw = page.evaluate("() => { const s = document.getElementById('statusbar'); return [s.scrollWidth, s.clientWidth] }")
    assert sw <= cw + 1
    assert page.is_visible(".statusbar .seg--keep")
    # every subsystem pill fits inside the topbar status area
    right = page.evaluate("() => document.getElementById('sys-pills').getBoundingClientRect().right")
    pills = page.evaluate("() => [...document.querySelectorAll('.sys-pill')].map(p => p.getBoundingClientRect().right)")
    assert all(r <= right + 0.5 for r in pills)
    page.close()


def test_agent_tile_basis_and_no_strategy_rules(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/")
    t2 = page.locator('.agent-mini[data-agent-slot="2"]')
    assert "P&L · DAY" in t2.inner_text().upper()
    assert t2.locator(".agent-mini__pnl .chip--basis").inner_text().strip() == "SIM"  # P&L never without basis
    t5 = page.locator('.agent-mini[data-agent-slot="5"]').inner_text().upper()
    assert "NO STRATEGY REPORTED" in t5 and "NO ACTIVE STRATEGY" not in t5
    t1 = page.locator('.agent-mini[data-agent-slot="1"]').inner_text().upper()
    assert "NO ACTIVE STRATEGY" in t1
    # pipeline: undeclared stages disclosed, reconstructed lane outcome marked
    visit(page, "/research")
    assert page.get_attribute("[data-undeclared]", "data-undeclared") == "2"
    assert page.get_attribute('.pl-lane-chip[data-recon]', "data-lane-terminal") == "REJECTED"
    assert page.locator('.tracks__row[data-item="FX-S001"] .tracks__cell.on').count() == 0
    assert "STAGE NOT DECLARED" in page.inner_text('.tracks__row[data-item="FX-S001"]')
    page.close()


def test_agent_tiles_show_source_error_not_sleeping(browser, state_factory):
    def broken(doc):
        doc["data"]["agents"][1]["status"] = "LIVE"
        doc["data"]["agents"][1]["newer_field"] = True

    url, server = start_server(state_factory({"agents": broken}))
    try:
        page = new_page(browser, url)
        visit(page, "/")
        statuses = page.eval_on_selector_all(".agent-mini", "els => els.map(e => e.dataset.agentStatus)")
        assert set(statuses) == {"SOURCE_ERROR"}
        text = page.inner_text(".cc-floor").upper()
        assert "STATE UNAVAILABLE" in text and "SLEEPING" not in text and "NO ACTIVE STRATEGY" not in text
        assert "NO AGENT RUNTIME CONNECTED" not in text
        page.close()
    finally:
        server.should_exit = True


def test_agent_tile_flags_unknown_version(browser, state_factory):
    def v9(doc):
        doc["data"]["agents"][1]["assignment"]["version"] = 9

    url, server = start_server(state_factory({"agents": v9}))
    try:
        page = new_page(browser, url)
        visit(page, "/")
        t2 = page.locator('.agent-mini[data-agent-slot="2"] .agent-mini__strategy')
        assert "NOT IN REGISTRY" in t2.inner_text().upper()
        assert "tone-bad" in t2.locator(".badge").get_attribute("class")
        page.close()
    finally:
        server.should_exit = True


def test_sparkline_breaks_at_gaps_and_metric_rejects_non_finite(browser, empty_url):
    page = new_page(browser, empty_url)
    out = page.evaluate(
        """async () => {
            const c = await import('/cc/static/js/components/chart.js');
            const f = await import('/cc/static/js/core/format.js');
            const svg = String(c.sparkline([10, 11, null, 12, 13], { width: 100, height: 20 }));
            const ys = [...svg.matchAll(/(\\d+\\.\\d),(\\d+\\.\\d)/g)].map(m => Number(m[2]));
            return {
                polylines: (svg.match(/<polyline/g) || []).length,
                maxY: Math.max(...ys),
                emptyTooFew: String(c.sparkline([null, 5])).includes('data-empty'),
                nan: f.fmtMetric({ value: null, unit: 'ratio', basis: 'OUT_OF_SAMPLE' }).empty,
                inf: f.fmtMetric({ value: Infinity, unit: 'ratio', basis: 'OUT_OF_SAMPLE' }).empty,
                clean: c.cleanSeries([{ time: 3, value: 1 }, { time: 1, value: 2 }, { time: 3, value: 4 }, { time: 2, value: NaN }]),
            };
        }"""
    )
    assert out["polylines"] == 2  # the gap breaks the line; it is never drawn through zero
    assert out["maxY"] <= 18  # no point dropped to the baseline
    assert out["emptyTooFew"] is True
    assert out["nan"] is True and out["inf"] is True
    assert out["clean"] == [{"time": 1, "value": 2}, {"time": 3, "value": 4}]
    page.close()
