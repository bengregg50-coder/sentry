"""FileStateProvider: explicit per-source status, never silent gaps."""

from __future__ import annotations

import json
import os
import time

from atp.gui.command_centre.provider import FileStateProvider, SourceStatus, empty_provider, load_all
from atp.gui.command_centre.schemas import DOCUMENTS

from .conftest import FIXTURE_DIR


def test_unconfigured_provider_reports_not_configured():
    p = empty_provider()
    for key, src in load_all(p).items():
        assert src.status is SourceStatus.NOT_CONFIGURED, key
        assert src.data is None
    assert p.load_events().status is SourceStatus.NOT_CONFIGURED
    assert p.location() is None


def test_missing_documents_in_configured_dir(tmp_path):
    p = FileStateProvider(tmp_path)
    for key, src in load_all(p).items():
        assert src.status is SourceStatus.MISSING, key
        assert src.path.endswith(DOCUMENTS[key][0])
    assert p.load_events().status is SourceStatus.MISSING


def test_fixture_loads_ok():
    p = FileStateProvider(FIXTURE_DIR)
    for key, src in load_all(p).items():
        assert src.status is SourceStatus.OK, (key, src.error)
        assert src.meta.origin.value == "SYNTHETIC_FIXTURE"
    ev = p.load_events()
    assert ev.status is SourceStatus.OK and len(ev.events) == ev.total_lines > 0


def test_invalid_document_reports_error_and_no_data(state_factory):
    def corrupt(doc):
        doc["data"]["hypotheses"][0]["status"] = "NOT_A_STATUS"

    p = FileStateProvider(state_factory({"research": corrupt}))
    src = p.load("research")
    assert src.status is SourceStatus.INVALID
    assert src.data is None
    assert "hypotheses.0.status" in src.error
    assert src.meta is not None  # envelope still identified


def test_unreadable_document(state_factory):
    d = state_factory()
    (d / "memory.json").write_text("{not json")
    src = FileStateProvider(d).load("memory")
    assert src.status is SourceStatus.UNREADABLE
    assert src.data is None and src.error


def test_invalid_event_lines_are_counted_not_dropped_silently(state_factory):
    d = state_factory()
    with (d / "agent_events.jsonl").open("a") as f:
        f.write('{"event_id": "bad"}\n')
        f.write("\n")
    ev = FileStateProvider(d).load_events()
    assert ev.status is SourceStatus.INVALID
    assert ev.invalid_lines == 1
    assert ev.first_error and "line" in ev.first_error
    assert len(ev.events) == ev.total_lines - 1


def test_cache_invalidates_on_change(state_factory):
    d = state_factory()
    p = FileStateProvider(d)
    first = p.load("insights")
    rev1 = p.revision()
    assert p.load("insights") is first  # cached
    raw = json.loads((d / "insights.json").read_text())
    raw["data"]["insights"] = []
    time.sleep(0.01)
    (d / "insights.json").write_text(json.dumps(raw))
    os.utime(d / "insights.json", None)
    second = p.load("insights")
    assert second is not first
    assert second.data.insights == []
    assert p.revision() != rev1
