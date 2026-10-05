"""Agents views (Trading Floor overview, agent terminal, agent activity).

Empty mode: every slot sleeps with no strategy, nothing is displayed as a
value, every control is locked. Fixture mode: declared agent state renders
verbatim (slot 02 runs FX-S003 in SIM with an FXA LONG position; slot 04 is on
STANDBY; slot 05 was not reported by the runtime and is NOT REPORTED, not
SLEEPING). Unknown slots render a proper state, never an error box.
"""

from __future__ import annotations

import pytest

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit

pytestmark = pytest.mark.browser

SLOTS = (1, 2, 3, 4, 5)
ROUTES = (
    ["/agents"]
    + [f"/agents/{n}" for n in SLOTS]
    + [f"/agents/{n}/activity" for n in SLOTS]
    + ["/agents/9", "/agents/x", "/agents/0/activity", "/agents/2/activity?kind=PROPOSAL", "/agents/2/activity?kind=NOPE"]
)


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


def _controls(page):
    return page.eval_on_selector_all(
        ".view [data-control]", "els => els.map(e => [e.dataset.control, e.getAttribute('data-enabled')])"
    )


def _text(page, selector):
    return page.inner_text(selector).upper()


# --------------------------------------------------------------------------- empty mode


@pytest.mark.parametrize("route", ROUTES)
def test_empty_routes_clean_and_valueless(empty_page, route):
    v = visit(empty_page, route)
    assert v.clean, v.describe()
    assert v.module in ("agents-overview", "agent-terminal", "agent-activity")
    assert present_values(empty_page) == [], f"{route} displays values with nothing connected"
    assert fake_value_hits(view_text(empty_page)) == [], f"{route} shows number-like text with nothing connected"
    ok = empty_page.eval_on_selector_all(".view .tone-ok", "els => els.map(e => e.textContent.trim())")
    assert ok == [], f"{route} shows a positive state with nothing connected: {ok}"


def test_empty_overview_five_sleeping_slots_without_strategy(empty_page):
    v = visit(empty_page, "/agents")
    assert v.clean, v.describe()
    cards = empty_page.eval_on_selector_all(
        ".ag-card", "els => els.map(e => [e.dataset.agentSlot, e.dataset.agentStatus, e.innerText.toUpperCase()])"
    )
    assert [c[0] for c in cards] == ["1", "2", "3", "4", "5"]
    for slot, status, text in cards:
        assert status == "SLEEPING", slot
        assert "NO ACTIVE STRATEGY" in text, slot
        assert "SLEEPING" in text, slot
    # fleet counts are not shown as facts when the runtime is not connected
    counts = empty_page.eval_on_selector_all(".ag-board__count", "els => els.map(e => e.hasAttribute('data-empty'))")
    assert counts and all(counts)
    # deployment + runtime controls exist and are all locked
    controls = _controls(empty_page)
    assert {k for k, _ in controls} >= {"ASSIGN_STRATEGY", "START_SIMULATION", "ENABLE_LIVE", "HALT_AGENT", "TRIP_KILL_SWITCH"}
    assert all(enabled == "0" for _, enabled in controls), controls
    text = view_text(empty_page).upper()
    assert "NO ACTIVE AGENT ACTIVITY" in text
    assert "STRATEGY REGISTRY NOT CONNECTED" in text


@pytest.mark.parametrize("slot", SLOTS)
def test_empty_terminal_sleeping_and_locked(empty_page, slot):
    v = visit(empty_page, f"/agents/{slot}")
    assert v.clean, v.describe()
    headline = empty_page.inner_text("[data-headline]").upper()
    assert headline == f"AGENT 0{slot} · SLEEPING · NO ACTIVE STRATEGY"
    assert empty_page.get_attribute(".ag-head", "data-agent-status") == "SLEEPING"
    controls = _controls(empty_page)
    assert {k for k, _ in controls} == {"ASSIGN_STRATEGY", "START_SIMULATION", "HALT_AGENT", "TRIP_KILL_SWITCH"}
    assert all(enabled == "0" for _, enabled in controls), controls
    assert all(empty_page.eval_on_selector_all(".view button[data-control]", "els => els.map(e => e.disabled)"))
    # every terminal area is present even though nothing is connected
    codes = empty_page.eval_on_selector_all(".view .panel__code", "els => els.map(e => e.textContent.trim())")
    assert codes == [f"AT-{i:02d}" for i in range(1, 16)]
    candles = empty_page.get_attribute('.chart[data-chart="candles"]', "data-has-data")
    assert candles == "0"
    assert "NO MARKET DATA" in view_text(empty_page).upper()
    assert empty_page.locator(".view canvas").count() == 0


def test_empty_activity_has_full_structure_and_cursor(empty_page):
    v = visit(empty_page, "/agents/3/activity")
    assert v.clean, v.describe()
    text = view_text(empty_page).upper()
    assert "NO ACTIVE AGENT ACTIVITY" in text
    assert empty_page.locator(".view .log__cursor").count() >= 1
    steps = empty_page.eval_on_selector_all(".ag-loop .step", "els => els.map(e => e.dataset.step)")
    assert steps == [
        "OBSERVE", "INTERPRET", "RECALL", "HYPOTHESIZE", "TEST", "EVALUATE", "LEARN", "WRITE_MEMORY", "PROPOSE",
        "RESEARCH_VALIDATION", "GOVERNANCE_APPROVAL", "NEW_VERSION",
    ]
    # counts are empty (not zero) when nothing is connected
    assert all(empty_page.eval_on_selector_all(".ag-loop .step__count", "els => els.map(e => e.hasAttribute('data-empty'))"))
    assert empty_page.locator(".ag-loop .step--boundary").count() == 1
    assert empty_page.locator("[data-kind-index]").count() == 18
    assert "NEW STRATEGY VERSION" in text and "AUTONOMOUS RESEARCH LEARNING" in text and "PRODUCTION CHANGE IS GATED" in text


# --------------------------------------------------------------------------- fixture mode


@pytest.mark.parametrize("route", ROUTES)
def test_fixture_routes_clean(fixture_page, route):
    v = visit(fixture_page, route)
    assert v.clean, v.describe()
    assert fixture_page.is_visible('[data-banner="synthetic"]')


def test_fixture_overview_slots_and_eligibility(fixture_page):
    v = visit(fixture_page, "/agents")
    assert v.clean, v.describe()
    statuses = fixture_page.eval_on_selector_all(".ag-card", "els => els.map(e => e.dataset.agentStatus)")
    assert statuses == ["SLEEPING", "SIMULATING", "SLEEPING", "STANDBY", "NOT_REPORTED"]
    card2 = fixture_page.inner_text('.ag-card[data-agent-slot="2"]').upper()
    assert "FX-S003" in card2 and "FXA LONG 2" in card2 and "SIM" in card2
    card5 = fixture_page.inner_text('.ag-card[data-agent-slot="5"]').upper()
    assert "NOT REPORTED" in card5 and "SLEEPING" not in card5
    board = dict(
        fixture_page.eval_on_selector_all(
            ".ag-board__col", "els => els.map(e => [e.dataset.boardStatus, e.querySelector('.ag-board__count').textContent.trim()])"
        )
    )
    assert board["SLEEPING"] == "2" and board["SIMULATING"] == "1" and board["STANDBY"] == "1"
    assert board["NOT_REPORTED"] == "1" and board["LIVE"] == "0"
    text = view_text(fixture_page).upper()
    assert "FX-S003" in text  # derived.controls.deployment_eligible (retired FX-S004 is never eligible)
    assert fixture_page.locator(".ag-log__row[data-event-id]").count() == 15
    assert all(enabled == "0" for _, enabled in _controls(fixture_page))
    assert fixture_page.locator('[data-memref="FX-M0003"]').count() == 1


def test_fixture_terminal_slot2_renders_declared_state(fixture_page):
    v = visit(fixture_page, "/agents/2", settle_ms=600)
    assert v.clean, v.describe()
    assert fixture_page.inner_text("[data-headline]").upper() == "AGENT 02 · SIMULATING · FX-S003 V2"
    candles = fixture_page.locator('.chart[data-chart="candles"][data-has-data="1"]')
    assert candles.count() == 1
    assert candles.locator("canvas").count() >= 1
    equity = fixture_page.locator('.chart[data-chart="area"][data-has-data="1"]')
    assert equity.count() == 1 and equity.locator("canvas").count() >= 1
    pos = fixture_page.locator('[data-position="FXA"]').locator("xpath=ancestor::tr").inner_text().upper()
    assert "FXA" in pos and "LONG" in pos
    link = fixture_page.locator("a[data-strategy-link]")
    assert link.inner_text() == "FX-S003" and link.get_attribute("href") == "#/strategy/FX-S003"
    text = view_text(fixture_page).upper()
    assert "FX-PKG-003-2" in text and "FIXTURE/APPROVAL.MD" in text
    # P&L via metric(): value + currency + basis chip
    pnl = fixture_page.inner_text(".ag-pnl").upper()
    assert "1,250.00" in pnl and "USD" in pnl and "SIM" in pnl
    assert fixture_page.locator(".ag-pnl .chip--basis").count() >= 3
    # execution stats as declared, including a real zero
    exec_text = fixture_page.inner_text(".ag-exec").upper()
    assert "42.0" in exec_text and "120.0" in exec_text and "14" in exec_text
    assert fixture_page.locator('.ag-limit[data-limit="max_contracts"]').count() == 1
    # activity: 15 events; research activity: the 7 research-kind events
    assert fixture_page.locator(".ag-fillbody .ag-log__row[data-event-id]").count() == 15
    research = fixture_page.eval_on_selector_all(
        ".ag-log--compact .ag-log__row", "els => els.map(e => e.dataset.kind)"
    )
    assert sorted(research) == sorted(["HYPOTHESIS", "TEST", "EVALUATION", "LEARNING", "MEMORY_WRITE", "PROPOSAL", "RESEARCH_OBSERVATION"])
    assert fixture_page.locator('a.ag-mem[href="#/memory/item/FX-M0003"]').count() == 1
    assert fixture_page.locator('[data-alert="FX-AL1"]').count() == 1
    controls = _controls(fixture_page)
    assert len(controls) == 4 and all(enabled == "0" for _, enabled in controls)


def test_fixture_terminal_slot5_not_reported(fixture_page):
    v = visit(fixture_page, "/agents/5")
    assert v.clean, v.describe()
    assert fixture_page.get_attribute(".ag-head", "data-agent-status") == "NOT_REPORTED"
    headline = fixture_page.inner_text("[data-headline]").upper()
    assert "NOT REPORTED" in headline and "SLEEPING" not in headline
    assert "DID NOT REPORT SLOT 05" in view_text(fixture_page).upper()


def test_fixture_terminal_slot4_standby(fixture_page):
    v = visit(fixture_page, "/agents/4")
    assert v.clean, v.describe()
    assert fixture_page.get_attribute(".ag-head", "data-agent-status") == "STANDBY"
    assert "AGENT 04 · STANDBY · NO ACTIVE STRATEGY" == fixture_page.inner_text("[data-headline]").upper()
    assert "FIXTURE: AWAITING DEPLOYMENT PACKAGE" in view_text(fixture_page).upper()
    # reported but declares none: "none" facts, not "not connected"
    assert "NO OPEN POSITIONS" in view_text(fixture_page).upper()


@pytest.mark.parametrize("route", ["/agents/9", "/agents/x", "/agents/0/activity"])
def test_unknown_slot_state(fixture_page, route):
    v = visit(fixture_page, route)
    assert v.clean, v.describe()
    assert fixture_page.locator('[data-empty-state="unknown-slot"]').count() == 1
    assert "UNKNOWN AGENT SLOT" in view_text(fixture_page).upper()
    assert fixture_page.locator(".ag-unknown__slot").count() == 5


def test_fixture_activity_slot2_stream_loop_and_proposals(fixture_page):
    v = visit(fixture_page, "/agents/2/activity")
    assert v.clean, v.describe()
    rows = fixture_page.eval_on_selector_all(".ag-log__row[data-event-id]", "els => els.map(e => e.dataset.eventId)")
    assert len(rows) == 15
    assert rows[0] == "FX-E0014" and rows[-1] == "FX-E0000"  # newest first
    loop = dict(
        fixture_page.eval_on_selector_all(
            ".ag-loop .step", "els => els.map(e => [e.dataset.step, e.querySelector('.step__count').textContent.trim()])"
        )
    )
    assert loop["OBSERVE"] == "2" and loop["PROPOSE"] == "1" and loop["WRITE_MEMORY"] == "1"
    # gated stages count this slot's proposals by state (FX-PR1 released, FX-PR2 in research)
    assert loop["RESEARCH_VALIDATION"] == "1" and loop["GOVERNANCE_APPROVAL"] == "0" and loop["NEW_VERSION"] == "1"
    proposals = fixture_page.locator('[data-proposal]').all_inner_texts()
    assert sorted(proposals) == ["FX-PR1", "FX-PR2"]
    text = view_text(fixture_page).upper()
    assert "RELEASED AS VERSION" in text and "IN RESEARCH" in text and "V2" in text
    traffic = fixture_page.inner_text('[data-traffic="MEMORY_RECALL"]').upper()
    assert "FX-M0003" in traffic
    assert fixture_page.locator('.ag-log__refs a[href="#/memory/item/FX-M0003"]').count() >= 2


def test_fixture_activity_kind_filter(fixture_page):
    v = visit(fixture_page, "/agents/2/activity?kind=PROPOSAL")
    assert v.clean, v.describe()
    kinds = fixture_page.eval_on_selector_all(".ag-log__row[data-event-id]", "els => els.map(e => e.dataset.kind)")
    assert kinds == ["PROPOSAL"]
    assert fixture_page.locator('.ag-log__refs a[href="#/strategy/FX-S003"]').count() >= 1
    assert fixture_page.get_attribute('.tab[aria-selected="true"]', "href") == "#/agents/2/activity?kind=PROPOSAL"
    v = visit(fixture_page, "/agents/2/activity?kind=NOPE")
    assert v.clean, v.describe()
    assert fixture_page.locator(".ag-log__row[data-event-id]").count() == 15
    assert "UNKNOWN EVENT KIND" in view_text(fixture_page).upper()


def test_fixture_activity_connected_but_empty_slot(fixture_page):
    v = visit(fixture_page, "/agents/1/activity")
    assert v.clean, v.describe()
    text = view_text(fixture_page).upper()
    assert "NO ACTIVE AGENT ACTIVITY" in text
    assert "AGENT 01 HAS RECORDED NO EVENTS" in text
    # a connected source with nothing recorded shows real zeros
    loop = fixture_page.eval_on_selector_all(".ag-loop .step__count", "els => els.map(e => e.textContent.trim())")
    assert loop[:9] == ["0"] * 9
    assert "NO PROPOSALS FROM THIS AGENT" in text


# --------------------------------------------------------------------------- partial / hostile state


def test_partial_state_runtime_without_registry_or_events(browser, state_factory):
    from .conftest import start_server

    url, server = start_server(state_factory(drop=("strategies", "memory", "agent_events.jsonl")))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents/2", settle_ms=500)
        assert v.clean, v.describe()
        text = view_text(page).upper()
        assert "REGISTRY NOT CONNECTED" in text  # strategy status is never inferred
        assert "NO ACTIVE AGENT ACTIVITY" in text and "AGENT_EVENTS.JSONL HAS NOT BEEN PRODUCED" in text
        assert "MEMORY.JSON NOT CONNECTED" in text
        v = visit(page, "/agents/2/activity")
        assert v.clean, v.describe()
        assert "PROPOSALS NOT CONNECTED" in view_text(page).upper()
        v = visit(page, "/agents")
        assert v.clean, v.describe()
        assert page.eval_on_selector_all(".ag-card", "els => els.map(e => e.dataset.agentStatus)") == [
            "SLEEPING", "SIMULATING", "SLEEPING", "STANDBY", "NOT_REPORTED",
        ]
        page.close()
    finally:
        server.should_exit = True


def test_agent_strings_are_escaped(browser, state_factory):
    from .conftest import start_server

    payload = '<img src="x" onerror="window.__pwned=1">'

    def mutate(d):
        a = d["data"]["agents"][1]
        a["codename"] = payload
        a["status_detail"] = payload
        a["alerts"][0]["message"] = payload
        return d

    url, server = start_server(state_factory({"agents": mutate}))
    try:
        page = new_page(browser, url)
        for route in ("/agents", "/agents/2", "/agents/2/activity"):
            v = visit(page, route, settle_ms=300)
            assert v.clean, v.describe()
            assert page.evaluate("window.__pwned === undefined"), route
            assert page.evaluate("document.querySelectorAll('.view img').length") == 0, route
        visit(page, "/agents/2")
        assert payload in view_text(page)
        page.close()
    finally:
        server.should_exit = True


@pytest.mark.parametrize("width", [1024, 1280, 1600, 2200])
def test_no_horizontal_overflow(browser, fixture_url, empty_url, width):
    for base in (fixture_url, empty_url):
        page = new_page(browser, base, width=width, height=900)
        for route in ("/agents", "/agents/2", "/agents/5", "/agents/2/activity", "/agents/9"):
            visit(page, route, settle_ms=150)
            overflow = page.evaluate("() => { const m = document.getElementById('main'); return m.scrollWidth - m.clientWidth }")
            assert overflow <= 1, f"{route} overflows by {overflow}px at {width}px ({base})"
        page.close()
