"""Agents views (Trading Floor overview, agent terminal, agent activity).

Empty mode: every slot sleeps with no strategy, nothing is displayed as a
value, every control is locked. Fixture mode: declared agent state renders
verbatim (slot 02 runs FX-S003 in SIM with an FXA LONG position; slot 04 is on
STANDBY; slot 05 was not reported by the runtime and is NOT REPORTED, not
SLEEPING). Unknown slots render a proper state, never an error box.

Wording follows the source status: not connected (no state dir) ≠ not produced
(MISSING) ≠ rejected by the contract (INVALID) ≠ none recorded. Activity counts
are exact whole-stream counts (derived.agent_slots[i].events.by_kind / by_mode),
and record-bearing totals are split by origin, never merged.
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
    # not connected is not "no activity": the log says the stream is not connected
    assert "AGENT EVENT STREAM NOT CONNECTED" in text and "NO ACTIVE AGENT ACTIVITY" not in text
    assert "STRATEGY REGISTRY NOT CONNECTED" in text
    # no cross-check ran, so the panel never claims consistency
    assert "NO AGENT CROSS-CHECK RAN" in text and "CONSISTENT" not in text
    assert empty_page.locator('[data-check-coverage] [data-ran="1"]').count() == 0
    # the deployment rule is stated as policy, never as a current fact
    assert "NOTHING ELSE REACHES THE TRADING FLOOR" not in text and "POLICY:" in text
    assert "ASLEEP" not in text


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
    # AT-04: one empty state for "no signal", not an empty box above an empty state
    assert empty_page.locator(".ag-signal .empty").count() == 1
    assert empty_page.locator(".ag-signal [data-v], .ag-signal__state").count() == 0
    # AT-01 is a market chart; with nothing connected its mode is unknown, not "live"
    assert "LIVE CHART" not in view_text(empty_page).upper()
    assert empty_page.locator(".view .panel__actions .badge", has_text="MODE UNKNOWN").count() == 2


def test_empty_activity_has_full_structure_and_cursor(empty_page):
    v = visit(empty_page, "/agents/3/activity")
    assert v.clean, v.describe()
    text = view_text(empty_page).upper()
    assert "AGENT EVENT STREAM NOT CONNECTED" in text and "NO ACTIVE AGENT ACTIVITY" not in text
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
    # AGT-05: every agent node's status and refs text sits inside its node with padding
    nodes = fixture_page.eval_on_selector_all(
        "[data-net-slot]",
        """els => els.map(g => { const r = g.querySelector('rect').getBBox();
            return [g.dataset.netSlot, r.x, r.x + r.width, [...g.querySelectorAll('text')].map(t => { const b = t.getBBox(); return [t.textContent, b.x, b.x + b.width]; })]; })""",
    )
    assert len(nodes) == 5
    for slot, left, right, texts in nodes:
        for label, x0, x1 in texts:
            assert x0 >= left + 4 and x1 <= right - 4, (slot, label, x0, x1, left, right)
        status, refs = texts[1], texts[2]
        assert status[2] + 8 <= refs[1], (slot, status, refs)


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
    # the candle panel is a market chart, never titled "live"; both chart panels carry the assignment mode
    titles = fixture_page.eval_on_selector_all(".view .panel__title", "els => els.map(e => e.textContent.trim().toUpperCase())")
    assert "MARKET CHART" in titles and not any("LIVE" in t for t in titles), titles
    modes = fixture_page.eval_on_selector_all(".view .panel__actions .badge[data-state='SIM']", "els => els.map(e => e.textContent.trim())")
    assert modes == ["SIM MODE", "SIM MODE"], modes


def test_fixture_terminal_slot5_not_reported(fixture_page):
    v = visit(fixture_page, "/agents/5")
    assert v.clean, v.describe()
    assert fixture_page.get_attribute(".ag-head", "data-agent-status") == "NOT_REPORTED"
    headline = fixture_page.inner_text("[data-headline]").upper()
    assert "NOT REPORTED" in headline and "SLEEPING" not in headline
    assert "DID NOT REPORT SLOT 05" in view_text(fixture_page).upper()
    assert fixture_page.locator(".ag-signal .empty").count() == 1
    assert fixture_page.locator(".ag-signal__state").count() == 0


def test_fixture_terminal_slot4_standby(fixture_page):
    v = visit(fixture_page, "/agents/4")
    assert v.clean, v.describe()
    assert fixture_page.get_attribute(".ag-head", "data-agent-status") == "STANDBY"
    assert "AGENT 04 · STANDBY · NO ACTIVE STRATEGY" == fixture_page.inner_text("[data-headline]").upper()
    assert "FIXTURE: AWAITING DEPLOYMENT PACKAGE" in view_text(fixture_page).upper()
    # reported but declares none: "none" facts, not "not connected"
    assert "NO OPEN POSITIONS" in view_text(fixture_page).upper()
    assert fixture_page.locator(".view .panel__actions .badge", has_text="NO ASSIGNMENT").count() == 2


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
    # gated stages count this slot's proposals that reached each gate, cumulatively (FX-PR1
    # released, FX-PR2 in research): never 1 -> 0 -> 1, which reads as a release without approval
    assert loop["RESEARCH_VALIDATION"] == "2" and loop["GOVERNANCE_APPROVAL"] == "1" and loop["NEW_VERSION"] == "1"
    gated = [int(loop[k]) for k in ("RESEARCH_VALIDATION", "GOVERNANCE_APPROVAL", "NEW_VERSION")]
    assert gated == sorted(gated, reverse=True), gated
    note = fixture_page.inner_text(".ag-loop__note").upper()
    assert "CUMULATIVELY" in note and "0 REJECTED" in note
    assert fixture_page.get_attribute(".ag-loop__note", "data-window") == "complete"
    assert "ALL 15 OF ITS EVENTS" in note and "LOADED" not in note
    modes = dict(fixture_page.eval_on_selector_all(".ag-modes__cell", "els => els.map(e => [e.dataset.mode, e.querySelector('.v').textContent.trim()])"))
    assert modes == {"RESEARCH": "6", "SIM": "9", "PAPER": "0", "LIVE": "0"}
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
        # MISSING documents are "not produced", never "not connected"; strategy status is never inferred
        assert "REGISTRY NOT PRODUCED" in text
        assert "AGENT EVENT STREAM NOT PRODUCED" in text and "AGENT_EVENTS.JSONL HAS NOT BEEN PRODUCED" in text
        assert "NO ACTIVE AGENT ACTIVITY" not in text
        assert "MEMORY.JSON NOT PRODUCED" in text
        assert "NOT CONNECTED" not in text, "a MISSING source is labelled NOT CONNECTED on /agents/2"
        v = visit(page, "/agents/2/activity")
        assert v.clean, v.describe()
        text = view_text(page).upper()
        assert "PROPOSALS NOT PRODUCED" in text and "NOT CONNECTED" not in text
        assert "STRATEGIES.JSON HAS NOT BEEN PRODUCED" in page.inner_text(".ag-loop__note").upper()
        v = visit(page, "/agents")
        assert v.clean, v.describe()
        assert page.eval_on_selector_all(".ag-card", "els => els.map(e => e.dataset.agentStatus)") == [
            "SLEEPING", "SIMULATING", "SLEEPING", "STANDBY", "NOT_REPORTED",
        ]
        text = view_text(page).upper()
        assert "STRATEGY REGISTRY NOT PRODUCED" in text and "NOT CONNECTED" not in text
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


def test_terminal_quantities_are_not_rounded(browser, state_factory):
    """Fractional sizes are shown as declared (0.25 is never displayed as 0)."""
    from .conftest import start_server

    def mutate(d):
        a = d["data"]["agents"][1]
        a["positions"][0]["quantity"] = 0.25
        a["orders"][0]["quantity"] = 1.5
        a["recent_trades"][0]["quantity"] = 0.125
        return d

    url, server = start_server(state_factory({"agents": mutate}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents/2", settle_ms=300)
        assert v.clean, v.describe()

        def qty(selector):
            cells = page.locator(selector).locator("xpath=ancestor::tr").locator("td")
            headers = page.locator(selector).locator("xpath=ancestor::table").locator("th").all_inner_texts()
            return cells.nth([h.strip().upper() for h in headers].index("QTY")).inner_text().strip()

        assert qty('[data-position="FXA"]') == "0.25"
        assert qty('.ref:text-is("FX-O1")') == "1.5"
        assert qty('.ref:text-is("FX-TR1")') == "0.125"
        page.close()
    finally:
        server.should_exit = True


def _windowed_state(state_factory):
    """Slot 01 with 1,200 recorded events; the oldest 200 are HYPOTHESIS / RESEARCH (outside the 1,000 loaded)."""
    import json
    from datetime import datetime, timedelta, timezone

    target = state_factory()
    path = target / "agent_events.jsonl"
    t0 = datetime(2025, 12, 1, tzinfo=timezone.utc)
    lines = []
    for i in range(1200):
        old = i < 200
        lines.append(
            json.dumps(
                {
                    "event_id": f"W-{i:05d}",
                    "ts": (t0 + timedelta(minutes=i)).isoformat(),
                    "agent_slot": 1,
                    "kind": "HYPOTHESIS" if old else "OBSERVATION",
                    "mode": "RESEARCH" if old else "SIM",
                    "summary": f"FIXTURE window event {i}",
                    "refs": {"memory_ids": []},
                    "origin": "SYNTHETIC_FIXTURE",
                }
            )
        )
    path.write_text("\n".join(lines + path.read_text().splitlines()) + "\n")
    return target


def test_activity_counts_are_exact_over_the_whole_stream(browser, state_factory):
    """Stage, kind and mode counts come from derived by_kind / by_mode over every event, not the loaded window."""
    from .conftest import start_server

    url, server = start_server(_windowed_state(state_factory))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents/1/activity", settle_ms=400)
        assert v.clean, v.describe()
        sum_text = page.inner_text(".ag-sum").upper()
        assert "1,200" in sum_text and "1,000" in sum_text
        # the window holds 1,000 of 1,200 events, so the slot total is not split by origin
        assert "ALL ORIGINS" in sum_text
        loop = dict(
            page.eval_on_selector_all(
                ".ag-loop .step",
                "els => els.map(e => [e.dataset.step, [e.querySelector('.step__count').textContent.trim(), e.querySelector('.step__count').hasAttribute('data-empty')]])",
            )
        )
        # 200 hypotheses were recorded outside the loaded window: counted exactly, never a false 0
        assert loop["HYPOTHESIZE"] == ["200", False]
        assert loop["OBSERVE"] == ["1,000", False]
        # kinds that were never recorded are real zeros (the counts cover the whole stream)
        assert loop["TEST"] == ["0", False]
        assert page.get_attribute(".ag-loop__note", "data-window") == "complete"
        note = page.inner_text(".ag-loop__note").upper()
        assert "ALL 1,200 OF ITS EVENTS" in note and "PARTIAL" not in note
        kinds = dict(page.eval_on_selector_all("[data-kind-index]", "els => els.map(e => [e.dataset.kindIndex, e.querySelector('.v').textContent.trim()])"))
        assert kinds["HYPOTHESIS"] == "200" and kinds["OBSERVATION"] == "1,000" and kinds["FILL"] == "0"
        modes = dict(page.eval_on_selector_all(".ag-modes__cell", "els => els.map(e => [e.dataset.mode, e.querySelector('.v').textContent.trim()])"))
        assert modes == {"RESEARCH": "200", "SIM": "1,000", "PAPER": "0", "LIVE": "0"}
        tabs = page.eval_on_selector_all(".ag-tabs .tab", "els => els.map(e => e.textContent.replace(/\\s+/g, ' ').trim().toUpperCase())")
        assert any(t.startswith("HYPOTHESIS") and t.endswith("200") for t in tabs), tabs
        assert any(t.startswith("ALL") and t.endswith("1,200") for t in tabs), tabs
        # the stream list itself is the loaded window, and says so
        assert "LATEST 1,000 OF 1,200" in page.inner_text(".ag-fillbody .panel__sub").upper()
        # memory traffic is read from the loaded window: marked partial
        assert page.locator('.ag-traffic__window .badge[data-state="PARTIAL"]').count() == 1
        # a kind filter is served over every recorded event, not the loaded window
        v = visit(page, "/agents/1/activity?kind=HYPOTHESIS", settle_ms=400)
        assert v.clean, v.describe()
        kinds = page.eval_on_selector_all(".ag-log__row[data-event-id]", "els => els.map(e => e.dataset.kind)")
        assert len(kinds) == 200 and set(kinds) == {"HYPOTHESIS"}
        assert "ALL 200 RECORDED" in page.inner_text(".ag-fillbody .panel__sub").upper()
        assert "HAS RECORDED NO" not in view_text(page).upper()
        v = visit(page, "/agents/2/activity", settle_ms=300)
        assert v.clean, v.describe()
        assert page.get_attribute(".ag-loop__note", "data-window") == "complete"
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


# --------------------------------------------------------------------------- status-accurate wording


def _extra_field(doc):
    """A present, parseable document the contract rejects (INVALID), as a newer producer might write."""
    doc["data"]["__unexpected__"] = True
    return doc


def test_invalid_agents_json_is_a_source_error_not_a_sleeping_or_disconnected_fleet(browser, state_factory):
    from .conftest import start_server

    url, server = start_server(state_factory({"agents": _extra_field}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents", settle_ms=400)
        assert v.clean, v.describe()
        statuses = page.eval_on_selector_all(".ag-card", "els => els.map(e => e.dataset.agentStatus)")
        assert set(statuses) == {"SOURCE_ERROR"}
        text = view_text(page).upper()
        # the assignment is unreadable, so nothing — not even "no strategy" — is asserted
        assert "STRATEGY UNKNOWN" in text and "NO ACTIVE STRATEGY" not in text
        assert "REJECTED BY THE CONTRACT" in text
        assert "SLOTS DISPLAY AS SOURCE ERROR" in text and "SLEEPING BY DEFAULT" not in text
        assert "AGENT MEMORY REFERENCES REJECTED BY THE CONTRACT" in text
        assert "NOT CONNECTED" not in text, "an INVALID agents.json is labelled NOT CONNECTED"
        # the deployment-eligible table does not claim what the slots are doing
        assert "ASLEEP" not in text
        v = visit(page, "/agents/2", settle_ms=400)
        assert v.clean, v.describe()
        assert page.inner_text("[data-headline]").upper() == "AGENT 02 · SOURCE ERROR · STRATEGY UNKNOWN"
        text = view_text(page).upper()
        assert "NO ACTIVE STRATEGY" not in text and "NOT CONNECTED" not in text
        page.close()
    finally:
        server.should_exit = True


def test_invalid_strategies_json_is_a_contract_error(browser, state_factory):
    from .conftest import start_server

    url, server = start_server(state_factory({"strategies": _extra_field}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents", settle_ms=400)
        assert v.clean, v.describe()
        text = view_text(page).upper()
        assert "STRATEGY REGISTRY REJECTED BY THE CONTRACT" in text and "NOT CONNECTED" not in text
        # the registry status on the card is a red source error, never a calm grey absence
        reg = page.locator('.ag-card[data-agent-slot="2"] .ag-card__strat .badge')
        assert reg.inner_text().strip().upper() == "REGISTRY CONTRACT ERROR"
        assert "tone-bad" in reg.get_attribute("class")
        v = visit(page, "/agents/2/activity", settle_ms=300)
        assert v.clean, v.describe()
        text = view_text(page).upper()
        assert "PROPOSALS REJECTED BY THE CONTRACT" in text and "NOT CONNECTED" not in text
        assert "DOES NOT CONFORM TO THE STATE CONTRACT" in page.inner_text(".ag-loop__note").upper()
        page.close()
    finally:
        server.should_exit = True


def _invalid_events_state(state_factory):
    """agent_events.jsonl with one line the contract rejects (the stream is INVALID, 15 valid lines remain)."""
    target = state_factory()
    path = target / "agent_events.jsonl"
    path.write_text(path.read_text().rstrip("\n") + '\n{"event_id": "BROKEN"}\n')
    return target


def test_invalid_event_stream_counts_are_lower_bounds_never_zero(browser, state_factory):
    """Rejected lines cannot be attributed to a slot: a count over valid lines is ≥n and a zero is unknown."""
    from .conftest import start_server

    url, server = start_server(_invalid_events_state(state_factory))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents/2/activity", settle_ms=400)
        assert v.clean, v.describe()
        loop = dict(page.eval_on_selector_all(".ag-loop .step", "els => els.map(e => [e.dataset.step, e.querySelector('.step__count').textContent.trim()])"))
        assert loop["OBSERVE"] == "≥2" and loop["PROPOSE"] == "≥1"
        assert page.get_attribute(".ag-loop__note", "data-window") == "partial"
        assert "VALID LINES ONLY" in page.inner_text(".ag-loop__note").upper()
        modes = dict(page.eval_on_selector_all(".ag-modes__cell", "els => els.map(e => [e.dataset.mode, [e.querySelector('.v').textContent.trim(), e.querySelector('.v').classList.contains('is-empty')]])"))
        assert modes["SIM"] == ["≥9", False] and modes["PAPER"] == ["—", True]
        kinds = dict(page.eval_on_selector_all("[data-kind-index]", "els => els.map(e => [e.dataset.kindIndex, e.querySelector('.v').textContent.trim()])"))
        assert "0" not in kinds.values()
        # a slot with no valid line: neither "has recorded no events" nor a 0
        v = visit(page, "/agents/1/activity", settle_ms=300)
        assert v.clean, v.describe()
        text = view_text(page).upper()
        assert "NO VALID EVENT LINE" in text and "HAS RECORDED NO EVENTS" not in text
        assert "REJECTED BY THE CONTRACT" in text
        loop = page.eval_on_selector_all(".ag-loop .step__count", "els => els.map(e => e.textContent.trim())")
        assert "0" not in loop[:9]
        v = visit(page, "/agents", settle_ms=300)
        assert v.clean, v.describe()
        card1 = page.locator('.ag-card[data-agent-slot="1"] .ag-card__grid')
        events = card1.locator("dt", has_text="EVENTS").locator("xpath=following-sibling::dd").inner_text().strip()
        last = card1.locator("dt", has_text="LAST EVENT").locator("xpath=following-sibling::dd").inner_text().strip().upper()
        assert events == "—" and last != "NONE"
        fleet = page.inner_text(".ag-fleet").upper()
        assert "REJECTED BY THE CONTRACT" in fleet
        page.close()
    finally:
        server.should_exit = True


def _not_eligible(doc):
    """FX-S003 v2 loses its validation: no strategy is deployment-eligible, though Agent 02 still runs it."""
    for s in doc["data"]["strategies"]:
        for v in s["versions"]:
            v["validation_status"] = "IN_PROGRESS"
    return doc


def test_slots_note_follows_agent_state_not_the_registry_alone(browser, state_factory):
    """'Agents remain asleep' was asserted from strategies.json alone; the note now reads agents.json."""
    from .conftest import start_server

    url, server = start_server(state_factory({"strategies": _not_eligible}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents", settle_ms=400)
        assert v.clean, v.describe()
        assert page.locator('[data-empty-state="no-eligible-strategy"]').count() == 1
        note = page.inner_text("[data-slots-note]").upper()
        assert "AGENT 02 REPORTS SIMULATING" in note and "ASLEEP" not in note and "NO SLOT" not in note
        page.close()
    finally:
        server.should_exit = True


def test_slots_note_when_no_slot_is_active(browser, state_factory):
    from .conftest import start_server

    def idle(doc):
        for a in doc["data"]["agents"]:
            if a["status"] in ("SIMULATING", "PAPER", "LIVE"):
                a["status"] = "STANDBY"
        return doc

    url, server = start_server(state_factory({"strategies": _not_eligible, "agents": idle}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents", settle_ms=400)
        assert v.clean, v.describe()
        note = page.inner_text("[data-slots-note]").upper()
        assert "REPORTS NO SLOT SIMULATING, PAPER OR LIVE" in note
        page.close()
    finally:
        server.should_exit = True


def test_slots_note_without_agent_runtime(browser, state_factory):
    from .conftest import start_server

    url, server = start_server(state_factory({"strategies": _not_eligible}, drop=("agents",)))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents", settle_ms=400)
        assert v.clean, v.describe()
        note = page.inner_text("[data-slots-note]").upper()
        assert "UNKNOWN" in note and "AGENTS.JSON NOT PRODUCED" in note and "NO SLOT" not in note
        page.close()
    finally:
        server.should_exit = True


# --------------------------------------------------------------------------- origins never merged


def test_memory_and_event_totals_are_split_by_origin(browser, state_factory, fixture_page):
    from .conftest import start_server

    # fixture: every event is SYNTHETIC_FIXTURE, so the totals carry the SYNTH tag
    v = visit(fixture_page, "/agents")
    assert v.clean, v.describe()
    fleet = fixture_page.locator(".ag-fleet [data-origin-split] [data-origin]")
    assert fleet.evaluate_all("els => els.map(e => [e.dataset.origin, e.textContent.trim()])") == [["SYNTHETIC_FIXTURE", "15SYNTH"]]
    card2 = fixture_page.locator('.ag-card[data-agent-slot="2"] [data-origin-split] [data-origin]')
    assert card2.evaluate_all("els => els.map(e => e.dataset.origin)") == ["SYNTHETIC_FIXTURE"]
    v = visit(fixture_page, "/agents/2")
    assert v.clean, v.describe()
    assert fixture_page.locator(".ag-head__meta [data-origin-split]").count() == 1

    def mixed(doc):
        for i, m in enumerate(doc["data"]["memories"]):
            m["origin"] = "RECONSTRUCTED" if i >= 4 else "ORIGINAL"
        return doc

    url, server = start_server(state_factory({"memory": mixed}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/agents", settle_ms=400)
        assert v.clean, v.describe()
        mem = page.locator(".ag-net text[data-origin-split]")
        assert mem.count() == 1
        txt = mem.text_content().upper()
        assert "4 ORIGINAL" in txt and "2 RECONSTRUCTED" in txt and "6" not in txt
        assert "tone-warn" in page.locator('.ag-net tspan[data-origin="RECONSTRUCTED"]').get_attribute("class")
        page.close()
    finally:
        server.should_exit = True


# --------------------------------------------------------------------------- cross-check coverage


def test_cross_checks_list_which_checks_ran(fixture_page):
    v = visit(fixture_page, "/agents")
    assert v.clean, v.describe()
    ran = dict(fixture_page.eval_on_selector_all("[data-check-coverage] [data-check]", "els => els.map(e => [e.dataset.check, e.dataset.ran])"))
    assert ran == {"agent_eligibility": "1", "agent_activity": "1", "freshness": "0"}
    assert "NO PRODUCER DECLARED" in fixture_page.inner_text('[data-check="freshness"]').upper()


# --------------------------------------------------------------------------- styling / layout regressions


def test_empty_dashes_are_faint_in_every_value_cell(empty_page):
    """Value colour rules never override .is-empty (AA-03 by mode, AA-04 kinds, AA-06 traffic)."""
    v = visit(empty_page, "/agents/3/activity")
    assert v.clean, v.describe()
    colors = empty_page.evaluate(
        """() => Object.fromEntries(['.ag-sum__v .v.is-empty', '.ag-modes__cell .v.is-empty', '.ag-kinds__row .v.is-empty', '.ag-traffic__head .v.is-empty']
            .map(sel => { const e = document.querySelector(sel); return [sel, e ? getComputedStyle(e).color : null]; }))"""
    )
    assert None not in colors.values(), colors
    assert len(set(colors.values())) == 1, colors


@pytest.mark.parametrize("width", [1024, 1280])
def test_no_scroll_or_filler_inside_agent_panels(browser, fixture_url, empty_url, width):
    """AA-01 loop, AGT-05 network and handoff steps fit their panels; the AGT-01 board leaves no filler cell."""
    probe = """() => [...document.querySelectorAll('.view .ag-loop, .view .ag-loop .steps, .view .ag-net, .view .ag-steps--compact, .view .ag-rule__steps')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => [e.className, e.scrollWidth, e.clientWidth])"""
    for base in (fixture_url, empty_url):
        page = new_page(browser, base, width=width, height=900)
        for route in ("/agents", "/agents/2", "/agents/2/activity"):
            visit(page, route, settle_ms=200)
            assert page.evaluate(probe) == [], f"{route} at {width}px ({base})"
        visit(page, "/agents", settle_ms=200)
        # every board row is filled: the last status ends at the board's right edge
        edge = page.evaluate(
            """() => { const b = document.querySelector('.ag-board').getBoundingClientRect();
                const cols = [...document.querySelectorAll('.ag-board__col')]; const l = cols[cols.length - 1].getBoundingClientRect();
                return [Math.round(b.right - l.right), Math.round(b.bottom - l.bottom)]; }"""
        )
        assert all(abs(d) <= 2 for d in edge), edge
        # every slot card fits its status badge
        clipped = page.evaluate(
            """() => [...document.querySelectorAll('.ag-card')].filter(c => { const r = c.getBoundingClientRect();
                const b = c.querySelector('.ag-status').getBoundingClientRect(); return b.right > r.right + 0.5; }).map(c => c.dataset.agentSlot)"""
        )
        assert clipped == [], clipped
        page.close()
