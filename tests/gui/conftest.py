"""Shared fixtures for Command Centre tests.

* ``empty_url`` / ``fixture_url``: live servers (no state source / synthetic fixture)
* ``browser``: headless Chromium via Playwright (tests skip if unavailable)
* ``state_factory``: copy the synthetic fixture into tmp and mutate documents
"""

from __future__ import annotations

import json
import shutil
import socket
import threading
import time
from collections.abc import Callable
from pathlib import Path

import pytest

from atp.gui.app import create_app
from atp.gui.command_centre.provider import FileStateProvider

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "synthetic_state"


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(state_dir: Path | None):
    import uvicorn

    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(create_app(FileStateProvider(state_dir)), host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("Command Centre test server failed to start")
    return f"http://127.0.0.1:{port}", server


@pytest.fixture(scope="session")
def empty_url():
    url, server = start_server(None)
    yield url
    server.should_exit = True


@pytest.fixture(scope="session")
def fixture_url():
    url, server = start_server(FIXTURE_DIR)
    yield url
    server.should_exit = True


@pytest.fixture(scope="session")
def browser():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        pytest.skip("playwright not installed")
    pw = sync_playwright().start()
    try:
        b = pw.chromium.launch()
    except Exception as exc:  # browser binary missing
        pw.stop()
        pytest.skip(f"chromium unavailable: {exc}")
    yield b
    b.close()
    pw.stop()


@pytest.fixture
def state_factory(tmp_path) -> Callable[..., Path]:
    """Copy the synthetic fixture and apply mutations: {doc_key: fn(doc_dict) -> None | dict}."""

    def make(mutations: dict[str, Callable] | None = None, drop: tuple[str, ...] = ()) -> Path:
        target = tmp_path / "state"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(FIXTURE_DIR, target)
        for key in drop:
            (target / (key if key.endswith(".jsonl") else f"{key}.json")).unlink()
        for key, fn in (mutations or {}).items():
            path = target / f"{key}.json"
            doc = json.loads(path.read_text())
            out = fn(doc)
            path.write_text(json.dumps(out if out is not None else doc))
        return target

    return make
