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


@pytest.fixture(scope="module")
def empty_client():
    return TestClient(create_app(empty_provider()))


@pytest.fixture(scope="module")
def fixture_client():
    return TestClient(create_app(FileStateProvider(FIXTURE_DIR)))


def test_api_has_no_mutating_endpoints(empty_client):
    schema = empty_client.get("/openapi.json").json()
    methods = {m.upper() for ops in schema["paths"].values() for m in ops}
    assert methods == {"GET"}, methods
    for path in ("/api/cc/snapshot", "/api/cc/events"):
        for verb in ("post", "put", "patch", "delete"):
            assert getattr(empty_client, verb)(path).status_code == 405


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
    assert s["revision"] == fixture_client.get("/api/cc/revision").json()["revision"]


def test_events_filtering(fixture_client):
    r = fixture_client.get("/api/cc/events", params={"slot": 2, "limit": 5}).json()
    assert len(r["events"]) == 5
    ts = [e["ts"] for e in r["events"]]
    assert ts == sorted(ts, reverse=True)  # newest first
    r = fixture_client.get("/api/cc/events", params={"kind": "PROPOSAL"}).json()
    assert [e["kind"] for e in r["events"]] == ["PROPOSAL"]
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
