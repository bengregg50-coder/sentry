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
    assert _attr(page, '[data-interlock="kill_switch"]', "data-state") == "ARMED"
    # Fixture approvals are SIM-scope only: no LIVE-scope approval is on record.
    assert "NONE ON RECORD" in _text(page, '[data-interlock="live_scope_approvals"]').upper()
    # Deployment path: FX-S003 v2 is running in SIM (an ongoing simulation is RUNNING, never
    # COMPLETE) and has not reached live.
    assert page.locator('[data-path-strategy="FX-S003"]').count() == 1
    row = page.locator('tr:has([data-path-strategy="FX-S003"])')
    states = row.locator("[data-step-state]").evaluate_all("els => els.map(e => e.dataset.stepState)")
    assert states == ["COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "RUNNING", "NOT_REACHED"]
    # Stepper: both fixture approvals are SIM scope. The approval step counts any scope and says
    # so; its LIVE-scope subset is 0, agreeing with the LIVE-scope approvals interlock.
    approval = '.ops-path .step[data-step="APPROVAL"]'
    assert "LIVE" not in _text(page, f"{approval} .step__label").upper()
    assert "ANY SCOPE" in _text(page, f"{approval} .step__detail").upper()
    assert _text(page, f"{approval} .step__count") == "2"
    assert _attr(page, "[data-live-scope-approvals]", "data-live-scope-approvals") == "0"
    assert _text(page, "[data-live-scope-approvals] .v") == "0"
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
        # Any-scope approvals stay 2 (FX-S003 LIVE SMALL + FX-S004 SIM); only one is LIVE scope.
        assert _text(page, f"{approval} .step__count") == "2"
        assert _attr(page, "[data-live-scope-approvals]", "data-live-scope-approvals") == "1"
        assert _attr(page, '[data-interlock="live_scope_approvals"]', "data-state") == "APPROVED"
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
