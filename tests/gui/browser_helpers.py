"""Helpers for driving the Command Centre in headless Chromium."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

#: Patterns that look like fabricated numbers if they appear in empty mode.
FAKE_VALUE_PATTERNS = [
    re.compile(r"[$£€]\s?\d"),
    re.compile(r"\d+(?:\.\d+)?\s?%"),
    re.compile(r"(?<![\w-])[+−-]\d+\.\d+"),
    re.compile(r"\b\d+(?:\.\d+)?\s?bps\b", re.I),
    re.compile(r"\bsharpe\b[^\n]{0,12}\d", re.I),
]


@dataclass
class Visit:
    page: Any
    route: str
    console_errors: list[str] = field(default_factory=list)
    external_requests: list[str] = field(default_factory=list)
    error_box: bool = False
    module: str = ""

    @property
    def clean(self) -> bool:
        return not (self.console_errors or self.external_requests or self.error_box)

    def describe(self) -> str:
        return f"{self.route}: errors={self.console_errors} external={self.external_requests} error_box={self.error_box}"


def new_page(browser, base: str, *, width: int = 1600, height: int = 1000):
    """A page that records console errors and any request leaving the local server."""
    page = browser.new_page(viewport={"width": width, "height": height})
    page._cc_errors = []  # type: ignore[attr-defined]
    page._cc_external = []  # type: ignore[attr-defined]
    page.on("console", lambda m: page._cc_errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: page._cc_errors.append(f"pageerror: {e}"))
    page.on("requestfailed", lambda r: page._cc_errors.append(f"requestfailed: {r.url}"))

    def on_request(r):
        if not (r.url.startswith(base) or r.url.startswith("data:") or r.url.startswith("blob:")):
            page._cc_external.append(r.url)

    page.on("request", on_request)
    # Hard offline guarantee: anything not served by the local app is aborted.
    page.route(re.compile(r"^(?!" + re.escape(base) + r").*"), lambda route: route.abort())
    page.goto(base + "/#/")
    page.wait_for_selector(".view[data-module]", timeout=15000)
    return page


def visit(page, route: str, *, settle_ms: int = 300) -> Visit:
    page._cc_errors.clear()
    page._cc_external.clear()
    page.evaluate("h => { location.hash = h }", "#" + route)
    page.wait_for_function(
        "r => { const v = document.querySelector('.view'); return v && v.dataset.route !== undefined && location.hash === '#' + r }",
        arg=route,
        timeout=10000,
    )
    page.wait_for_timeout(settle_ms)
    return Visit(
        page=page,
        route=route,
        console_errors=list(page._cc_errors),
        external_requests=list(page._cc_external),
        error_box=page.evaluate("!!document.querySelector('.error-box')"),
        module=page.evaluate("document.querySelector('.view')?.dataset.module || ''"),
    )


def present_values(page) -> list[str]:
    """Text of every value node that claims to display data (not marked empty)."""
    return page.evaluate(
        """() => [...document.querySelectorAll('.view [data-v]')]
            .filter(el => !el.classList.contains('is-empty') && !el.hasAttribute('data-empty'))
            .map(el => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 60))"""
    )


def view_text(page) -> str:
    return page.evaluate("document.querySelector('.view')?.innerText || ''")


def fake_value_hits(text: str) -> list[str]:
    hits = []
    for pat in FAKE_VALUE_PATTERNS:
        hits += [m.group(0) for m in pat.finditer(text)]
    return hits
