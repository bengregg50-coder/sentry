"""Screenshot Command Centre routes in headless Chromium (dev tool, not a test).

    python tests/gui/tools/shoot.py --mode empty   --out DIR [--routes / /governance ...] [--width 1600 --height 1000] [--full]
    python tests/gui/tools/shoot.py --mode fixture --out DIR

Prints per-route: console errors, failed/external requests, and whether the
view rendered an error box. Exit code 1 if any route had errors.
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src"))

from atp.gui.app import create_app  # noqa: E402
from atp.gui.command_centre.provider import FileStateProvider  # noqa: E402

FIXTURE = ROOT / "tests" / "gui" / "fixtures" / "synthetic_state"

ALL_ROUTES = [
    "/", "/system",
    "/research", "/research/discovery", "/research/hypotheses", "/research/experiments", "/research/backtests",
    "/research/robustness", "/research/oos", "/research/validation", "/research/history",
    "/agents", "/agents/1", "/agents/2", "/agents/5", "/agents/2/activity", "/agents/1/activity",
    "/strategies", "/strategies/candidates", "/strategies/validated", "/strategies/deployed", "/strategies/retired",
    "/strategy/FX-S003", "/strategy/FX-S002", "/strategy/NOPE",
    "/memory", "/memory/graph", "/memory/findings", "/memory/lessons", "/memory/evidence", "/memory/agents", "/memory/item/FX-M0003", "/memory/item/NOPE",
    "/portfolio", "/risk", "/execution", "/live", "/data", "/data/sources", "/governance", "/insights",
]


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def serve(state_dir: Path | None) -> tuple[str, uvicorn.Server]:
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(FileStateProvider(state_dir)), host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    return f"http://127.0.0.1:{port}", server


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["empty", "fixture"], default="empty")
    ap.add_argument("--state-dir", type=Path, default=None)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--routes", nargs="*", default=None)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1000)
    ap.add_argument("--full", action="store_true", help="full-page screenshots")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    state_dir = args.state_dir or (FIXTURE if args.mode == "fixture" else None)
    base, server = serve(state_dir)
    args.out.mkdir(parents=True, exist_ok=True)
    routes = args.routes or ALL_ROUTES
    bad = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": args.width, "height": args.height})
        errors: list[str] = []
        external: list[str] = []
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url} {r.failure}"))
        page.on("request", lambda r: external.append(r.url) if not r.url.startswith(base) and not r.url.startswith("data:") else None)
        page.goto(base + "/#/")
        page.wait_for_selector(".view[data-module]", timeout=15000)
        for route in routes:
            errors.clear()
            external.clear()
            page.evaluate("h => { location.hash = h }", "#" + route)
            try:
                page.wait_for_function("r => document.querySelector('.view')?.dataset.route !== undefined && location.hash === '#' + r", arg=route, timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(450)
            module = page.evaluate("document.querySelector('.view')?.dataset.module || ''")
            err_box = page.evaluate("!!document.querySelector('.error-box')")
            name = route.strip("/").replace("/", "_") or "home"
            page.screenshot(path=str(args.out / f"{args.mode}-{name}.png"), full_page=args.full)
            status = "OK"
            if errors or external or err_box:
                status = "ERR"
                bad += 1
            print(f"[{status}] {route} module={module} errbox={err_box} errors={errors[:3]} external={external[:3]}")
        browser.close()
    server.should_exit = True
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
