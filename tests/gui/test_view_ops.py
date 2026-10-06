"""Operations views (Portfolio, Risk, Execution, Live Engine).

Invariants: with no state connected nothing displays a value and the live
trading state reads NOT CONNECTED (never DISABLED); with the synthetic fixture
the declared records render verbatim with their states and bases.
"""

from __future__ import annotations

import pytest

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit
from .conftest import start_server

pytestmark = pytest.mark.browser

ROUTES = ["/portfolio", "/risk", "/execution", "/live"]
MODULES = {"/portfolio": "portfolio", "/risk": "risk", "/execution": "execution", "/live": "live-engine"}


def _attr(page, selector: str, name: str) -> str | None:
    return page.get_attribute(selector, name)


def _text(page, selector: str) -> str:
    return (page.text_content(selector) or "").strip()


def _step_counts(page) -> dict[str, str]:
    """Deployment-path stepper counts by step key (text as displayed)."""
    return page.evaluate(
        "Object.fromEntries([...document.querySelectorAll('.ops-path .step')].map(s => [s.dataset.step, (s.querySelector('.step__count')?.textContent || '').trim()]))"
    )


def _unallocated(page) -> int:
    return page.evaluate("[...document.querySelectorAll('.ops-none')].filter(e => e.textContent.trim() === 'UNALLOCATED').length")


# --------------------------------------------------------------------------- empty mode


def test_ops_empty_routes_render_clean_with_no_values(browser, empty_url):
    page = new_page(browser, empty_url)
    for route in ROUTES:
        v = visit(page, route)
        assert v.clean, v.describe()
        assert v.module == MODULES[route]
        assert present_values(page) == [], route
        assert fake_value_hits(view_text(page)) == [], route
        # Nothing reads as passed/validated (green) when nothing is connected.
        assert page.eval_on_selector_all(".view .tone-ok", "els => els.length") == 0, route
        # Structure stays visible: panels with codes, not one big "no data" box.
        codes = page.eval_on_selector_all(".view .panel__code", "els => els.map(e => e.textContent.trim())")
        assert len(codes) >= 6, (route, codes)
        assert page.locator(".view .empty").count() >= 2, route
    page.close()


def test_live_empty_says_not_connected_never_disabled(browser, empty_url):
    page = new_page(browser, empty_url)
    v = visit(page, "/live")
    assert v.clean, v.describe()
    assert _attr(page, "[data-live-trading]", "data-live-trading") == "NOT_CONNECTED"
    assert _text(page, ".ops-live__v") == "NOT CONNECTED"
    flag_cls = _attr(page, "[data-live-trading]", "class")
    assert "tone-ok" not in flag_cls and "tone-info" not in flag_cls
    text = view_text(page).upper()
    assert "DISABLED" not in text
    assert "THIS COMMAND CENTRE HAS NO ORDER-ROUTING CAPABILITY" in text
    # Trading mode / enabled cells claim nothing.
    assert _attr(page, "[data-trading-mode]", "data-empty") == "1"
    assert _attr(page, "[data-trading-enabled]", "data-empty") == "1"
    # No mode rung is highlighted without a source.
    assert page.locator(".ops-ladder__rung[data-current]").count() == 0
    # Interlocks report their sources as not connected (except the structural no-routing fact).
    assert _attr(page, '[data-interlock="research_live_separation"]', "data-state") == "NOT_CONNECTED"
    assert _attr(page, '[data-interlock="kill_switch"]', "data-state") == "NOT_CONNECTED"
    # Controls are locked with server-computed blockers.
    for key in ("ENABLE_LIVE", "TRIP_KILL_SWITCH", "HALT_AGENT"):
        assert _attr(page, f'.control[data-control="{key}"]', "data-enabled") == "0"
    assert page.locator(".ops-path .step").count() == 6
    # The approval step is never labelled LIVE scope (it completes on any scope); its LIVE-scope
    # subset claims nothing without strategies.json.
    assert "LIVE" not in _text(page, '.ops-path .step[data-step="APPROVAL"] .step__label').upper()
    assert _attr(page, "[data-live-scope-approvals]", "data-live-scope-approvals") == ""
    # Live cross-checks: one NOT CONNECTED tile, no duplicate empty state underneath.
    assert _attr(page, '[data-interlock="live_findings"]', "data-state") == "NOT_CONNECTED"
    assert page.locator('[data-empty-state="no-live-findings"]').count() == 0
    assert page.locator("[data-live-findings]").count() == 0
    page.close()


def _interlock_rows(page) -> list[int]:
    """Number of interlock tiles on each visual row of the LIV-02 grid."""
    return page.evaluate(
        """() => {
            const rows = new Map();
            for (const el of document.querySelectorAll('.ops-locks > .ops-lock')) {
                const top = Math.round(el.getBoundingClientRect().top);
                rows.set(top, (rows.get(top) || 0) + 1);
            }
            return [...rows.keys()].sort((a, b) => a - b).map((k) => rows.get(k));
        }"""
    )


@pytest.mark.parametrize("width", [1024, 1440, 1920, 2560])
def test_live_interlocks_form_a_balanced_grid(browser, empty_url, width):
    # Six interlocks never leave one card stranded on its own row (5 + 1 / 4 + 2).
    page = new_page(browser, empty_url, width=width)
    v = visit(page, "/live")
    assert v.clean, v.describe()
    assert _interlock_rows(page) == [3, 3], width
    page.close()


def test_risk_and_portfolio_empty_keep_structure(browser, empty_url):
    page = new_page(browser, empty_url)
    visit(page, "/risk")
    assert _attr(page, "[data-kill-switch]", "data-kill-switch") == "NOT_CONNECTED"
    assert "ARMED" not in _text(page, ".ops-ks__state")
    assert page.locator("[data-agent-limits]").count() == 5
    assert page.locator(".ops-limit").count() == 0  # no default limits are ever invented
    visit(page, "/portfolio")
    assert _attr(page, "[data-portfolio-mode]", "data-portfolio-mode") == "NOT_CONNECTED"
    assert page.get_attribute(".chart", "data-has-data") == "0"
    # Five agent slots are always shown, none with an allocation.
    rows = page.eval_on_selector_all(".view .ops-slot-link", "els => els.map(e => e.textContent.trim())")
    assert {f"AGENT 0{i}" for i in range(1, 6)} <= set(rows)
    assert page.locator("[data-allocation]").count() == 0
    visit(page, "/execution")
    assert page.locator("[data-fill]").count() == 0
    assert page.locator('.ops-hbar:not(.is-empty)').count() == 0
    page.close()


# --------------------------------------------------------------------------- fixture mode


def test_ops_fixture_routes_render_clean(browser, fixture_url):
    page = new_page(browser, fixture_url)
    for route in ROUTES:
        v = visit(page, route)
        assert v.clean, v.describe()
        assert v.module == MODULES[route]
        assert page.is_visible('[data-banner="synthetic"]')
        # Synthetic provenance is labelled on the page itself.
        assert "SYNTHETIC FIXTURE" in view_text(page).upper(), route
    page.close()


def test_live_fixture_sim_mode_and_live_trading_disabled(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/live")
    assert v.clean, v.describe()
    assert _attr(page, "[data-live-trading]", "data-live-trading") == "DISABLED"
    assert _text(page, ".ops-live__v") == "DISABLED"
    assert _attr(page, "[data-trading-mode]", "data-trading-mode") == "SIM"
    assert _text(page, "[data-trading-mode] .badge") == "SIM"
    assert _attr(page, "[data-trading-enabled]", "data-trading-enabled") == "false"
    assert _text(page, "[data-trading-enabled] .badge") == "DISABLED"
    assert _attr(page, "[data-engine-state]", "data-engine-state") == "RUNNING"
    assert _attr(page, ".ops-ladder__rung[data-current]", "data-rung") == "SIM"
    assert _attr(page, '[data-interlock="research_live_separation"]', "data-state") == "PASS"
    # A declared check without detail is described as the check, never as "not reported".
    assert "REPORTS NO" not in _text(page, '[data-interlock="research_live_separation"]').upper()
    assert _attr(page, '[data-interlock="kill_switch"]', "data-state") == "ARMED"
    # Fixture approvals are SIM-scope only: no LIVE-scope approval is on record.
    assert "NONE ON RECORD" in _text(page, '[data-interlock="live_scope_approvals"]').upper()
    # Deployment path: FX-S003 v2 is running in SIM (an ongoing simulation is RUNNING, never
    # COMPLETE) and has not reached live.
    assert page.locator('[data-path-strategy="FX-S003"]').count() == 1
    row = page.locator('tr:has([data-path-strategy="FX-S003"])')
    states = row.locator("[data-step-state]").evaluate_all("els => els.map(e => e.dataset.stepState)")
    assert states == ["COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "RUNNING", "NOT_REACHED"]
    # Stepper: fixture approvals are SIM scope. The approval step counts any scope and says so;
    # its LIVE-scope subset is 0, agreeing with the LIVE-scope approvals interlock. Withdrawn
    # strategies (FX-S004 RETIRED, FX-S005 REJECTED) are listed but never counted on the path.
    approval = '.ops-path .step[data-step="APPROVAL"]'
    assert "LIVE" not in _text(page, f"{approval} .step__label").upper()
    assert "ANY SCOPE" in _text(page, f"{approval} .step__detail").upper()
    assert _step_counts(page) == {
        "VALIDATION": "1", "APPROVAL": "1", "DEPLOYMENT_PACKAGE": "1", "AGENT_ASSIGNMENT": "1", "SIMULATION": "0", "LIVE": "0",
    }
    assert _attr(page, "[data-live-scope-approvals]", "data-live-scope-approvals") == "0"
    assert _text(page, "[data-live-scope-approvals] .v") == "0"
    # The ongoing simulation is shown as running, not as a completed step.
    assert _attr(page, "[data-sim-running]", "data-sim-running") == "1"
    assert _attr(page, "[data-path-withdrawn]", "data-path-withdrawn") == "2"
    assert page.locator('tr:has([data-path-strategy="FX-S004"]) [data-withdrawn]').count() == 1
    assert page.locator('tr:has([data-path-strategy="FX-S003"]) [data-withdrawn]').count() == 0
    # One origin in the registry: plain counts, no per-origin split.
    assert page.locator(".ops-path [data-origin-split]").count() == 0
    # No live findings: the tile says so once; no second full-width empty state repeats it.
    assert _attr(page, '[data-interlock="live_findings"]', "data-state") == ""
    assert "NO FINDINGS" in _text(page, '[data-interlock="live_findings"] .badge').upper()
    assert page.locator('[data-empty-state="no-live-findings"]').count() == 0
    assert page.locator("[data-live-findings]").count() == 0
    # Connections and heartbeat from live.json.
    assert page.locator('.ops-conn[data-connection="FIXTURE sim broker"]').count() == 1
    page.close()


def test_risk_fixture_kill_switch_and_daily_loss_warn(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/risk")
    assert v.clean, v.describe()
    assert _attr(page, "[data-kill-switch]", "data-kill-switch") == "ARMED"
    assert _text(page, ".ops-ks__state") == "ARMED"
    limit = '.ops-limit[data-limit="daily_loss"]'
    assert _attr(page, limit, "data-state") == "WARN"
    badge_cls = _attr(page, f"{limit} .badge", "class")
    assert "tone-warn" in badge_cls and "tone-ok" not in badge_cls
    assert "tone-warn" in _attr(page, f"{limit} .meter", "class")
    nums = _text(page, f"{limit} .ops-limit__nums")
    assert "1,700.00" in nums and "2,000.00" in nums
    # OK limits keep their declared state.
    assert _attr(page, '.ops-limit[data-limit="gross"]', "data-state") == "OK"
    # Breach and the derived risk finding are both shown.
    assert "FX-B1" in view_text(page)
    assert page.locator('.finding[data-finding="RISK_BREACH"]').count() == 1
    # Per-agent limits come from agents.json (agent 02 only).
    assert page.locator('[data-agent-limits="2"] .ops-limit[data-limit="max_contracts"]').count() == 1
    assert page.locator('[data-agent-limits="1"] .ops-limit').count() == 0
    page.close()


def test_portfolio_fixture_equity_chart_and_allocation(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/portfolio", settle_ms=600)
    assert v.clean, v.describe()
    assert _attr(page, ".chart[data-chart='area']", "data-has-data") == "1"
    assert page.locator(".chart[data-chart='area'] canvas").count() > 0
    assert _attr(page, "[data-portfolio-mode]", "data-portfolio-mode") == "SIM"
    alloc_row = page.locator("tr:has([data-allocation='FX-S003'])")
    assert alloc_row.count() == 1
    row_text = alloc_row.inner_text()
    assert "AGENT 02" in row_text and "v2" in row_text and "100.00" in row_text and "100,000.00" in row_text
    # Unallocated slots say so (connected source), never a zero weight.
    assert _unallocated(page) == 4
    # P&L carries its basis chip.
    assert _text(page, '[data-ops-metric="realized"] .chip--basis') == "SIM"
    assert "1,250.00" in _text(page, '[data-ops-metric="realized"]')
    # Exposures render gross and net per key, including a short net.
    assert page.locator(".ops-expo__row").count() == 2
    assert "-18.00" in _text(page, '[data-exposure="fx-rates"]')
    page.close()


def test_execution_fixture_fill_and_latency(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/execution")
    assert v.clean, v.describe()
    assert page.locator('[data-fill="FX-TR1"]').count() == 1
    fill_row = page.locator('tr:has([data-fill="FX-TR1"])').inner_text()
    assert "1.20" in fill_row and "bps" in fill_row and "SIM" in fill_row and "AGENT 02" in fill_row
    text = view_text(page)
    assert "42.0" in text and "120.0" in text
    assert _text(page, '.ops-slip [data-slip="model"] .v').startswith("1.50")
    assert page.locator('[data-slip-agent="2"]').count() == 1
    assert "FX-O1" in text
    page.close()


# --------------------------------------------------------------------------- mutated state


def test_live_enabled_in_live_mode_is_flagged(browser, state_factory):
    def live_on(doc):
        doc["data"]["trading_mode"] = "LIVE"
        doc["data"]["trading_enabled"] = True

    url, server = start_server(state_factory({"live": live_on}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/live")
        assert v.clean, v.describe()
        assert _attr(page, "[data-live-trading]", "data-live-trading") == "ENABLED"
        assert _attr(page, ".ops-ladder__rung[data-current]", "data-rung") == "LIVE"
        # The server-side cross-check (no LIVE-scope approval exists) is surfaced, not hidden.
        assert page.locator('.finding[data-finding="LIVE_ENABLED_WITHOUT_APPROVED_STRATEGY"]').count() == 1
        assert _attr(page, '[data-interlock="live_findings"]', "data-state") == "CRITICAL"
        # The findings themselves are listed under the interlock grid.
        assert page.locator('[data-live-findings] .finding[data-finding="LIVE_ENABLED_WITHOUT_APPROVED_STRATEGY"]').count() == 1
        page.close()
    finally:
        server.should_exit = True


def test_live_scope_approval_is_counted_apart_from_any_scope(browser, state_factory):
    def live_small(doc):
        for s in doc["data"]["strategies"]:
            if s["strategy_id"] == "FX-S003":
                cur = next(v for v in s["versions"] if v["version"] == s["current_version"])
                cur["approval"]["scope"] = "LIVE_SMALL"

    url, server = start_server(state_factory({"strategies": live_small}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/live")
        assert v.clean, v.describe()
        approval = '.ops-path .step[data-step="APPROVAL"]'
        # FX-S003 (LIVE SMALL) is the one active approval; withdrawn FX-S004 (SIM) is not counted.
        assert _text(page, f"{approval} .step__count") == "1"
        assert _attr(page, "[data-live-scope-approvals]", "data-live-scope-approvals") == "1"
        assert _attr(page, '[data-interlock="live_scope_approvals"]', "data-state") == "APPROVED"
        assert page.locator('[data-interlock="live_scope_approvals"] [data-live-approved="FX-S003"]').count() == 1
        page.close()
    finally:
        server.should_exit = True


def test_trading_enabled_in_sim_is_not_live_trading(browser, state_factory):
    def sim_on(doc):
        doc["data"]["trading_enabled"] = True

    url, server = start_server(state_factory({"live": sim_on}))
    try:
        page = new_page(browser, url)
        visit(page, "/live")
        assert _attr(page, "[data-live-trading]", "data-live-trading") == "DISABLED"
        assert _attr(page, "[data-trading-enabled]", "data-trading-enabled") == "true"
        assert "no live orders" in _text(page, ".ops-live__sub")
        page.close()
    finally:
        server.should_exit = True


def test_missing_and_invalid_sources_are_named_not_zeroed(browser, state_factory):
    def corrupt_live(doc):
        doc["data"]["trading_mode"] = "TURBO"  # not in the contract

    def empty_book(doc):
        doc["data"].update({"positions": [], "exposures": [], "allocations": [], "equity": [], "pnl": None, "drawdown": None})

    url, server = start_server(state_factory({"live": corrupt_live, "portfolio": empty_book}, drop=("risk",)))
    try:
        page = new_page(browser, url)
        v = visit(page, "/live")
        assert v.clean, v.describe()
        assert _attr(page, "[data-live-trading]", "data-live-trading") == "INVALID"
        assert _text(page, ".ops-live__v") == "CONTRACT ERROR"
        assert "tone-bad" in _attr(page, "[data-live-trading]", "class")
        # A broken live.json claims no trading state (the validator's message is quoted verbatim).
        assert _attr(page, "[data-trading-enabled]", "data-empty") == "1"
        assert "does not conform to the state contract" in _text(page, ".ops-live__sub")

        visit(page, "/risk")
        assert _attr(page, "[data-kill-switch]", "data-kill-switch") == "NOT_CONNECTED"
        assert _text(page, ".ops-ks__state") == "NOT PRODUCED"
        # Section limits come only from risk.json: none are invented without it.
        assert page.evaluate("[...document.querySelectorAll('.ops-limit')].filter(e => !e.closest('[data-agent-limits]')).length") == 0
        assert page.locator('[data-agent-limits="2"] .ops-limit').count() == 2  # agents.json still declares these

        visit(page, "/portfolio")
        # Connected but empty: a declared zero is a fact; absent P&L stays absent.
        assert _text(page, '[data-ops-stat="positions"] .stat__value') == "0"
        assert "is-empty" in _attr(page, '[data-ops-metric="realized"] .v', "class")
        assert page.locator('[data-empty-state="no-positions"]').count() == 1
        assert page.locator('[data-empty-state="no-exposures"]').count() == 1
        assert _unallocated(page) == 5
        page.close()
    finally:
        server.should_exit = True


def test_ops_strings_are_escaped(browser, state_factory):
    payload = '<img src=x onerror="window.__ops_xss=1">'

    def inject(doc):
        doc["data"]["detail"] = payload
        doc["data"]["connections"][0]["name"] = payload

    url, server = start_server(state_factory({"live": inject}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/live")
        assert v.clean, v.describe()
        assert page.evaluate("window.__ops_xss === undefined")
        assert payload in view_text(page)
        page.close()
    finally:
        server.should_exit = True



def test_tripped_kill_switch_and_breach_limit_render_red(browser, state_factory):
    def trip(doc):
        doc["data"]["kill_switch"] = {"state": "TRIPPED", "detail": "FIXTURE trip", "tripped_at": doc["data"]["as_of"]}
        doc["data"]["daily_limits"][0]["state"] = "BREACH"

    url, server = start_server(state_factory({"risk": trip}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/risk")
        assert v.clean, v.describe()
        assert _attr(page, "[data-kill-switch]", "data-kill-switch") == "TRIPPED"
        assert "tone-bad" in _attr(page, "[data-kill-switch]", "class")
        assert page.locator('.finding[data-finding="KILL_SWITCH_TRIPPED"]').count() == 1
        limit = '.ops-limit[data-limit="daily_loss"]'
        assert "tone-bad" in _attr(page, f"{limit} .badge", "class")
        assert "tone-bad" in _attr(page, limit, "class")
        visit(page, "/live")
        assert _attr(page, '[data-interlock="kill_switch"]', "data-state") == "TRIPPED"
        page.close()
    finally:
        server.should_exit = True


# --------------------------------------------------------------------------- round 2 regressions


def _set_scope(doc, strategy_id, scope):
    for s in doc["data"]["strategies"]:
        if s["strategy_id"] == strategy_id:
            cur = next(v for v in s["versions"] if v["version"] == s["current_version"])
            cur["approval"]["scope"] = scope


def test_withdrawn_live_scope_approval_is_not_counted_for_live(browser, state_factory):
    # FX-S004 is RETIRED. A LIVE-scope approval on its current version is not a path to live
    # capital: the interlock and the stepper both leave it out and say so.
    url, server = start_server(state_factory({"strategies": lambda d: _set_scope(d, "FX-S004", "LIVE")}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/live")
        assert v.clean, v.describe()
        tile = '[data-interlock="live_scope_approvals"]'
        assert "NONE ON RECORD" in _text(page, f"{tile} .badge").upper()
        assert "tone-ok" not in _attr(page, tile, "class")
        assert _attr(page, f"{tile} [data-live-withdrawn]", "data-live-withdrawn") == "1"
        assert "FX-S004" in _text(page, f"{tile} [data-live-withdrawn]")
        assert _attr(page, "[data-live-scope-approvals]", "data-live-scope-approvals") == "0"
        assert _step_counts(page)["APPROVAL"] == "1"
        page.close()
    finally:
        server.should_exit = True


def test_deployment_path_counts_are_kept_per_origin(browser, state_factory):
    # A registry mixing ORIGINAL and RECONSTRUCTED strategies never shows one merged step count.
    def mix(doc):
        for s in doc["data"]["strategies"]:
            s["origin"] = "RECONSTRUCTED" if s["strategy_id"] == "FX-S003" else "ORIGINAL"

    url, server = start_server(state_factory({"strategies": mix}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/live")
        assert v.clean, v.describe()
        split = page.evaluate(
            """() => Object.fromEntries([...document.querySelectorAll('.ops-path .step')].map(s => [
                s.dataset.step,
                Object.fromEntries([...s.querySelectorAll('.step__count [data-origin]')].map(n => [n.dataset.origin, n.querySelector('.v').textContent.trim()])),
            ]))"""
        )
        # Active population: FX-S001 / FX-S002 ORIGINAL, FX-S003 RECONSTRUCTED (FX-S004/5 withdrawn).
        assert split["VALIDATION"] == {"ORIGINAL": "0", "RECONSTRUCTED": "1"}
        assert split["APPROVAL"] == {"ORIGINAL": "0", "RECONSTRUCTED": "1"}
        assert split["LIVE"] == {"ORIGINAL": "0", "RECONSTRUCTED": "0"}
        assert "RECON" in _text(page, '.ops-path .step[data-step="VALIDATION"] .step__count')
        page.close()
    finally:
        server.should_exit = True


def test_missing_sources_say_not_produced_not_not_connected(browser, state_factory):
    url, server = start_server(state_factory(drop=("portfolio", "execution", "agents", "strategies")))
    try:
        page = new_page(browser, url)
        visit(page, "/portfolio")
        assert _text(page, "[data-portfolio-mode] .badge") == "NOT PRODUCED"
        titles = page.eval_on_selector_all(".view .empty__title", "els => els.map(e => e.textContent.trim())")
        assert "Exposures not produced" in titles and "Positions not produced" in titles, titles
        assert not [t for t in titles if "not connected" in t.lower()], titles
        assert "not produced" in _text(page, ".chart__empty .t").lower()
        # Agent slots without agents.json claim no status (never the SLEEPING default).
        statuses = page.eval_on_selector_all(".view td .badge", "els => els.map(e => e.textContent.trim())")
        assert "SLEEPING" not in statuses and statuses.count("NOT PRODUCED") == 10, statuses

        visit(page, "/execution")
        titles = page.eval_on_selector_all(".view .empty__title", "els => els.map(e => e.textContent.trim())")
        assert {"Open orders not produced", "Fills not produced", "Connections not produced"} <= set(titles), titles
        assert not [t for t in titles if "not connected" in t.lower()], titles

        visit(page, "/risk")
        heads = page.eval_on_selector_all("[data-agent-limits] [data-slot-status]", "els => els.map(e => e.dataset.slotStatus)")
        assert heads == ["NOT_CONNECTED"] * 5
        assert "SLEEPING" not in _text(page, '[data-agent-limits="1"]').upper()
        assert "NOT PRODUCED" in _text(page, '[data-agent-limits="1"]').upper()

        visit(page, "/live")
        tile = '[data-interlock="live_scope_approvals"]'
        assert _text(page, f"{tile} .badge") == "NOT PRODUCED"
        assert _text(page, '[data-interlock="live_agents"] .badge') == "NOT PRODUCED"
        assert "Strategy registry not produced" in page.eval_on_selector_all(".view .empty__title", "els => els.map(e => e.textContent.trim())")
        assert "not connected" not in _text(page, ".ops-path-note").lower()
        page.close()
    finally:
        server.should_exit = True


def test_invalid_sources_read_as_contract_errors(browser, state_factory):
    def break_doc(doc):
        doc["data"] = {"nonsense": True}

    url, server = start_server(state_factory({"risk": break_doc, "governance": break_doc, "portfolio": break_doc}))
    try:
        page = new_page(browser, url)
        visit(page, "/risk")
        assert _attr(page, "[data-kill-switch]", "data-kill-switch") == "INVALID"
        assert _text(page, ".ops-ks__state") == "CONTRACT ERROR"
        assert "tone-bad" in _attr(page, "[data-kill-switch]", "class")
        titles = page.eval_on_selector_all(".view .empty__title", "els => els.map(e => e.textContent.trim())")
        assert "Portfolio limits rejected by the contract" in titles and "Breaches rejected by the contract" in titles, titles
        # The risk checks did not run: never "No risk findings".
        assert page.locator('[data-empty-state="no-risk-findings"]').count() == 0
        assert page.locator('[data-empty-state="risk-checks-not-run"]').count() == 1
        assert "CONTRACT ERROR" in _text(page, '[data-empty-state="risk-checks-not-run"] .empty__title').upper()

        visit(page, "/live")
        for key in ("kill_switch", "research_live_separation"):
            assert _attr(page, f'[data-interlock="{key}"]', "data-state") == "INVALID", key
            assert _text(page, f'[data-interlock="{key}"] .badge') == "CONTRACT ERROR", key

        visit(page, "/portfolio")
        assert _attr(page, "[data-portfolio-mode]", "data-portfolio-mode") == "INVALID"
        assert "tone-bad" in _attr(page, "[data-portfolio-mode] .badge", "class")
        assert "conforms to the state contract" in _text(page, ".chart__empty .r")

        visit(page, "/execution")
        assert "Execution limits rejected by the contract" in page.eval_on_selector_all(".view .empty__title", "els => els.map(e => e.textContent.trim())")
        page.close()
    finally:
        server.should_exit = True


def test_empty_slot_badges_say_not_connected_and_empty_values_stay_faint(browser, empty_url):
    page = new_page(browser, empty_url)
    visit(page, "/portfolio")
    statuses = page.eval_on_selector_all(".view td .badge", "els => els.map(e => e.textContent.trim())")
    assert statuses and set(statuses) == {"NOT CONNECTED"}, statuses
    visit(page, "/live")
    # An empty value node keeps the faint empty colour: no .v rule overrides .is-empty.
    colours = page.evaluate(
        """() => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--faint)';
            document.body.appendChild(probe);
            const faint = getComputedStyle(probe).color;
            probe.remove();
            const node = document.querySelector('[data-live-scope-approvals] .v.is-empty');
            return { faint, node: node ? getComputedStyle(node).color : null };
        }"""
    )
    assert colours["node"] == colours["faint"], colours
    page.close()


@pytest.mark.parametrize("width,per_row", [(1024, [3, 3]), (1440, [3, 3]), (1920, [6]), (2560, [6])])
def test_portfolio_book_tiles_never_orphan(browser, fixture_url, width, per_row):
    page = new_page(browser, fixture_url, width=width)
    v = visit(page, "/portfolio")
    assert v.clean, v.describe()
    rows = page.evaluate(
        """() => {
            const rows = new Map();
            for (const el of document.querySelectorAll('.ops-book__stats .stat-row > .stat')) {
                const top = Math.round(el.getBoundingClientRect().top);
                rows.set(top, (rows.get(top) || 0) + 1);
            }
            return [...rows.keys()].sort((a, b) => a - b).map((k) => rows.get(k));
        }"""
    )
    assert rows == per_row, (width, rows)
    page.close()


@pytest.mark.parametrize("width", [1920, 2560])
@pytest.mark.parametrize("route", ROUTES)
def test_ops_paired_panels_leave_no_large_blank(browser, fixture_url, empty_url, width, route):
    # Panels sharing a row stretch to the taller one; the pairing keeps the unused bottom small
    # (was 161px under the portfolio exposures panel at 1920).
    for base in (fixture_url, empty_url):
        page = new_page(browser, base, width=width)
        v = visit(page, route, settle_ms=600)
        assert v.clean, v.describe()
        blanks = _paired_blanks(page)
        assert blanks, "expected paired panels"
        assert all(b <= 80 for _, b in blanks), (base, width, route, blanks)
        page.close()


def _paired_blanks(page) -> list:
    return page.evaluate(
        """() => [...document.querySelectorAll('.view .grid')].filter(g => g.children.length > 1).flatMap(g => [...g.children].map(p => {
            const body = p.querySelector('.panel__body');
            const last = body.lastElementChild;
            const pad = parseFloat(getComputedStyle(body).paddingBottom) || 0;
            return [p.querySelector('.panel__code')?.textContent.trim(), Math.round(body.getBoundingClientRect().bottom - pad - last.getBoundingClientRect().bottom)];
        }))"""
    )


@pytest.mark.parametrize("width", [1024, 1280])
def test_live_path_matrix_fits_without_horizontal_scroll(browser, fixture_url, width):
    # The withdrawn marker wraps under the strategy id instead of widening the column.
    page = new_page(browser, fixture_url, width=width)
    v = visit(page, "/live")
    assert v.clean, v.describe()
    over = page.evaluate(
        "(() => { const w = document.querySelector('tr:has([data-path-strategy]) ').closest('.table-wrap'); return w.scrollWidth - w.clientWidth; })()"
    )
    assert over <= 1, (width, over)
    page.close()


def _row_extents(page, selector: str) -> list[dict]:
    """Per visual row: element count and the row's left / right edge (rounded px), top to bottom."""
    return page.evaluate(
        """(sel) => {
            const rows = new Map();
            for (const el of document.querySelectorAll(sel)) {
                const r = el.getBoundingClientRect();
                const top = Math.round(r.top);
                const row = rows.get(top) || { n: 0, left: Infinity, right: -Infinity };
                row.n += 1;
                row.left = Math.min(row.left, Math.round(r.left));
                row.right = Math.max(row.right, Math.round(r.right));
                rows.set(top, row);
            }
            return [...rows.keys()].sort((a, b) => a - b).map((k) => rows.get(k));
        }""",
        selector,
    )


@pytest.mark.parametrize("width", [1024, 1280, 1440, 1920])
def test_risk_grids_leave_no_orphan_beside_a_void(browser, fixture_url, width):
    page = new_page(browser, fixture_url, width=width)
    v = visit(page, "/risk")
    assert v.clean, v.describe()
    # Five agent slots: one row of five, or 3 + 2 with the second row spanning the full width.
    slots = _row_extents(page, "[data-agent-limits]")
    assert [r["n"] for r in slots] in ([5], [3, 2]), slots
    assert all(abs(r["left"] - slots[0]["left"]) <= 2 and abs(r["right"] - slots[0]["right"]) <= 2 for r in slots), slots
    # Section limit panels (RSK-03..05): one row of three, or two + one spanning the row.
    sections = page.evaluate(
        """() => [...document.querySelectorAll('.view .panel')]
            .filter(p => ['RSK-03', 'RSK-04', 'RSK-05'].includes(p.querySelector('.panel__code')?.textContent.trim()))
            .map(p => { const r = p.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }; })"""
    )
    tops = sorted({s["top"] for s in sections})
    assert len(tops) in (1, 2), sections
    rows = [[s for s in sections if s["top"] == t] for t in tops]
    left, right = min(s["left"] for s in sections), max(s["right"] for s in sections)
    for row in rows:
        assert min(s["left"] for s in row) - left <= 2 and right - max(s["right"] for s in row) <= 2, (width, sections)
    page.close()


@pytest.mark.parametrize("width", [1024, 1280])
@pytest.mark.parametrize("route", ROUTES)
def test_ops_tables_fit_at_narrow_widths(browser, fixture_url, width, route):
    page = new_page(browser, fixture_url, width=width)
    v = visit(page, route)
    assert v.clean, v.describe()
    over = page.evaluate(
        "[...document.querySelectorAll('.view .table-wrap')].map(w => [w.closest('.panel')?.querySelector('.panel__code')?.textContent.trim(), w.scrollWidth - w.clientWidth]).filter(x => x[1] > 1)"
    )
    assert over == [], (width, route, over)
    assert page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 0
    page.close()
