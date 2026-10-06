"""Memory views: evidence-backed memories rendered from declared state only.

Empty mode must show the complete structure with no values; fixture mode must
render the fixture's records exactly (evidence for and against, unresolved
references, agent attribution) without inventing relationships.
"""

from __future__ import annotations

import pytest

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit

pytestmark = pytest.mark.browser

ROUTES = [
    "/memory",
    "/memory/graph",
    "/memory/findings",
    "/memory/lessons",
    "/memory/evidence",
    "/memory/agents",
    "/memory/item/FX-M0003",
    "/memory/item/NOPE",
]


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


def _attrs(page, selector, attr):
    return page.eval_on_selector_all(selector, f"els => els.map(e => e.getAttribute({attr!r}))")


def _fixture_snapshot():
    from atp.gui.command_centre.api import build_snapshot
    from atp.gui.command_centre.provider import FileStateProvider

    from .conftest import FIXTURE_DIR

    return build_snapshot(FileStateProvider(FIXTURE_DIR))


def _serve(state_dir):
    from .conftest import start_server

    return start_server(state_dir)


# ---------------------------------------------------------------- every route, both modes


@pytest.mark.parametrize("route", ROUTES)
def test_empty_route_is_clean_and_shows_no_values(empty_page, route):
    v = visit(empty_page, route)
    assert v.clean, v.describe()
    assert v.module.startswith("memory-"), v.module
    assert present_values(empty_page) == [], f"{route} displays values with no state connected"
    assert fake_value_hits(view_text(empty_page)) == []
    assert empty_page.eval_on_selector_all(".view .tone-ok", "els => els.length") == 0


@pytest.mark.parametrize("route", ROUTES)
def test_fixture_route_is_clean_and_bannered(fixture_page, route):
    v = visit(fixture_page, route)
    assert v.clean, v.describe()
    assert v.module.startswith("memory-"), v.module
    assert fixture_page.is_visible('[data-banner="synthetic"]')


# ---------------------------------------------------------------- empty mode: full structure, honest emptiness


def test_empty_overview_renders_full_structure(empty_page):
    visit(empty_page, "/memory")
    bars = _attrs(empty_page, ".mem-bar", "data-bar")
    for key in ("FINDING", "LESSON", "DATA_NOTE", "VALIDATED", "CONTRADICTED", "HIGH", "UNRATED", "RETAIN", "ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"):
        assert key in bars
    assert empty_page.eval_on_selector_all(".mem-bar:not(.is-empty)", "els => els.length") == 0
    assert _attrs(empty_page, ".mem-loop__node", "data-connected") == ["0"] * 7
    steps = _attrs(empty_page, ".mem-flow .step", "data-state")
    assert len(steps) == 6 and "REPORTING" not in steps
    text = view_text(empty_page).upper()
    assert "NOT CONNECTED" in text
    assert "PRICE / VALUE" not in text
    # the "better" stages are never scored; the records behind the loop say NOT CONNECTED, not 0
    assert empty_page.inner_text('[data-stage="BETTER"] .mem-stage__rec').strip().upper() == "NOT SCORED"
    for key in ("HYPOTHESES", "TRIALS", "VALIDATED", "STRATEGIES"):
        assert empty_page.inner_text(f'[data-record="{key}"] .mem-stage__rec').strip().upper() == "NOT CONNECTED"


def test_empty_graph_titles_say_not_connected_and_nodes_panel_is_compact(empty_page):
    visit(empty_page, "/memory/graph")
    titles = empty_page.eval_on_selector_all(".view .empty__title", "els => els.map(e => e.textContent.trim().toUpperCase())")
    assert titles and all(t == "GRAPH SOURCES NOT CONNECTED" for t in titles), titles
    text = view_text(empty_page).upper()
    for zero_like in ("NO NODES", "NOTHING TO RESOLVE", "NO RELATIONSHIPS TO DRAW"):
        assert zero_like not in text
    # nothing to list: the legend takes its own row and the node panel is not stretched around blank space
    assert empty_page.is_visible('[data-graph-lower="compact"]')
    heights = empty_page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll('.panel')]
            .filter(p => /MEM-G0[34]/.test(p.querySelector('.panel__code')?.textContent ?? ''))
            .map(p => [p.querySelector('.panel__code').textContent, p.getBoundingClientRect().height]))"""
    )
    assert set(heights) == {"MEM-G03", "MEM-G04"}
    assert max(heights.values()) < 420, heights


def test_empty_graph_shows_schematic_not_nodes(empty_page):
    visit(empty_page, "/memory/graph")
    assert empty_page.is_visible('[data-graph-mode="schematic"] svg')
    assert empty_page.query_selector_all(".kg-node") == []
    assert "none are inferred" in view_text(empty_page)


def test_empty_agents_shows_five_empty_lanes(empty_page):
    visit(empty_page, "/memory/agents")
    assert _attrs(empty_page, "[data-agent-lane]", "data-agent-lane") == ["1", "2", "3", "4", "5"]
    assert _attrs(empty_page, ".mem-lane.is-empty", "data-agent-lane") == ["1", "2", "3", "4", "5"]
    for slot in range(1, 6):
        assert "NO AGENT MEMORIES" in empty_page.inner_text(f'[data-agent-lane="{slot}"]').upper()
    assert empty_page.is_visible('[data-empty-state="cross-agent-unavailable"]')


def test_empty_detail_says_not_connected_not_missing(empty_page):
    visit(empty_page, "/memory/item/FX-M0003")
    assert empty_page.is_visible('[data-empty-state="source-memory-NOT_CONFIGURED"]')
    assert empty_page.query_selector('[data-empty-state="memory-not-found"]') is None


# ---------------------------------------------------------------- fixture mode: specific records


def test_fixture_detail_shows_evidence_for_and_against(fixture_page):
    visit(fixture_page, "/memory/item/FX-M0003")
    assert _attrs(fixture_page, '[data-evidence-col="SUPPORTS"] .mem-ev', "data-evidence-id") == ["FX-EV4"]
    assert _attrs(fixture_page, '[data-evidence-col="CONTRADICTS"] .mem-ev', "data-evidence-id") == ["FX-EV5"]
    assert "tone-bad" in fixture_page.get_attribute('.mem-ev[data-evidence-id="FX-EV5"]', "class")
    # declared checks are null in the fixture: shown as NOT REPORTED, never as a state
    assert set(_attrs(fixture_page, ".mem-check", "data-state")) == {"NOT_REPORTED"}
    # local relationships come from derived edges only
    keys = _attrs(fixture_page, ".mem-ego__node", "data-key")
    assert "MEMORY:FX-M0003" in keys and "STRATEGY:FX-S003" in keys
    # explicit back-references: agent memory_refs, strategy lineage, proposal evidence
    refs = fixture_page.inner_text('[data-ref-group="Agents"]') + fixture_page.inner_text('[data-ref-group="Strategy versions"]') + fixture_page.inner_text('[data-ref-group="Improvement proposals"]')
    assert "AGENT 02" in refs and "FX-S003 v2" in refs and "FX-PR1" in refs
    events = _attrs(fixture_page, ".mem-evlist [data-event-id]", "data-event-id")
    assert sorted(events) == ["FX-E0002", "FX-E0010"]


def test_fixture_detail_marks_unresolved_and_untraceable(fixture_page):
    visit(fixture_page, "/memory/item/FX-M0005")
    unresolved = fixture_page.eval_on_selector_all(".mem-unres", "els => els.map(e => e.textContent)")
    assert any("FX-M9999" in u for u in unresolved)
    assert fixture_page.query_selector('[data-finding="UNRESOLVED_REFERENCE"]') is not None
    visit(fixture_page, "/memory/item/FX-M0006")
    assert "UNTRACEABLE MEMORY" in view_text(fixture_page).upper()
    assert fixture_page.query_selector_all(".mem-ev") == []


def test_fixture_not_found_is_a_state_not_an_error(fixture_page):
    v = visit(fixture_page, "/memory/item/NOPE")
    assert v.clean and not v.error_box
    assert fixture_page.is_visible('[data-empty-state="memory-not-found"]')
    assert fixture_page.query_selector_all(".mem-ev") == []


def test_fixture_evidence_ledger(fixture_page):
    visit(fixture_page, "/memory/evidence")
    ids = _attrs(fixture_page, "tr[data-evidence-id]", "data-evidence-id")
    assert sorted(ids) == [f"FX-EV{i}" for i in range(1, 8)]
    cls = fixture_page.get_attribute('tr[data-evidence-id="FX-EV5"] .badge[data-state="CONTRADICTS"]', "class")
    assert "tone-bad" in cls
    assert _attrs(fixture_page, "[data-untraceable]", "data-untraceable") == ["FX-M0006"]
    assert "tone-warn" in fixture_page.get_attribute('[data-untraceable="FX-M0006"] .badge', "class")
    visit(fixture_page, "/memory/evidence?stance=CONTRADICTS")
    assert _attrs(fixture_page, "tr[data-evidence-id]", "data-evidence-id") == ["FX-EV5"]


def test_fixture_graph_draws_declared_nodes_and_unresolved_target(fixture_page):
    visit(fixture_page, "/memory/graph")
    assert fixture_page.is_visible(".kg svg")
    assert fixture_page.eval_on_selector_all(".kg .kg-node", "els => els.length") > 0
    assert fixture_page.get_attribute('.kg-node[data-key="MEMORY:FX-M9999"]', "data-state") == "UNRESOLVED"
    # FX-PR1 is declared in strategies.json, so it must not be listed as unresolved
    assert fixture_page.get_attribute('.kg-node[data-key="PROPOSAL:FX-PR1"]', "data-state") == "RELEASED_AS_VERSION"
    # the unresolved list is exactly the dashed (UNRESOLVED) nodes the graph draws — nothing dropped, nothing invented
    listed = _attrs(fixture_page, "[data-unresolved]", "data-unresolved")
    drawn = _attrs(fixture_page, '.kg-node[data-state="UNRESOLVED"]', "data-key")
    assert sorted(listed) == sorted(drawn)
    assert "MEMORY:FX-M9999" in listed and "PROPOSAL:FX-PR1" not in listed
    assert fixture_page.eval_on_selector_all("tr[data-node]", "els => els.length") == fixture_page.eval_on_selector_all(".kg-node", "els => els.length")


def test_fixture_graph_type_filter(fixture_page):
    visit(fixture_page, "/memory/graph?type=MEMORY")
    assert fixture_page.get_attribute(".mem-graph", "data-graph-mode") == "filtered"
    keys = set(_attrs(fixture_page, ".kg-node", "data-key"))
    assert {f"MEMORY:FX-M000{i}" for i in range(1, 7)} | {"MEMORY:FX-M9999"} <= keys
    # exactly the memories plus records sharing a declared edge with one — no other record is drawn
    kg = _fixture_snapshot()["derived"]["knowledge_graph"]
    mem = {n["key"] for n in kg["nodes"] if n["type"] == "MEMORY"}
    expected = mem | {k for e in kg["edges"] if e["source"] in mem or e["target"] in mem for k in (e["source"], e["target"])}
    assert keys == expected
    assert "HYPOTHESIS" not in set(_attrs(fixture_page, ".kg-node", "data-type"))


def test_fixture_lessons_and_findings_are_split_by_type(fixture_page):
    visit(fixture_page, "/memory/lessons")
    assert _attrs(fixture_page, ".mem-card", "data-memory-id") == ["FX-M0004"]
    visit(fixture_page, "/memory/findings")
    cards = _attrs(fixture_page, ".mem-card", "data-memory-id")
    assert "FX-M0001" in cards and "FX-M0004" not in cards and len(cards) == 5
    card = fixture_page.inner_text('.mem-card[data-memory-id="FX-M0003"]')
    assert "1 supporting" in card and "1 contradicting" in card and "2 independent" in card
    assert "NOT REPORTED" in card.upper()
    visit(fixture_page, "/memory/findings?state=VALIDATED")
    assert sorted(_attrs(fixture_page, ".mem-card", "data-memory-id")) == ["FX-M0001", "FX-M0002", "FX-M0005"]


def test_fixture_agent_memories_attributed_to_agent_02(fixture_page):
    visit(fixture_page, "/memory/agents")
    assert sorted(_attrs(fixture_page, '[data-agent-lane="2"] .mem-lane__mem', "data-memory-id")) == ["FX-M0003", "FX-M0006"]
    for slot in (1, 3, 4, 5):
        assert fixture_page.query_selector_all(f'[data-agent-lane="{slot}"] .mem-lane__mem') == []
    assert sorted(_attrs(fixture_page, '[data-agent-lane="2"] .mem-lane__ev', "data-event-id")) == ["FX-E0002", "FX-E0010"]
    # the fixture's recall is of agent 02's own memory: no cross-agent sharing is claimed
    assert fixture_page.query_selector_all(".mem-xagent") == []
    assert fixture_page.is_visible('[data-empty-state="cross-agent-none"]')
    assert fixture_page.inner_text('[data-cell="2-2"]').strip() == "1"


def test_fixture_overview_values(fixture_page):
    visit(fixture_page, "/memory")
    assert _attrs(fixture_page, ".mem-recent__row", "data-memory-id") == [f"FX-M000{i}" for i in range(6, 0, -1)]
    assert fixture_page.get_attribute(".mem-growth", "data-growth-points") == "6"
    assert _attrs(fixture_page, ".mem-loop__node", "data-connected") == ["1"] * 7
    assert fixture_page.inner_text('.mem-flow [data-step="DISCOVER"] .step__count').strip() == "2"
    assert fixture_page.get_attribute('.mem-flow [data-step="TEST"]', "data-state") == "NOT_REPORTED"


def test_fixture_loop_never_counts_better_stages(fixture_page):
    visit(fixture_page, "/memory")
    # only RESEARCH / EVIDENCE / MEMORY carry a count; the four "better" stages are one unscored row
    assert _attrs(fixture_page, ".mem-stage[data-stage]", "data-stage") == ["RESEARCH", "EVIDENCE", "MEMORY", "BETTER"]
    better = fixture_page.inner_text('[data-stage="BETTER"]').upper()
    assert "NOT SCORED" in better
    assert fixture_page.query_selector_all('[data-stage="BETTER"] [data-v]') == []
    for name in fixture_page.eval_on_selector_all(".mem-stage--record .mem-stage__name", "els => els.map(e => e.textContent)"):
        assert "BETTER" not in name.upper()

    def rec(key):
        return fixture_page.eval_on_selector_all(f'[data-record="{key}"] .mem-stage__rec [data-v]', "els => els.map(e => e.textContent.trim())")

    # same definition as derived.research_summary.validated: FX-S004 is RETIRED, so only FX-S003 counts
    assert rec("VALIDATED") == ["1"]
    assert sum(int(n) for n in rec("VALIDATED")) == _fixture_snapshot()["derived"]["research_summary"]["validated"]
    assert rec("STRATEGIES") == ["5"]
    assert rec("HYPOTHESES") == ["7", "1"]  # ORIGINAL and RECONSTRUCTED never merged
    assert rec("TRIALS") == ["9", "2"]


def test_fixture_overview_panel_codes_follow_reading_order(browser, fixture_url):
    for width in (1024, 1440, 1920):
        page = new_page(browser, fixture_url, width=width)
        visit(page, "/memory")
        codes = page.evaluate(
            """() => [...document.querySelectorAll('.view .panel__code')]
                .map(e => [e.textContent, e.getBoundingClientRect().top, e.getBoundingClientRect().left])"""
        )
        page.close()
        by_code = {c: (top, left) for c, top, left in codes}
        assert [c for c, _, _ in codes] == [f"MEM-0{i}" for i in range(1, 9)], codes
        # Composition (MEM-02) sits under the store; the loop (MEM-03) is beside it or below it, never above
        assert by_code["MEM-02"][0] > by_code["MEM-01"][0]
        assert by_code["MEM-03"][0] >= by_code["MEM-01"][0]
        if by_code["MEM-03"][1] <= by_code["MEM-02"][1]:
            assert by_code["MEM-03"][0] > by_code["MEM-02"][0], (width, codes)


def test_fixture_card_footer_never_clips_ids(browser, fixture_url):
    page = new_page(browser, fixture_url, width=1440)
    for route in ("/memory/findings", "/memory/lessons"):
        visit(page, route)
        feet = page.evaluate(
            """() => [...document.querySelectorAll('.mem-card')].map(c => {
                const s = c.querySelector('.mem-card__src'), d = c.querySelector('.mem-card__date');
                const cs = getComputedStyle(s);
                return {id: c.dataset.memoryId, display: cs.display, overflow: cs.textOverflow,
                        title: s.title, text: s.textContent.trim(), dateH: d.getBoundingClientRect().height};
            })"""
        )
        assert feet, route
        for f in feet:
            # a block (not a flex container), so a long source line ends in an ellipsis, never a cut glyph
            assert f["display"] == "block" and f["overflow"] == "ellipsis", f
            assert f["title"] == f"Source: {f['text']}", f
            assert f["dateH"] < 20, f  # one line: the created date never wraps
    page.close()


def test_fixture_detail_layout_at_1440(browser, fixture_url):
    page = new_page(browser, fixture_url, width=1440)
    visit(page, "/memory/item/FX-M0003")
    lay = page.evaluate(
        """() => {
            const t = document.querySelector('.page-head__title');
            const lh = parseFloat(getComputedStyle(t).lineHeight);
            const tiles = Object.fromEntries([...document.querySelectorAll('.mem-vtile')].map(e => {
                const r = e.getBoundingClientRect(); return [e.dataset.tile, [r.left, r.right, r.top]];
            }));
            const kv = [...document.querySelectorAll('.mem-src-kv .kv__item')].map(e => e.getBoundingClientRect().top);
            return {titleLines: Math.round(t.getBoundingClientRect().height / lh), tiles, kvRows: new Set(kv.map(Math.round)).size};
        }"""
    )
    page.close()
    assert lay["titleLines"] == 1, lay
    assert lay["kvRows"] == 1, lay  # the full-width Source panel lays its five fields out in one row
    tiles = lay["tiles"]
    # every tile edge lines up with a column edge of the first row (no thirds-over-halves)
    row1 = {round(tiles[k][0]) for k in ("confidence", "validation", "status")} | {round(tiles[k][1]) for k in ("confidence", "validation", "status")}
    for k in ("evidence", "origin"):
        if tiles[k][2] > tiles["confidence"][2]:
            assert round(tiles[k][0]) in row1 or round(tiles[k][1]) in row1, lay


def test_fixture_detail_strip_aligns_when_narrow(browser, fixture_url):
    page = new_page(browser, fixture_url, width=1600)
    visit(page, "/memory/item/FX-M0003")
    tiles = page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll('.mem-vtile')].map(e => {
            const r = e.getBoundingClientRect(); return [e.dataset.tile, [Math.round(r.left), Math.round(r.right), Math.round(r.top)]];
        }))"""
    )
    page.close()
    # Confidence / Validation / Status on one row; Evidence + Origin below, with Origin under Status
    assert tiles["confidence"][2] == tiles["validation"][2] == tiles["status"][2]
    assert tiles["evidence"][2] == tiles["origin"][2] > tiles["status"][2]
    assert abs(tiles["origin"][0] - tiles["status"][0]) <= 1 and abs(tiles["origin"][1] - tiles["status"][1]) <= 1
    assert abs(tiles["evidence"][0] - tiles["confidence"][0]) <= 1


# ---------------------------------------------------------------- mutated state


def test_cross_agent_recall_is_shown_when_the_data_proves_it(browser, state_factory):
    def written_by_agent_4(doc):
        for m in doc["data"]["memories"]:
            if m["memory_id"] == "FX-M0003":
                m["source"]["agent_slot"] = 4

    url, server = _serve(state_factory({"memory": written_by_agent_4}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/memory/agents")
        assert v.clean, v.describe()
        assert _attrs(page, '[data-agent-lane="2"] .mem-xagent', "data-cross-agent") == ["4"]
        assert page.inner_text('[data-cell="2-4"]').strip() == "1"
        assert "FX-M0003" in _attrs(page, '[data-agent-lane="4"] .mem-lane__mem', "data-memory-id")
        page.close()
    finally:
        server.should_exit = True


def test_connected_but_empty_store_shows_recorded_zeros(browser, state_factory):
    def no_memories(doc):
        doc["data"]["memories"] = []

    url, server = _serve(state_factory({"memory": no_memories}))
    try:
        page = new_page(browser, url)
        visit(page, "/memory")
        assert page.inner_text(".stat-row .stat .stat__value").strip() == "0"
        assert page.is_visible('[data-empty-state="memory-recent-none"]')
        # zero memories is "none recorded", never a vacuous "all traceable"
        assert page.is_visible('[data-empty-state="memory-trace-none"]')
        assert "ALL TRACEABLE" not in view_text(page).upper()
        visit(page, "/memory/findings")
        assert page.is_visible('[data-empty-state="memory-findings-none"]')
        visit(page, "/memory/evidence")
        assert page.is_visible('[data-empty-state="evidence-none"]')
        assert page.is_visible('[data-empty-state="evidence-trace-none"]')
        assert "ALL MEMORIES TRACEABLE" not in view_text(page).upper()
        v = visit(page, "/memory/item/FX-M0003")
        assert v.clean and page.is_visible('[data-empty-state="memory-not-found"]')
        page.close()
    finally:
        server.should_exit = True


def test_missing_memory_store_keeps_graph_from_other_sources(browser, state_factory):
    url, server = _serve(state_factory(drop=("memory",)))
    try:
        page = new_page(browser, url)
        for route in ROUTES:
            v = visit(page, route, settle_ms=150)
            assert v.clean, v.describe()
        visit(page, "/memory/graph")
        assert page.is_visible(".kg svg")
        # research/strategies still connected: their nodes render; memory nodes are only unresolved references
        memory_states = set(_attrs(page, '.kg-node[data-type="MEMORY"]', "data-state"))
        assert memory_states <= {"UNRESOLVED"}
        assert "NOT PRODUCED" in view_text(page).upper()
        visit(page, "/memory")
        assert page.is_visible('[data-empty-state="source-memory-MISSING"]')
        page.close()
    finally:
        server.should_exit = True
