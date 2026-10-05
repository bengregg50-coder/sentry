"""Command group views: Command Centre (/) and System Map (/system).

Empty mode must show the full structure with nothing displayed as a value;
fixture mode must render specific synthetic records; colours must never make
an unvalidated / not-reached / merely-connected state look like a pass.
"""

from __future__ import annotations

import json

import pytest

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit
from .conftest import start_server

pytestmark = pytest.mark.browser

ROUTES = {"/": "command-centre", "/system": "system-map"}


def _attr_all(page, selector, attr):
    return page.eval_on_selector_all(selector, f"els => els.map(e => e.getAttribute('{attr}'))")


def _text(page, selector):
    return page.inner_text(selector).strip()


# ---------------------------------------------------------------- both routes


@pytest.mark.parametrize("route", list(ROUTES))
def test_route_empty_renders_clean_and_shows_no_values(browser, empty_url, route):
    page = new_page(browser, empty_url)
    v = visit(page, route)
    assert v.clean, v.describe()
    assert v.module == ROUTES[route]
    assert present_values(page) == []
    assert fake_value_hits(view_text(page)) == []
    assert not page.is_visible('[data-banner="synthetic"]')
    page.close()


@pytest.mark.parametrize("route", list(ROUTES))
def test_route_fixture_renders_clean_with_synthetic_banner(browser, fixture_url, route):
    page = new_page(browser, fixture_url)
    v = visit(page, route)
    assert v.clean, v.describe()
    assert v.module == ROUTES[route]
    assert page.is_visible('[data-banner="synthetic"]')
    assert len(present_values(page)) > 0
    page.close()


@pytest.mark.parametrize("route", list(ROUTES))
@pytest.mark.parametrize("width", [1024, 1280, 2200])
def test_route_has_no_page_level_horizontal_overflow(browser, fixture_url, route, width):
    page = new_page(browser, fixture_url, width=width, height=1000)
    v = visit(page, route)
    assert v.clean, v.describe()
    overflow = page.evaluate(
        "() => { const m = document.querySelector('.main'); return m.scrollWidth - m.clientWidth }"
    )
    assert overflow <= 1, f"{route} @ {width}px overflows horizontally by {overflow}px"
    page.close()


# ---------------------------------------------------------------- Command Centre


def test_home_empty_structure_is_complete_and_honest(browser, empty_url):
    page = new_page(browser, empty_url)
    v = visit(page, "/")
    assert v.clean, v.describe()

    # trading floor: exactly five sleeping slots, no strategy
    assert page.locator("[data-agent-slot]").count() == 5
    assert set(_attr_all(page, "[data-agent-slot]", "data-agent-status")) == {"SLEEPING"}
    assert "NO ACTIVE STRATEGY" in view_text(page).upper()

    # central pipeline: all ten stages drawn, marked unavailable
    assert page.get_attribute("[data-pipeline-available]", "data-pipeline-available") == "0"
    assert page.locator(".pl-node").count() == 10

    # system status: six subsystems, none claimed connected
    assert _attr_all(page, ".view [data-subsystem]", "data-subsystem") == [
        "research_engine",
        "trading_engine",
        "agent_network",
        "data",
        "governance",
        "memory",
    ]
    assert set(_attr_all(page, ".cc-sys[data-state]", "data-state")) == {"NOT_CONNECTED"}

    # validated strategies: prominent, explicitly not connected (not zero)
    assert page.get_attribute('[data-kpi="validated"]', "data-available") == "0"
    assert page.get_attribute('[data-kpi="validated"] [data-v]', "data-empty") == "1"
    assert "THIS IS NOT A ZERO" in _text(page, '[data-kpi="validated"]').upper()

    # loop, risk, alerts, event stream: structure present, nothing connected
    assert page.locator(".cc-ring [data-cycle-node]").count() == 5
    assert set(_attr_all(page, ".cc-ring [data-cycle-node]", "data-connected")) == {"0"}
    assert page.locator(".cc-ring .flow-dash").count() == 0
    assert page.get_attribute("[data-kill-switch]", "data-kill-switch") == "NOT_CONNECTED"
    assert page.locator("[data-limit-group]").count() == 3
    assert page.locator("[data-severity]").count() == 3
    assert page.locator("[data-event]").count() == 0
    assert "EVENT STREAM NOT CONNECTED" in view_text(page).upper()

    # controls render locked, from derived.controls
    keys = _attr_all(page, ".cc-deck [data-control]", "data-control")
    assert keys == ["ASSIGN_STRATEGY", "START_SIMULATION", "ENABLE_LIVE", "HALT_AGENT", "TRIP_KILL_SWITCH"]
    assert set(_attr_all(page, ".cc-deck [data-control]", "data-enabled")) == {"0"}
    page.close()


def test_home_fixture_renders_declared_records(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/", settle_ms=600)
    assert v.clean, v.describe()

    # agent 02 simulates FX-S003; the other slots keep their declared states
    tile2 = page.locator('[data-agent-slot="2"]')
    assert tile2.get_attribute("data-agent-status") == "SIMULATING"
    assert "FX-S003" in tile2.inner_text()
    assert page.get_attribute('[data-agent-slot="4"]', "data-agent-status") == "STANDBY"
    assert page.get_attribute('[data-agent-slot="5"]', "data-agent-status") == "NOT_REPORTED"

    # research status: validated count is a real number from derived.research_summary
    assert page.get_attribute('[data-kpi="validated"]', "data-available") == "1"
    assert _text(page, '[data-kpi="validated"] [data-v]') == "1"

    # pipeline available with declared counts
    assert page.get_attribute("[data-pipeline-available]", "data-pipeline-available") == "1"
    assert page.locator('.pl-node[data-stage="DISCOVERY"] [data-v]').text_content().strip() == "12"
    assert page.locator('[data-terminal="REJECTED"] b').text_content().strip() == "3"

    # subsystems: declared states displayed verbatim, warning stays amber
    trading = page.locator('.cc-sys[data-subsystem="trading_engine"]')
    assert trading.get_attribute("data-state") == "DEGRADED"
    assert "tone-warn" in (trading.locator(".badge").first.get_attribute("class") or "")

    # research focus + active programme
    focus = _text(page, ".cc-focus")
    assert "FX-P02" in focus and "FX-H007" in focus and "FIXTURE: run implementation verification" in focus
    assert page.locator('[data-programme="FX-P02"]').count() == 1
    assert page.locator('[data-programme="FX-P01"]').count() == 0  # SEALED, not active
    assert page.locator('[data-hyp-status="REJECTED"] b').text_content().strip() == "2"

    # memory: recent titles resolved from documents.memory, origin badge shown
    row = page.locator('[data-memory="FX-M0006"]')
    assert "FIXTURE: sim slippage below model" in row.inner_text()
    assert row.locator('[data-state="SYNTHETIC_FIXTURE"]').count() == 1

    # risk: warn limit stays amber, kill switch as declared
    assert page.get_attribute("[data-kill-switch]", "data-kill-switch") == "ARMED"
    warn = page.locator('[data-limit="daily_loss"] .badge').get_attribute("class") or ""
    assert "tone-warn" in warn and "tone-ok" not in warn

    # live: metrics carry their basis chip
    live = _text(page, ".cc-panel-live")
    assert "RUNNING" in live.upper()
    assert page.locator(".cc-panel-live .chip--basis").count() >= 3

    # alerts: consistency findings + integrity notices
    assert page.locator('[data-finding="SYNTHETIC_FIXTURE_LOADED"]').count() == 1
    assert "FIXTURE: ORIGINAL FILES LOST" in view_text(page).upper()

    # events come from /api/cc/events via load()
    assert page.locator("[data-event]").count() == 6
    assert page.locator('[data-event="FX-E0014"]').count() == 1

    # system loop fully connected with real counts
    assert set(_attr_all(page, ".cc-ring [data-cycle-node]", "data-connected")) == {"1"}
    obs = page.locator('.cc-ring [data-cycle-node="OBSERVATIONS"] [data-v]').text_content().strip()
    assert obs == "15"
    page.close()


def test_home_connected_registry_with_no_validated_shows_real_zero(browser, state_factory):
    """Connected-but-empty is a fact (0); missing research.json is NOT PRODUCED, not 0."""

    def no_strategies(d):
        d["data"]["strategies"] = []
        d["data"]["proposals"] = []

    def unassign(d):
        for a in d["data"]["agents"]:
            a.pop("assignment", None)
            a["positions"] = []
            a["orders"] = []
            if a["status"] == "SIMULATING":
                a["status"] = "STANDBY"

    state = state_factory({"strategies": no_strategies, "agents": unassign}, drop=("research",))
    url, server = start_server(state)
    try:
        page = new_page(browser, url)
        v = visit(page, "/")
        assert v.clean, v.describe()
        assert page.get_attribute('[data-kpi="validated"]', "data-available") == "1"
        assert _text(page, '[data-kpi="validated"] [data-v]') == "0"
        assert "NONE VALIDATED" in _text(page, '[data-kpi="validated"]').upper()
        # research.json missing -> research figures empty and labelled NOT PRODUCED
        assert "NOT PRODUCED" in _text(page, ".cc-focus").upper()
        assert page.locator(".cc-ring [data-cycle-node=\"RESEARCH\"]").get_attribute("data-connected") == "0"
        # pipeline still available from the (empty) registry
        assert page.get_attribute("[data-pipeline-available]", "data-pipeline-available") == "1"
        assert "No strategy is validated, approved and packaged" in view_text(page)
        page.close()
    finally:
        server.should_exit = True


def test_home_invalid_source_is_reported_not_hidden(browser, state_factory):
    def corrupt(d):
        d["data"]["unexpected_field"] = True

    state = state_factory({"risk": corrupt})
    url, server = start_server(state)
    try:
        page = new_page(browser, url)
        v = visit(page, "/")
        assert v.clean, v.describe()
        assert page.get_attribute("[data-kill-switch]", "data-kill-switch") == "INVALID"
        assert "CONTRACT ERROR" in _text(page, ".cc-panel-risk").upper()
        page.close()
    finally:
        server.should_exit = True


# ---------------------------------------------------------------- System Map


def test_system_empty_shows_handoff_and_architecture_without_values(browser, empty_url):
    page = new_page(browser, empty_url)
    v = visit(page, "/system")
    assert v.clean, v.describe()
    assert present_values(page) == []

    steps = _attr_all(page, ".cc-handoff .step", "data-step")
    assert steps == [
        "RESEARCH_STRATEGY",
        "VALIDATION",
        "APPROVAL",
        "DEPLOYMENT_PACKAGE",
        "AGENT_ASSIGNMENT",
        "SIMULATION",
        "LIVE",
    ]
    assert set(_attr_all(page, ".cc-handoff .step__count", "data-empty")) == {"1"}
    assert "does not become tradable because it exists" in view_text(page)

    assert _attr_all(page, "[data-arch-node]", "data-arch-node") == [
        "research_engine",
        "state",
        "command_centre",
        "agent_trading",
    ]
    assert page.get_attribute('[data-arch-node="research_engine"]', "data-state") == "NOT_CONNECTED"
    assert set(_attr_all(page, "[data-arch-link]", "data-connected")) == {"0"}
    assert page.locator(".cc-arch .flow-dash").count() == 0

    learn = _attr_all(page, ".cc-learn .step", "data-step")
    assert len(learn) == 12 and learn[0] == "OBSERVE" and learn[-1] == "NEW_VERSION"
    assert "step--boundary" in (page.get_attribute('.cc-learn .step[data-step="RESEARCH_VALIDATION"]', "class") or "")

    assert page.locator(".cc-ring [data-cycle-node]").count() == 7
    assert set(_attr_all(page, ".cc-ring [data-cycle-node]", "data-connected")) == {"0"}

    roles = _attr_all(page, "[data-role]", "data-state")
    assert len(roles) == 7 and set(roles) == {"NOT_CONNECTED"}

    srcs = page.locator(".cc-map .table tbody tr")
    assert srcs.count() == 13
    page.close()


def test_system_fixture_renders_declared_counts(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/system")
    assert v.clean, v.describe()

    def count(step):
        return page.locator(f'.cc-handoff .step[data-step="{step}"] .step__count').text_content().strip()

    assert count("RESEARCH_STRATEGY") == "5"
    assert count("VALIDATION") == "2"
    assert count("AGENT_ASSIGNMENT") == "1"
    assert count("LIVE") == "0"

    eligible = _text(page, '[data-fact="eligible"]')
    assert "FX-S003" in eligible and "FX-S004" not in eligible  # retired strategies are never eligible

    rows = page.locator(".cc-panel-handoff .table tbody tr")
    assert rows.count() == 5
    s3 = page.locator('.cc-panel-handoff .table tbody tr[data-href="#/strategy/FX-S003"]')
    assert "ELIGIBLE" in s3.inner_text().upper()
    # not-reached steps are never green
    for cls in page.eval_on_selector_all(
        '.cc-panel-handoff .badge[data-state="NOT_REACHED"]', "els => els.map(e => e.className)"
    ):
        assert "tone-ok" not in cls

    learn_obs = page.locator('.cc-learn .step[data-step="OBSERVE"] .step__count').text_content().strip()
    assert learn_obs == "2"
    gov = page.locator('.cc-learn .step[data-step="GOVERNANCE_APPROVAL"] .step__count').text_content().strip()
    assert gov == "0"

    assert page.get_attribute('[data-role="BACKTESTER"]', "data-state") == "BLOCKED"
    assert page.get_attribute('[data-role="GOVERNANCE"]', "data-state") == "NOT_BUILT"

    # self-improvement: evidence counts stay separated by origin; "better" stages unscored
    ev = page.locator('.cc-ring [data-cycle-node="EVIDENCE"] [data-v]').text_content().strip()
    assert ev == "9"
    assert page.get_attribute('.cc-ring [data-cycle-node="BETTER_STRATEGIES"] [data-v]', "data-empty") == "1"
    assert "9" in _text(page, '[data-ledger="Trial records · original"]')
    assert "2" in _text(page, '[data-ledger="Trial records · reconstructed"]')

    # architecture overlay: everything connected; agent channel stays locked
    assert page.get_attribute('[data-arch-link="research-state"]', "data-connected") == "1"
    assert page.get_attribute('[data-arch-link="cc-agents"]', "data-connected") == "0"
    assert page.get_attribute('[data-arch-node="agent_trading"]', "data-state") == "ONLINE"

    # source status: connected is cyan (info), never green
    for cls in page.eval_on_selector_all('.cc-map .table .badge[data-state="CONNECTED"]', "els => els.map(e => e.className)"):
        assert "tone-info" in cls and "tone-ok" not in cls
    assert "15 valid" in view_text(page)
    page.close()


def test_system_payload_text_is_escaped(browser, state_factory):
    """Producer strings are data: markup inside them must render as text."""

    def inject(d):
        d["data"]["roles"][0]["detail"] = "<img src=x onerror=alert(1)><b>bold</b>"
        d["data"]["focus"]["next_action"] = "<script>window.__pwned=1</script>"

    state = state_factory({"research": inject})
    url, server = start_server(state)
    try:
        page = new_page(browser, url)
        for route in ("/system", "/"):
            v = visit(page, route)
            assert v.clean, v.describe()
            assert page.locator(".view img").count() == 0
            assert page.evaluate("window.__pwned === undefined")
        assert "<img src=x" in view_text(page) or "<script>" in view_text(page)
        page.close()
    finally:
        server.should_exit = True


def test_fixture_documents_are_json(state_factory):
    """Guard: the mutation helpers above rely on these keys existing in the fixture."""
    state = state_factory()
    research = json.loads((state / "research.json").read_text())
    assert research["data"]["roles"] and research["data"]["focus"]
