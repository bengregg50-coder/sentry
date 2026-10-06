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
        lane = empty_page.inner_text(f'[data-agent-lane="{slot}"]').upper()
        # nothing is connected: the lane says so, never a "no memories" fact
        assert "SOURCES NOT CONNECTED" in lane and "NO AGENT MEMORIES" not in lane, lane
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
    # a matrix cell is counted per origin of the recall events behind it
    assert _attrs(fixture_page, '[data-cell="2-2"] [data-origin]', "data-origin") == ["SYNTHETIC_FIXTURE"]
    assert fixture_page.inner_text('[data-cell="2-2"] [data-origin] .v').strip() == "1"
    for slot in (1, 3, 4, 5):
        assert "NO AGENT MEMORIES RECORDED" in fixture_page.inner_text(f'[data-agent-lane="{slot}"]').upper()


def test_fixture_overview_values(fixture_page):
    visit(fixture_page, "/memory")
    assert _attrs(fixture_page, ".mem-recent__row", "data-memory-id") == [f"FX-M000{i}" for i in range(6, 0, -1)]
    assert fixture_page.get_attribute(".mem-growth", "data-growth-points") == "6"
    assert _attrs(fixture_page, ".mem-loop__node", "data-connected") == ["1"] * 7
    assert _split(fixture_page, '.mem-flow [data-step="DISCOVER"] .step__count') == {"SYNTHETIC_FIXTURE": "2"}
    # APPLICABILITY_TEST is a contract event kind: a connected stream without one has none recorded (0), not "not reported"
    assert fixture_page.get_attribute('.mem-flow [data-step="TEST"]', "data-state") == "NONE_RECORDED"
    assert _split(fixture_page, '.mem-flow [data-step="TEST"] .step__count') == {"NONE": "0"}


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
        assert _split(page, '[data-cell="2-4"]') == {"SYNTHETIC_FIXTURE": "1"}
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


# ---------------------------------------------------------------- per-origin counts: never one merged figure


def _split(page, selector):
    """{origin: shown number} of the per-origin split rendered inside the first `selector`."""
    return page.evaluate(
        """(sel) => {
            const host = document.querySelector(sel);
            if (!host) return null;
            return Object.fromEntries([...host.querySelectorAll('[data-origin]')]
                .map(e => [e.dataset.origin, e.querySelector('.v').textContent.trim()]));
        }""",
        selector,
    )


def _stat_split(page, label):
    """Per-origin split shown in the stat tile labelled `label` (None when the tile shows no split)."""
    return page.evaluate(
        """(label) => {
            const s = [...document.querySelectorAll('.view .stat')]
                .find(x => x.querySelector('.stat__label').textContent.trim().toUpperCase() === label.toUpperCase());
            if (!s) throw new Error('no stat ' + label);
            const parts = [...s.querySelectorAll('.stat__value [data-origin]')];
            if (!parts.length) return null;
            return Object.fromEntries(parts.map(e => [e.dataset.origin, e.querySelector('.v').textContent.trim()]));
        }""",
        label,
    )


def _as_shown(counts):
    return {k: str(v) for k, v in counts.items() if v}


def _mixed_origins(doc):
    """FX-M0001..4 ORIGINAL, FX-M0005..6 RECONSTRUCTED (the store mixes origins)."""
    for m in doc["data"]["memories"]:
        m["origin"] = "RECONSTRUCTED" if m["memory_id"] in ("FX-M0005", "FX-M0006") else "ORIGINAL"


def test_mixed_origin_store_is_never_shown_as_one_total(browser, state_factory):
    from collections import Counter

    from atp.gui.command_centre.api import build_snapshot
    from atp.gui.command_centre.provider import FileStateProvider

    state = state_factory({"memory": _mixed_origins})
    snap = build_snapshot(FileStateProvider(state))
    ms = snap["derived"]["memory_stats"]
    mems = snap["documents"]["memory"]["memories"]
    url, server = _serve(state)
    try:
        page = new_page(browser, url, width=1920)
        v = visit(page, "/memory")
        assert v.clean, v.describe()
        # MEM-01: each tile is derive's per-origin map (or the same definition counted per origin)
        assert _stat_split(page, "Total memories") == _as_shown(ms["by_origin"]) == {"ORIGINAL": "4", "RECONSTRUCTED": "2"}
        assert _stat_split(page, "High confidence") == _as_shown(ms["high_confidence_by_origin"]) == {"ORIGINAL": "2", "RECONSTRUCTED": "1"}
        assert _stat_split(page, "Unresolved") == _as_shown(ms["unresolved_by_origin"]) == {"ORIGINAL": "1", "RECONSTRUCTED": "1"}
        rejected = Counter(m["origin"] for m in mems if m["type"] == "REJECTED_ASSUMPTION" or m["status"] == "REJECTED")
        assert _stat_split(page, "Rejected assumptions") == _as_shown(rejected)
        assert sum(rejected.values()) == ms["rejected_assumptions"]
        assert _stat_split(page, "Contradicted") == {"NONE": "0"} and ms["contradicted"] == 0
        # no tile shows the merged figure (6 memories, 3 high-confidence)
        tiles = page.eval_on_selector_all(".view .stat__value", "els => els.map(e => e.textContent.replace(/\\s+/g, ' ').trim())")
        assert "6" not in tiles and "3" not in tiles, tiles
        assert _split(page, '[data-total="evidence"]') == {"ORIGINAL": "6", "RECONSTRUCTED": "1"}
        # composition bars carry the split; the growth chart draws one line per origin
        assert _split(page, '.mem-bar[data-bar="VALIDATED"]') == {"ORIGINAL": "3", "RECONSTRUCTED": "1"}
        assert page.get_attribute(".mem-growth", "data-growth-series") == "ORIGINAL RECONSTRUCTED"
        assert sorted(_attrs(page, ".mem-growth__line", "data-series")) == ["ORIGINAL", "RECONSTRUCTED"]
        assert "6" not in page.inner_text(".mem-growth__legend")
        # MEM-06 counts are per origin too
        assert _split(page, '.mem-flow [data-step="DISCOVER"] .step__count') == {"ORIGINAL": "1", "RECONSTRUCTED": "1"}

        visit(page, "/memory/findings")
        assert _split(page, ".mem-filterbar .tab .count") == {"ORIGINAL": "3", "RECONSTRUCTED": "2"}
        assert _stat_split(page, "Shown") == {"ORIGINAL": "3", "RECONSTRUCTED": "2"}
        assert page.inner_text(".mem-list-panel .panel__sub").startswith("3 original · 2 reconstructed")

        visit(page, "/memory/evidence")
        assert _stat_split(page, "Evidence items") == {"ORIGINAL": "6", "RECONSTRUCTED": "1"}
        assert _stat_split(page, "Untraceable") == {"RECONSTRUCTED": "1"}

        visit(page, "/memory/graph")
        assert _stat_split(page, "Memory nodes") == {"ORIGINAL": "4", "RECONSTRUCTED": "2"}

        visit(page, "/memory/agents")
        assert _stat_split(page, "Agent-sourced memories") == {"ORIGINAL": "1", "RECONSTRUCTED": "1"}
        assert _split(page, '[data-agent-lane="2"] .mem-lane__stat:first-child') == {"ORIGINAL": "1", "RECONSTRUCTED": "1"}
        page.close()
    finally:
        server.should_exit = True


def test_fixture_counts_are_tagged_with_their_origin(fixture_page):
    visit(fixture_page, "/memory")
    assert _stat_split(fixture_page, "Total memories") == {"SYNTHETIC_FIXTURE": "6"}
    snap = _fixture_snapshot()
    growth = snap["derived"]["memory_stats"]["growth"]
    # a single-origin store draws exactly derive's growth series, one line
    assert fixture_page.get_attribute(".mem-growth", "data-growth-series") == "SYNTHETIC_FIXTURE"
    assert int(fixture_page.get_attribute(".mem-growth", "data-growth-points")) == len(growth)
    assert fixture_page.inner_text('[data-series-key="SYNTHETIC_FIXTURE"] b').strip() == str(growth[-1]["cumulative"])
    visit(fixture_page, "/memory/agents")
    # every memory event of the stream was fetched (checked against derive's exact per-kind counts)
    assert _stat_split(fixture_page, "Memory writes") == {"SYNTHETIC_FIXTURE": "1"}
    hints = fixture_page.eval_on_selector_all(".mem-stats-6 .stat__hint", "els => els.map(e => e.textContent.trim())")
    assert hints.count("Whole stream") == 3, hints


# ---------------------------------------------------------------- source status: not connected ≠ not produced ≠ invalid

MEMORY_ROUTES = ["/memory", "/memory/graph", "/memory/findings", "/memory/lessons", "/memory/evidence", "/memory/agents", "/memory/item/FX-M0003"]


def test_missing_memory_store_says_not_produced_never_not_connected(browser, state_factory):
    url, server = _serve(state_factory(drop=("memory",)))
    try:
        page = new_page(browser, url)
        for route in MEMORY_ROUTES:
            v = visit(page, route, settle_ms=150)
            assert v.clean, v.describe()
            text = view_text(page).upper()
            assert "NOT CONNECTED" not in text, route
            assert "NOT PRODUCED" in text, route
        visit(page, "/memory/item/FX-M0003")
        assert page.inner_text('[data-empty-state="source-memory-MISSING"] .empty__title').strip().upper() == "MEMORY STORE NOT PRODUCED"
        visit(page, "/memory")
        assert page.eval_on_selector(".mem-growth-empty .t", "e => e.textContent.trim()") == "Memory growth not produced"
        assert page.get_attribute('.mem-flow [data-step="DISCOVER"]', "data-state") == "NOT_PRODUCED"
        # the event stream is still readable: its steps keep reporting
        assert page.get_attribute('.mem-flow [data-step="STORE"]', "data-state") == "REPORTING"
        visit(page, "/memory/agents")
        lane = page.inner_text('[data-agent-lane="1"]').upper()
        assert "NONE IN AVAILABLE SOURCES" in lane and "MEMORY.JSON NOT PRODUCED" in lane, lane
        page.close()
    finally:
        server.should_exit = True


def test_invalid_memory_store_is_a_contract_error_never_not_connected(browser, state_factory):
    def invalid(doc):
        doc["data"]["memories"][0]["confidence"] = "VERY_HIGH"  # not a contract value

    url, server = _serve(state_factory({"memory": invalid}))
    try:
        page = new_page(browser, url)
        for route in MEMORY_ROUTES:
            v = visit(page, route, settle_ms=150)
            assert v.clean, v.describe()
            text = view_text(page).upper()
            assert "NOT CONNECTED" not in text, route
            assert "CONTRACT ERROR" in text or "REJECTED BY THE CONTRACT" in text or "DOES NOT CONFORM" in text, route
        visit(page, "/memory/item/FX-M0003")
        assert page.inner_text('[data-empty-state="source-memory-INVALID"] .empty__title').strip().upper() == "MEMORY STORE REJECTED BY THE CONTRACT"
        visit(page, "/memory")
        assert _stat_split(page, "Total memories") is None
        assert "CONTRACT ERROR" in page.inner_text(".view .stat").upper()
        assert page.get_attribute('.mem-flow [data-step="DISCOVER"]', "data-state") == "INVALID"
        visit(page, "/memory/graph")
        assert "memory.json rejected by the contract" in page.inner_text('[data-graph-missing="memory"]')
        page.close()
    finally:
        server.should_exit = True


def test_no_findings_means_none_from_checks_that_ran(browser, state_factory):
    def resolved(doc):
        for m in doc["data"]["memories"]:
            m["related_memories"] = []  # no unresolved memory reference left; FX-M0004 is then referenced by nothing
            if m["memory_id"] == "FX-M0004":
                m["source"]["programme_id"] = None  # ... and references nothing

    url, server = _serve(state_factory({"memory": resolved}, drop=("strategies",)))
    try:
        page = new_page(browser, url)
        visit(page, "/memory")
        assert page.is_visible('[data-empty-state="memory-no-findings"]')
        reason = page.inner_text('[data-empty-state="memory-no-findings"] .empty__reason')
        assert reason.startswith("None from the memory cross-checks that ran"), reason
        # strategies.json is missing, so strategy references were not checked — and it says so
        assert "Strategy references were not checked — strategies.json not produced" in reason, reason
        assert "CONSISTENT" not in view_text(page).upper()
        visit(page, "/memory/item/FX-M0004")
        assert page.is_visible('[data-empty-state="memory-relations-none"]')
        # references from strategies cannot be checked when strategies.json is missing
        text = view_text(page)
        assert "no record references it in its lineage" not in text
        assert "strategies.json not produced" in text
        page.close()
    finally:
        server.should_exit = True


# ---------------------------------------------------------------- applicability tests (APPLICABILITY_TEST events)


def test_applicability_test_events_are_counted(browser, state_factory):
    import json

    state = state_factory()
    path = state / "agent_events.jsonl"
    event = {
        "event_id": "FX-E0100",
        "ts": "2026-01-20T12:10:00+00:00",
        "agent_slot": 3,
        "kind": "APPLICABILITY_TEST",
        "mode": "SIM",
        "summary": "Agent 03 tested whether FX-M0003 applies to its market",
        "refs": {"memory_ids": ["FX-M0003"]},
        "origin": "ORIGINAL",
    }
    path.write_text(path.read_text().rstrip("\n") + "\n" + json.dumps(event) + "\n")
    url, server = _serve(state)
    try:
        page = new_page(browser, url)
        visit(page, "/memory")
        assert page.get_attribute('.mem-flow [data-step="TEST"]', "data-state") == "REPORTING"
        assert _split(page, '.mem-flow [data-step="TEST"] .step__count') == {"ORIGINAL": "1"}
        visit(page, "/memory/agents")
        assert _stat_split(page, "Applicability tests") == {"ORIGINAL": "1"}
        assert _attrs(page, '[data-agent-lane="3"] .mem-lane__ev', "data-kind") == ["APPLICABILITY_TEST"]
        visit(page, "/memory/item/FX-M0003")
        assert "FX-E0100" in _attrs(page, ".mem-evlist [data-event-id]", "data-event-id")
        page.close()
    finally:
        server.should_exit = True


# ---------------------------------------------------------------- layout regressions


def test_empty_values_keep_the_empty_colour(browser, state_factory):
    def unreported(doc):
        for m in doc["data"]["memories"]:
            if m["memory_id"] == "FX-M0003":
                for e in m["evidence"]:
                    e["recorded_at"] = None
                    e["independent"] = None

    url, server = _serve(state_factory({"memory": unreported}))
    try:
        page = new_page(browser, url)
        visit(page, "/memory/item/FX-M0003")
        colours = page.evaluate(
            """() => {
                const probe = document.createElement('span');
                probe.style.color = 'var(--faint)';
                document.body.appendChild(probe);
                const faint = getComputedStyle(probe).color;
                probe.remove();
                return {faint, foot: [...document.querySelectorAll('.mem-ev__foot .v.is-empty')].map(e => getComputedStyle(e).color),
                        all: [...document.querySelectorAll('.view .v.is-empty')].map(e => getComputedStyle(e).color)};
            }"""
        )
        assert len(colours["foot"]) >= 2, colours
        assert set(colours["foot"]) == {colours["faint"]}, colours
        assert set(colours["all"]) == {colours["faint"]}, colours
        page.close()
    finally:
        server.should_exit = True


def test_lessons_panel_is_not_stretched_to_the_side_column(browser, fixture_url):
    for width in (1920, 2560):
        page = new_page(browser, fixture_url, width=width)
        visit(page, "/memory/lessons")
        g = page.evaluate(
            """() => {
                const p = document.querySelector('.mem-list-panel').getBoundingClientRect();
                const c = [...document.querySelectorAll('.mem-list-panel .mem-card')].map(e => e.getBoundingClientRect().bottom);
                const side = document.querySelector('.mem-side').getBoundingClientRect();
                return {panelBottom: p.bottom, lastCard: Math.max(...c), sideBottom: side.bottom};
            }"""
        )
        page.close()
        assert g["panelBottom"] - g["lastCard"] < 40, (width, g)  # ends with its card, not in blank panel
        assert g["panelBottom"] < g["sideBottom"], (width, g)


def _rows_fill(page, container_sel, item_sel):
    """For each container: every visual row of items spans the container's full inner width (no empty track)."""
    return page.evaluate(
        """([cs, is]) => [...document.querySelectorAll(cs)].map(c => {
            const box = c.getBoundingClientRect();
            const bl = parseFloat(getComputedStyle(c).borderLeftWidth) || 0, br = parseFloat(getComputedStyle(c).borderRightWidth) || 0;
            const rows = {};
            for (const it of c.querySelectorAll(is)) {
                const r = it.getBoundingClientRect();
                (rows[Math.round(r.top)] ??= []).push([r.left, r.right]);
            }
            return Object.values(rows).map(items => ({
                left: Math.min(...items.map(x => x[0])) - (box.left + bl),
                right: (box.right - br) - Math.max(...items.map(x => x[1])),
                n: items.length,
            }));
        })""",
        [container_sel, item_sel],
    )


def test_card_check_grid_never_leaves_a_filler_cell(browser, fixture_url):
    for width in (1024, 1280, 1440, 1920):
        page = new_page(browser, fixture_url, width=width)
        visit(page, "/memory/findings")
        grids = _rows_fill(page, ".mem-card__checks", ".mem-card__check")
        page.close()
        assert grids, width
        for rows in grids:
            assert [r["n"] for r in rows] in ([5], [3, 2]), (width, rows)
            for r in rows:
                assert abs(r["left"]) <= 1.5 and abs(r["right"]) <= 1.5, (width, rows)


def test_agent_lanes_wrap_without_an_empty_slot(browser, fixture_url):
    for width in (1024, 1280, 1440, 1920, 2560):
        page = new_page(browser, fixture_url, width=width)
        visit(page, "/memory/agents")
        (rows,) = _rows_fill(page, ".mem-lanes", ".mem-lane")
        six = page.evaluate(
            """() => [...document.querySelectorAll('.mem-stats-6 > .stat-row')].map(r =>
                Object.values([...r.children].reduce((a, s) => { const t = Math.round(s.getBoundingClientRect().top); a[t] = (a[t] ?? 0) + 1; return a; }, {})))"""
        )
        page.close()
        assert [r["n"] for r in rows] in ([5], [3, 2]), (width, rows)
        for r in rows:
            assert abs(r["left"]) <= 1.5 and abs(r["right"]) <= 1.5, (width, rows)
        # six activity stats: one row of six or two rows of three
        assert six and all(s in ([6], [3, 3]) for s in six), (width, six)


def test_graph_type_tabs_never_overlap(browser, fixture_url):
    for width in (1024, 1440):
        page = new_page(browser, fixture_url, width=width)
        visit(page, "/memory/graph")
        boxes = page.eval_on_selector_all(
            ".mem-graph-tabs .tab", "els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })"
        )
        nodes = page.evaluate(
            """() => { const s = [...document.querySelectorAll('.mem-stats-6 .stat')][0]; return s.querySelector('.stat__value').getBoundingClientRect().height; }"""
        )
        page.close()
        for i, a in enumerate(boxes):
            for b in boxes[i + 1 :]:
                overlap = min(a[2], b[2]) - max(a[0], b[0]) > 1 and min(a[3], b[3]) - max(a[1], b[1]) > 1
                assert not overlap, (width, a, b)
        assert nodes < 40, (width, nodes)  # the per-origin Nodes split fits on one line
