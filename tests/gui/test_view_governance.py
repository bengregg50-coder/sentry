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
