"""Derivations: aggregate and cross-check declared state; never invent or merge."""

from __future__ import annotations

import json

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


def _steps(d, sid):
    h = next(h for h in d["handoffs"] if h["strategy_id"] == sid)
    return {s["step"]: s["state"] for s in h["steps"]}


def test_handoff_running_simulation_is_not_complete(fixture_derived):
    h = next(h for h in fixture_derived["handoffs"] if h["strategy_id"] == "FX-S003")
    assert h["deployment_eligible"] is True
    states = [s["state"] for s in h["steps"]]
    # An ongoing simulation is RUNNING, never a green COMPLETE; live is not reached.
    assert states == ["COMPLETE"] * 4 + ["RUNNING", "NOT_REACHED"]
    assert h["approval_scope"] == "SIM" and h["live_scope"] is False and h["assigned_slots"] == [2]


def test_handoff_validation_state_is_declared_verbatim(fixture_derived):
    # IN_PROGRESS / NOT_STARTED are not "blocked"; FAILED is a failure, not a pending state.
    assert _steps(fixture_derived, "FX-S002")["VALIDATION"] == "IN_PROGRESS"
    assert _steps(fixture_derived, "FX-S001")["VALIDATION"] == "NOT_STARTED"
    s5 = _steps(fixture_derived, "FX-S005")
    assert s5["VALIDATION"] == "FAILED"
    # withdrawn strategies: later steps are WITHDRAWN (muted), never amber BLOCKED
    assert {s5[k] for k in ("APPROVAL", "DEPLOYMENT_PACKAGE", "AGENT_ASSIGNMENT", "SIMULATION", "LIVE")} == {"WITHDRAWN"}
    s4 = _steps(fixture_derived, "FX-S004")
    assert [s4[k] for k in ("VALIDATION", "APPROVAL", "DEPLOYMENT_PACKAGE")] == ["COMPLETE"] * 3
    assert {s4[k] for k in ("AGENT_ASSIGNMENT", "SIMULATION", "LIVE")} == {"WITHDRAWN"}
    assert "BLOCKED" not in s5.values() and "BLOCKED" not in s4.values()


def test_handoff_prerequisites_are_cumulative_live_without_package(state_factory):
    def live_nopkg(doc):
        s3 = doc["data"]["strategies"][2]
        s3["status"] = "DEPLOYED_LIVE"
        s3["assigned_agent"] = None
        v = s3["versions"][1]
        v["status"] = "DEPLOYED_LIVE"
        v["deployment_package"] = None
        v["approval"]["scope"] = "LIVE"

    def unassign(doc):
        a = doc["data"]["agents"][1]
        a["assignment"] = None
        a["status"] = "STANDBY"
        a["positions"], a["orders"], a["recent_trades"] = [], [], []

    d = derived_for(FileStateProvider(state_factory({"strategies": live_nopkg, "agents": unassign})))
    st = _steps(d, "FX-S003")
    assert st["DEPLOYMENT_PACKAGE"] == "BLOCKED"
    assert st["LIVE"] != "COMPLETE" and st["LIVE"] == "VIOLATION"
    assert st["SIMULATION"] == "VIOLATION"
    c = codes(d)
    assert c["DEPLOYED_WITHOUT_PACKAGE"]["severity"] == "CRITICAL"
    assert c["DEPLOYED_WITHOUT_PACKAGE"]["refs"] == ["FX-S003"]


def test_handoff_package_removed_with_agent_still_assigned(state_factory):
    def drop_pkg(doc):
        doc["data"]["strategies"][2]["versions"][1]["deployment_package"] = None

    d = derived_for(FileStateProvider(state_factory({"strategies": drop_pkg})))
    st = _steps(d, "FX-S003")
    assert st["AGENT_ASSIGNMENT"] == "VIOLATION"
    assert st["SIMULATION"] != "COMPLETE" and st["SIMULATION"] == "VIOLATION"
    assert "DEPLOYED_WITHOUT_PACKAGE" in codes(d)


def test_handoff_without_agent_runtime_is_unverified_not_violation(state_factory):
    d = derived_for(FileStateProvider(state_factory(drop=("agents",))))
    st = _steps(d, "FX-S003")
    assert st["AGENT_ASSIGNMENT"] == "UNKNOWN"
    assert st["SIMULATION"] == "UNVERIFIED"
    assert "VIOLATION" not in st.values()


def test_deployed_live_with_sim_scope_and_unvalidated_approval_are_findings(state_factory):
    def live_sim_scope(doc):
        s3 = doc["data"]["strategies"][2]
        s3["status"] = "DEPLOYED_LIVE"
        s3["versions"][1]["status"] = "DEPLOYED_LIVE"
        s2 = doc["data"]["strategies"][1]["versions"][0]
        s2["approval"] = {"decision": "APPROVED", "scope": "LIVE", "decided_at": "2026-01-10T00:00:00Z", "decided_by": "x"}
        s2["deployment_package"] = {"package_id": "P", "created_at": "2026-01-10T00:00:00Z"}
        doc["data"]["strategies"][0]["versions"][0]["deployment_package"] = {"package_id": "Q", "created_at": "2026-01-10T00:00:00Z"}

    d = derived_for(FileStateProvider(state_factory({"strategies": live_sim_scope})))
    c = codes(d)
    assert c["DEPLOYED_LIVE_WITHOUT_LIVE_SCOPE"]["refs"] == ["FX-S003"]
    assert c["APPROVAL_WITHOUT_VALIDATION"]["refs"] == ["FX-S002"]
    assert c["PACKAGE_WITHOUT_APPROVAL"]["refs"] == ["FX-S001"]
    assert all(c[k]["severity"] == "CRITICAL" for k in ("DEPLOYED_LIVE_WITHOUT_LIVE_SCOPE", "APPROVAL_WITHOUT_VALIDATION", "PACKAGE_WITHOUT_APPROVAL"))
    assert _steps(d, "FX-S003")["LIVE"] == "VIOLATION"
    assert _steps(d, "FX-S002")["APPROVAL"] == "VIOLATION"


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
    assert stages["RESEARCH_VALIDATION"]["owner"] == "RESEARCH"
    # Gated counts are cumulative: FX-PR1 (released) passed research validation AND approval;
    # FX-PR2 is in research. A released version never shows behind zero approvals.
    assert stages["RESEARCH_VALIDATION"]["count"] == 2
    assert stages["GOVERNANCE_APPROVAL"]["count"] == 1
    assert stages["NEW_VERSION"]["count"] == 1
    assert fixture_derived["learning"]["proposals_rejected"] == 0


def test_invalid_source_is_reported_as_finding(state_factory):
    def corrupt(doc):
        doc["data"]["datasets"][0]["integrity"] = "GREAT"

    d = derived_for(FileStateProvider(state_factory({"datasets": corrupt})))
    assert "SOURCE_INVALID" in codes(d)
    data = next(s for s in d["system"] if s["key"] == "data")
    # The declaration is kept verbatim, but a healthy declaration over a broken source is not shown healthy.
    assert data["declared"]["state"] == "ONLINE"
    assert data["state"] == "SOURCE_ERROR"
    assert "datasets.json is INVALID" in data["source_problem"]


def test_declared_online_without_any_document_is_source_missing(state_factory):
    d = derived_for(FileStateProvider(state_factory(drop=("research",))))
    research = next(s for s in d["system"] if s["key"] == "research_engine")
    assert research["declared"]["state"] == "ONLINE" and research["state"] == "SOURCE_MISSING"
    trading = next(s for s in d["system"] if s["key"] == "trading_engine")
    assert trading["state"] == "DEGRADED" and trading["source_problem"] is None


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
    unresolved = sorted(n["id"] for n in fixture_derived["knowledge_graph"]["nodes"] if n["state"] == "UNRESOLVED")
    # FX-M9999: unknown related memory; fixture/exp/la: EXPERIMENT evidence that resolves to no trial
    assert unresolved == ["FX-M9999", "fixture/exp/la"]
    assert fixture_derived["knowledge_graph"]["unresolved"] == 2


def test_knowledge_graph_draws_every_declared_reference(fixture_derived):
    g = fixture_derived["knowledge_graph"]
    pairs = {(e["source"], e["target"], e["relation"]) for e in g["edges"]}
    # memory -> programme provenance
    assert ("MEMORY:FX-M0001", "PROGRAMME:FX-P01", "SOURCED_FROM") in pairs
    # non-TRIAL research evidence (EXPERIMENT) is drawn, with its stance
    assert ("MEMORY:FX-M0005", "TRIAL:fixture/exp/la", "SUPPORTS") in pairs
    # proposal -> cited memory
    assert ("PROPOSAL:FX-PR1", "MEMORY:FX-M0003", "CITES") in pairs
    assert "memory.source.programme_id" in g["reference_fields"]


def test_experiment_ids_resolve_to_trials(state_factory):
    def exp(doc):
        doc["data"]["trials"][0]["experiment_id"] = "FX-EXP-1"

    def cite(doc):
        m = doc["data"]["memories"][1]
        m["related_experiments"] = ["FX-EXP-1"]
        m["evidence"].append({"evidence_id": "Y", "kind": "OUT_OF_SAMPLE", "ref": "FX-T003", "stance": "CONTRADICTS"})

    g = derived_for(FileStateProvider(state_factory({"research": exp, "memory": cite})))["knowledge_graph"]
    pairs = {(e["source"], e["target"], e["relation"]) for e in g["edges"]}
    assert ("MEMORY:FX-M0002", "TRIAL:FX-T001", "RELATES_TO") in pairs
    assert ("MEMORY:FX-M0002", "TRIAL:FX-T003", "CONTRADICTS") in pairs


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


# ---------------------------------------------------------------- review fixes


def test_pipeline_never_infers_research_stages_from_registry_status(fixture_derived):
    items = {it["id"]: it for it in fixture_derived["pipeline"]["items"]}
    # CANDIDATE / IN_VALIDATION with no declared stage and no linked hypothesis: not placed anywhere.
    assert items["FX-S001"]["stage_reached"] is None and items["FX-S001"]["stage_basis"] is None
    assert items["FX-S002"]["stage_reached"] is None
    # a deployment status is itself a declared stage
    assert items["FX-S003"]["stage_reached"] == "SIM" and items["FX-S003"]["stage_basis"] == "STATUS"
    # a REJECTED strategy is placed where the research engine declared it stopped — not at VALIDATION
    assert (items["FX-S005"]["stage_reached"], items["FX-S005"]["stage_basis"], items["FX-S005"]["terminal"]) == ("OOS", "DECLARED", "REJECTED")
    und = fixture_derived["pipeline"]["undeclared"]
    assert "FX-S001" in und["ids"] and "FX-S002" in und["ids"]
    assert und["count"] == len(und["ids"])
    stages = {s["stage"]: s for s in fixture_derived["pipeline"]["stages"]}
    staged = [it for it in items.values() if it["stage_reached"] is not None]
    assert stages["DISCOVERY"]["reached"] == len(staged)  # undeclared items are never counted as reached


def test_pipeline_uses_declared_strategy_stage_and_linked_hypothesis(state_factory):
    def declare(doc):
        doc["data"]["strategies"][1]["stage_reached"] = "ROBUSTNESS"

    def link(doc):
        doc["data"]["hypotheses"][3]["strategy_id"] = "FX-S001"  # FX-H004 (ROBUSTNESS, PENDING)

    d = derived_for(FileStateProvider(state_factory({"strategies": declare, "research": link})))
    items = {it["id"]: it for it in d["pipeline"]["items"]}
    assert items["FX-S002"]["stage_reached"] == "ROBUSTNESS" and items["FX-S002"]["stage_basis"] == "DECLARED"
    assert items["FX-S001"]["stage_reached"] == "ROBUSTNESS" and items["FX-S001"]["stage_basis"] == "HYPOTHESIS"
    assert "FX-H004" not in items  # represented by its strategy


def test_agents_source_error_is_not_a_sleeping_fleet(state_factory):
    def broken(doc):
        doc["data"]["agents"][1]["status"] = "LIVE"
        doc["data"]["agents"][1]["future_field"] = 1  # newer producer: fails the contract

    d = derived_for(FileStateProvider(state_factory({"agents": broken})))
    slots = d["agent_slots"]
    assert {s["status"] for s in slots} == {"SOURCE_ERROR"}
    assert all(not s["reported"] and s["source_status"] == "INVALID" for s in slots)
    assert all("agents.json invalid" in s["status_reason"] for s in slots)
    assert all("No agent runtime connected" not in s["status_reason"] for s in slots)
    halt = next(a for a in d["controls"]["actions"] if a["key"] == "HALT_AGENT")
    assert any("rejected by the contract" in b for b in halt["blockers"])
    # missing (not produced) keeps the sanctioned sleeping default
    d = derived_for(FileStateProvider(state_factory(drop=("agents",))))
    assert {s["status"] for s in d["agent_slots"]} == {"SLEEPING"}
    assert "not produced" in d["agent_slots"][0]["status_reason"]


def test_agent_slot_resolves_assigned_version(state_factory):
    def v9(doc):
        doc["data"]["agents"][1]["assignment"]["version"] = 9

    d = derived_for(FileStateProvider(state_factory({"agents": v9})))
    s2 = next(s for s in d["agent_slots"] if s["slot"] == 2)
    assert s2["strategy"]["known"] is True and s2["strategy"]["known_version"] is False
    assert s2["strategy"]["version_status"] is None
    f = codes(d)["AGENT_VERSION_UNKNOWN"]
    assert f["refs"] == ["FX-S003", "agent:02"]  # the strategy page can find it


def test_live_scope_blocker_is_computed_from_state(fixture_derived, state_factory):
    live = next(a for a in fixture_derived["controls"]["actions"] if a["key"] == "ENABLE_LIVE")
    assert any("LIVE-scope" in b for b in live["blockers"])

    def live_scope(doc):
        doc["data"]["strategies"][2]["versions"][1]["approval"]["scope"] = "LIVE_SMALL"

    d = derived_for(FileStateProvider(state_factory({"strategies": live_scope})))
    live = next(a for a in d["controls"]["actions"] if a["key"] == "ENABLE_LIVE")
    assert not any("LIVE-scope" in b for b in live["blockers"])


def test_referee_check_fail_is_not_dropped_when_block_matches(state_factory):
    def gov(doc):
        doc["data"]["referee"]["state"] = "MATCH"
        for c in doc["data"]["checks"]:
            if c["key"] == "referee":
                c["state"] = "FAIL"
                c["detail"] = "independent reproduction FAILED"

    d = derived_for(FileStateProvider(state_factory({"governance": gov})))
    c = codes(d)
    assert c["GOVERNANCE_FAIL"]["severity"] == "CRITICAL" and c["GOVERNANCE_FAIL"]["refs"] == ["referee"]
    assert c["REFEREE_STATE_DISAGREES"]["severity"] == "WARNING"

    def not_run(doc):
        doc["data"]["referee"]["state"] = "NOT_RUN"

    d = derived_for(FileStateProvider(state_factory({"governance": not_run})))
    c = codes(d)
    assert "GOVERNANCE_DIFFERS" in c and "REFEREE_STATE_DISAGREES" in c


def test_validated_version_with_failed_checks_and_disagreeing_multiple_testing(state_factory):
    def weaken(doc):
        v = doc["data"]["strategies"][2]["versions"][1]
        for k in ("robustness", "walk_forward", "sample_size", "positive_expectancy"):
            v["validation"][k]["state"] = "FAIL"
        v["multiple_testing"]["state"] = "FAIL"

    d = derived_for(FileStateProvider(state_factory({"strategies": weaken})))
    c = codes(d)
    f = c["VALIDATED_WITH_FAILED_CHECK"]
    assert f["refs"] == ["FX-S003"] and "robustness" in f["message"] and "walk_forward" in f["message"]
    assert c["MULTIPLE_TESTING_DISAGREES"]["severity"] == "WARNING"


def test_agent_checks_run_for_unassigned_agents_and_without_registry(state_factory):
    def standby_alert(doc):
        a4 = doc["data"]["agents"][3]
        a4["alerts"] = [{"alert_id": "A", "at": "2026-01-20T12:00:00Z", "severity": "CRITICAL", "message": "broker session lost with unknown exposure"}]
        a4["recent_trades"] = [{"trade_id": "T", "instrument": "FXA", "side": "BUY", "quantity": 1, "price": 1.0, "executed_at": "2026-01-20T12:00:00Z", "mode": "LIVE"}]

    d = derived_for(FileStateProvider(state_factory({"agents": standby_alert})))
    c = codes(d)
    assert c["AGENT_ALERT"]["refs"] == ["agent:04"]
    assert c["AGENT_EXPOSURE_WITHOUT_STRATEGY"]["refs"] == ["agent:04"]

    def live_agent(doc):
        a2 = doc["data"]["agents"][1]
        a2["status"] = "LIVE"
        a2["assignment"]["mode"] = "LIVE"
        a2["alerts"] = [{"alert_id": "B", "at": "2026-01-20T12:00:00Z", "severity": "CRITICAL", "message": "x"}]

    d = derived_for(FileStateProvider(state_factory({"agents": live_agent}, drop=("strategies",))))
    c = codes(d)
    assert c["AGENT_ALERT"]["refs"] == ["agent:02", "FX-S003"]
    assert c["AGENT_LIVE_UNVERIFIABLE"]["severity"] == "CRITICAL"


def test_version_lineage_and_withdrawn_versions_are_checked(state_factory):
    def lineage(doc):
        s3 = doc["data"]["strategies"][2]
        v3 = json.loads(json.dumps(s3["versions"][1]))
        v3.update({"version": 3, "parent_version": 2, "proposal_id": "FX-PR2", "status": "VALIDATED"})
        s3["versions"][1]["status"] = "RETIRED"
        s3["versions"].append(v3)
        s3["current_version"] = 3
        s3["status"] = "VALIDATED"
        doc["data"]["proposals"].append(
            {"proposal_id": "FX-PR3", "proposed_at": "2026-01-19T12:00:00Z", "proposed_by": "agent:02", "strategy_id": "FX-S003",
             "base_version": 2, "summary": "x", "state": "RELEASED_AS_VERSION"}
        )
        doc["data"]["proposals"].append(
            {"proposal_id": "FX-PR4", "proposed_at": "2026-01-19T12:00:00Z", "proposed_by": "agent:02", "strategy_id": "FX-S003",
             "base_version": 2, "summary": "y", "state": "IN_RESEARCH", "resulting_version": 9}
        )

    d = derived_for(FileStateProvider(state_factory({"strategies": lineage})))
    c = codes(d)
    assert c["VERSION_FROM_UNRELEASED_PROPOSAL"]["refs"] == ["FX-S003", "FX-PR2"]
    assert c["VERSION_FROM_UNRELEASED_PROPOSAL"]["severity"] == "CRITICAL"
    assert c["AGENT_RUNS_WITHDRAWN_VERSION"]["severity"] == "CRITICAL"
    assert c["PROPOSAL_RELEASE_UNRESOLVED"]["refs"] == ["FX-S003", "FX-PR3"]
    assert c["PROPOSAL_VERSION_BEFORE_RELEASE"]["refs"] == ["FX-S003", "FX-PR4"]


def test_agent_on_non_current_version_is_flagged(state_factory):
    def older(doc):
        doc["data"]["agents"][1]["assignment"]["version"] = 1

    c = codes(derived_for(FileStateProvider(state_factory({"agents": older}))))
    # fixture v1 is RETIRED: running a withdrawn version is critical
    assert c["AGENT_RUNS_WITHDRAWN_VERSION"]["refs"] == ["FX-S003", "agent:02"]

    def v1_validated(doc):
        doc["data"]["strategies"][2]["versions"][0]["status"] = "VALIDATED"

    c = codes(derived_for(FileStateProvider(state_factory({"agents": older, "strategies": v1_validated}))))
    assert "AGENT_RUNS_WITHDRAWN_VERSION" not in c
    assert c["AGENT_RUNS_NON_CURRENT_VERSION"]["refs"] == ["FX-S003", "agent:02"]


def test_status_and_validation_mismatch(state_factory):
    def mismatch(doc):
        doc["data"]["strategies"][0]["versions"][0]["validation_status"] = "VALIDATED"
        s2 = doc["data"]["strategies"][1]
        s2["status"] = "VALIDATED"

    d = derived_for(FileStateProvider(state_factory({"strategies": mismatch})))
    refs = [f["refs"] for f in d["consistency"] if f["code"] == "STATUS_VALIDATION_MISMATCH"]
    assert ["FX-S001"] in refs and ["FX-S002"] in refs


def test_memory_and_record_integrity_checks_are_derived(state_factory):
    def mem(doc):
        doc["data"]["memories"][1]["evidence"] = []  # FX-M0002: MEDIUM, VALIDATED

    def recs(doc):
        doc["data"]["hypotheses"][0]["trial_numbers"] = [1, 2, 3, 77]
        doc["data"]["trial_accounting"]["reconstructed_baseline"] = 1
        doc["data"]["trial_accounting"]["global_count"] = 10

    c = codes(derived_for(FileStateProvider(state_factory({"memory": mem, "research": recs}))))
    assert c["MEMORY_VALIDATED_WITHOUT_EVIDENCE"]["refs"] == ["FX-M0002"]
    assert c["HYPOTHESIS_TRIAL_RECORD_MISSING"]["refs"] == ["FX-H001"]
    assert "#77" in c["HYPOTHESIS_TRIAL_RECORD_MISSING"]["message"]
    assert c["RECONSTRUCTED_RECORDS_EXCEED_BASELINE"]["severity"] == "WARNING"


def test_event_stream_activity_for_sleeping_or_unreported_slot(state_factory):
    d = state_factory()
    with (d / "agent_events.jsonl").open("a") as f:
        for i, (slot, kind) in enumerate(((3, "ORDER"), (3, "FILL"), (5, "ORDER"))):
            f.write(json.dumps({"event_id": f"X{i}", "ts": "2026-01-20T12:30:00Z", "agent_slot": slot, "kind": kind,
                                "mode": "LIVE", "summary": "x", "origin": "SYNTHETIC_FIXTURE"}) + "\n")
        f.write(json.dumps({"event_id": "X9", "ts": "2026-01-20T12:31:00Z", "agent_slot": 2, "kind": "ORDER", "mode": "SIM",
                            "summary": "x", "refs": {"strategy_id": "FX-S004", "version": 1}, "origin": "SYNTHETIC_FIXTURE"}) + "\n")
    dd = derived_for(FileStateProvider(d))
    found = [f for f in dd["consistency"] if f["code"] == "AGENT_ACTIVITY_WITHOUT_STRATEGY"]
    assert sorted(f["refs"][0] for f in found) == ["agent:03", "agent:05"]
    assert all(f["severity"] == "CRITICAL" for f in found)
    assert codes(dd)["EVENT_STRATEGY_MISMATCH"]["refs"] == ["agent:02", "FX-S003"]


def test_live_enabled_with_registry_unavailable_is_worded_as_unverifiable(state_factory):
    def enable(doc):
        doc["data"]["trading_enabled"] = True
        doc["data"]["trading_mode"] = "LIVE"

    c = codes(derived_for(FileStateProvider(state_factory({"live": enable}, drop=("strategies",)))))
    assert "LIVE_ENABLED_WITHOUT_APPROVED_STRATEGY" not in c
    f = c["LIVE_ENABLED_APPROVAL_UNVERIFIABLE"]
    assert f["severity"] == "CRITICAL" and "cannot be verified" in f["message"] and "MISSING" in f["message"]


def test_check_coverage_says_which_checks_ran(fixture_derived, state_factory):
    empty = derived_for(empty_provider())["check_coverage"]
    assert not any(c["ran"] for c in empty)
    d = derived_for(FileStateProvider(state_factory(drop=("strategies",))))
    cov = {c["key"]: c for c in d["check_coverage"]}
    assert cov["agent_eligibility"]["ran"] is False
    assert cov["agent_eligibility"]["missing"] == [{"source": "strategies", "file": "strategies.json", "status": "MISSING"}]
    assert cov["governance"]["ran"] is True
    assert cov["freshness"]["ran"] is False and "heartbeat_max_age_s" in cov["freshness"]["note"]


def test_freshness_is_judged_only_against_a_declared_bound(fixture_derived, state_factory):
    s2 = next(s for s in fixture_derived["agent_slots"] if s["slot"] == 2)
    assert s2["stale"] is None and s2["heartbeat_age_s"] > 0  # no bound declared: not judged
    assert "HEARTBEAT_STALE" not in codes(fixture_derived)

    def bound(doc):
        doc["meta"]["heartbeat_max_age_s"] = 600

    d = derived_for(FileStateProvider(state_factory({"agents": bound, "live": bound})))
    s2 = next(s for s in d["agent_slots"] if s["slot"] == 2)
    assert s2["stale"] is True
    stale = [f for f in d["consistency"] if f["code"] == "HEARTBEAT_STALE"]
    assert {f["section"] for f in stale} == {"agents", "live"}
    assert "agent:02" in stale[0]["refs"] or "agent:02" in stale[1]["refs"]


def test_memory_and_hypothesis_totals_carry_origin_splits(fixture_derived):
    rs = fixture_derived["research_summary"]
    assert rs["hypotheses_total_by_origin"] == {"ORIGINAL": 7, "RECONSTRUCTED": 1}
    assert sum(rs["hypotheses_total_by_origin"].values()) == rs["hypotheses_total"]
    ms = fixture_derived["memory_stats"]
    assert sum(ms["high_confidence_by_origin"].values()) == ms["high_confidence_findings"]
    assert sum(ms["unresolved_by_origin"].values()) == ms["unresolved"]


def test_one_failing_derivation_does_not_take_down_the_snapshot(monkeypatch):
    from atp.gui.command_centre import derive

    def boom(*_a, **_k):
        raise RuntimeError("bad record")

    monkeypatch.setattr(derive, "derive_knowledge_graph", boom)
    d = derived_for(FileStateProvider(FIXTURE_DIR))
    assert d["knowledge_graph"]["available"] is False
    assert d["errors"] == [{"section": "knowledge_graph", "error": "RuntimeError: bad record"}]
    assert codes(d)["DERIVATION_ERROR"]["refs"] == ["knowledge_graph"]
    assert d["pipeline"]["available"] is True  # other sections unaffected


def test_agent_slot_event_counts_cover_whole_stream(fixture_derived):
    ev = {s["slot"]: s["events"] for s in fixture_derived["agent_slots"]}
    assert sum(ev[2]["by_kind"].values()) == ev[2]["count"] == 15
    assert ev[2]["by_kind"]["OBSERVATION"] == 2
    assert set(ev[2]["by_mode"]) == {"SIM", "RESEARCH"}
    assert ev[1]["by_kind"] == {} and ev[1]["count"] == 0
    empty = derived_for(empty_provider())["agent_slots"][0]["events"]
    assert empty["by_kind"] is None and empty["count"] is None
