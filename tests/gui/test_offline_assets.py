"""Offline-first: no external fonts, scripts, styles, images or services."""

from __future__ import annotations

import re
from pathlib import Path

from atp.gui.command_centre import STATIC_DIR

EXTERNAL = re.compile(r"""(?:https?:)?//(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\.[a-z]{2,}""", re.I)
VENDOR = STATIC_DIR / "vendor"


def own_assets() -> list[Path]:
    return [p for p in STATIC_DIR.rglob("*") if p.is_file() and VENDOR not in p.parents and p.suffix in {".js", ".css", ".html"}]


def test_no_external_references_in_own_assets():
    offenders = {}
    for p in own_assets():
        text = p.read_text(encoding="utf-8")
        # SVG namespace identifiers are not network references.
        text = text.replace("http://www.w3.org/2000/svg", "")
        hits = EXTERNAL.findall(text)
        if hits:
            offenders[str(p.relative_to(STATIC_DIR))] = hits
    assert offenders == {}


def test_index_loads_only_local_assets():
    html = (STATIC_DIR / "index.html").read_text()
    for attr in re.findall(r'(?:src|href)="([^"]+)"', html):
        assert attr.startswith("/cc/static/") or attr.startswith("data:"), attr
    assert "default-src 'self'" in html
    assert "fonts.googleapis" not in html and "cdn" not in html.lower()


def test_css_has_no_remote_imports_or_fonts():
    for p in STATIC_DIR.rglob("*.css"):
        css = p.read_text()
        assert "@import" not in css, p
        assert "@font-face" not in css, p
        for url in re.findall(r"url\(([^)]+)\)", css):
            # data: URIs, local assets and in-document fragment refs (url(#id)) make no network request
            assert url.strip("'\"").startswith(("data:", "/cc/static/", "#")), (p, url)


def test_vendored_chart_library_is_local_and_licensed():
    lib = VENDOR / "lightweight-charts" / "lightweight-charts.standalone.production.js"
    assert lib.exists() and lib.stat().st_size > 100_000
    assert (VENDOR / "lightweight-charts" / "LICENSE").exists()


def test_frontend_has_no_write_requests():
    for p in own_assets():
        if p.suffix != ".js":
            continue
        text = p.read_text()
        assert not re.search(r"method\s*:\s*['\"](POST|PUT|PATCH|DELETE)", text, re.I), p
        assert "XMLHttpRequest" not in text and "WebSocket(" not in text, p


def test_no_randomness_or_hardcoded_demo_data_in_frontend():
    for p in own_assets():
        if p.suffix != ".js":
            continue
        text = p.read_text()
        assert "Math.random" not in text, p
        assert not re.search(r"\b(lorem|dummy|mock data|fake data)\b", text, re.I), p
