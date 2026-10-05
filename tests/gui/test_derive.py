"""Derivations: aggregate and cross-check declared state; never invent or merge."""

from __future__ import annotations

import pytest

from atp.gui.command_centre.derive import derive_all
from atp.gui.command_centre.provider import FileStateProvider, empty_provider, load_all

from .conftest import FIXTURE_DIR


def derived_for(provider):
    return derive_all(load_all(provider), provider.load_events())


def codes(d):
    return {f["code"]: f for f in d["consistency"]}


@pytest.fixture(scope="module")
def fixture_derived():
    return derived_for(FileStateProvider(FIXTURE_DIR))


def test_unconnected_state_is_null_not_zero():
    d = derived_for(empty_provider())
    assert d["pipeline"]["available"] is False
    assert all(s["reached"] is None and s["active"] is None for s in d["pipeline"]["stages"])
    assert d["trial_accounting"]["records_total"] is None
    assert d["memory_stats"] == {"available": False}
    assert d["knowledge_graph"]["available"] is False
    assert all(s["count"] is None for s in d["learning"]["stages"])
    assert d["consistency"] == []
    assert d["synthetic"] is False
    assert {s["state"] for s in d["system"]} == {"NOT_CONNECTED"}


def test_connected_but_empty_is_zero(tmp_path):
    import json

    meta = {"schema_version": "1", "producer": "t", "generated_at": "2026-01-01T00:00:00Z", "origin": "ORIGINAL"}
    (tmp_path / "research.json").write_text(json.dumps({"meta": meta, "data": {}}))
    (tmp_path / "memory.json").write_text(json.dumps({"meta": meta, "data": {"memories": []}}))
    d = derived_for(FileStateProvider(tmp_path))
    assert d["pipeline"]["available"] is True
    assert all(s["reached"] == 0 for s in d["pipeline"]["stages"])
    assert d["trial_accounting"]["records_total"] == 0
    assert d["memory_stats"]["total"] == 0
    research = next(s for s in d["system"] if s["key"] == "research_engine")
    assert research["state"] == "REPORTING"


def test_agent_slots_default_and_unreported(fixture_derived):
    empty = derived_for(empty_provider())["agent_slots"]
    assert [s["slot"] for s in empty] == [1, 2, 3, 4, 5]
    assert all(s["status"] == "SLEEPING" and not s["has_strategy"] and s["agent"] is None for s in empty)
    slots = {s["slot"]: s for s in fixture_derived["agent_slots"]}
    assert slots[2]["status"] == "SIMULATING" and slots[2]["strategy"]["strategy_id"] == "FX-S003"
    assert slots[5]["status"] is None and slots[5]["reported"] is False  # not reported != sleeping
    assert slots[2]["events"]["count"] == 15


def test_pipeline_does_not_double_count_hypothesis_linked_to_strategy(fixture_derived):
    ids = [it["id"] for it in fixture_derived["pipeline"]["items"]]
    assert "FX-H005" not in ids and "FX-S003" in ids
    assert len(ids) == len(set(ids))
    stages = {s["stage"]: s for s in fixture_derived["pipeline"]["stages"]}
    assert stages["LIVE"]["reached"] == 0 and stages["SCALED"]["reached"] == 0
    assert stages["HYPOTHESIS"]["terminals"]["BLOCKED_BY_DATA"] == 1


def test_trial_accounting_keeps_origins_separate(fixture_derived):
    ta = fixture_derived["trial_accounting"]
    assert ta["declared"]["reconstructed_baseline"] == 5
    assert ta["declared"]["live_recorded"] == 9
    assert ta["records_by_origin"]["RECONSTRUCTED"] == 2
    assert ta["records_by_origin"]["ORIGINAL"] == 9
    c = codes(fixture_derived)
    assert c["RECONSTRUCTED_RECORDS_INCOMPLETE"]["severity"] == "INFO"


def test_fixture_is_flagged_synthetic(fixture_derived):
    assert fixture_derived["synthetic"] is True
    assert codes(fixture_derived)["SYNTHETIC_FIXTURE_LOADED"]["severity"] == "CRITICAL"


def test_referee_differs_is_surfaced_not_hidden(fixture_derived):
    f = codes(fixture_derived)["REFEREE_DIFFERS"]
    assert f["severity"] == "WARNING"


def test_handoff_complete_until_live(fixture_derived):
    h = next(h for h in fixture_derived["handoffs"] if h["strategy_id"] == "FX-S003")
    assert h["deployment_eligible"] is True
    states = [s["state"] for s in h["steps"]]
    assert states == ["COMPLETE"] * 5 + ["NOT_REACHED"]
    h2 = next(h for h in fixture_derived["handoffs"] if h["strategy_id"] == "FX-S002")
    assert h2["deployment_eligible"] is False
    assert h2["steps"][0]["state"] == "BLOCKED"


def test_controls_are_always_locked(fixture_derived):
    for d in (fixture_derived, derived_for(empty_provider())):
        assert d["controls"]["read_only"] is True
        assert all(a["enabled"] is False and a["blockers"] for a in d["controls"]["actions"])


def test_agent_assigned_unapproved_strategy_is_critical(state_factory):
    def assign(doc):
        doc["data"]["agents"][0]["assignment"] = {
            "strategy_id": "FX-S002",
            "version": 1,
            "mode": "SIM",
            "assigned_at": "2026-01-10T00:00:00Z",
        }
        doc["data"]["agents"][0]["status"] = "SIMULATING"

    d = derived_for(FileStateProvider(state_factory({"agents": assign})))
    assert codes(d)["AGENT_ASSIGNMENT_NOT_ELIGIBLE"]["severity"] == "CRITICAL"
    h = next(h for h in d["handoffs"] if h["strategy_id"] == "FX-S002")
    assert next(s for s in h["steps"] if s["step"] == "AGENT_ASSIGNMENT")["state"] == "VIOLATION"


def test_live_mode_without_live_approval_is_critical(state_factory):
    def go_live(doc):
        doc["data"]["agents"][1]["assignment"]["mode"] = "LIVE"

    d = derived_for(FileStateProvider(state_factory({"agents": go_live})))
    assert codes(d)["AGENT_LIVE_WITHOUT_LIVE_APPROVAL"]["severity"] == "CRITICAL"


def test_live_trading_enabled_without_approved_strategy_is_critical(state_factory):
    def enable(doc):
        doc["data"]["trading_enabled"] = True
        doc["data"]["trading_mode"] = "LIVE"

    d = derived_for(FileStateProvider(state_factory({"live": enable})))
    assert codes(d)["LIVE_ENABLED_WITHOUT_APPROVED_STRATEGY"]["severity"] == "CRITICAL"


def test_trial_count_mismatch_is_critical(state_factory):
    def bump(doc):
        doc["data"]["trial_accounting"]["global_count"] = 99

    d = derived_for(FileStateProvider(state_factory({"research": bump})))
    assert codes(d)["TRIAL_COUNT_MISMATCH"]["severity"] == "CRITICAL"


def test_deployed_without_validation_or_approval_is_critical(state_factory):
    def promote(doc):
        doc["data"]["strategies"][0]["status"] = "DEPLOYED_SIM"

    d = derived_for(FileStateProvider(state_factory({"strategies": promote})))
    c = codes(d)
    assert c["DEPLOYED_WITHOUT_VALIDATION"]["severity"] == "CRITICAL"
    assert c["DEPLOYED_WITHOUT_APPROVAL"]["severity"] == "CRITICAL"


def test_proposal_cannot_overwrite_a_version(state_factory):
    def overwrite(doc):
        doc["data"]["proposals"][0]["resulting_version"] = 1

    d = derived_for(FileStateProvider(state_factory({"strategies": overwrite})))
    assert codes(d)["PROPOSAL_OVERWROTE_VERSION"]["severity"] == "CRITICAL"


def test_validated_with_failing_required_check_is_flagged(state_factory):
    def weaken(doc):
        v = doc["data"]["strategies"][2]["versions"][1]
        v["validation"]["out_of_sample"]["state"] = "PENDING"
        v["metrics"]["sharpe"]["basis"] = "IN_SAMPLE"

    d = derived_for(FileStateProvider(state_factory({"strategies": weaken})))
    msgs = [f["message"] for f in d["consistency"]]
    assert any("out_of_sample is PENDING" in m for m in msgs)
    assert "HEADLINE_METRIC_IN_SAMPLE" in codes(d)


def test_memory_confidence_without_evidence_is_flagged(state_factory):
    def strip(doc):
        doc["data"]["memories"][0]["evidence"] = []

    d = derived_for(FileStateProvider(state_factory({"memory": strip})))
    assert codes(d)["MEMORY_CONFIDENCE_WITHOUT_EVIDENCE"]["severity"] == "WARNING"


def test_knowledge_graph_uses_only_explicit_references(fixture_derived):
    g = fixture_derived["knowledge_graph"]
    keys = {n["key"] for n in g["nodes"]}
    for e in g["edges"]:
        assert e["source"] in keys and e["target"] in keys
        assert e["declared_by"]
    unresolved = [n for n in g["nodes"] if n["state"] == "UNRESOLVED"]
    assert any(n["id"] == "FX-M9999" for n in unresolved)
    assert g["unresolved"] == len(unresolved)
    rels = {e["relation"] for e in g["edges"]}
    assert "SUPPORTS" in rels
    # Non-trial evidence (e.g. a live observation) is not turned into a graph edge.
    assert "CONTRADICTS" not in rels


def test_contradicting_trial_evidence_becomes_contradicts_edge(state_factory):
    def contradict(doc):
        doc["data"]["memories"][0]["evidence"].append(
            {"evidence_id": "X", "kind": "TRIAL", "ref": "FX-T005", "stance": "CONTRADICTS"}
        )

    g = derived_for(FileStateProvider(state_factory({"memory": contradict})))["knowledge_graph"]
    assert any(e["relation"] == "CONTRADICTS" and e["target"] == "TRIAL:FX-T005" for e in g["edges"])


def test_learning_counts_from_events_and_proposals(fixture_derived):
    stages = {s["key"]: s for s in fixture_derived["learning"]["stages"]}
    assert stages["PROPOSE"]["count"] == 1
    assert stages["NEW_VERSION"]["count"] == 1
    assert stages["RESEARCH_VALIDATION"]["owner"] == "RESEARCH"


def test_invalid_source_is_reported_as_finding(state_factory):
    def corrupt(doc):
        doc["data"]["datasets"][0]["integrity"] = "GREAT"

    d = derived_for(FileStateProvider(state_factory({"datasets": corrupt})))
    assert "SOURCE_INVALID" in codes(d)
    data = next(s for s in d["system"] if s["key"] == "data")
    assert data["state"] == "ONLINE"  # declared by system.json; the invalid source is a separate finding


def test_retired_strategy_is_never_deployment_eligible(fixture_derived):
    h = next(h for h in fixture_derived["handoffs"] if h["strategy_id"] == "FX-S004")
    assert h["withdrawn"] is True and h["deployment_eligible"] is False
    assert fixture_derived["controls"]["deployment_eligible"] == ["FX-S003"]


def test_eligibility_and_items_are_null_when_not_connected():
    d = derived_for(empty_provider())
    assert d["controls"]["deployment_eligible"] is None
    assert d["pipeline"]["items"] is None


def test_pipeline_discloses_origins_per_stage(fixture_derived):
    stages = {s["stage"]: s for s in fixture_derived["pipeline"]["stages"]}
    disc = stages["DISCOVERY"]
    assert sum(disc["reached_by_origin"].values()) == disc["reached"]
    assert disc["reached_by_origin"].get("RECONSTRUCTED") == 1  # FX-H002
    bt = stages["BACKTEST"]
    assert bt["terminals_by_origin"]["RECONSTRUCTED"] == {"REJECTED": 1}


def test_trial_breakdowns_by_origin(fixture_derived):
    ta = fixture_derived["trial_accounting"]
    assert ta["outcomes_by_origin"]["RECONSTRUCTED"] == {"FAIL": 2}
    assert sum(ta["kinds_by_origin"]["ORIGINAL"].values()) == 9
    rs = fixture_derived["research_summary"]
    assert rs["trials_by_origin"] == {"ORIGINAL": 9, "RECONSTRUCTED": 2}
    assert rs["hypotheses_by_status_origin"]["RECONSTRUCTED"] == {"REJECTED": 1}


def test_declared_proposal_is_not_unresolved(fixture_derived):
    nodes = {n["key"]: n for n in fixture_derived["knowledge_graph"]["nodes"]}
    assert nodes["PROPOSAL:FX-PR1"]["state"] == "RELEASED_AS_VERSION"
    assert fixture_derived["knowledge_graph"]["unresolved"] == 1


def test_unresolved_reference_findings_carry_refs(fixture_derived):
    f = next(f for f in fixture_derived["consistency"] if f["code"] == "UNRESOLVED_REFERENCE")
    assert f["refs"] == ["FX-M0005", "FX-M9999"]


def test_dataset_citation_cross_check(state_factory):
    def cite(doc):
        doc["data"]["trials"][0]["data_used"] = ["FX-DS-A", "FX-DS-UNKNOWN"]

    d = derived_for(FileStateProvider(state_factory({"research": cite})))
    f = next(f for f in d["consistency"] if f["code"] == "UNRESOLVED_DATASET_REFERENCE")
    assert f["refs"][0] == "FX-DS-UNKNOWN" and f["severity"] == "INFO"
    # without a data catalogue nothing can be claimed missing
    d = derived_for(FileStateProvider(state_factory({"research": cite}, drop=("datasets",))))
    assert not any(f["code"] == "UNRESOLVED_DATASET_REFERENCE" for f in d["consistency"])
