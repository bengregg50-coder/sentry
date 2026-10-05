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


def test_insights_empty_says_none_produced(browser, empty_url):
    page = new_page(browser, empty_url)
    v = visit(page, "/insights")
    assert v.clean, v.describe()
    assert page.query_selector("[data-insight]") is None
    text = view_text(page).upper()
    assert "NO INSIGHTS PRODUCED YET" in text
    assert "NULL RESULTS ARE RESULTS" in text
    # digest blocks are present, each explaining its emptiness
    assert page.eval_on_selector_all("[data-digest]", "els => els.map(e => e.dataset.digest)") == ["D1", "D2", "D3"]
    assert "NOTHING CONNECTED — NOTHING TO CROSS-CHECK" in text
    page.close()


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
        assert "NOT CONNECTED" not in page.inner_text(".dat-sumgrid").upper()
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
