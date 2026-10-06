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


def _split(page, scope):
    """{origin: displayed count} for every per-origin count inside ``scope`` (first match)."""
    return page.eval_on_selector(
        scope,
        """el => Object.fromEntries([...el.querySelectorAll('[data-origin]')]
            .map(n => [n.dataset.origin, n.querySelector('[data-v]').textContent.trim()]))""",
    )


def _stat(label, panel=".cc-panel-kpi"):
    """Selector for the value of the stat tile labelled ``label`` inside ``panel``."""
    return f'{panel} .stat:has(> .stat__label:text-is("{label}")) > .stat__value'


def _derived(page):
    """derived block of the snapshot the page is rendering (the UI must show it verbatim)."""
    return page.evaluate("fetch('/api/cc/snapshot').then(r => r.json()).then(s => s.derived)")


def _panel_codes(page):
    return page.eval_on_selector_all(".view .panel__code", "els => els.map(e => e.textContent.trim())")


def _mixed_origins(state_factory):
    """Fixture with two RECONSTRUCTED candidates and two RECONSTRUCTED memories (others ORIGINAL)."""

    def strategies(d):
        for s in d["data"]["strategies"]:
            s["origin"] = "RECONSTRUCTED" if s["strategy_id"] in ("FX-S001", "FX-S002") else "ORIGINAL"

    def memory(d):
        for m in d["data"]["memories"]:
            m["origin"] = "RECONSTRUCTED" if m["memory_id"] in ("FX-M0004", "FX-M0006") else "ORIGINAL"

    return state_factory({"strategies": strategies, "memory": memory})


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

    # declared trial accounting has its place on the home page, explicitly not connected
    assert page.get_attribute("[data-trial-accounting]", "data-trial-accounting") == "NOT_CONNECTED"
    assert all("is-empty" in (c or "") for c in _attr_all(page, "[data-acct] [data-v]", "class"))

    # panel codes follow reading order
    assert _panel_codes(page) == [f"CMD-{i:02d}" for i in range(1, 13)]

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

    # research status: validated count is a real number, tagged with its record origin
    assert page.get_attribute('[data-kpi="validated"]', "data-available") == "1"
    assert _text(page, '[data-kpi="validated"] [data-v]') == "1"
    assert _split(page, '[data-kpi="validated"]') == {"SYNTHETIC_FIXTURE": "1"}

    # research status counts are per origin, never one merged total (7 ORIGINAL + 1 RECONSTRUCTED hypotheses)
    assert _split(page, _stat("Hypotheses")) == {"ORIGINAL": "7", "RECONSTRUCTED": "1"}
    assert _split(page, _stat("Trial records")) == {"ORIGINAL": "9", "RECONSTRUCTED": "2"}
    assert _split(page, _stat("Memories")) == {"SYNTHETIC_FIXTURE": "6"}
    hyp_tile = _text(page, '.cc-panel-kpi .stat:has(> .stat__label:text-is("Hypotheses"))')
    assert "8" not in hyp_tile and "RECON" in hyp_tile.upper()
    # declared trial accounting: three separate ledger figures, never summed by the UI
    assert page.get_attribute("[data-trial-accounting]", "data-trial-accounting") == "DECLARED"
    assert _text(page, '[data-acct="reconstructed_baseline"] [data-v]') == "5"
    assert _text(page, '[data-acct="live_recorded"] [data-v]') == "9"
    assert _text(page, '[data-acct="global_count"] [data-v]') == "14"

    # pipeline available with declared counts
    assert page.get_attribute("[data-pipeline-available]", "data-pipeline-available") == "1"
    discovery = _derived(page)["pipeline"]["stages"][0]
    assert discovery["stage"] == "DISCOVERY" and discovery["reached"] is not None
    assert page.locator('.pl-node[data-stage="DISCOVERY"] [data-v]').text_content().strip() == str(discovery["reached"])
    assert _split(page, '[data-terminal="REJECTED"]') == {"ORIGINAL": "1", "RECONSTRUCTED": "1", "SYNTHETIC_FIXTURE": "1"}

    # subsystems: declared states displayed verbatim, warning stays amber
    trading = page.locator('.cc-sys[data-subsystem="trading_engine"]')
    assert trading.get_attribute("data-state") == "DEGRADED"
    assert "tone-warn" in (trading.locator(".badge").first.get_attribute("class") or "")

    # research focus + active programme
    focus = _text(page, ".cc-focus")
    assert "FX-P02" in focus and "FX-H007" in focus and "FIXTURE: run implementation verification" in focus
    assert page.locator('[data-programme="FX-P02"]').count() == 1
    assert page.locator('[data-programme="FX-P01"]').count() == 0  # SEALED, not active
    assert _split(page, '[data-hyp-status="REJECTED"]') == {"ORIGINAL": "1", "RECONSTRUCTED": "1"}

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

    # system loop fully connected with real counts; record nodes show ORIGINAL only, all origins listed beside
    assert set(_attr_all(page, ".cc-ring [data-cycle-node]", "data-connected")) == {"1"}
    obs = page.locator('.cc-ring [data-cycle-node="OBSERVATIONS"] [data-v]').text_content().strip()
    assert obs == "15"
    assert page.locator('.cc-ring [data-cycle-node="RESEARCH"] [data-v]').text_content().strip() == "7"
    assert _split(page, '[data-loop-node="RESEARCH"]') == {"ORIGINAL": "7", "RECONSTRUCTED": "1"}

    # live strip badges are sized to their content, never stretched to the column
    slack = page.eval_on_selector_all(
        ".cc-live-head .badge",
        """els => els.map(el => { const r = document.createRange(); r.selectNodeContents(el);
            return el.getBoundingClientRect().width - r.getBoundingClientRect().width })""",
    )
    assert slack and max(slack) < 24, slack

    assert _panel_codes(page) == [f"CMD-{i:02d}" for i in range(1, 13)]
    page.close()


def test_home_counts_never_merge_origins(browser, state_factory):
    """Mixed origins: RECONSTRUCTED records are tagged and counted apart, never folded into a total."""
    url, server = start_server(_mixed_origins(state_factory))
    try:
        page = new_page(browser, url)
        v = visit(page, "/")
        assert v.clean, v.describe()
        # both candidates are RECONSTRUCTED: no untagged "2"
        assert _split(page, _stat("Candidates")) == {"RECONSTRUCTED": "2"}
        assert _split(page, _stat("Memories")) == {"ORIGINAL": "4", "RECONSTRUCTED": "2"}
        assert _split(page, _stat("Deployed")) == {"ORIGINAL": "1"}
        assert _split(page, _stat("Memories", ".cc-panel-mem")) == {"ORIGINAL": "4", "RECONSTRUCTED": "2"}
        for tag in page.eval_on_selector_all('[data-origin="RECONSTRUCTED"] .cc-split__tag', "els => els.map(e => e.className)"):
            assert "tone-warn" in tag and "tone-ok" not in tag
        # loop ring shows the ORIGINAL count; the legend lists the reconstructed records beside it
        assert page.locator('.cc-ring [data-cycle-node="KNOWLEDGE"] [data-v]').text_content().strip() == "4"
        assert _split(page, '[data-loop-node="KNOWLEDGE"]') == {"ORIGINAL": "4", "RECONSTRUCTED": "2"}
        assert _split(page, '[data-loop-node="STRATEGIES"]') == {"ORIGINAL": "3", "RECONSTRUCTED": "2"}
        page.close()
    finally:
        server.should_exit = True


def test_home_shows_declared_trial_accounting_when_records_are_absent(browser, state_factory):
    """Post-loss shape: no individual trials, but the ledger declares 112 reconstructed + 3 live (115)."""

    def post_loss(d):
        d["data"]["trials"] = []
        d["data"]["trial_accounting"].update({"reconstructed_baseline": 112, "live_recorded": 3, "global_count": 115})

    url, server = start_server(state_factory({"research": post_loss}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/")
        assert v.clean, v.describe()
        assert _split(page, _stat("Trial records")) == {"ORIGINAL": "0"}
        assert _text(page, '[data-acct="reconstructed_baseline"] [data-v]') == "112"
        assert "RECON" in _text(page, '[data-acct="reconstructed_baseline"]').upper()
        assert _text(page, '[data-acct="live_recorded"] [data-v]') == "3"
        assert _text(page, '[data-acct="global_count"] [data-v]') == "115"
        page.close()
    finally:
        server.should_exit = True


def test_home_undeclared_trial_accounting_is_not_a_zero(browser, state_factory):
    def no_accounting(d):
        d["data"]["trial_accounting"] = None

    url, server = start_server(state_factory({"research": no_accounting}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/")
        assert v.clean, v.describe()
        assert page.get_attribute("[data-trial-accounting]", "data-trial-accounting") == "NOT_DECLARED"
        assert all("is-empty" in (c or "") for c in _attr_all(page, "[data-acct] [data-v]", "class"))
        assert "not declared" in _text(page, "[data-trial-accounting]").lower()
        page.close()
    finally:
        server.should_exit = True


@pytest.mark.parametrize("route", list(ROUTES))
def test_empty_values_render_faint(browser, empty_url, route):
    """An empty value (—) is never painted in the bright value colour by a view rule."""
    page = new_page(browser, empty_url)
    v = visit(page, route)
    assert v.clean, v.describe()
    colours = page.evaluate(
        """() => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--faint)';
            document.querySelector('.view').appendChild(probe);
            const faint = getComputedStyle(probe).color;
            probe.remove();
            const bad = [...document.querySelectorAll('.view .v.is-empty')]
              .filter(el => getComputedStyle(el).color !== faint)
              .map(el => (el.parentElement.className || el.parentElement.tagName) + ' ' + getComputedStyle(el).color);
            return { faint, bad, n: document.querySelectorAll('.view .v.is-empty').length };
        }"""
    )
    assert colours["n"] > 0
    assert colours["bad"] == [], colours
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
    declared_gov = next(st["count"] for st in _derived(page)["learning"]["stages"] if st["key"] == "GOVERNANCE_APPROVAL")
    assert gov == str(declared_gov)

    assert page.get_attribute('[data-role="BACKTESTER"]', "data-state") == "BLOCKED"
    assert page.get_attribute('[data-role="GOVERNANCE"]', "data-state") == "NOT_BUILT"

    # self-improvement: evidence counts stay separated by origin; "better" stages unscored
    ev = page.locator('.cc-ring [data-cycle-node="EVIDENCE"] [data-v]').text_content().strip()
    assert ev == "9"
    assert page.get_attribute('.cc-ring [data-cycle-node="BETTER_STRATEGIES"] [data-v]', "data-empty") == "1"
    assert "9" in _text(page, '[data-ledger="Trial records · original"]')
    assert "2" in _text(page, '[data-ledger="Trial records · reconstructed"]')
    # rejected hypotheses: FX-H001 is ORIGINAL, FX-H002 RECONSTRUCTED — one row per origin, never "2"
    assert page.locator('[data-ledger="Hypotheses rejected"]').count() == 0
    assert _text(page, '[data-ledger="Hypotheses rejected · original"] .cc-ledger__v') == "1"
    assert _text(page, '[data-ledger="Hypotheses rejected · reconstructed"] .cc-ledger__v') == "1"
    # memory-backed rows carry their record origin
    assert _split(page, '[data-ledger="Memories"]') == {"SYNTHETIC_FIXTURE": "6"}
    assert _split(page, '[data-ledger="Programmes"]') == {"SYNTHETIC_FIXTURE": "4"}

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
