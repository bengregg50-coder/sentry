"""Strategies views: Strategy Library (all / candidates / validated / deployed / retired) and Strategy detail.

Invariants: nothing is displayed without a source (and "validated" is never shown as 0
when the registry is not connected); a connected registry with no validated strategy
says so plainly; every metric shows its evidence basis; checks are shown exactly as
reported (a FAIL is red, never green); versions are immutable records selectable with
?v=N; the deployment hand-off comes from derived.handoffs; unknown ids get a proper
not-found state; counts of different record origins are never merged.
"""

from __future__ import annotations

import json
import re
import shutil

import pytest

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit
from .conftest import FIXTURE_DIR, start_server

pytestmark = pytest.mark.browser

LIBRARY = ["/strategies", "/strategies/candidates", "/strategies/validated", "/strategies/deployed", "/strategies/retired"]
DETAIL = ["/strategy/FX-S003", "/strategy/FX-S003?v=1", "/strategy/FX-S002", "/strategy/NOPE"]
ROUTES = LIBRARY + DETAIL

#: a bare zero standing on its own (not part of ids like STR-01, dates or decimals)
BARE_ZERO = re.compile(r"(?<![\w.\-/:·])0(?![\w.%/:\-])")


def _module(route: str) -> str:
    return "strategies-library" if route.startswith("/strategies") else "strategy-detail"


def _tabs(page) -> list[list]:
    """[label, count|None] per category tab."""
    return page.eval_on_selector_all(
        ".tabs .tab", "els => els.map(e => [e.firstChild.textContent.trim(), e.querySelector('.count')?.textContent ?? null])"
    )


def _rows(page) -> list[str]:
    return page.eval_on_selector_all(".st-reg tbody tr[data-strategy]", "els => els.map(e => e.dataset.strategy)")


# ---------------------------------------------------------------- empty mode


@pytest.mark.parametrize("route", ROUTES)
def test_empty_routes_clean_and_show_no_values(browser, empty_url, route):
    page = new_page(browser, empty_url)
    v = visit(page, route)
    assert v.clean, v.describe()
    assert v.module == _module(route)
    assert present_values(page) == []
    assert fake_value_hits(view_text(page)) == []
    # the strategy registry explains that it is not connected
    assert page.locator('[data-empty-state="source-strategies-NOT_CONFIGURED"]').count() >= 1
    page.close()


@pytest.mark.parametrize("route", LIBRARY)
def test_empty_library_keeps_full_structure(browser, empty_url, route):
    page = new_page(browser, empty_url)
    visit(page, route)
    assert page.get_attribute(".st-verdict", "data-validated-state") == "not-connected"
    assert page.inner_text("[data-validated-count]").strip() == "NOT CONNECTED"
    # lifecycle: seven stages + two terminals, all empty
    assert page.get_attribute(".st-lifecycle", "data-lifecycle-available") == "0"
    nodes = page.eval_on_selector_all(".st-lc-node", "els => els.map(e => [e.dataset.status, e.dataset.count])")
    assert [n[0] for n in nodes] == ["REJECTED", "RETIRED", "CANDIDATE", "IN_VALIDATION", "VALIDATED", "APPROVED", "DEPLOYED_SIM", "DEPLOYED_LIVE", "SCALED"]
    assert all(n[1] == "" for n in nodes)
    # tabs carry no counts; the registry table keeps its columns
    assert page.locator(".tabs .tab").count() == 5
    assert page.locator(".tabs .count").count() == 0
    heads = page.eval_on_selector_all(".st-reg thead th", "els => els.map(e => e.innerText.replace(/\\s+/g, ' ').trim().toUpperCase())")
    assert heads == [
        "STRATEGY NAME · MECHANISM", "MARKET INST · TF", "STATUS VERSION · VALIDATION",
        "NET RETURN", "SHARPE", "MAX DD", "AGENT UPDATED",
    ], heads
    # the delivery flow shows all six stages; deployment controls are locked
    assert page.locator("[data-flow-stage]").count() == 6
    locked = page.eval_on_selector_all("[data-control]", "els => els.map(e => e.dataset.enabled)")
    assert locked and set(locked) == {"0"}
    page.close()


def test_empty_validated_never_shows_zero(browser, empty_url):
    page = new_page(browser, empty_url)
    visit(page, "/strategies/validated")
    text = view_text(page)
    assert BARE_ZERO.findall(text) == [], BARE_ZERO.findall(text)
    assert "NOT CONNECTED" in text.upper()
    assert page.locator('[data-empty-state="no-validated-strategies"]').count() == 0
    page.close()


def test_empty_detail_renders_skeleton(browser, empty_url):
    page = new_page(browser, empty_url)
    visit(page, "/strategy/FX-S003")
    assert page.locator('[data-empty-state="strategy-not-found"]').count() == 0
    checks = page.eval_on_selector_all(".st-chkgroups .st-chk", "els => els.map(e => e.dataset.state)")
    assert len(checks) == 13 and set(checks) == {"NOT_CONNECTED"}
    steps = page.eval_on_selector_all(".st-handoff .step", "els => els.map(e => [e.dataset.step, e.dataset.state])")
    assert [s[0] for s in steps] == ["VALIDATION", "APPROVAL", "DEPLOYMENT_PACKAGE", "AGENT_ASSIGNMENT", "SIMULATION", "LIVE"]
    assert all(s[1] == "" for s in steps)
    assert page.locator(".st-mt").count() == 9
    assert page.locator(".st-gcn__row").count() == 3
    assert page.get_attribute("[data-hero-status]", "data-hero-status") == ""
    page.close()


# ---------------------------------------------------------------- fixture: library


@pytest.mark.parametrize("route", ROUTES)
def test_fixture_routes_clean(browser, fixture_url, route):
    page = new_page(browser, fixture_url)
    v = visit(page, route)
    assert v.clean, v.describe()
    assert v.module == _module(route)
    page.close()


@pytest.mark.parametrize(
    "route,expected",
    [
        ("/strategies", ["FX-S001", "FX-S002", "FX-S003", "FX-S004", "FX-S005"]),
        ("/strategies/candidates", ["FX-S001", "FX-S002"]),
        ("/strategies/validated", ["FX-S003"]),
        ("/strategies/deployed", ["FX-S003"]),
        ("/strategies/retired", ["FX-S004"]),
    ],
)
def test_fixture_library_filters(browser, fixture_url, route, expected):
    page = new_page(browser, fixture_url)
    visit(page, route)
    assert _rows(page) == expected
    # every listed strategy links to its detail page
    hrefs = page.eval_on_selector_all("[data-strategy-link]", "els => els.map(e => e.getAttribute('href'))")
    assert hrefs == [f"#/strategy/{sid}" for sid in expected]
    page.close()


def test_fixture_validated_lists_s003_not_retired_s004(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/strategies/validated")
    rows = _rows(page)
    assert "FX-S003" in rows and "FX-S004" not in rows
    assert page.get_attribute(".st-verdict", "data-validated-state") == "some"
    page.close()


def test_fixture_library_counts_tabs_lifecycle_and_origin(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/strategies")
    assert _tabs(page) == [["All", "5"], ["Candidates", "2"], ["Validated", "1"], ["Deployed", "1"], ["Retired", "1"]]
    counts = dict(page.eval_on_selector_all(".st-lc-node", "els => els.map(e => [e.dataset.status, e.dataset.count])"))
    assert counts == {
        "CANDIDATE": "1", "IN_VALIDATION": "1", "VALIDATED": "0", "APPROVED": "0", "DEPLOYED_SIM": "1",
        "DEPLOYED_LIVE": "0", "SCALED": "0", "REJECTED": "1", "RETIRED": "1",
    }
    # rejected strategies stay visible with their status
    assert page.get_attribute('.st-reg tr[data-strategy="FX-S005"]', "data-status") == "REJECTED"
    # synthetic records are flagged in the table — in the Strategy cell, with the same label as the source tag
    assert page.locator('.st-reg [data-state="SYNTHETIC_FIXTURE"]').count() == 5
    assert page.locator('.st-reg td.st-col-id [data-state="SYNTHETIC_FIXTURE"]').count() == 5
    labels = set(page.eval_on_selector_all('.st-reg [data-state="SYNTHETIC_FIXTURE"]', "els => els.map(e => e.textContent.trim())"))
    assert labels == {"SYNTHETIC FIXTURE"}, labels
    # headline metrics carry their basis
    s3 = page.inner_text('.st-reg tr[data-strategy="FX-S003"]')
    assert "OOS" in s3 and "AGENT 02" in s3
    s2 = page.inner_text('.st-reg tr[data-strategy="FX-S002"]')
    assert re.search(r"1\.90\s*IS", s2)
    page.close()


# ---------------------------------------------------------------- fixture: detail


def test_fixture_s003_versions_handoff_and_basis(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/strategy/FX-S003")
    assert page.get_attribute(".st-vt", "data-versions") == "1,2"
    cards = page.eval_on_selector_all(".st-vt__card[data-version]", "els => els.map(e => [e.dataset.version, e.dataset.current, e.dataset.selected])")
    assert cards == [["1", "0", "0"], ["2", "1", "1"]]
    assert page.get_attribute("[data-viewing]", "data-viewing") == "2"
    assert "VERSIONS ARE IMMUTABLE" in view_text(page).upper()
    # hand-off: four COMPLETE steps, an ongoing simulation is RUNNING (never COMPLETE), LIVE not reached
    steps = dict(page.eval_on_selector_all(".st-handoff .step", "els => els.map(e => [e.dataset.step, e.dataset.state])"))
    assert [k for k, s in steps.items() if s == "COMPLETE"] == ["VALIDATION", "APPROVAL", "DEPLOYMENT_PACKAGE", "AGENT_ASSIGNMENT"]
    assert steps["SIMULATION"] == "RUNNING"
    assert steps["LIVE"] == "NOT_REACHED"
    assert page.get_attribute("[data-eligible]", "data-eligible") == "1"
    # Sharpe with an out-of-sample basis chip
    sharpe = page.locator('.st-mt[data-metric="sharpe"]')
    assert sharpe.get_attribute("data-basis") == "OUT_OF_SAMPLE"
    assert sharpe.locator(".chip--basis").inner_text().strip() == "OOS"
    # gross / cost / net reported separately, cost multiplier shown
    comps = page.eval_on_selector_all(".st-gcn__row", "els => els.map(e => e.dataset.component)")
    assert comps == ["GROSS", "COST", "NET"]
    assert "1× COST" in page.inner_text('.st-gcn__row[data-component="COST"]')
    assert "2× COST" in page.inner_text('.st-addl__row[data-metric="net_2x"]')
    # approval + package identities of the displayed version
    assert page.locator('[data-package="FX-PKG-003-2"]').count() == 1
    # the agent that reports running it
    assert page.locator('.st-agent[data-agent-slot="2"]').count() == 1
    # proposals, related memories, lineage links
    assert page.eval_on_selector_all("tr[data-proposal]", "els => els.map(e => e.dataset.proposal)") == ["FX-PR2", "FX-PR1"]
    assert page.eval_on_selector_all("tr[data-memory]", "els => els.map(e => e.dataset.memory)") == ["FX-M0003", "FX-M0006"]
    lin = page.eval_on_selector_all(".st-lin a", "els => els.map(e => e.getAttribute('href'))")
    assert "#/strategy/FX-S003?v=1" in lin
    assert "#/memory/item/FX-M0003" in lin
    assert "#/strategy/FX-S003?proposal=FX-PR1" in lin
    assert "#/research/hypotheses?focus=FX-H005" in lin
    page.close()


def test_fixture_s003_v1_selected(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/strategy/FX-S003?v=1")
    assert v.clean, v.describe()
    assert page.get_attribute("[data-viewing]", "data-viewing") == "1"
    selected = page.eval_on_selector_all('.st-vt__card[data-selected="1"]', "els => els.map(e => e.dataset.version)")
    assert selected == ["1"]
    assert page.get_attribute("[data-earlier-version]", "data-earlier-version") == "1"
    # v1's own lineage: hypothesis and trial links
    lin = page.eval_on_selector_all(".st-lin a", "els => els.map(e => e.getAttribute('href'))")
    assert "#/research/history?focus=FX-T008" in lin
    # v1 has no approval: shown as missing, not borrowed from v2
    assert page.locator('[data-package="FX-PKG-003-2"]').count() == 0
    assert "NO GOVERNANCE APPROVAL RECORDED FOR V1" in view_text(page).upper()
    page.close()


def test_fixture_s002_in_sample_basis_and_failed_check(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/strategy/FX-S002")
    sharpe = page.locator('.st-mt[data-metric="sharpe"]')
    assert sharpe.get_attribute("data-basis") == "IN_SAMPLE"
    assert sharpe.locator(".chip--basis").inner_text().strip() == "IS"
    cs = page.locator('.st-chkgroups .st-chk[data-check="cost_sensitivity"]')
    assert cs.get_attribute("data-state") == "FAIL"
    cls = cs.locator(".badge").get_attribute("class")
    assert "tone-bad" in cls and "tone-ok" not in cls
    # an unreported check says so, and is not coloured as a pass
    wf = page.locator('.st-chkgroups .st-chk[data-check="walk_forward"]')
    assert wf.get_attribute("data-state") == "NOT_REPORTED"
    assert "tone-ok" not in wf.locator(".badge").get_attribute("class")
    # pending multiple-testing treatment; the hand-off shows the declared validation status verbatim
    # (IN PROGRESS) and stops there
    steps = dict(page.eval_on_selector_all(".st-handoff .step", "els => els.map(e => [e.dataset.step, e.dataset.state])"))
    assert steps["VALIDATION"] == "IN_PROGRESS"
    assert [k for k, s in steps.items() if s == "COMPLETE"] == []
    assert page.get_attribute("[data-eligible]", "data-eligible") == "0"
    page.close()


def test_fixture_unknown_strategy_not_found(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/strategy/NOPE")
    assert v.clean, v.describe()
    assert not v.error_box
    assert page.locator('[data-empty-state="strategy-not-found"]').count() == 1
    assert "NOPE" in view_text(page)
    # known ids are offered instead
    assert page.locator(".st-known a.ref").count() == 5
    page.close()


def test_fixture_missing_version_falls_back_with_notice(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/strategy/FX-S003?v=9")
    assert v.clean, v.describe()
    assert "VERSION V9 DOES NOT EXIST" in view_text(page).upper()
    assert page.get_attribute("[data-viewing]", "data-viewing") == "2"
    page.close()


def test_fixture_proposal_focus(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/strategy/FX-S003?proposal=FX-PR1")
    assert "is-focus" in (page.get_attribute('tr[data-proposal="FX-PR1"]', "class") or "")
    assert "is-focus" not in (page.get_attribute('tr[data-proposal="FX-PR2"]', "class") or "")
    page.close()


# ---------------------------------------------------------------- mutated state


def test_connected_empty_registry_says_no_validated_strategies(browser, state_factory):
    def empty_registry(d):
        d["data"]["strategies"] = []
        d["data"]["proposals"] = []

    url, server = start_server(state_factory({"strategies": empty_registry}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/strategies/validated")
        assert v.clean, v.describe()
        assert page.locator('[data-empty-state="no-validated-strategies"]').count() == 1
        assert page.get_attribute(".st-verdict", "data-validated-state") == "none"
        assert "NO VALIDATED STRATEGIES" in view_text(page).upper()
        # connected and empty: a real zero is a fact and is shown on the tabs
        assert ["Validated", "0"] in _tabs(page)
        visit(page, "/strategy/FX-S003")
        assert page.locator('[data-empty-state="strategy-not-found"]').count() == 1
        page.close()
    finally:
        server.should_exit = True


def test_origins_never_merged(browser, state_factory):
    def mixed(d):
        by_id = {s["strategy_id"]: s for s in d["data"]["strategies"]}
        by_id["FX-S001"]["origin"] = "ORIGINAL"
        by_id["FX-S002"]["origin"] = "RECONSTRUCTED"

    url, server = start_server(state_factory({"strategies": mixed}))
    try:
        page = new_page(browser, url)
        visit(page, "/strategies")
        registered = page.locator(".stat", has_text="Registered").locator(".st-split__n")
        parts = [t.strip() for t in registered.all_text_contents()]
        assert parts == ["1", "1RECON", "3SYNTH"], parts
        # a reconstructed record is badged in the table, in its Strategy cell (visible at every width)
        assert page.locator('.st-reg tr[data-strategy="FX-S002"] td.st-col-id [data-state="RECONSTRUCTED"]').count() == 1
        # an ORIGINAL record carries no origin badge
        assert page.locator('.st-reg tr[data-strategy="FX-S001"] .st-cell-origin').count() == 0
        page.close()
    finally:
        server.should_exit = True


def test_detail_identity_not_repeated_and_one_origin_label(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/strategy/FX-S003")
    # STR-D01 carries identity only; status, version, agent, last update and origin live in the header strip
    keys = page.eval_on_selector_all("[data-identity] .kv__k", "els => els.map(e => e.textContent.trim().toUpperCase())")
    assert keys == ["STRATEGY ID", "NAME", "MECHANISM", "MARKET", "INSTRUMENT", "TIMEFRAME", "VERSIONS ON RECORD"], keys
    hero = page.eval_on_selector_all(".st-hero__k", "els => els.map(e => e.textContent.trim().toUpperCase())")
    for k in ("STATUS", "CURRENT VERSION", "ASSIGNED AGENT", "LAST UPDATE", "ORIGIN"):
        assert k in hero, hero
    # one origin label everywhere: the header strip says what the page-head source tag says
    hero_origin = page.inner_text("[data-hero-origin] .st-hero__v").strip()
    src_origin = page.inner_text('.page-head [data-source="strategies"] [data-state="SYNTHETIC_FIXTURE"]').strip()
    assert hero_origin == src_origin == "SYNTHETIC FIXTURE"
    # STR-D10: one proposer reference — the agent link, with the raw producer ref as its tooltip
    cell = page.locator('tr[data-proposal="FX-PR1"] td').nth(4)
    assert cell.inner_text().strip() == "AGENT 02"
    assert cell.locator("a.ref").get_attribute("title") == "agent:02"
    page.close()


def _registry_only_state(tmp_path, strategies=None, proposals=None):
    """A state dir holding strategies.json alone — no agent, live or execution source connected."""
    d = tmp_path / "registry_only"
    d.mkdir()
    shutil.copy(FIXTURE_DIR / "strategies.json", d / "strategies.json")
    doc = json.loads((d / "strategies.json").read_text())
    if strategies is not None:
        doc["data"]["strategies"] = [s for s in doc["data"]["strategies"] if s["strategy_id"] in strategies]
    if proposals is not None:
        doc["data"]["proposals"] = [p for p in doc["data"]["proposals"] if p["proposal_id"] in proposals]
    (d / "strategies.json").write_text(json.dumps(doc))
    return d


def test_deployed_empty_claims_only_what_the_registry_says(browser, tmp_path):
    """With only strategies.json connected, the deployed list may not claim anything about trading or agents."""
    url, server = start_server(_registry_only_state(tmp_path, strategies=[], proposals=[]))
    try:
        page = new_page(browser, url)
        v = visit(page, "/strategies/deployed")
        assert v.clean, v.describe()
        empty = page.locator('[data-empty-state="none-deployed"]')
        assert empty.count() == 1
        assert "No registered strategy has status DEPLOYED_SIM, DEPLOYED_LIVE or SCALED." in empty.inner_text()
        text = view_text(page)
        assert not re.search(r"nothing is trading|no strategy is running|asleep", text, re.I), text
        visit(page, "/strategies/retired")
        assert "No registered strategy has status RETIRED." in page.inner_text('[data-empty-state="none-retired"]')
        page.close()
    finally:
        server.should_exit = True


def test_none_validated_sentence_matches_filter_and_names_exclusions(browser, tmp_path):
    """FX-S004 is RETIRED with a VALIDATED current version: "none VALIDATED" would be false; say what was excluded."""
    url, server = start_server(_registry_only_state(tmp_path, strategies=["FX-S004", "FX-S005"], proposals=[]))
    try:
        page = new_page(browser, url)
        for route in ("/strategies", "/strategies/validated"):
            v = visit(page, route)
            assert v.clean, v.describe()
            assert page.get_attribute(".st-verdict", "data-validated-state") == "none"
            text = view_text(page)
            assert "none of their current versions VALIDATED" not in text
            assert "has a current version the research engine declares VALIDATED." not in text
            assert "RETIRED and REJECTED excluded" in text
            excl = page.eval_on_selector_all("[data-excluded-validated]", "els => els.map(e => e.dataset.excludedValidated)")
            assert excl and set(excl) == {"FX-S004"}, excl
            assert page.locator('[data-excluded-validated] a[href="#/strategy/FX-S004"]').count() >= 1
        assert page.locator('[data-empty-state="no-validated-strategies"] [data-excluded-validated="FX-S004"]').count() == 1
        page.close()
    finally:
        server.should_exit = True


def test_no_exclusion_note_when_nothing_is_excluded(browser, tmp_path):
    url, server = start_server(_registry_only_state(tmp_path, strategies=["FX-S001", "FX-S005"], proposals=[]))
    try:
        page = new_page(browser, url)
        visit(page, "/strategies")
        assert page.get_attribute(".st-verdict", "data-validated-state") == "none"
        assert page.locator("[data-excluded-validated]").count() == 0
        page.close()
    finally:
        server.should_exit = True


# ---------------------------------------------------------------- layout


@pytest.mark.parametrize("width", [1024, 1280, 1440])
@pytest.mark.parametrize("route", LIBRARY)
def test_registry_columns_fit_without_horizontal_scroll(browser, fixture_url, route, width):
    """Evidence-basis figures and per-row provenance stay on screen across the supported widths."""
    page = new_page(browser, fixture_url, width=width)
    visit(page, route)
    m = page.evaluate(
        """() => { const tw = document.querySelector('.st-reg'); const r = tw.getBoundingClientRect();
          return { sw: tw.scrollWidth, cw: tw.clientWidth, overflow: tw.dataset.overflow ?? null,
                   offscreen: [...tw.querySelectorAll('thead th')].filter(th => th.getBoundingClientRect().right > r.right + 1).map(th => th.innerText) }; }"""
    )
    assert m["sw"] <= m["cw"] + 1, f"{route} registry scrolls at {width}px: {m}"
    assert m["offscreen"] == [] and m["overflow"] is None, m
    # every listed row shows its origin badge inside the visible Strategy cell
    rows = page.locator(".st-reg tbody tr[data-strategy]")
    for i in range(rows.count()):
        badge_box = rows.nth(i).locator(".st-cell-origin .badge").bounding_box()
        assert badge_box and badge_box["width"] > 0
    page.close()


def test_registry_overflow_is_marked_with_an_edge(browser, state_factory):
    """If producer strings still force overflow, the scroller says so (faded edge), never a silent cut."""

    def long_instrument(d):
        s = next(x for x in d["data"]["strategies"] if x["strategy_id"] == "FX-S003")
        s["instrument"] = "FXA/FXB/FXC/FXD/FXE/FXF/FXG/FXH/FXI/FXJ/FXK/FXL/FXM/FXN/FXO/FXP/FXQ"

    url, server = start_server(state_factory({"strategies": long_instrument}))
    try:
        page = new_page(browser, url, width=1024)
        visit(page, "/strategies")
        tw = page.locator(".st-reg")
        assert page.evaluate("() => { const t = document.querySelector('.st-reg'); return t.scrollWidth > t.clientWidth; }")
        assert tw.get_attribute("data-overflow") == "right"
        assert page.evaluate("() => getComputedStyle(document.querySelector('.st-reg')).maskImage") not in ("", "none")
        page.evaluate("() => { const t = document.querySelector('.st-reg'); t.scrollLeft = t.scrollWidth; }")
        page.wait_for_timeout(100)
        assert tw.get_attribute("data-overflow") == "left"
        page.close()
    finally:
        server.should_exit = True



@pytest.mark.parametrize("width", [1024, 1280, 2200])
@pytest.mark.parametrize("route", ["/strategies", "/strategy/FX-S003"])
def test_no_horizontal_page_overflow(browser, fixture_url, route, width):
    page = new_page(browser, fixture_url, width=width)
    visit(page, route)
    overflow = page.evaluate("() => { const m = document.querySelector('.main'); return m.scrollWidth - m.clientWidth; }")
    assert overflow <= 1, f"{route} overflows by {overflow}px at {width}px"
    page.close()


# ---------------------------------------------------------------- escaping


def test_strategy_strings_are_escaped(browser, state_factory):
    payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>'

    def inject(d):
        s = next(x for x in d["data"]["strategies"] if x["strategy_id"] == "FX-S003")
        for key in ("name", "mechanism", "economic_rationale", "market", "instrument"):
            s[key] = payload
        v2 = next(v for v in s["versions"] if v["version"] == 2)
        v2["change_summary"] = payload
        v2["validation"]["out_of_sample"]["detail"] = payload
        v2["lineage"].append({"kind": "DOCUMENT", "ref": payload, "note": payload})
        v2["approval"]["conditions"] = [payload]
        d["data"]["proposals"][0]["summary"] = payload

    url, server = start_server(state_factory({"strategies": inject}))
    try:
        page = new_page(browser, url)
        for route in ("/strategies", "/strategy/FX-S003", "/strategy/FX-S003?v=1", "/strategies/deployed"):
            v = visit(page, route, settle_ms=150)
            assert v.clean, v.describe()
            assert page.evaluate("window.__pwned === undefined"), route
            assert page.evaluate("document.querySelectorAll('.view img[src=\"x\"], .view script').length") == 0, route
        # the payload is displayed as text, not dropped
        assert "<script>" in view_text(page) or page.locator(".st-reg", has_text="<img").count() >= 1
        page.close()
    finally:
        server.should_exit = True


def test_regime_results_render_with_state_and_basis(browser, state_factory):
    def add_regime(d):
        s = next(x for x in d["data"]["strategies"] if x["strategy_id"] == "FX-S003")
        v2 = next(v for v in s["versions"] if v["version"] == 2)
        v2["regimes"] = [
            {
                "regime": "FIXTURE high volatility",
                "window": {"label": "FIXTURE window", "role": "OUT_OF_SAMPLE", "start": "2020-01-01", "end": "2021-01-01"},
                "metrics": [{"key": "sharpe", "label": "Sharpe", "metric": {"value": 0.2, "unit": "ratio", "basis": "OUT_OF_SAMPLE"}}],
                "state": "FAIL",
            }
        ]

    url, server = start_server(state_factory({"strategies": add_regime}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/strategy/FX-S003")
        assert v.clean, v.describe()
        item = page.locator('.st-reg-i[data-regime="FIXTURE high volatility"]')
        assert item.count() == 1
        assert "tone-bad" in item.locator(".badge").get_attribute("class")
        assert item.locator(".chip--basis").inner_text().strip() == "OOS"
        assert "2020-01-01" in item.inner_text()
        # v1 has no regimes: shown as not reported for v1, not borrowed from v2
        visit(page, "/strategy/FX-S003?v=1")
        assert page.locator(".st-reg-i").count() == 0
        page.close()
    finally:
        server.should_exit = True
