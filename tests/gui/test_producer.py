"""Producer helpers: contract-valid, atomic, append-only."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from atp.gui.command_centre.producer import append_event, write_document
from atp.gui.command_centre.provider import FileStateProvider, SourceStatus


def test_write_document_roundtrip(tmp_path):
    path = write_document(
        tmp_path,
        "research",
        {"trial_accounting": {"reconstructed_baseline": 3, "live_recorded": 0, "global_count": 3}},
        producer="test",
        origin="RECONSTRUCTED",
    )
    assert path.name == "research.json"
    src = FileStateProvider(tmp_path).load("research")
    assert src.status is SourceStatus.OK
    assert src.meta.origin.value == "RECONSTRUCTED"
    assert src.data.trial_accounting.reconstructed_baseline == 3
    assert not list(tmp_path.glob(".research.json.*"))  # no temp files left behind


def test_invalid_payload_never_touches_disk(tmp_path):
    with pytest.raises(ValidationError):
        write_document(tmp_path, "governance", {"checks": [{"key": "referee", "state": "GREEN"}]}, producer="t", origin="ORIGINAL")
    assert list(tmp_path.iterdir()) == []


def test_unknown_document_key(tmp_path):
    with pytest.raises(KeyError):
        write_document(tmp_path, "profits", {}, producer="t", origin="ORIGINAL")


def test_append_event_is_append_only(tmp_path):
    ev = {
        "event_id": "e1",
        "ts": "2026-01-01T00:00:00Z",
        "agent_slot": 1,
        "kind": "OBSERVATION",
        "mode": "RESEARCH",
        "summary": "observed",
        "origin": "ORIGINAL",
    }
    append_event(tmp_path, ev)
    append_event(tmp_path, {**ev, "event_id": "e2"})
    res = FileStateProvider(tmp_path).load_events()
    assert res.status is SourceStatus.OK
    assert [e.event_id for e in res.events] == ["e1", "e2"]
    with pytest.raises(ValidationError):
        append_event(tmp_path, {**ev, "agent_slot": 7})
    assert FileStateProvider(tmp_path).load_events().total_lines == 2
