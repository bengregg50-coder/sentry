"""Derived views over declared SENTRY state.

Everything here is a pure function of the loaded documents. These functions
*aggregate and cross-check* what producers declared; they never decide whether
research passed, never estimate missing values, and never merge evidence of
different origins. The convention throughout:

* source unavailable  -> counts are ``None`` (rendered as "not connected")
* source available but empty -> counts are ``0`` (rendered as "0 recorded")
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from .provider import EventsResult, SourceResult
from .schemas import (
    AGENT_SLOTS,
    PIPELINE_STAGES,
    AgentEventKind,
    AgentMode,
    AgentsState,
    AgentState,
    AgentStatus,
    CheckState,
    DatasetsState,
    GovernanceCheckKey,
    GovernanceDoc,
    GovernanceState,
    InsightsState,
    LiveEngineState,
    MemoryState,
    Origin,
    ResearchState,
    RiskState,
    Stage,
    StrategiesState,
    Strategy,
    StrategyStatus,
    StrategyVersion,
    SubsystemKey,
    SystemState,
    Terminal,
    ValidationStatus,
)

STAGE_INDEX = {s: i for i, s in enumerate(PIPELINE_STAGES)}

#: Strategy status -> furthest pipeline stage that status implies.
STATUS_STAGE: dict[StrategyStatus, Stage] = {
    StrategyStatus.CANDIDATE: Stage.VALIDATION,
    StrategyStatus.IN_VALIDATION: Stage.VALIDATION,
    StrategyStatus.VALIDATED: Stage.VALIDATION,
    StrategyStatus.APPROVED: Stage.APPROVED,
    StrategyStatus.DEPLOYED_SIM: Stage.SIM,
    StrategyStatus.DEPLOYED_LIVE: Stage.LIVE,
    StrategyStatus.SCALED: Stage.SCALED,
}

DEPLOYED_STATUSES = {
    StrategyStatus.APPROVED,
    StrategyStatus.DEPLOYED_SIM,
    StrategyStatus.DEPLOYED_LIVE,
    StrategyStatus.SCALED,
}

ACTIVE_AGENT_STATUSES = {AgentStatus.SIMULATING, AgentStatus.PAPER, AgentStatus.LIVE}

#: Checks that must PASS before a declared VALIDATED status is internally consistent.
REQUIRED_VALIDATION_CHECKS = (
    "economic_rationale",
    "realistic_costs",
    "cost_sensitivity",
    "out_of_sample",
    "multiple_testing",
)

SUBSYSTEM_SOURCES: dict[SubsystemKey, tuple[str, ...]] = {
    SubsystemKey.RESEARCH_ENGINE: ("research",),
    SubsystemKey.TRADING_ENGINE: ("live", "execution"),
    SubsystemKey.AGENT_NETWORK: ("agents",),
    SubsystemKey.DATA: ("datasets",),
    SubsystemKey.GOVERNANCE: ("governance",),
    SubsystemKey.MEMORY: ("memory",),
}

SUBSYSTEM_LABELS: dict[SubsystemKey, str] = {
    SubsystemKey.RESEARCH_ENGINE: "Research Engine",
    SubsystemKey.TRADING_ENGINE: "Trading Engine",
    SubsystemKey.AGENT_NETWORK: "Agent Network",
    SubsystemKey.DATA: "Data",
    SubsystemKey.GOVERNANCE: "Governance",
    SubsystemKey.MEMORY: "Memory",
}

#: The agent learning loop. Stages up to PROPOSE are agent-autonomous (research
#: mode only); stages after it belong to research validation and governance.
LEARNING_LOOP: tuple[tuple[str, str, tuple[AgentEventKind, ...]], ...] = (
    ("OBSERVE", "Observe", (AgentEventKind.OBSERVATION,)),
    ("INTERPRET", "Interpret", (AgentEventKind.INTERPRETATION,)),
    ("RECALL", "Recall memory", (AgentEventKind.MEMORY_RECALL,)),
    ("HYPOTHESIZE", "Form hypothesis", (AgentEventKind.HYPOTHESIS,)),
    ("TEST", "Test", (AgentEventKind.TEST,)),
    ("EVALUATE", "Evaluate", (AgentEventKind.EVALUATION,)),
    ("LEARN", "Learn", (AgentEventKind.LEARNING,)),
    ("WRITE_MEMORY", "Write memory", (AgentEventKind.MEMORY_WRITE,)),
    ("PROPOSE", "Propose improvement", (AgentEventKind.PROPOSAL,)),
)


def _data(src: SourceResult | None) -> Any:
    return src.data if src is not None and src.ok else None


def _finding(severity: str, code: str, message: str, section: str, refs: Iterable[str] = ()) -> dict[str, Any]:
    return {"severity": severity, "code": code, "message": message, "section": section, "refs": list(refs)}


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _by_origin(records: Iterable[Any], key: Any) -> dict[str, dict[str, int]]:
    """{origin: {key(record): count}} — counts that must not be merged across origins."""
    out: dict[str, dict[str, int]] = {}
    for r in records:
        bucket = out.setdefault(r.origin.value, {})
        k = key(r)
        bucket[k] = bucket.get(k, 0) + 1
    return out


def _current(strategy: Strategy) -> StrategyVersion:
    return next(v for v in strategy.versions if v.version == strategy.current_version)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def _strategy_stage(strategy: Strategy) -> tuple[Stage, str | None]:
    status = strategy.status
    if status in STATUS_STAGE:
        return STATUS_STAGE[status], None
    # RETIRED / REJECTED: furthest stage any version's status implies.
    reached = [STATUS_STAGE[v.status] for v in strategy.versions if v.status in STATUS_STAGE]
    stage = max(reached, key=STAGE_INDEX.__getitem__) if reached else Stage.VALIDATION
    terminal = Terminal.RETIRED.value if status is StrategyStatus.RETIRED else Terminal.REJECTED.value
    return stage, terminal


def derive_pipeline(research: ResearchState | None, strategies: StrategiesState | None) -> dict[str, Any]:
    available = research is not None or strategies is not None
    items: list[dict[str, Any]] = []
    strategy_ids = {s.strategy_id for s in strategies.strategies} if strategies else set()
    if research is not None:
        for h in research.hypotheses:
            if h.strategy_id and h.strategy_id in strategy_ids:
                continue  # represented by its strategy; never double count
            items.append(
                {
                    "id": h.hypothesis_id,
                    "label": h.title,
                    "kind": "HYPOTHESIS",
                    "stage_reached": h.stage_reached.value,
                    "terminal": h.terminal.value if h.terminal else None,
                    "status": h.status.value,
                    "origin": h.origin.value,
                    "family": h.family,
                    "programme_id": h.programme_id,
                }
            )
    if strategies is not None:
        for s in strategies.strategies:
            stage, terminal = _strategy_stage(s)
            items.append(
                {
                    "id": s.strategy_id,
                    "label": s.name,
                    "kind": "STRATEGY",
                    "stage_reached": stage.value,
                    "terminal": terminal,
                    "status": s.status.value,
                    "origin": s.origin.value,
                    "family": s.mechanism,
                    "programme_id": None,
                }
            )
    stages = []
    for stage in PIPELINE_STAGES:
        idx = STAGE_INDEX[stage]
        if not available:
            stages.append(
                {
                    "stage": stage.value,
                    "reached": None,
                    "active": None,
                    "terminals": None,
                    "reached_by_origin": None,
                    "active_by_origin": None,
                    "terminals_by_origin": None,
                }
            )
            continue
        reached_items = [it for it in items if STAGE_INDEX[Stage(it["stage_reached"])] >= idx]
        here = [it for it in items if it["stage_reached"] == stage.value]
        terminals = Counter(it["terminal"] for it in here if it["terminal"])
        terminals_by_origin: dict[str, dict[str, int]] = {}
        for it in here:
            if it["terminal"]:
                bucket = terminals_by_origin.setdefault(it["origin"], {})
                bucket[it["terminal"]] = bucket.get(it["terminal"], 0) + 1
        stages.append(
            {
                "stage": stage.value,
                "reached": len(reached_items),
                "active": sum(1 for it in here if not it["terminal"]),
                "terminals": {t.value: terminals.get(t.value, 0) for t in Terminal},
                # Origins are never merged silently: the totals above are disclosed per origin here.
                "reached_by_origin": dict(Counter(it["origin"] for it in reached_items)),
                "active_by_origin": dict(Counter(it["origin"] for it in here if not it["terminal"])),
                "terminals_by_origin": terminals_by_origin,
            }
        )
    return {"available": available, "stages": stages, "items": items if available else None}


# ---------------------------------------------------------------------------
# Trial accounting
# ---------------------------------------------------------------------------


def derive_trial_accounting(research: ResearchState | None) -> dict[str, Any]:
    if research is None:
        return {"available": False, "declared": None, "records_by_origin": None, "records_total": None}
    declared = research.trial_accounting
    by_origin = Counter(t.origin.value for t in research.trials)
    return {
        "available": True,
        "declared": declared.model_dump(mode="json") if declared else None,
        "records_by_origin": {o.value: by_origin.get(o.value, 0) for o in Origin},
        "records_total": len(research.trials),
        "outcomes": dict(Counter(t.outcome.value for t in research.trials)),
        "kinds": dict(Counter(t.kind.value for t in research.trials)),
        "outcomes_by_origin": _by_origin(research.trials, lambda t: t.outcome.value),
        "kinds_by_origin": _by_origin(research.trials, lambda t: t.kind.value),
    }


# ---------------------------------------------------------------------------
# Strategy → agent handoff
# ---------------------------------------------------------------------------

HANDOFF_STEPS = ("VALIDATION", "APPROVAL", "DEPLOYMENT_PACKAGE", "AGENT_ASSIGNMENT", "SIMULATION", "LIVE")


def _assignments_for(strategy: Strategy, agents: AgentsState | None) -> list[AgentState]:
    if agents is None:
        return []
    return [a for a in agents.agents if a.assignment and a.assignment.strategy_id == strategy.strategy_id]


def derive_handoff(strategy: Strategy, agents: AgentsState | None) -> dict[str, Any]:
    """Where a strategy's *current version* is in the deployment handoff, from declared facts only."""
    v = _current(strategy)
    validated = v.validation_status is ValidationStatus.VALIDATED
    approved = v.approval is not None and v.approval.decision == "APPROVED"
    packaged = v.deployment_package is not None
    assigned = [a for a in _assignments_for(strategy, agents) if a.assignment.version == v.version]
    sim_modes = {AgentMode.SIM, AgentMode.PAPER, AgentMode.LIVE}
    simulating = strategy.status in {StrategyStatus.DEPLOYED_SIM, StrategyStatus.DEPLOYED_LIVE, StrategyStatus.SCALED} or any(
        a.assignment.mode in sim_modes for a in assigned
    )
    live = strategy.status in {StrategyStatus.DEPLOYED_LIVE, StrategyStatus.SCALED} or any(
        a.assignment.mode is AgentMode.LIVE for a in assigned
    )
    live_scope = approved and v.approval.scope in {"LIVE_SMALL", "LIVE"}

    def step(done: bool, prerequisite: bool, ok_detail: str, blocked_detail: str, violation: str) -> dict[str, str]:
        if done and not prerequisite:
            return {"state": "VIOLATION", "detail": violation}
        if done:
            return {"state": "COMPLETE", "detail": ok_detail}
        return {"state": "BLOCKED" if prerequisite else "NOT_REACHED", "detail": blocked_detail}

    steps = {
        "VALIDATION": {"state": "COMPLETE", "detail": "Validation status VALIDATED"}
        if validated
        else {"state": "BLOCKED", "detail": f"Validation status {v.validation_status.value}"},
        "APPROVAL": step(
            approved,
            validated,
            f"Approved for {v.approval.scope} by {v.approval.decided_by}" if approved else "",
            "No governance approval recorded",
            "Approval recorded without VALIDATED status",
        ),
        "DEPLOYMENT_PACKAGE": step(
            packaged,
            approved,
            f"Package {v.deployment_package.package_id}" if packaged else "",
            "No deployment package",
            "Deployment package exists without approval",
        ),
        "AGENT_ASSIGNMENT": step(
            bool(assigned),
            packaged,
            "Assigned to " + ", ".join(f"Agent {a.slot:02d}" for a in assigned),
            "Not assigned to an agent",
            "Assigned to an agent without a deployment package",
        ),
        "SIMULATION": step(
            simulating,
            bool(assigned) or packaged,
            "Running in simulation or later",
            "Not in simulation",
            "Simulation without assignment or package",
        ),
        "LIVE": step(
            live,
            live_scope,
            "Live",
            "Not live",
            "Live without a LIVE-scope approval",
        ),
    }
    withdrawn = strategy.status in (StrategyStatus.RETIRED, StrategyStatus.REJECTED)
    return {
        "strategy_id": strategy.strategy_id,
        "version": v.version,
        "deployment_eligible": validated and approved and packaged and not withdrawn,
        "withdrawn": withdrawn,
        "steps": [{"step": k, **steps[k]} for k in HANDOFF_STEPS],
    }


# ---------------------------------------------------------------------------
# Agent slots
# ---------------------------------------------------------------------------


def derive_agent_slots(
    agents_src: SourceResult | None,
    strategies: StrategiesState | None,
    events: EventsResult | None,
) -> list[dict[str, Any]]:
    agents: AgentsState | None = _data(agents_src)
    by_slot = {a.slot: a for a in agents.agents} if agents else {}
    strat_by_id = {s.strategy_id: s for s in strategies.strategies} if strategies else {}
    ev_ok = events is not None and events.status.value in ("OK", "INVALID")
    slots = []
    for slot in AGENT_SLOTS:
        agent = by_slot.get(slot)
        if agents is None:
            status, reported = AgentStatus.SLEEPING.value, False
            reason = "No agent runtime connected"
        elif agent is None:
            status, reported = None, False
            reason = "Agent runtime did not report this slot"
        else:
            status, reported = agent.status.value, True
            reason = agent.status_detail
        strategy = None
        if agent and agent.assignment:
            s = strat_by_id.get(agent.assignment.strategy_id)
            strategy = {
                "strategy_id": agent.assignment.strategy_id,
                "version": agent.assignment.version,
                "mode": agent.assignment.mode.value,
                "known": s is not None,
                "name": s.name if s else None,
                "status": s.status.value if s else None,
            }
        slot_events = [e for e in events.events if e.agent_slot == slot] if ev_ok else []
        slots.append(
            {
                "slot": slot,
                "reported": reported,
                "status": status,
                "status_reason": reason,
                "has_strategy": strategy is not None,
                "strategy": strategy,
                "agent": agent.model_dump(mode="json") if agent else None,
                "events": {
                    "available": ev_ok,
                    "count": len(slot_events) if ev_ok else None,
                    "last_ts": _iso(slot_events[-1].ts) if slot_events else None,
                },
            }
        )
    return slots


# ---------------------------------------------------------------------------
# Memory + knowledge graph
# ---------------------------------------------------------------------------


def derive_memory_stats(memory: MemoryState | None) -> dict[str, Any]:
    if memory is None:
        return {"available": False}
    mems = sorted(memory.memories, key=lambda m: m.created_at)
    growth: list[dict[str, Any]] = []
    per_day = Counter(m.created_at.date().isoformat() for m in mems)
    total = 0
    for day in sorted(per_day):
        total += per_day[day]
        growth.append({"date": day, "added": per_day[day], "cumulative": total})
    return {
        "available": True,
        "total": len(mems),
        "by_type": dict(Counter(m.type.value for m in mems)),
        "by_confidence": dict(Counter(m.confidence for m in mems)),
        "by_validation_state": dict(Counter(m.validation_state for m in mems)),
        "by_status": dict(Counter(m.status for m in mems)),
        "by_origin": dict(Counter(m.origin.value for m in mems)),
        "high_confidence_findings": sum(
            1 for m in mems if m.confidence == "HIGH" and m.validation_state == "VALIDATED"
        ),
        "unresolved": sum(1 for m in mems if m.validation_state in ("UNVERIFIED", "PROVISIONAL") or m.status == "REVIEW"),
        "rejected_assumptions": sum(
            1 for m in mems if m.type.value == "REJECTED_ASSUMPTION" or m.status == "REJECTED"
        ),
        "contradicted": sum(1 for m in mems if m.validation_state == "CONTRADICTED"),
        "recent": [m.memory_id for m in reversed(mems[-10:])],
        "growth": growth,
    }


def derive_knowledge_graph(
    research: ResearchState | None,
    strategies: StrategiesState | None,
    memory: MemoryState | None,
) -> dict[str, Any]:
    """Nodes and edges strictly from explicit references. Unknown targets become UNRESOLVED nodes."""
    available = any(x is not None for x in (research, strategies, memory))
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []

    def node(nid: str, ntype: str, label: str, state: str | None = None, origin: str | None = None) -> str:
        key = f"{ntype}:{nid}"
        current = nodes.get(key)
        if current is None or current["state"] == "UNRESOLVED":
            nodes[key] = {"key": key, "id": nid, "type": ntype, "label": label, "state": state, "origin": origin}
        return key

    def ref(ntype: str, nid: str) -> str:
        key = f"{ntype}:{nid}"
        if key not in nodes:
            nodes[key] = {"key": key, "id": nid, "type": ntype, "label": nid, "state": "UNRESOLVED", "origin": None}
        return key

    def edge(a: str, b: str, relation: str, declared_by: str) -> None:
        edges.append({"source": a, "target": b, "relation": relation, "declared_by": declared_by})

    trials_by_number: dict[int, str] = {}
    if research:
        for p in research.programmes:
            node(p.programme_id, "PROGRAMME", p.name, p.status.value, p.origin.value)
        for t in research.trials:
            k = node(t.trial_id, "TRIAL", t.experiment or t.trial_id, t.outcome.value, t.origin.value)
            if t.trial_number is not None:
                trials_by_number[t.trial_number] = t.trial_id
            _ = k
        for h in research.hypotheses:
            node(h.hypothesis_id, "HYPOTHESIS", h.title, h.status.value, h.origin.value)
    if strategies:
        for s in strategies.strategies:
            node(s.strategy_id, "STRATEGY", s.name, s.status.value, s.origin.value)
        for p in strategies.proposals:
            node(p.proposal_id, "PROPOSAL", p.summary, p.state.value, None)
    if memory:
        for m in memory.memories:
            node(m.memory_id, "MEMORY", m.title, m.validation_state, m.origin.value)

    if research:
        for h in research.hypotheses:
            hk = f"HYPOTHESIS:{h.hypothesis_id}"
            if h.programme_id:
                edge(hk, ref("PROGRAMME", h.programme_id), "PART_OF", h.hypothesis_id)
            for n in h.trial_numbers:
                tid = trials_by_number.get(n)
                edge(hk, ref("TRIAL", tid if tid else f"#{n}"), "TESTED_BY", h.hypothesis_id)
            if h.strategy_id:
                edge(hk, ref("STRATEGY", h.strategy_id), "BECAME", h.hypothesis_id)
        for t in research.trials:
            if t.hypothesis_id:
                edge(f"TRIAL:{t.trial_id}", ref("HYPOTHESIS", t.hypothesis_id), "TESTS", t.trial_id)
    if strategies:
        for s in strategies.strategies:
            sk = f"STRATEGY:{s.strategy_id}"
            for v in s.versions:
                for lr in v.lineage:
                    target_type = {"STRATEGY_VERSION": "STRATEGY", "PROPOSAL": "PROPOSAL"}.get(lr.kind, lr.kind)
                    if target_type in ("DOCUMENT", "LITERATURE"):
                        continue
                    tid = lr.ref.split("@")[0] if target_type == "STRATEGY" else lr.ref
                    if target_type == "STRATEGY" and tid == s.strategy_id:
                        continue
                    edge(sk, ref(target_type, tid), f"DERIVED_FROM(v{v.version})", f"{s.strategy_id} v{v.version}")
        for p in strategies.proposals:
            pk = node(p.proposal_id, "PROPOSAL", p.summary, p.state.value, None)
            edge(pk, ref("STRATEGY", p.strategy_id), f"PROPOSES_CHANGE(v{p.base_version})", p.proposal_id)
    if memory:
        for m in memory.memories:
            mk = f"MEMORY:{m.memory_id}"
            for tid in m.source.trial_ids:
                edge(mk, ref("TRIAL", tid), "SOURCED_FROM", m.memory_id)
            for ev in m.evidence:
                if ev.kind == "TRIAL":
                    edge(mk, ref("TRIAL", ev.ref), ev.stance, m.memory_id)
            for sid in m.related_strategies:
                edge(mk, ref("STRATEGY", sid), "RELATES_TO", m.memory_id)
            for oid in m.related_memories:
                edge(mk, ref("MEMORY", oid), "RELATES_TO", m.memory_id)
    return {
        "available": available,
        "nodes": list(nodes.values()),
        "edges": edges,
        "unresolved": sum(1 for n in nodes.values() if n["state"] == "UNRESOLVED"),
    }


# ---------------------------------------------------------------------------
# Learning loop
# ---------------------------------------------------------------------------


def derive_learning(events: EventsResult | None, strategies: StrategiesState | None) -> dict[str, Any]:
    ev_ok = events is not None and events.status.value in ("OK", "INVALID")
    counts = Counter(e.kind for e in events.events) if ev_ok else Counter()
    stages = [
        {
            "key": key,
            "label": label,
            "count": sum(counts.get(k, 0) for k in kinds) if ev_ok else None,
            "owner": "AGENT",
        }
        for key, label, kinds in LEARNING_LOOP
    ]
    proposals = strategies.proposals if strategies else None
    by_state = Counter(p.state.value for p in proposals) if proposals is not None else None
    stages += [
        {
            "key": "RESEARCH_VALIDATION",
            "label": "Research validation",
            "count": (by_state.get("IN_RESEARCH", 0) + by_state.get("VALIDATED", 0)) if by_state is not None else None,
            "owner": "RESEARCH",
        },
        {
            "key": "GOVERNANCE_APPROVAL",
            "label": "Governance approval",
            "count": by_state.get("APPROVED", 0) if by_state is not None else None,
            "owner": "GOVERNANCE",
        },
        {
            "key": "NEW_VERSION",
            "label": "New strategy version",
            "count": by_state.get("RELEASED_AS_VERSION", 0) if by_state is not None else None,
            "owner": "GOVERNANCE",
        },
    ]
    return {
        "events_available": ev_ok,
        "proposals_available": proposals is not None,
        "stages": stages,
        "proposals_by_state": dict(by_state) if by_state is not None else None,
    }


# ---------------------------------------------------------------------------
# Research summary
# ---------------------------------------------------------------------------


def derive_research_summary(research: ResearchState | None, strategies: StrategiesState | None) -> dict[str, Any]:
    out: dict[str, Any] = {"research_available": research is not None, "strategies_available": strategies is not None}
    if research is not None:
        out["programmes_by_status"] = dict(Counter(p.status.value for p in research.programmes))
        out["hypotheses_by_status"] = dict(Counter(h.status.value for h in research.hypotheses))
        out["hypotheses_by_status_origin"] = _by_origin(research.hypotheses, lambda h: h.status.value)
        out["trials_by_origin"] = dict(Counter(t.origin.value for t in research.trials))
        out["hypotheses_total"] = len(research.hypotheses)
        out["trials_total"] = len(research.trials)
        out["trials_running"] = sum(1 for t in research.trials if t.outcome.value == "RUNNING")
        out["families"] = sorted({x for x in (h.family for h in research.hypotheses) if x})
    if strategies is not None:
        strategies_list = strategies.strategies
        out["strategies_total"] = len(strategies_list)
        out["strategies_by_status"] = dict(Counter(s.status.value for s in strategies_list))
        out["strategies_by_status_origin"] = _by_origin(strategies_list, lambda s: s.status.value)
        out["candidates"] = sum(
            1 for s in strategies_list if s.status in (StrategyStatus.CANDIDATE, StrategyStatus.IN_VALIDATION)
        )
        out["validated"] = sum(
            1
            for s in strategies_list
            if _current(s).validation_status is ValidationStatus.VALIDATED
            and s.status not in (StrategyStatus.RETIRED, StrategyStatus.REJECTED)
        )
        out["deployed"] = sum(
            1
            for s in strategies_list
            if s.status in (StrategyStatus.DEPLOYED_SIM, StrategyStatus.DEPLOYED_LIVE, StrategyStatus.SCALED)
        )
        out["retired"] = sum(1 for s in strategies_list if s.status is StrategyStatus.RETIRED)
    return out


# ---------------------------------------------------------------------------
# System status
# ---------------------------------------------------------------------------


def derive_system(sources: dict[str, SourceResult], events: EventsResult | None) -> list[dict[str, Any]]:
    system: SystemState | None = _data(sources.get("system"))
    declared = {s.key: s for s in system.subsystems} if system else {}
    out = []
    for key in SubsystemKey:
        keys = SUBSYSTEM_SOURCES[key]
        states = {k: sources[k].status.value for k in keys if k in sources}
        if key is SubsystemKey.AGENT_NETWORK and events is not None:
            states["agent_events"] = events.status.value
        d = declared.get(key)
        if d is not None:
            display = d.state.value
        elif any(v == "OK" for v in states.values()):
            display = "REPORTING"
        elif any(v in ("INVALID", "UNREADABLE") for v in states.values()):
            display = "SOURCE_ERROR"
        else:
            display = "NOT_CONNECTED"
        out.append(
            {
                "key": key.value,
                "label": SUBSYSTEM_LABELS[key],
                "state": display,
                "declared": d.model_dump(mode="json") if d else None,
                "sources": states,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Controls (all read-only in this build; reasons are explicit)
# ---------------------------------------------------------------------------

READ_ONLY_REASON = "Command Centre is read-only: no command channel exists in this build"


def derive_controls(strategies: StrategiesState | None, agents: AgentsState | None, handoffs: list[dict[str, Any]]) -> dict[str, Any]:
    eligible = [h["strategy_id"] for h in handoffs if h["deployment_eligible"]]
    deploy_blockers = [READ_ONLY_REASON]
    if strategies is None:
        deploy_blockers.append("Strategy registry not connected")
    elif not eligible:
        deploy_blockers.append("No strategy is validated, approved and packaged for deployment")
    runtime_blockers = [READ_ONLY_REASON]
    if agents is None:
        runtime_blockers.append("No agent runtime connected")
    return {
        "read_only": True,
        "deployment_eligible": eligible if strategies is not None else None,
        "actions": [
            {"key": "ASSIGN_STRATEGY", "label": "Assign strategy", "enabled": False, "blockers": deploy_blockers},
            {"key": "START_SIMULATION", "label": "Start simulation", "enabled": False, "blockers": deploy_blockers},
            {
                "key": "ENABLE_LIVE",
                "label": "Enable live trading",
                "enabled": False,
                "blockers": deploy_blockers + ["Requires LIVE-scope governance approval"],
            },
            {"key": "HALT_AGENT", "label": "Halt agent", "enabled": False, "blockers": runtime_blockers},
            {"key": "TRIP_KILL_SWITCH", "label": "Trip kill switch", "enabled": False, "blockers": runtime_blockers},
        ],
    }


# ---------------------------------------------------------------------------
# Consistency findings (governance cross-checks on declared state)
# ---------------------------------------------------------------------------


def derive_consistency(sources: dict[str, SourceResult], events: EventsResult | None) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    research: ResearchState | None = _data(sources.get("research"))
    strategies: StrategiesState | None = _data(sources.get("strategies"))
    agents: AgentsState | None = _data(sources.get("agents"))
    memory: MemoryState | None = _data(sources.get("memory"))
    governance: GovernanceDoc | None = _data(sources.get("governance"))
    live: LiveEngineState | None = _data(sources.get("live"))
    risk: RiskState | None = _data(sources.get("risk"))
    datasets: DatasetsState | None = _data(sources.get("datasets"))
    insights: InsightsState | None = _data(sources.get("insights"))

    # -- provenance ---------------------------------------------------------
    fixture_docs = [k for k, s in sources.items() if s.meta is not None and s.meta.origin is Origin.SYNTHETIC_FIXTURE]
    fixture_records = []
    for name, records in (
        ("research.hypotheses", research.hypotheses if research else []),
        ("research.trials", research.trials if research else []),
        ("research.programmes", research.programmes if research else []),
        ("strategies", strategies.strategies if strategies else []),
        ("memory", memory.memories if memory else []),
        ("datasets", datasets.datasets if datasets else []),
        ("insights", insights.insights if insights else []),
    ):
        if any(r.origin is Origin.SYNTHETIC_FIXTURE for r in records):
            fixture_records.append(name)
    if events is not None and any(e.origin is Origin.SYNTHETIC_FIXTURE for e in events.events):
        fixture_records.append("agent_events")
    if fixture_docs or fixture_records:
        findings.append(
            _finding(
                "CRITICAL",
                "SYNTHETIC_FIXTURE_LOADED",
                "Synthetic fixture data is loaded. Nothing displayed is SENTRY state.",
                "governance",
                fixture_docs + fixture_records,
            )
        )
    for key, src in sources.items():
        if src.status.value in ("INVALID", "UNREADABLE"):
            findings.append(
                _finding("WARNING", "SOURCE_" + src.status.value, f"{src.file}: {src.error}", "data", [src.file])
            )
    if events is not None and events.status.value in ("INVALID", "UNREADABLE"):
        findings.append(
            _finding(
                "WARNING",
                "EVENTS_" + events.status.value,
                f"agent_events.jsonl: {events.invalid_lines} invalid line(s); {events.first_error}",
                "agents",
                ["agent_events.jsonl"],
            )
        )

    # -- trial accounting ---------------------------------------------------
    if research is not None and research.trial_accounting is not None:
        ta = research.trial_accounting
        if None not in (ta.reconstructed_baseline, ta.live_recorded, ta.global_count):
            if ta.global_count != ta.reconstructed_baseline + ta.live_recorded:
                findings.append(
                    _finding(
                        "CRITICAL",
                        "TRIAL_COUNT_MISMATCH",
                        f"Declared global trial count {ta.global_count} ≠ reconstructed baseline "
                        f"{ta.reconstructed_baseline} + live-recorded {ta.live_recorded}",
                        "governance",
                    )
                )
        recon_records = sum(1 for t in research.trials if t.origin is Origin.RECONSTRUCTED)
        if ta.reconstructed_baseline is not None and recon_records < ta.reconstructed_baseline:
            findings.append(
                _finding(
                    "INFO",
                    "RECONSTRUCTED_RECORDS_INCOMPLETE",
                    f"Ledger declares {ta.reconstructed_baseline} reconstructed baseline trials; "
                    f"{recon_records} individual records are present. Missing records are not estimated.",
                    "research",
                )
            )
        orig_records = sum(1 for t in research.trials if t.origin is Origin.ORIGINAL)
        if ta.live_recorded is not None and orig_records != ta.live_recorded:
            findings.append(
                _finding(
                    "WARNING",
                    "LIVE_RECORD_COUNT_DIFFERS",
                    f"Ledger declares {ta.live_recorded} live-recorded trials; {orig_records} ORIGINAL records present.",
                    "research",
                )
            )
        if ta.sealed_evidence_separate is False:
            findings.append(
                _finding(
                    "CRITICAL",
                    "SEALED_EVIDENCE_NOT_SEPARATE",
                    "Ledger reports reconstructed trials are NOT separated from sealed evidence.",
                    "governance",
                )
            )

    # -- governance ---------------------------------------------------------
    if governance is not None:
        if governance.referee is not None and governance.referee.state in ("DIFFERS", "ERROR"):
            findings.append(
                _finding(
                    "WARNING" if governance.referee.state == "DIFFERS" else "CRITICAL",
                    "REFEREE_" + governance.referee.state,
                    f"Referee reports {governance.referee.state}"
                    + (f": {governance.referee.detail}" if governance.referee.detail else ""),
                    "governance",
                )
            )
        for c in governance.checks:
            if c.state in (GovernanceState.FAIL, GovernanceState.DIFFERS):
                if c.key is GovernanceCheckKey.REFEREE and governance.referee is not None:
                    continue  # already reported from the referee block
                findings.append(
                    _finding(
                        "CRITICAL" if c.state is GovernanceState.FAIL else "WARNING",
                        f"GOVERNANCE_{c.state.value}",
                        f"{c.key.value}: {c.state.value}" + (f" — {c.detail}" if c.detail else ""),
                        "governance",
                        [c.key.value],
                    )
                )

    # -- strategies ---------------------------------------------------------
    strat_by_id = {s.strategy_id: s for s in strategies.strategies} if strategies else {}
    if strategies is not None:
        for s in strategies.strategies:
            v = _current(s)
            if s.status in DEPLOYED_STATUSES:
                if v.validation_status is not ValidationStatus.VALIDATED:
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "DEPLOYED_WITHOUT_VALIDATION",
                            f"{s.strategy_id} v{v.version} is {s.status.value} but validation status is "
                            f"{v.validation_status.value}",
                            "strategies",
                            [s.strategy_id],
                        )
                    )
                if v.approval is None or v.approval.decision != "APPROVED":
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "DEPLOYED_WITHOUT_APPROVAL",
                            f"{s.strategy_id} v{v.version} is {s.status.value} without an APPROVED governance decision",
                            "strategies",
                            [s.strategy_id],
                        )
                    )
            if v.validation_status is ValidationStatus.VALIDATED:
                for name in REQUIRED_VALIDATION_CHECKS:
                    chk = getattr(v.validation, name)
                    if chk is None or chk.state is not CheckState.PASS:
                        findings.append(
                            _finding(
                                "WARNING",
                                "VALIDATED_CHECK_NOT_PASS",
                                f"{s.strategy_id} v{v.version} declared VALIDATED but {name} is "
                                f"{chk.state.value if chk else 'NOT REPORTED'}",
                                "strategies",
                                [s.strategy_id],
                            )
                        )
                for name in ("sharpe", "expected_return", "net_return"):
                    m = getattr(v.metrics, name)
                    if m is not None and m.basis.value == "IN_SAMPLE":
                        findings.append(
                            _finding(
                                "WARNING",
                                "HEADLINE_METRIC_IN_SAMPLE",
                                f"{s.strategy_id} v{v.version}: headline {name} is in-sample only",
                                "strategies",
                                [s.strategy_id],
                            )
                        )
            if s.assigned_agent is not None and agents is not None:
                a = next((x for x in agents.agents if x.slot == s.assigned_agent), None)
                if a is None or a.assignment is None or a.assignment.strategy_id != s.strategy_id:
                    findings.append(
                        _finding(
                            "WARNING",
                            "ASSIGNMENT_MISMATCH",
                            f"{s.strategy_id} lists Agent {s.assigned_agent:02d} but that agent does not report it",
                            "agents",
                            [s.strategy_id],
                        )
                    )
        for p in strategies.proposals:
            if p.resulting_version is not None and p.resulting_version <= p.base_version:
                findings.append(
                    _finding(
                        "CRITICAL",
                        "PROPOSAL_OVERWROTE_VERSION",
                        f"{p.proposal_id} resulted in v{p.resulting_version}, not a new version above "
                        f"v{p.base_version}",
                        "strategies",
                        [p.proposal_id],
                    )
                )
            if p.strategy_id not in strat_by_id:
                findings.append(
                    _finding(
                        "INFO",
                        "UNRESOLVED_REFERENCE",
                        f"{p.proposal_id} references unknown strategy {p.strategy_id}",
                        "strategies",
                        [p.proposal_id, p.strategy_id],
                    )
                )

    # -- agents -------------------------------------------------------------
    if agents is not None:
        for a in agents.agents:
            label = f"Agent {a.slot:02d}"
            if a.assignment is None:
                if a.status in ACTIVE_AGENT_STATUSES:
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "AGENT_ACTIVE_WITHOUT_STRATEGY",
                            f"{label} is {a.status.value} with no assigned strategy",
                            "agents",
                        )
                    )
                if a.positions or a.orders:
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "AGENT_EXPOSURE_WITHOUT_STRATEGY",
                            f"{label} reports positions/orders with no assigned strategy",
                            "agents",
                        )
                    )
                continue
            s = strat_by_id.get(a.assignment.strategy_id)
            if strategies is not None and s is None:
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_STRATEGY_UNKNOWN",
                        f"{label} is assigned {a.assignment.strategy_id}, which is not in the strategy registry",
                        "agents",
                    )
                )
                continue
            if s is None:
                continue
            v = next((x for x in s.versions if x.version == a.assignment.version), None)
            if v is None:
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_VERSION_UNKNOWN",
                        f"{label} runs {s.strategy_id} v{a.assignment.version}, which does not exist",
                        "agents",
                    )
                )
                continue
            approved = v.approval is not None and v.approval.decision == "APPROVED"
            if not (v.validation_status is ValidationStatus.VALIDATED and approved and v.deployment_package):
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_ASSIGNMENT_NOT_ELIGIBLE",
                        f"{label} is assigned {s.strategy_id} v{v.version}, which is not validated, approved and "
                        "packaged",
                        "agents",
                        [s.strategy_id],
                    )
                )
            if a.assignment.mode is AgentMode.LIVE and not (approved and v.approval.scope in ("LIVE_SMALL", "LIVE")):
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_LIVE_WITHOUT_LIVE_APPROVAL",
                        f"{label} is in LIVE mode without a LIVE-scope approval for {s.strategy_id} v{v.version}",
                        "agents",
                        [s.strategy_id],
                    )
                )
            for al in a.alerts:
                if al.severity.value == "CRITICAL":
                    findings.append(_finding("CRITICAL", "AGENT_ALERT", f"{label}: {al.message}", "agents"))

    # -- data citations -----------------------------------------------------
    if research is not None and datasets is not None:
        known = {d.dataset_id for d in datasets.datasets}
        missing: dict[str, list[str]] = {}
        for t in research.trials:
            for ds in t.data_used:
                if ds not in known:
                    missing.setdefault(ds, []).append(t.trial_id)
        for ds, trial_ids in sorted(missing.items()):
            findings.append(
                _finding(
                    "INFO",
                    "UNRESOLVED_DATASET_REFERENCE",
                    f"{len(trial_ids)} trial(s) cite dataset {ds}, which is not in the data catalogue",
                    "data",
                    [ds, *trial_ids],
                )
            )

    # -- live / risk --------------------------------------------------------
    if live is not None and live.trading_enabled and live.trading_mode == "LIVE":
        live_ok = any(
            (v := _current(s)).approval is not None
            and v.approval.decision == "APPROVED"
            and v.approval.scope in ("LIVE_SMALL", "LIVE")
            for s in strat_by_id.values()
        )
        if not live_ok:
            findings.append(
                _finding(
                    "CRITICAL",
                    "LIVE_ENABLED_WITHOUT_APPROVED_STRATEGY",
                    "Live engine reports live trading enabled but no strategy holds a LIVE-scope approval",
                    "live",
                )
            )
    if risk is not None:
        if risk.kill_switch is not None and risk.kill_switch.state == "TRIPPED":
            findings.append(_finding("CRITICAL", "KILL_SWITCH_TRIPPED", "Kill switch is TRIPPED", "risk"))
        for b in risk.breaches:
            findings.append(_finding(b.severity.value, "RISK_BREACH", f"{b.limit_key}: {b.detail or 'breach'}", "risk"))

    # -- memory -------------------------------------------------------------
    if memory is not None:
        mem_ids = {m.memory_id for m in memory.memories}
        for m in memory.memories:
            supporting = [e for e in m.evidence if e.stance == "SUPPORTS"]
            if m.confidence == "HIGH" and not supporting:
                findings.append(
                    _finding(
                        "WARNING",
                        "MEMORY_CONFIDENCE_WITHOUT_EVIDENCE",
                        f"{m.memory_id} is HIGH confidence with no supporting evidence attached",
                        "memory",
                        [m.memory_id],
                    )
                )
            if m.validation_state == "VALIDATED" and any(e.stance == "CONTRADICTS" for e in m.evidence):
                findings.append(
                    _finding(
                        "INFO",
                        "MEMORY_HAS_CONTRADICTING_EVIDENCE",
                        f"{m.memory_id} is VALIDATED but carries contradicting evidence",
                        "memory",
                        [m.memory_id],
                    )
                )
            for oid in m.related_memories:
                if oid not in mem_ids:
                    findings.append(
                        _finding(
                            "INFO",
                            "UNRESOLVED_REFERENCE",
                            f"{m.memory_id} references unknown memory {oid}",
                            "memory",
                            [m.memory_id, oid],
                        )
                    )
            if strategies is not None:
                for sid in m.related_strategies:
                    if sid not in strat_by_id:
                        findings.append(
                            _finding(
                                "INFO",
                                "UNRESOLVED_REFERENCE",
                                f"{m.memory_id} references unknown strategy {sid}",
                                "memory",
                                [m.memory_id, sid],
                            )
                        )

    order = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}
    findings.sort(key=lambda f: order[f["severity"]])
    return findings


# ---------------------------------------------------------------------------
# Snapshot assembly
# ---------------------------------------------------------------------------


def derive_all(sources: dict[str, SourceResult], events: EventsResult | None) -> dict[str, Any]:
    research: ResearchState | None = _data(sources.get("research"))
    strategies: StrategiesState | None = _data(sources.get("strategies"))
    agents: AgentsState | None = _data(sources.get("agents"))
    memory: MemoryState | None = _data(sources.get("memory"))
    handoffs = [derive_handoff(s, agents) for s in strategies.strategies] if strategies else []
    consistency = derive_consistency(sources, events)
    origins = {
        k: s.meta.origin.value for k, s in sources.items() if s.meta is not None
    }
    return {
        "system": derive_system(sources, events),
        "pipeline": derive_pipeline(research, strategies),
        "trial_accounting": derive_trial_accounting(research),
        "research_summary": derive_research_summary(research, strategies),
        "handoffs": handoffs,
        "agent_slots": derive_agent_slots(sources.get("agents"), strategies, events),
        "memory_stats": derive_memory_stats(memory),
        "knowledge_graph": derive_knowledge_graph(research, strategies, memory),
        "learning": derive_learning(events, strategies),
        "controls": derive_controls(strategies, agents, handoffs),
        "consistency": consistency,
        "validation_requirements": list(REQUIRED_VALIDATION_CHECKS),
        "alert_counts": dict(Counter(f["severity"] for f in consistency)),
        "document_origins": origins,
        "synthetic": any(f["code"] == "SYNTHETIC_FIXTURE_LOADED" for f in consistency),
        "reconstructed_sources": sorted(k for k, o in origins.items() if o == Origin.RECONSTRUCTED.value),
    }
