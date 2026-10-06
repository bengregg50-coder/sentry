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


def _append_event(d, **over):
    line = json.loads((d / "agent_events.jsonl").read_text().splitlines()[0])
    line.update(over)
    with (d / "agent_events.jsonl").open("a") as f:
        f.write(json.dumps(line) + "\n")


def test_naive_timestamp_invalidates_only_that_record(state_factory):
    """One timezone-naive timestamp must not take down the API (it used to raise in a sort)."""
    from atp.gui.command_centre.api import build_snapshot

    def naive(doc):
        doc["data"]["memories"][0]["created_at"] = "2026-01-01T00:00:00"

    d = state_factory({"memory": naive})
    _append_event(d, event_id="NAIVE-1", ts="2026-01-20T12:30:00")
    p = FileStateProvider(d)
    mem = p.load("memory")
    assert mem.status is SourceStatus.INVALID and "timezone" in mem.error
    ev = p.load_events()
    assert ev.status is SourceStatus.INVALID and ev.invalid_lines == 1
    snap = build_snapshot(p)  # must not raise
    assert snap["sources"]["memory"]["status"] == "INVALID"


def test_non_finite_numbers_make_the_document_invalid(state_factory):
    def nan(doc):
        doc["data"]["strategies"][2]["versions"][1]["metrics"]["sharpe"]["value"] = float("nan")

    def inf(doc):
        doc["data"]["daily_limits"][0]["limit"] = float("inf")

    p = FileStateProvider(state_factory({"strategies": nan, "risk": inf}))
    assert p.load("strategies").status is SourceStatus.INVALID
    assert p.load("risk").status is SourceStatus.INVALID


def test_unordered_series_make_the_document_invalid(state_factory):
    def reverse(doc):
        doc["data"]["equity"] = list(reversed(doc["data"]["equity"]))

    def dup(doc):
        bars = doc["data"]["agents"][1]["bars"]
        bars[1]["t"] = bars[0]["t"]

    p = FileStateProvider(state_factory({"portfolio": reverse, "agents": dup}))
    src = p.load("portfolio")
    assert src.status is SourceStatus.INVALID and "strictly ascending" in src.error
    assert p.load("agents").status is SourceStatus.INVALID


def test_pathological_json_is_unreadable_not_a_crash(state_factory):
    d = state_factory()
    (d / "insights.json").write_text("[" * 100000 + "]" * 100000)
    (d / "memory.json").write_text('{"x": ' + "9" * 5000 + "}")
    p = FileStateProvider(d)
    assert p.load("insights").status is SourceStatus.UNREADABLE
    assert p.load("memory").status is SourceStatus.UNREADABLE
    with (d / "agent_events.jsonl").open("a") as f:
        f.write("[" * 100000 + "]" * 100000 + "\n")
    assert p.load_events().invalid_lines == 1


def test_same_size_rewrite_with_preserved_mtime_is_seen(state_factory):
    d = state_factory()
    p = FileStateProvider(d)
    path = d / "risk.json"
    before = p.load("risk")
    rev = p.revision()
    st = path.stat()
    # same byte length, written via atomic replace (new inode), original mtime restored
    tmp = d / "risk.tmp"
    tmp.write_text(path.read_text().replace("FIXTURE", "TRIPPED", 1))
    os.replace(tmp, path)
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))
    assert path.stat().st_size == st.st_size and path.stat().st_mtime_ns == st.st_mtime_ns
    after = p.load("risk")
    assert after is not before
    assert p.revision() != rev


def test_split_revisions(state_factory):
    d = state_factory()
    p = FileStateProvider(d)
    r1 = p.revisions()
    _append_event(d, event_id="NEW-1")
    r2 = p.revisions()
    assert r2["events"] != r1["events"] and r2["documents"] == r1["documents"] and r2["revision"] != r1["revision"]
