"""HTTP API: read-only by construction; snapshot shape; static shell."""

from __future__ import annotations

import warnings

import pytest

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from fastapi.testclient import TestClient

from atp.gui.app import create_app
from atp.gui.command_centre.provider import FileStateProvider, empty_provider

from .conftest import FIXTURE_DIR


BASE = "http://127.0.0.1"  # the Host header must be an allowed loopback name


@pytest.fixture(scope="module")
def empty_client():
    return TestClient(create_app(empty_provider()), base_url=BASE)


@pytest.fixture(scope="module")
def fixture_client():
    return TestClient(create_app(FileStateProvider(FIXTURE_DIR)), base_url=BASE)


def test_api_has_no_mutating_endpoints(empty_client):
    from fastapi.routing import APIRoute

    app = empty_client.app
    methods = {m for r in app.routes if isinstance(r, APIRoute) for m in r.methods}
    assert methods == {"GET"}, methods
    for path in ("/api/cc/snapshot", "/api/cc/events"):
        for verb in ("post", "put", "patch", "delete"):
            assert getattr(empty_client, verb)(path).status_code == 405


def test_foreign_host_header_is_rejected_and_no_openapi(empty_client):
    # DNS rebinding: a page on another origin resolving to 127.0.0.1 sends its own Host header.
    r = empty_client.get("/api/cc/snapshot", headers={"Host": "evil.attacker.example"})
    assert r.status_code == 400
    assert empty_client.get("/api/cc/snapshot", headers={"Host": "localhost:8765"}).status_code == 200
    assert empty_client.get("/openapi.json").status_code == 404
    assert empty_client.get("/api/cc/health").headers["x-content-type-options"] == "nosniff"


def test_health_declares_read_only(empty_client):
    h = empty_client.get("/api/cc/health").json()
    assert h["read_only"] is True and h["contract_version"] == "1"
    assert h["provider"]["location"] is None


def test_empty_snapshot_has_no_documents(empty_client):
    s = empty_client.get("/api/cc/snapshot").json()
    assert s["read_only"] is True
    assert all(v is None for v in s["documents"].values())
    assert {v["status"] for v in s["sources"].values()} == {"NOT_CONFIGURED"}
    assert s["events_source"]["status"] == "NOT_CONFIGURED"
    assert s["derived"]["synthetic"] is False


def test_fixture_snapshot(fixture_client):
    s = fixture_client.get("/api/cc/snapshot").json()
    assert all(v is not None for v in s["documents"].values())
    assert s["derived"]["synthetic"] is True
    rev = fixture_client.get("/api/cc/revision").json()
    assert s["revision"] == rev["revision"]
    assert s["revisions"] == rev and set(rev) == {"revision", "documents", "events"}
    # the agent payload is served once (documents.agents); the client joins it to the slots
    assert all("agent" not in slot for slot in s["derived"]["agent_slots"])


def test_snapshot_revision_is_taken_before_reading(state_factory, monkeypatch):
    """A producer write that lands while the snapshot is built must change the next /revision."""
    import json

    from atp.gui.command_centre.api import build_snapshot

    d = state_factory()
    provider = FileStateProvider(d)
    original = provider.load_events

    def write_during_build():
        res = original()
        raw = json.loads((d / "live.json").read_text())
        raw["data"]["engine_state"] = "DEGRADED"
        (d / "live.json").write_text(json.dumps(raw))
        return res

    monkeypatch.setattr(provider, "load_events", write_during_build)
    snap = build_snapshot(provider)
    assert snap["documents"]["live"]["engine_state"] == "RUNNING"
    assert snap["revision"] != provider.revision()  # the client will refetch


def test_events_filtering(fixture_client):
    r = fixture_client.get("/api/cc/events", params={"slot": 2, "limit": 5}).json()
    assert len(r["events"]) == 5
    ts = [e["ts"] for e in r["events"]]
    assert ts == sorted(ts, reverse=True)  # newest first
    r = fixture_client.get("/api/cc/events", params={"kind": "PROPOSAL"}).json()
    assert [e["kind"] for e in r["events"]] == ["PROPOSAL"]
    # an unknown kind is an error, not "none recorded"
    assert fixture_client.get("/api/cc/events", params={"kind": "BOGUS"}).status_code == 422
    assert fixture_client.get("/api/cc/events", params={"slot": 9}).status_code == 422
    assert fixture_client.get("/api/cc/events", params={"slot": 1}).json()["events"] == []


def test_contract_endpoints(empty_client):
    idx = empty_client.get("/api/cc/contract").json()
    assert len(idx["documents"]) == 12
    s = empty_client.get("/api/cc/contract/research.schema.json").json()
    assert s["$id"].endswith("research.schema.json")
    assert empty_client.get("/api/cc/contract/agent_event.schema.json").status_code == 200
    assert empty_client.get("/api/cc/contract/nope").status_code == 404


def test_index_served_with_csp_and_no_store(empty_client):
    r = empty_client.get("/")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    assert "Content-Security-Policy" in r.text and "default-src 'self'" in r.text
    assert empty_client.get("/cc/static/js/main.js").status_code == 200
    assert empty_client.get("/cc/static/vendor/lightweight-charts/lightweight-charts.standalone.production.js").status_code == 200
