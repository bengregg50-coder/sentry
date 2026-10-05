"""Crawl every route: no errors, no external requests, and in empty mode no
value is displayed anywhere. In fixture mode the synthetic banner is always on."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from atp.gui.command_centre import STATIC_DIR

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit

pytestmark = pytest.mark.browser

ROUTES = [
    "/", "/system",
    "/research", "/research/discovery", "/research/hypotheses", "/research/experiments", "/research/backtests",
    "/research/robustness", "/research/oos", "/research/validation", "/research/history",
    "/agents", "/agents/1", "/agents/2", "/agents/3", "/agents/4", "/agents/5", "/agents/1/activity", "/agents/2/activity",
    "/strategies", "/strategies/candidates", "/strategies/validated", "/strategies/deployed", "/strategies/retired",
    "/strategy/FX-S003", "/strategy/UNKNOWN-ID",
    "/memory", "/memory/graph", "/memory/findings", "/memory/lessons", "/memory/evidence", "/memory/agents",
    "/memory/item/FX-M0003", "/memory/item/UNKNOWN-ID",
    "/portfolio", "/risk", "/execution", "/live", "/data", "/data/sources", "/governance", "/insights",
]


def _route_patterns() -> list[str]:
    src = (STATIC_DIR / "js" / "routes.js").read_text()
    return re.findall(r'path:\s*"([^"]+)"', src)


def test_crawl_list_covers_every_declared_route():
    for pattern in _route_patterns():
        rx = re.compile("^" + re.sub(r":[a-zA-Z_]+", "[^/]+", pattern) + "$")
        assert any(rx.match(r) for r in ROUTES), f"route {pattern} is not crawled"


@pytest.fixture(scope="module")
def empty_page(browser, empty_url):
    page = new_page(browser, empty_url)
    yield page
    page.close()


@pytest.fixture(scope="module")
def fixture_page(browser, fixture_url):
    page = new_page(browser, fixture_url)
    yield page
    page.close()


@pytest.mark.parametrize("route", ROUTES)
def test_empty_mode_route_is_clean_and_shows_no_values(empty_page, route):
    v = visit(empty_page, route)
    assert v.clean, v.describe()
    assert v.module, "view did not render"
    assert present_values(empty_page) == [], f"{route} displays values with no state connected"
    assert fake_value_hits(view_text(empty_page)) == [], f"{route} shows number-like text with no state"
    assert not empty_page.is_visible('[data-banner="synthetic"]')
    assert empty_page.is_visible('[data-banner="no-source"]')


@pytest.mark.parametrize("route", ROUTES)
def test_fixture_mode_route_is_clean_and_bannered(fixture_page, route):
    v = visit(fixture_page, route)
    assert v.clean, v.describe()
    assert fixture_page.is_visible('[data-banner="synthetic"]'), "synthetic data must always be bannered"


def test_empty_mode_never_uses_positive_tone(empty_page):
    for route in ROUTES:
        visit(empty_page, route, settle_ms=150)
        ok = empty_page.eval_on_selector_all(".view .tone-ok", "els => els.map(e => e.textContent.trim())")
        assert ok == [], f"{route} shows a green (validated/passed) state with nothing connected: {ok}"


PARTIAL_SETS = {
    # what an early integration is likely to export first
    "research-governance-data": ("system", "strategies", "agents", "memory", "portfolio", "risk", "execution", "live", "insights", "agent_events.jsonl"),
    # agent runtime without a strategy registry or memory store
    "agents-only": ("system", "research", "strategies", "memory", "governance", "datasets", "portfolio", "risk", "execution", "live", "insights"),
}


@pytest.mark.parametrize("name", list(PARTIAL_SETS))
def test_partial_state_routes_are_clean(browser, state_factory, name):
    from .conftest import start_server

    url, server = start_server(state_factory(drop=PARTIAL_SETS[name]))
    try:
        page = new_page(browser, url)
        for route in ROUTES:
            v = visit(page, route, settle_ms=120)
            assert v.clean, f"[{name}] {v.describe()}"
        page.close()
    finally:
        server.should_exit = True
