"""Data views (Datasets, State Sources, Insights): honest when empty, exact when populated.

Covers: every route renders clean in empty and fixture modes; nothing claims a
value with no state connected; State Sources shows every contract document's
real status (NOT_CONFIGURED / OK / INVALID with the validation error visible);
the coverage timeline is drawn only from declared dates; null results are
emphasised; links stay local; nothing on these pages can submit.
"""

from __future__ import annotations

import pytest

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit
from .conftest import start_server

pytestmark = pytest.mark.browser

ROUTES = ["/data", "/data/sources", "/insights"]
DOC_FILES = [
    "system.json",
    "research.json",
    "strategies.json",
    "agents.json",
    "memory.json",
    "governance.json",
    "datasets.json",
    "portfolio.json",
    "risk.json",
    "execution.json",
    "live.json",
    "insights.json",
]


def _doc_rows(page) -> dict[str, str]:
    return page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll('.view [data-source-row][data-kind="document"]')]
            .map(el => [el.dataset.sourceRow, el.dataset.status]))"""
    )


def _no_write_affordances(page) -> None:
    assert page.evaluate("document.querySelectorAll('.view form, .view input, .view textarea, .view select').length") == 0
    hrefs = page.eval_on_selector_all(".view a[href]", "els => els.map(e => e.getAttribute('href'))")
    external = [h for h in hrefs if not (h.startswith("#") or h.startswith("/api/cc/"))]
    assert external == [], external


# --------------------------------------------------------------------------- empty mode


@pytest.mark.parametrize("route", ROUTES)
def test_empty_routes_render_clean_with_no_values(browser, empty_url, route):
    page = new_page(browser, empty_url)
    v = visit(page, route)
    assert v.clean, v.describe()
    assert v.module in {"data", "data-sources", "insights"}
    assert present_values(page) == []
    assert fake_value_hits(view_text(page)) == []
    assert page.eval_on_selector_all(".view .tone-ok", "els => els.length") == 0  # nothing reads as passed
    _no_write_affordances(page)
    page.close()


def test_sources_empty_shows_all_twelve_not_configured(browser, empty_url):
    page = new_page(browser, empty_url)
    v = visit(page, "/data/sources")
    assert v.clean, v.describe()
    rows = _doc_rows(page)
    assert len(rows) == 12
    assert set(rows.values()) == {"NOT_CONFIGURED"}
    files = page.eval_on_selector_all('[data-kind="document"] .dat-doc__name b', "els => els.map(e => e.textContent.trim())")
    assert files == DOC_FILES
    assert page.get_attribute('[data-source-row="agent_events"]', "data-status") == "NOT_CONFIGURED"
    assert page.inner_text('[data-status-count="NOT_CONFIGURED"] .dat-vs__count').replace("\n", "") == "12/12"
    assert page.inner_text('[data-status-count="OK"] .dat-vs__count').replace("\n", "") == "0/12"
    assert page.query_selector("[data-source-error]") is None
    # every document links its local JSON Schema, plus the agent event schema
    schemas = page.eval_on_selector_all(".dat-doc__schema", "els => els.map(e => e.getAttribute('href'))")
    assert len(schemas) == 13
    assert "/api/cc/contract/research.schema.json" in schemas
    assert "/api/cc/contract/agent_event.schema.json" in schemas
    text = view_text(page)
    for cmd in ("python -m atp.gui --state-dir <DIR>", "SENTRY_STATE_DIR", "contract export", "contract check"):
        assert cmd in text
    # the data flow is drawn but dormant upstream of the API
    assert page.get_attribute('[data-flow-stage="STATE"]', "class").count("is-dormant") == 1
    assert page.get_attribute('[data-flow-stage="API"]', "class").count("is-live") == 1
    page.close()


def test_datasets_empty_draws_frame_without_bars(browser, empty_url):
    page = new_page(browser, empty_url)
    v = visit(page, "/data")
    assert v.clean, v.describe()
    assert page.get_attribute("[data-timeline]", "data-timeline") == "empty"
    assert page.query_selector(".dat-tl__bar") is None
    assert page.query_selector(".dat-tl__year") is None  # no axis dates without declared dates
    assert page.query_selector("[data-dataset]") is None
    text = view_text(page).upper()
    assert "NO DATASETS CONNECTED — COVERAGE IS NEVER INFERRED" in text
    assert "NOT CONNECTED" in text
    # the record structure is still shown, honestly empty
    assert page.query_selector(".dat-schematic") is not None
    gov = page.eval_on_selector_all("[data-gov-row][data-state]", "els => els.map(e => e.dataset.state)")
    assert gov == ["NOT_CONNECTED"] * 3
    page.close()


def test_insights_empty_says_not_connected(browser, empty_url):
    page = new_page(browser, empty_url)
    v = visit(page, "/insights")
    assert v.clean, v.describe()
    assert page.query_selector("[data-insight]") is None
    text = view_text(page).upper()
    # not connected is not "none produced": no state directory means nothing can be said about insights
    assert "NO INSIGHTS PRODUCED YET" not in text
    titles = page.eval_on_selector_all(
        '[data-empty-state^="source-insights-"] .empty__title', "els => els.map(e => e.textContent.trim().toUpperCase())"
    )
    assert titles == ["INSIGHTS NOT CONNECTED"] * 2  # INS-03 null results and INS-04 stream
    assert "NULL RESULTS ARE RESULTS" in text
    # digest blocks are present, each explaining its emptiness
    assert page.eval_on_selector_all("[data-digest]", "els => els.map(e => e.dataset.digest)") == ["D1", "D2", "D3"]
    assert "NOTHING CONNECTED — NOTHING TO CROSS-CHECK" in text
    page.close()


def test_insights_missing_vs_invalid_titles(browser, state_factory):
    """MISSING in a configured state dir is "none produced"; a contract error names the file."""
    url, server = start_server(state_factory(drop=("insights",)))
    try:
        page = new_page(browser, url)
        v = visit(page, "/insights")
        assert v.clean, v.describe()
        text = view_text(page).upper()
        assert "NO INSIGHTS PRODUCED YET" in text
        assert "INSIGHTS NOT CONNECTED" not in text
        page.close()
    finally:
        server.should_exit = True

    def corrupt(doc):
        doc["data"]["insights"][0]["kind"] = "NOT_A_KIND"

    url, server = start_server(state_factory({"insights": corrupt}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/insights")
        assert v.clean, v.describe()
        text = view_text(page).upper()
        assert "INSIGHTS.JSON REJECTED BY THE CONTRACT" in text
        assert "NO INSIGHTS PRODUCED YET" not in text
        page.close()
    finally:
        server.should_exit = True


# --------------------------------------------------------------------------- fixture mode


@pytest.mark.parametrize("route", ROUTES)
def test_fixture_routes_render_clean(browser, fixture_url, route):
    page = new_page(browser, fixture_url)
    v = visit(page, route)
    assert v.clean, v.describe()
    _no_write_affordances(page)
    page.close()


def test_datasets_fixture_records(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/data")
    assert v.clean, v.describe()
    tl = page.eval_on_selector_all("[data-tl-dataset]", "els => els.map(e => e.dataset.tlDataset)")
    assert tl == ["FX-DS-A", "FX-DS-B", "FX-DS-C"]
    assert len(page.query_selector_all(".dat-tl__bar")) == 3
    roots = page.eval_on_selector_all(".dat-card__id b", "els => els.map(e => e.textContent.trim())")
    assert roots == ["FXA", "FXB", "FXC"]
    text = view_text(page)
    for d in ("2018-01-02", "2025-12-31", "2019-06-03"):
        assert d in text
    # FXB integrity WARN is amber, never green
    fxb = page.get_attribute('[data-dataset="FX-DS-B"] .dat-card__badges .badge', "class")
    assert "tone-warn" in fxb and "tone-ok" not in fxb
    assert page.get_attribute('[data-tl-dataset="FX-DS-B"] .dat-tl__integ .badge', "data-state") == "WARN"
    # FXC is flagged reconstructed (card, timeline hatch); FXA is not
    assert page.query_selector('[data-dataset="FX-DS-C"] [data-state="RECONSTRUCTED"]') is not None
    assert page.query_selector('[data-tl-dataset="FX-DS-C"] .dat-tl__recon') is not None
    assert page.query_selector('[data-dataset="FX-DS-A"] [data-state="RECONSTRUCTED"]') is None
    # the declared FXB gap is cut into its bar and listed
    assert page.get_attribute('[data-tl-dataset="FX-DS-B"] .dat-tl__gap', "data-gap") == "2020-03-16"
    assert page.query_selector('[data-dataset="FX-DS-B"] [data-gap-row="2020-03-16"]') is not None
    # full content hash on hover; short form shown
    full = page.get_attribute('[data-dataset="FX-DS-B"] .dat-hash', "title")
    assert full == "fx" + "0" * 61 + "2"
    assert page.inner_text('[data-dataset="FX-DS-B"] .dat-hash').endswith("…")
    # rows count is not declared by the fixture: shown empty, never 0
    rows_v = page.eval_on_selector('[data-dataset="FX-DS-A"]', "el => [...el.querySelectorAll('.kv__item')].find(i => i.textContent.includes('Rows')).querySelector('[data-v]').className")
    assert "is-empty" in rows_v
    # origin is surfaced on synthetic records
    assert len(page.query_selector_all('[data-dataset] [data-state="SYNTHETIC_FIXTURE"]')) == 3
    page.close()


def test_sources_fixture_all_twelve_ok(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/data/sources")
    assert v.clean, v.describe()
    rows = _doc_rows(page)
    assert len(rows) == 12 and set(rows.values()) == {"OK"}
    assert page.get_attribute('[data-source-row="agent_events"]', "data-status") == "OK"
    assert page.query_selector("[data-source-error]") is None
    assert page.inner_text('[data-status-count="OK"] .dat-vs__count').replace("\n", "") == "12/12"
    # provenance: every envelope here is a synthetic fixture
    synth = page.eval_on_selector_all('[data-origin="SYNTHETIC_FIXTURE"] .dat-file', "els => els.length")
    assert synth == 12
    assert page.get_attribute('[data-flow-stage="DERIVED"]', "class").count("is-live") == 1
    # connected (even contract-valid) is not a passed check, and these are synthetic documents:
    # every OK source reads CONNECTED in cyan, as on every other view — nothing here is green
    assert page.eval_on_selector_all(".view .tone-ok", "els => els.length") == 0
    row_cls = page.eval_on_selector_all('.view [data-source-row]', "els => els.map(e => e.className)")
    assert len(row_cls) == 13 and all("tone-info" in c for c in row_cls)
    states = page.eval_on_selector_all('.view [data-source-row] .dat-doc__status .badge', "els => els.map(e => e.dataset.state + ':' + e.textContent.trim())")
    assert set(states) == {"CONNECTED:CONNECTED"}
    assert "tone-info" in page.get_attribute('[data-status-count="OK"]', "class")
    assert page.get_attribute('[data-status-count="OK"] .badge', "data-state") == "CONNECTED"
    assert page.get_attribute(".dat-vs__events .badge", "data-state") == "CONNECTED"
    feed = page.eval_on_selector_all('[data-feed-status="OK"] .dot', "els => els.map(e => e.dataset.state)")
    assert feed and set(feed) == {"CONNECTED"}
    assert page.get_attribute(".dat-hdr .badge", "data-state") == "CONNECTED"
    assert "12/12 DOCUMENTS CONNECTED" in page.inner_text(".dat-hdr").upper()
    page.close()


def test_sources_invalid_research_shows_error_text(browser, state_factory):
    def corrupt(doc):
        doc["data"]["hypotheses"][0]["status"] = "NOT_A_STATUS"

    url, server = start_server(state_factory({"research": corrupt}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/data/sources")
        assert v.clean, v.describe()
        rows = _doc_rows(page)
        assert rows["research"] == "INVALID"
        assert sum(1 for s in rows.values() if s == "OK") == 11
        badge = page.get_attribute('[data-source-row="research"] .dat-doc__status .badge', "class")
        assert "tone-bad" in badge
        err = page.query_selector('[data-source-error="research"]')
        assert err is not None and err.is_visible()
        msg = err.inner_text()
        assert "hypotheses.0.status" in msg and "Input should be" in msg
        assert "1 DOCUMENT REJECTED BY THE CONTRACT" in view_text(page).upper()
        # datasets are unaffected and still render; research citations explain the contract error
        visit(page, "/data")
        assert page.query_selector('[data-dataset="FX-DS-B"]') is not None
        assert "RESEARCH.JSON · CONTRACT ERROR" in view_text(page).upper()
        page.close()
    finally:
        server.should_exit = True


def test_timeline_axis_comes_only_from_declared_dates(browser, state_factory):
    def custom(doc):
        doc["data"]["datasets"] = [
            {
                "dataset_id": "TST-1",
                "root": "ZQX",
                "integrity": "UNKNOWN",
                "coverage_start": "2001-02-01",
                "coverage_end": "2003-06-30",
                "gaps": [{"start": "2002-05-01", "end": "2002-05-03"}],
                "origin": "SYNTHETIC_FIXTURE",
            },
            {"dataset_id": "TST-2", "root": "ZQY", "integrity": "FAIL", "origin": "SYNTHETIC_FIXTURE"},
        ]

    def no_insights(doc):
        doc["data"]["insights"] = []

    url, server = start_server(state_factory({"datasets": custom, "insights": no_insights}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/data")
        assert v.clean, v.describe()
        years = page.eval_on_selector_all(".dat-tl__year", "els => els.map(e => e.textContent.trim())")
        assert years == ["2001", "2002", "2003"]
        assert len(page.query_selector_all(".dat-tl__bar")) == 1  # undated dataset gets no bar
        assert "COVERAGE NOT DECLARED" in page.inner_text('[data-tl-dataset="TST-2"]')
        fail = page.get_attribute('[data-dataset="TST-2"] .dat-card__badges .badge', "class")
        assert "tone-bad" in fail
        assert "2018" not in page.inner_text(".dat-tl")
        v = visit(page, "/insights")
        assert v.clean, v.describe()
        text = view_text(page)
        assert "NO INSIGHTS PRODUCED YET" in text.upper()
        assert "insights.json is connected and declares none." in text
        page.close()
    finally:
        server.should_exit = True


def test_datasets_connected_but_empty(browser, state_factory):
    def empty(doc):
        doc["data"]["datasets"] = []

    url, server = start_server(state_factory({"datasets": empty}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/data")
        assert v.clean, v.describe()
        assert page.get_attribute("[data-timeline]", "data-timeline") == "empty"
        text = view_text(page).upper()
        assert "NO DATASETS DECLARED" in text
        # a connected, empty catalogue is a fact: zero records, not "not connected"
        assert "NOT CONNECTED" not in page.inner_text(".dat-sum").upper()
        records = page.eval_on_selector_all(
            "[data-origin-matrix] [data-origin-row] .dat-om__n [data-v]",
            "els => els.map(e => [e.textContent.trim(), e.classList.contains('is-empty')])",
        )
        assert records == [["0", False]] * 3  # real zeros per origin, never blanks
        page.close()
    finally:
        server.should_exit = True


def test_insights_fixture_null_result_emphasised(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/insights")
    assert v.clean, v.describe()
    nulls = page.query_selector_all('[data-insight="FX-I1"][data-kind="NULL_RESULT"]')
    assert len(nulls) == 2  # once in Null results, once in the stream
    assert all("dat-ins--null" in (n.get_attribute("class") or "") for n in nulls)
    assert "NULL RESULT" in nulls[0].inner_text().upper()
    assert "FIXTURE: intraday family exhausted" in nulls[0].inner_text()
    # the governance insight is not presented as a null result
    fx2 = page.query_selector_all('[data-insight="FX-I2"]')
    assert len(fx2) == 1 and fx2[0].get_attribute("data-kind") == "GOVERNANCE"
    # evidence ref resolves to the real memory record
    assert page.get_attribute('[data-insight="FX-I1"] a.ref', "href") == "#/memory/item/FX-M0001"
    # digest is built from state: fixture has 1 critical, 2 warning, 2 info findings
    sev = page.eval_on_selector_all('[data-digest="D1"] [data-severity] [data-v]', "els => els.map(e => e.textContent.trim())")
    assert sev == ["1", "2", "2"]
    assert page.query_selector('[data-digest="D3"] [data-change="FX-C3"]') is not None
    v = visit(page, "/insights?kind=GOVERNANCE")
    assert v.clean, v.describe()
    stream = page.eval_on_selector_all(".dat-tabs ~ .dat-fit [data-insight]", "els => els.map(e => e.dataset.insight)")
    assert stream == ["FX-I2"]
    page.close()


# --------------------------------------------------------------------------- round 3 regressions

_ALL_DOCS = tuple(f[: -len(".json")] for f in DOC_FILES) + ("agent_events.jsonl",)


def _panel_text(page, code: str, part: str = "") -> str:
    """Inner text of a panel (or one of its parts: '.panel__sub', '.panel__body') by its code."""
    return page.evaluate(
        """([code, part]) => {
            const p = [...document.querySelectorAll('.view .panel')]
              .find(x => x.querySelector(':scope > .panel__head .panel__code')?.textContent.trim() === code);
            if (!p) return null;
            return (part ? p.querySelector(part) : p)?.innerText ?? null;
        }""",
        [code, part],
    )


_BLANK_JS = """codes => Object.fromEntries(codes.map(c => {
    const p = [...document.querySelectorAll('.view .panel')]
      .find(x => x.querySelector(':scope > .panel__head .panel__code')?.textContent.trim() === c);
    if (!p) return [c, null];
    const body = p.querySelector(':scope > .panel__body');
    let bottom = 0;
    for (const ch of body.children) { const r = ch.getBoundingClientRect(); if (r.height > 0) bottom = Math.max(bottom, r.bottom); }
    return [c, Math.round(body.getBoundingClientRect().bottom - bottom)];
}))"""

_FEED_ROWS_JS = """() => { const rows = {};
    for (const f of document.querySelectorAll('.view .dat-feed')) { const y = Math.round(f.getBoundingClientRect().top); rows[y] = (rows[y] || 0) + 1; }
    return Object.keys(rows).sort((a, b) => a - b).map(k => rows[k]); }"""

_EMPTY_NOT_FAINT_JS = """() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--faint)';
    document.body.appendChild(probe);
    const faint = getComputedStyle(probe).color;
    probe.remove();
    return [...document.querySelectorAll('.view [data-v].is-empty, .view [data-v][data-empty]')]
      .filter(e => getComputedStyle(e).color !== faint)
      .map(e => e.className + ' -> ' + getComputedStyle(e).color);
}"""


def test_missing_documents_are_not_produced_not_disconnected(browser, state_factory):
    """A configured state dir where nothing was produced: every label says NOT PRODUCED, never NOT CONNECTED."""
    url, server = start_server(state_factory(drop=_ALL_DOCS))
    try:
        page = new_page(browser, url)
        v = visit(page, "/data/sources")
        assert v.clean, v.describe()
        assert set(_doc_rows(page).values()) == {"MISSING"}
        assert page.get_attribute(".dat-hdr .badge", "data-state") == "NOT_PRODUCED"
        assert "0/12 DOCUMENTS CONNECTED" in page.inner_text(".dat-hdr").upper()
        sub = _panel_text(page, "SRC-04", ".panel__sub")
        assert sub.startswith("0 of 12 connected") and "NOT CONNECTED" not in sub.upper()
        assert "NOTHING PRODUCED" in page.inner_text('[data-flow-stage="PRODUCERS"]').upper()
        assert page.query_selector(".dat-doc-alert") is None  # MISSING is not a contract error

        v = visit(page, "/data")
        assert v.clean, v.describe()
        gov = page.eval_on_selector_all("[data-gov-row][data-state]", "els => els.map(e => e.dataset.state)")
        assert gov == ["NOT_PRODUCED"] * 3
        labels = page.eval_on_selector_all("[data-gov-row][data-state] .badge", "els => els.map(e => e.textContent.trim())")
        assert labels == ["NOT PRODUCED"] * 3
        dat02 = _panel_text(page, "DAT-02").upper()
        assert "NO DOCUMENT PRODUCED — NOTHING TO CROSS-CHECK" in dat02
        assert "NOTHING CONNECTED" not in dat02
        assert present_values(page) == []

        v = visit(page, "/insights")
        assert v.clean, v.describe()
        d1 = page.inner_text('[data-digest="D1"]').upper()
        assert "NO DOCUMENT PRODUCED — NOTHING TO CROSS-CHECK" in d1 and "NOTHING CONNECTED" not in d1
        assert "INSIGHTS NOT CONNECTED" not in view_text(page).upper()
        page.close()
    finally:
        server.should_exit = True


def test_invalid_governance_is_a_contract_error_on_datasets(browser, state_factory):
    def corrupt(doc):
        doc["data"]["checks"][0]["state"] = "NOT_A_STATE"

    url, server = start_server(state_factory({"governance": corrupt}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/data")
        assert v.clean, v.describe()
        gov = page.eval_on_selector_all("[data-gov-row][data-state]", "els => els.map(e => e.dataset.state)")
        assert gov == ["INVALID"] * 3
        badges = page.eval_on_selector_all("[data-gov-row][data-state] .badge", "els => els.map(e => [e.textContent.trim(), e.className])")
        assert all(t == "CONTRACT ERROR" and "tone-bad" in c for t, c in badges)
        # check descriptions say what is examined, never a finding nobody reported
        text = _panel_text(page, "DAT-02")
        for desc in ("Checks datasets against their manifests", "Checks each result is bound to a dataset content hash"):
            assert desc in text
        assert "verified against manifests" not in text and "bound to every result" not in text
        assert "NOT CONNECTED" not in text.upper()
        page.close()
    finally:
        server.should_exit = True


def test_sources_notice_names_each_failure_kind(browser, state_factory):
    def corrupt(doc):
        doc["data"]["hypotheses"][0]["status"] = "NOT_A_STATUS"

    target = state_factory({"research": corrupt})
    (target / "strategies.json").write_text("{not json")
    with (target / "agent_events.jsonl").open("a") as fh:
        fh.write("{not an event}\n")
    url, server = start_server(target)
    try:
        page = new_page(browser, url)
        v = visit(page, "/data/sources")
        assert v.clean, v.describe()
        rows = _doc_rows(page)
        assert rows["research"] == "INVALID" and rows["strategies"] == "UNREADABLE"
        alert = page.inner_text(".dat-doc-alert").upper()
        # an unreadable file is not "rejected by the contract"; the stream's invalid lines are named too
        assert "1 DOCUMENT REJECTED BY THE CONTRACT" in alert
        assert "1 DOCUMENT UNREADABLE" in alert
        assert "AGENT_EVENTS.JSONL: 1 INVALID LINE" in alert
        assert "2 DOCUMENTS REJECTED" not in alert
        page.close()
    finally:
        server.should_exit = True


def test_datasets_summary_never_merges_origins(browser, state_factory):
    def mixed(doc):
        doc["data"]["datasets"][0]["origin"] = "ORIGINAL"  # FX-DS-A: PASS
        doc["data"]["datasets"][2]["origin"] = "RECONSTRUCTED"  # FX-DS-C: PASS, reconstructed flag

    url, server = start_server(state_factory({"datasets": mixed}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/data")
        assert v.clean, v.describe()
        assert _panel_text(page, "DAT-01", ".panel__sub") == "Declared records: 1 original · 1 reconstructed · 1 synthetic fixture"
        matrix = page.evaluate(
            """() => Object.fromEntries([...document.querySelectorAll('[data-origin-matrix] [data-origin-row]')]
                .map(r => [r.dataset.originRow, [...r.querySelectorAll('td')].slice(1, 8).map(td => td.innerText.trim())]))"""
        )
        #                 records PASS WARN FAIL UNKNOWN recon gaps
        assert matrix["ORIGINAL"] == ["1", "1", "0", "0", "0", "0", "0"]
        assert matrix["RECONSTRUCTED"] == ["1", "1", "0", "0", "0", "1", "0"]
        assert matrix["SYNTHETIC_FIXTURE"] == ["1", "0", "1", "0", "0", "0", "1"]
        # composition chips carry a count per origin, never one merged "×3"
        venue = page.eval_on_selector('[data-comp="venue"] .dat-tally', "e => e.textContent.replace(/\\s+/g, '')")
        assert venue == "FIXTURE-VENUE1ORIG1RECON1SYNTH"
        assert "×" not in _panel_text(page, "DAT-01")
        # a PASS count is green only where it is a declared pass; WARN is amber
        assert "tone-ok" in page.get_attribute('[data-origin-row="ORIGINAL"] td:nth-child(3) .v', "class")
        assert "tone-warn" in page.get_attribute('[data-origin-row="SYNTHETIC_FIXTURE"] td:nth-child(4) .v', "class")
        page.close()
    finally:
        server.should_exit = True


def test_insights_counts_split_by_origin_and_tabs_carry_no_merged_count(browser, state_factory):
    def mixed(doc):
        for i in doc["data"]["insights"]:
            i["origin"] = "ORIGINAL" if i["insight_id"] == "FX-I1" else "RECONSTRUCTED"

    url, server = start_server(state_factory({"insights": mixed}))
    try:
        page = new_page(browser, url)
        v = visit(page, "/insights")
        assert v.clean, v.describe()
        assert _panel_text(page, "INS-02", ".panel__sub").startswith("Declared: 1 original · 1 reconstructed")
        assert _panel_text(page, "INS-03", ".panel__sub") == "Declared: 1 original · newest first"
        cell = lambda origin, kind: page.inner_text(f'[data-kind-matrix] [data-origin-row="{origin}"] [data-kind="{kind}"]').strip()
        assert cell("ORIGINAL", "NULL_RESULT") == "1" and cell("ORIGINAL", "GOVERNANCE") == "0"
        assert cell("RECONSTRUCTED", "GOVERNANCE") == "1" and cell("RECONSTRUCTED", "NULL_RESULT") == "0"
        assert cell("SYNTHETIC_FIXTURE", "NULL_RESULT") == "0"
        assert page.query_selector(".dat-tabs .tab .count") is None
        page.close()
    finally:
        server.should_exit = True


def test_findings_digest_counts_when_only_invalid_documents_exist(browser, state_factory):
    """Provenance checks ran on an INVALID document: its finding is shown, never "nothing connected"."""

    def corrupt(doc):
        doc["data"]["insights"][0]["kind"] = "NOT_A_KIND"

    keep_invalid = tuple(k for k in _ALL_DOCS if k != "insights")
    url, server = start_server(state_factory({"insights": corrupt}, drop=keep_invalid))
    try:
        page = new_page(browser, url)
        v = visit(page, "/insights")
        assert v.clean, v.describe()
        d1 = page.inner_text('[data-digest="D1"]').upper()
        assert "NOTHING CONNECTED" not in d1 and "NOTHING TO CROSS-CHECK" not in d1
        assert page.query_selector('[data-digest="D1"] [data-finding="SOURCE_INVALID"]') is not None
        warn = page.inner_text('[data-digest="D1"] [data-severity="WARNING"] [data-v]').strip()
        assert warn == "1"
        page.close()
    finally:
        server.should_exit = True


def test_no_findings_names_the_checks_that_ran(browser, fixture_url, state_factory):
    page = new_page(browser, fixture_url)
    v = visit(page, "/data")
    assert v.clean, v.describe()
    dat02 = _panel_text(page, "DAT-02")
    assert "NO DATA-SOURCE FINDINGS FROM THE 2 CHECK FAMILIES THAT RAN" in dat02.upper()
    assert "connected documents conform" not in dat02
    assert page.query_selector('[data-skipped="freshness"]') is not None
    page.close()

    url, server = start_server(state_factory(drop=("research",)))
    try:
        page = new_page(browser, url)
        v = visit(page, "/data")
        assert v.clean, v.describe()
        skipped = page.inner_text('[data-skipped="data_citations"]')
        assert "Dataset citations" in skipped and "research.json not produced" in skipped
        assert "FROM THE 1 CHECK FAMILY THAT RAN" in _panel_text(page, "DAT-02").upper()
        page.close()
    finally:
        server.should_exit = True


@pytest.mark.parametrize("width", [1024, 1440, 1920])
def test_subsystem_feeds_have_no_orphan_row(browser, fixture_url, width):
    page = new_page(browser, fixture_url, width=width)
    v = visit(page, "/data/sources")
    assert v.clean, v.describe()
    rows = page.evaluate(_FEED_ROWS_JS)
    assert rows == ([6] if width > 1500 else [3, 3]), rows
    page.close()


@pytest.mark.parametrize("width", [1920, 2560])
@pytest.mark.parametrize("mode", ["empty", "fixture"])
def test_paired_panels_do_not_leave_tall_blank_bottoms(browser, empty_url, fixture_url, mode, width):
    page = new_page(browser, empty_url if mode == "empty" else fixture_url, width=width)
    for route, codes in (("/data/sources", ["SRC-01", "SRC-02", "SRC-07"]), ("/insights", ["INS-03", "INS-04"]), ("/data", ["DAT-01", "DAT-02"])):
        v = visit(page, route)
        assert v.clean, v.describe()
        blank = page.evaluate(_BLANK_JS, codes)
        # body padding is 14px; before this fix SRC-01/SRC-07/INS-04 left 200-270px blank at 1920+
        assert all(b is not None and b <= 110 for b in blank.values()), (route, blank)
    page.close()


@pytest.mark.parametrize("mode", ["empty", "fixture"])
def test_empty_values_stay_faint_and_no_horizontal_overflow(browser, empty_url, fixture_url, mode):
    for width in (1024, 1920):
        page = new_page(browser, empty_url if mode == "empty" else fixture_url, width=width)
        for route in ROUTES:
            v = visit(page, route)
            assert v.clean, v.describe()
            assert page.evaluate(_EMPTY_NOT_FAINT_JS) == [], (route, width)
            over = page.evaluate(
                "() => [...document.querySelectorAll('.view .table-wrap, .view .panel__body')].filter(e => e.scrollWidth > e.clientWidth + 1).length"
            )
            assert over == 0, (route, width)
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        page.close()
