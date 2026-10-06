"""Governance view: real states displayed verbatim, never recoloured."""

from __future__ import annotations

import pytest

from .browser_helpers import fake_value_hits, new_page, present_values, view_text, visit

pytestmark = pytest.mark.browser


def test_governance_empty_shows_not_connected(browser, empty_url):
    page = new_page(browser, empty_url)
    v = visit(page, "/governance")
    assert v.clean, v.describe()
    assert present_values(page) == []
    assert fake_value_hits(view_text(page)) == []
    states = page.eval_on_selector_all(".gov-check", "els => els.map(e => e.dataset.state)")
    assert len(states) == 11
    assert set(states) == {"NOT_CONNECTED"}
    page.close()


def test_governance_fixture_preserves_differs_and_reconstructed(browser, fixture_url):
    page = new_page(browser, fixture_url)
    v = visit(page, "/governance")
    assert v.clean, v.describe()
    referee = page.get_attribute('.gov-check[data-check="referee"] .badge', "class")
    assert "tone-warn" in referee and "tone-ok" not in referee
    recon = page.get_attribute('.gov-check[data-check="reconstruction_status"]', "data-state")
    assert recon == "RECONSTRUCTED"
    unreported = page.get_attribute('.gov-check[data-check="strategy_approval"]', "data-state")
    assert unreported == "NOT_REPORTED"
    text = view_text(page)
    assert "RECONSTRUCTED BASELINE" in text.upper() and "LIVE-RECORDED" in text.upper()
    assert page.is_visible('[data-banner="synthetic"]')
    page.close()


def test_check_definition_never_fills_the_result_slot(browser, state_factory):
    from .conftest import start_server

    def gov(doc):
        for c in doc["data"]["checks"]:
            if c["key"] in ("oos_separation", "data_integrity"):
                c["state"] = "FAIL" if c["key"] == "oos_separation" else "DIFFERS"
                c["detail"] = None
        doc["data"]["referee"]["last_run_at"] = None

    url, server = start_server(state_factory({"governance": gov}))
    try:
        page = new_page(browser, url)
        visit(page, "/governance")
        tile = page.locator('.gov-check[data-check="oos_separation"]')
        assert tile.get_attribute("data-state") == "FAIL"
        assert "tone-bad" in tile.get_attribute("class")  # border tone via tones.js, not a raw state selector
        assert tile.locator(".gov-check__detail").get_attribute("data-detail") == "none"
        assert tile.locator(".gov-check__detail").inner_text().strip().upper() == "NO DETAIL DECLARED"
        # the definition is visibly a definition ("Checks: whether …"), never a statement of the result
        definition = tile.locator(".gov-check__def").inner_text()
        assert definition.upper().startswith("CHECKS") and "whether" in definition
        assert "untouched until" not in tile.locator(".gov-check__detail").inner_text()
        assert "tone-warn" in page.get_attribute('.gov-check[data-check="data_integrity"]', "class")
        # a referee that DIFFERS has run: a missing timestamp is "not reported", not "never run"
        last = page.inner_text("[data-referee-last-run]").upper()
        assert "NOT REPORTED" in last and "NEVER RUN" not in last
        page.close()
    finally:
        server.should_exit = True


def test_governance_pending_check_is_framed_amber(browser, fixture_url):
    page = new_page(browser, fixture_url)
    visit(page, "/governance")
    assert "tone-warn" in page.get_attribute('.gov-check[data-check="validation_status"]', "class")
    assert "tone-ok" in page.get_attribute('.gov-check[data-check="trial_accounting"]', "class")
    page.close()


def test_no_findings_is_scoped_to_the_checks_that_ran(browser, empty_url, tmp_path):
    import json

    from .conftest import start_server

    page = new_page(browser, empty_url)
    visit(page, "/governance")
    assert page.is_visible('[data-empty-state="findings-not-connected"]')
    assert "internally consistent" not in view_text(page)
    page.close()

    meta = {"schema_version": "1", "producer": "t", "generated_at": "2026-01-01T00:00:00Z", "origin": "ORIGINAL"}
    (tmp_path / "system.json").write_text(json.dumps({"meta": meta, "data": {"subsystems": []}}))
    url, server = start_server(tmp_path)
    try:
        page = new_page(browser, url)
        visit(page, "/governance")
        text = view_text(page)
        assert "NO FINDINGS FROM THE CHECKS THAT RAN" in text.upper()
        assert "internally consistent" not in text
        skipped = page.eval_on_selector_all(".gov-skipped [data-check-family]", "els => els.map(e => e.dataset.checkFamily)")
        assert "strategy_rules" in skipped and "agent_eligibility" in skipped
        assert "strategies.json missing" in page.inner_text('.gov-skipped [data-check-family="strategy_rules"]').lower()
        page.close()
    finally:
        server.should_exit = True
