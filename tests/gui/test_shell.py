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
