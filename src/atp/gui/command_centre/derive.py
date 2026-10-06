"""Derived views over declared SENTRY state.

Everything here is a pure function of the loaded documents. These functions
*aggregate and cross-check* what producers declared; they never decide whether
research passed, never estimate missing values, and never merge evidence of
different origins. The convention throughout:

* source unavailable  -> counts are ``None`` (rendered as "not connected")
* source available but empty -> counts are ``0`` (rendered as "0 recorded")
"""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from typing import Any

from .provider import EventsResult, SourceResult
from .schemas import (
    AGENT_SLOTS,
    DOCUMENTS,
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
    ProposalState,
    ResearchState,
    RiskState,
    Stage,
    StrategiesState,
    Strategy,
    StrategyStatus,
    StrategyVersion,
    SubsystemKey,
    SubsystemState,
    SystemState,
    Terminal,
    ValidationChecks,
    ValidationStatus,
)

log = logging.getLogger(__name__)

STAGE_INDEX = {s: i for i, s in enumerate(PIPELINE_STAGES)}

#: Strategy status -> the pipeline stage that status *declares* was reached.
#: Only statuses that are themselves a declared validation / governance / deployment outcome
#: appear here. CANDIDATE, IN_VALIDATION, RETIRED and REJECTED declare nothing about which
#: research stages (backtest, robustness, OOS) ran, so they are never mapped to a stage.
STATUS_STAGE: dict[StrategyStatus, Stage] = {
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
RUNNING_STATUSES = {StrategyStatus.DEPLOYED_SIM, StrategyStatus.DEPLOYED_LIVE, StrategyStatus.SCALED}
LIVE_STATUSES = {StrategyStatus.DEPLOYED_LIVE, StrategyStatus.SCALED}
WITHDRAWN_STATUSES = {StrategyStatus.RETIRED, StrategyStatus.REJECTED}
LIVE_SCOPES = ("LIVE_SMALL", "LIVE")

ACTIVE_AGENT_STATUSES = {AgentStatus.SIMULATING, AgentStatus.PAPER, AgentStatus.LIVE}

#: Event kinds that only an agent trading (or about to trade) a strategy should emit.
TRADING_EVENT_KINDS = {AgentEventKind.ORDER, AgentEventKind.FILL, AgentEventKind.DECISION}
TRADING_EVENT_MODES = {AgentMode.SIM, AgentMode.PAPER, AgentMode.LIVE}

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

#: Gated proposal stages. Counts are *cumulative*: a proposal is counted in every gate it has
#: passed through (a released version necessarily passed research validation and approval).
GATED_PROPOSAL_STAGES: tuple[tuple[str, str, str, tuple[ProposalState, ...]], ...] = (
    (
        "RESEARCH_VALIDATION",
        "Research validation",
        "RESEARCH",
        (ProposalState.IN_RESEARCH, ProposalState.VALIDATED, ProposalState.APPROVED, ProposalState.RELEASED_AS_VERSION),
    ),
    ("GOVERNANCE_APPROVAL", "Governance approval", "GOVERNANCE", (ProposalState.APPROVED, ProposalState.RELEASED_AS_VERSION)),
    ("NEW_VERSION", "New strategy version", "GOVERNANCE", (ProposalState.RELEASED_AS_VERSION,)),
)


def _data(src: SourceResult | None) -> Any:
    return src.data if src is not None and src.ok else None


def _status(src: SourceResult | EventsResult | None) -> str:
    return src.status.value if src is not None else "NOT_CONFIGURED"


def _events_ok(events: EventsResult | None) -> bool:
    return events is not None and events.status.value in ("OK", "INVALID")


_SOURCE_PHRASE = {
    "NOT_CONFIGURED": "not connected",
    "MISSING": "not produced",
    "INVALID": "rejected by the contract",
    "UNREADABLE": "unreadable",
}


def source_phrase(src: SourceResult | EventsResult | None, what: str) -> str:
    """'Strategy registry not connected' / '… not produced (strategies.json)' / '… rejected by the contract …'."""
    status = _status(src)
    if status == "OK":
        return what
    phrase = _SOURCE_PHRASE.get(status, status.lower())
    file = getattr(src, "file", None) if src is not None else None
    return f"{what} {phrase}" + (f" ({file})" if file and status != "NOT_CONFIGURED" else "")


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


def _approved(v: StrategyVersion | None) -> bool:
    return v is not None and v.approval is not None and v.approval.decision == "APPROVED"


def _live_scope(v: StrategyVersion | None) -> bool:
    return _approved(v) and v.approval.scope in LIVE_SCOPES


def _slot_ref(slot: int) -> str:
    return f"agent:{slot:02d}"


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def _strategy_stage(
    strategy: Strategy, linked: list[Any]
) -> tuple[Stage | None, str | None, str | None]:
    """(stage reached, terminal, basis) from declared facts only.

    basis: DECLARED (the strategy declares stage_reached), STATUS (a validation/governance/deployment
    status), VERSION_STATUS (a withdrawn strategy whose versions carried such a status), HYPOTHESIS
    (the declared stage of the hypothesis that became this strategy) — or None when no stage was
    declared anywhere. A None stage is never counted as having reached any stage.
    """
    status = strategy.status
    terminal: str | None = None
    if strategy.terminal is not None:
        terminal = strategy.terminal.value
    elif status is StrategyStatus.RETIRED:
        terminal = Terminal.RETIRED.value
    elif status is StrategyStatus.REJECTED:
        terminal = Terminal.REJECTED.value
    if strategy.stage_reached is not None:
        return strategy.stage_reached, terminal, "DECLARED"
    if status in STATUS_STAGE:
        return STATUS_STAGE[status], terminal, "STATUS"
    if status in WITHDRAWN_STATUSES:
        reached = [STATUS_STAGE[v.status] for v in strategy.versions if v.status in STATUS_STAGE]
        if reached:
            return max(reached, key=STAGE_INDEX.__getitem__), terminal, "VERSION_STATUS"
    if linked:
        stage = max((h.stage_reached for h in linked), key=STAGE_INDEX.__getitem__)
        return stage, terminal, "HYPOTHESIS"
    return None, terminal, None


def derive_pipeline(research: ResearchState | None, strategies: StrategiesState | None) -> dict[str, Any]:
    available = research is not None or strategies is not None
    items: list[dict[str, Any]] = []
    strategy_ids = {s.strategy_id for s in strategies.strategies} if strategies else set()
    linked: dict[str, list[Any]] = {}
    if research is not None:
        for h in research.hypotheses:
            if h.strategy_id and h.strategy_id in strategy_ids:
                linked.setdefault(h.strategy_id, []).append(h)
                continue  # represented by its strategy; never double count
            items.append(
                {
                    "id": h.hypothesis_id,
                    "label": h.title,
                    "kind": "HYPOTHESIS",
                    "stage_reached": h.stage_reached.value,
                    "stage_basis": "DECLARED",
                    "terminal": h.terminal.value if h.terminal else None,
                    "status": h.status.value,
                    "origin": h.origin.value,
                    "family": h.family,
                    "programme_id": h.programme_id,
                }
            )
    if strategies is not None:
        for s in strategies.strategies:
            stage, terminal, basis = _strategy_stage(s, linked.get(s.strategy_id, []))
            items.append(
                {
                    "id": s.strategy_id,
                    "label": s.name,
                    "kind": "STRATEGY",
                    "stage_reached": stage.value if stage else None,
                    "stage_basis": basis,
                    "terminal": terminal,
                    "status": s.status.value,
                    "origin": s.origin.value,
                    "family": s.mechanism,
                    "programme_id": None,
                }
            )
    staged = [it for it in items if it["stage_reached"] is not None]
    undeclared = [it for it in items if it["stage_reached"] is None]
    stages = []
    for stage in PIPELINE_STAGES:
        idx = STAGE_INDEX[stage]
        # Who can put items at this stage: research stages are reached by hypotheses (and by
        # strategies); governance/deployment stages only by strategies. A stage is countable only
        # when its primary source is connected; a missing secondary source makes it partial.
        research_side = idx <= STAGE_INDEX[Stage.VALIDATION]
        stage_available = (research is not None) if research_side else (strategies is not None)
        partial = ["strategies"] if research_side and stage_available and strategies is None else []
        if not stage_available:
            stages.append(
                {
                    "stage": stage.value,
                    "available": False,
                    "unavailable_source": "research" if research_side else "strategies",
                    "partial": [],
                    "reached": None,
                    "active": None,
                    "terminals": None,
                    "reached_by_origin": None,
                    "active_by_origin": None,
                    "terminals_by_origin": None,
                }
            )
            continue
        reached_items = [it for it in staged if STAGE_INDEX[Stage(it["stage_reached"])] >= idx]
        here = [it for it in staged if it["stage_reached"] == stage.value]
        terminals = Counter(it["terminal"] for it in here if it["terminal"])
        terminals_by_origin: dict[str, dict[str, int]] = {}
        for it in here:
            if it["terminal"]:
                bucket = terminals_by_origin.setdefault(it["origin"], {})
                bucket[it["terminal"]] = bucket.get(it["terminal"], 0) + 1
        stages.append(
            {
                "stage": stage.value,
                "available": True,
                "unavailable_source": None,
                "partial": partial,
                "reached": len(reached_items),
                "active": sum(1 for it in here if not it["terminal"]),
                # RETIRED can only come from strategies: unknown (None) when they are not connected.
                "terminals": {
                    t.value: (None if t is Terminal.RETIRED and strategies is None else terminals.get(t.value, 0))
                    for t in Terminal
                },
                # Origins are never merged silently: the totals above are disclosed per origin here.
                "reached_by_origin": dict(Counter(it["origin"] for it in reached_items)),
                "active_by_origin": dict(Counter(it["origin"] for it in here if not it["terminal"])),
                "terminals_by_origin": terminals_by_origin,
            }
        )
    return {
        "available": available,
        "stages": stages,
        "items": items if available else None,
        # Items whose stage nobody declared: never counted as having reached any stage.
        "undeclared": {
            "count": len(undeclared),
            "ids": [it["id"] for it in undeclared],
            "by_origin": dict(Counter(it["origin"] for it in undeclared)),
            "terminals": dict(Counter(it["terminal"] for it in undeclared if it["terminal"])),
            "active": sum(1 for it in undeclared if not it["terminal"]),
        }
        if available
        else None,
    }


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
HANDOFF_LABELS = {
    "VALIDATION": "validation",
    "APPROVAL": "approval",
    "DEPLOYMENT_PACKAGE": "deployment package",
    "AGENT_ASSIGNMENT": "agent assignment",
    "SIMULATION": "simulation",
    "LIVE": "live",
}

#: Step states. COMPLETE is the only passed state; RUNNING is in progress (never "complete");
#: VIOLATION means the step was declared although an earlier step is not complete.
HANDOFF_STATES = (
    "COMPLETE", "RUNNING", "IN_PROGRESS", "NOT_STARTED", "FAILED", "REJECTED", "REVOKED", "BLOCKED",
    "NOT_REACHED", "WITHDRAWN", "VIOLATION", "UNKNOWN", "UNVERIFIED",
)


def _assignments_for(strategy: Strategy, agents: AgentsState | None) -> list[AgentState]:
    if agents is None:
        return []
    return [a for a in agents.agents if a.assignment and a.assignment.strategy_id == strategy.strategy_id]


def derive_handoff(
    strategy: Strategy, agents: AgentsState | None, agents_phrase: str = "Agent runtime not connected"
) -> dict[str, Any]:
    """Where a strategy's *current version* is in the deployment handoff, from declared facts only.

    Prerequisites are cumulative: a step is COMPLETE only when its own condition holds AND every
    earlier step is COMPLETE. A step whose condition holds out of order is a VIOLATION naming the
    first earlier step that is not complete. ``agents=None`` means the agent runtime is not
    connected, so assignment-dependent steps are UNKNOWN / UNVERIFIED rather than asserted.
    """
    v = _current(strategy)
    status = strategy.status
    withdrawn = status in WITHDRAWN_STATUSES
    validated = v.validation_status is ValidationStatus.VALIDATED
    approved = _approved(v)
    live_scope = _live_scope(v)
    packaged = v.deployment_package is not None
    assigned = [a for a in _assignments_for(strategy, agents) if a.assignment.version == v.version]
    sim_assigned = [a for a in assigned if a.assignment.mode in (AgentMode.SIM, AgentMode.PAPER)]
    live_assigned = [a for a in assigned if a.assignment.mode is AgentMode.LIVE]
    declared_live = status in LIVE_STATUSES
    live = declared_live or bool(live_assigned)
    simulating = status in RUNNING_STATUSES or bool(sim_assigned) or bool(live_assigned)

    steps: dict[str, dict[str, str]] = {}
    gap: list[str] = []  # earlier steps that are not COMPLETE (chain broken)
    unknown: list[str] = []  # earlier steps that could not be verified

    def record(key: str, state: str, detail: str) -> None:
        steps[key] = {"state": state, "detail": detail}
        if state in ("UNKNOWN", "UNVERIFIED"):
            unknown.append(key)
        elif state != "COMPLETE":
            gap.append(key)

    def gated(key: str, done: bool, done_state: str, done_detail: str, waiting_detail: str, *, post_withdrawal: bool = False) -> None:
        if done:
            if withdrawn and post_withdrawal:
                return record(key, "VIOLATION", f"{done_detail}, but the strategy is {status.value}")
            if gap:
                first = gap[0]
                return record(
                    key, "VIOLATION", f"{done_detail}, but {HANDOFF_LABELS[first]} is {steps[first]['state'].replace('_', ' ')}"
                )
            if unknown:
                return record(key, "UNVERIFIED", f"{done_detail}; {HANDOFF_LABELS[unknown[0]]} cannot be verified")
            return record(key, done_state, done_detail)
        if withdrawn:
            return record(key, "WITHDRAWN", f"Strategy {status.value} — not eligible")
        if not gap and not unknown:
            return record(key, "BLOCKED", waiting_detail)
        return record(key, "NOT_REACHED", waiting_detail)

    # VALIDATION: the declared validation status, verbatim.
    vs = v.validation_status
    record(
        "VALIDATION",
        {
            ValidationStatus.VALIDATED: "COMPLETE",
            ValidationStatus.FAILED: "FAILED",
            ValidationStatus.IN_PROGRESS: "IN_PROGRESS",
            ValidationStatus.NOT_STARTED: "NOT_STARTED",
        }[vs],
        f"Validation status {vs.value}",
    )

    # APPROVAL: a REJECTED / REVOKED decision is shown as such, never as "awaiting".
    if v.approval is not None and v.approval.decision in ("REJECTED", "REVOKED"):
        record("APPROVAL", v.approval.decision, f"Governance decision {v.approval.decision} by {v.approval.decided_by}")
    else:
        gated(
            "APPROVAL",
            approved,
            "COMPLETE",
            f"Approved for {v.approval.scope} by {v.approval.decided_by}" if approved else "Approval recorded",
            "No governance approval recorded",
        )
    gated(
        "DEPLOYMENT_PACKAGE",
        packaged,
        "COMPLETE",
        f"Package {v.deployment_package.package_id}" if packaged else "Deployment package recorded",
        "No deployment package",
    )
    if agents is None:
        if withdrawn:
            record("AGENT_ASSIGNMENT", "WITHDRAWN", f"Strategy {status.value} — not eligible")
        elif gap:
            record("AGENT_ASSIGNMENT", "NOT_REACHED", agents_phrase)
        else:
            listed = f"Registry lists Agent {strategy.assigned_agent:02d}; " if strategy.assigned_agent else ""
            phrase = agents_phrase[:1].lower() + agents_phrase[1:]
            record("AGENT_ASSIGNMENT", "UNKNOWN", f"{listed}{phrase} — assignment cannot be verified")
    else:
        gated(
            "AGENT_ASSIGNMENT",
            bool(assigned),
            "COMPLETE",
            "Assigned to " + ", ".join(f"Agent {a.slot:02d} ({a.assignment.mode.value})" for a in assigned),
            "Not assigned to an agent",
            post_withdrawal=True,
        )
    if live:
        sim_detail = "Simulation passed through to live"
    elif sim_assigned:
        sim_detail = "Running in " + ", ".join(sorted({a.assignment.mode.value for a in sim_assigned}))
    else:
        sim_detail = f"Registry declares {status.value}"
    gated(
        "SIMULATION",
        simulating,
        "COMPLETE" if live else "RUNNING",
        sim_detail,
        "Not in simulation",
        post_withdrawal=True,
    )
    # LIVE: its own prerequisites on top of the cumulative chain.
    if live and not live_scope:
        record("LIVE", "VIOLATION", "Live without a LIVE-scope approval")
    elif live and agents is not None and not live_assigned and not withdrawn and not gap and not unknown:
        record("LIVE", "VIOLATION", f"Registry declares {status.value} but no agent runs this version in LIVE mode")
    else:
        gated(
            "LIVE",
            live,
            "COMPLETE",
            "Live" + (f" on Agent {', '.join(f'{a.slot:02d}' for a in live_assigned)}" if live_assigned else ""),
            "Not live",
            post_withdrawal=True,
        )
    return {
        "strategy_id": strategy.strategy_id,
        "version": v.version,
        "deployment_eligible": validated and approved and packaged and not withdrawn,
        "withdrawn": withdrawn,
        "approval_scope": v.approval.scope if approved else None,
        "live_scope": live_scope,
        "assigned_slots": [a.slot for a in assigned] if agents is not None else None,
        "steps": [{"step": k, **steps[k]} for k in HANDOFF_STEPS],
    }


# ---------------------------------------------------------------------------
# Heartbeat freshness (only judged against a producer-declared bound)
# ---------------------------------------------------------------------------


def _age_s(at: datetime | None, now: datetime) -> float | None:
    return None if at is None else max(0.0, (now - at).total_seconds())


def derive_freshness(sources: dict[str, SourceResult], now: datetime) -> dict[str, Any]:
    """Heartbeat ages per document. ``stale`` is judged only when the producer declared
    ``meta.heartbeat_max_age_s``; otherwise it is ``None`` (not judged), never guessed."""
    out: dict[str, Any] = {}
    for key in ("agents", "live", "execution", "system"):
        src = sources.get(key)
        data = _data(src)
        if data is None:
            out[key] = None
            continue
        bound = src.meta.heartbeat_max_age_s if src.meta else None
        items: list[dict[str, Any]] = []

        def add(ref: str, label: str, at: datetime | None) -> None:
            age = _age_s(at, now)
            items.append(
                {
                    "ref": ref,
                    "label": label,
                    "at": _iso(at),
                    "age_s": round(age, 1) if age is not None else None,
                    "stale": (age > bound) if (bound is not None and age is not None) else None,
                }
            )

        if key == "agents":
            for a in data.agents:
                add(_slot_ref(a.slot), f"Agent {a.slot:02d}", a.last_heartbeat)
                for c in a.connections:
                    add(f"{_slot_ref(a.slot)}/{c.name}", f"Agent {a.slot:02d} · {c.name}", c.last_heartbeat)
        elif key == "live":
            add("live:engine", "Live engine", data.heartbeat_at)
            for c in data.connections:
                add(f"live/{c.name}", f"Live engine · {c.name}", c.last_heartbeat)
        elif key == "execution":
            for c in data.connections:
                add(f"execution/{c.name}", f"Execution · {c.name}", c.last_heartbeat)
        else:
            for sub in data.subsystems:
                add(f"system/{sub.key.value}", SUBSYSTEM_LABELS[sub.key], sub.heartbeat_at)
        out[key] = {
            "max_age_s": bound,
            "judged": bound is not None,
            "items": items,
            "stale": [i["ref"] for i in items if i["stale"]],
        }
    return out


# ---------------------------------------------------------------------------
# Agent slots
# ---------------------------------------------------------------------------


def derive_agent_slots(
    agents_src: SourceResult | None,
    strategies: StrategiesState | None,
    events: EventsResult | None,
    freshness: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    agents: AgentsState | None = _data(agents_src)
    src_status = _status(agents_src)
    by_slot = {a.slot: a for a in agents.agents} if agents else {}
    strat_by_id = {s.strategy_id: s for s in strategies.strategies} if strategies else {}
    ev_ok = _events_ok(events)
    fresh = {i["ref"]: i for i in ((freshness or {}).get("agents") or {}).get("items", [])}
    slots = []
    for slot in AGENT_SLOTS:
        agent = by_slot.get(slot)
        if agents is None:
            reported = False
            if src_status in ("INVALID", "UNREADABLE"):
                # A broken source is not a sleeping fleet: the runtime wrote something we cannot read.
                status: str | None = "SOURCE_ERROR"
                file = agents_src.file if agents_src else "agents.json"
                reason = f"{file} {src_status.lower()}: {agents_src.error if agents_src else ''}".rstrip(": ")
            elif src_status == "MISSING":
                status = AgentStatus.SLEEPING.value
                reason = "agents.json not produced — no agent runtime is reporting"
            else:
                status = AgentStatus.SLEEPING.value
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
            v = next((x for x in s.versions if x.version == agent.assignment.version), None) if s else None
            strategy = {
                "strategy_id": agent.assignment.strategy_id,
                "version": agent.assignment.version,
                "mode": agent.assignment.mode.value,
                # None = the registry is not connected, so nothing can be said either way.
                "known": (s is not None) if strategies is not None else None,
                "known_version": (v is not None) if strategies is not None else None,
                "is_current": (v.version == s.current_version) if v is not None else None,
                "name": s.name if s else None,
                "status": s.status.value if s else None,
                "version_status": v.status.value if v else None,
                "version_validation_status": v.validation_status.value if v else None,
                "current_version": s.current_version if s else None,
            }
        slot_events = [e for e in events.events if e.agent_slot == slot] if ev_ok else []
        hb = fresh.get(_slot_ref(slot))
        slots.append(
            {
                "slot": slot,
                "reported": reported,
                "status": status,
                "status_reason": reason,
                "source_status": src_status,
                "has_strategy": strategy is not None,
                "strategy": strategy,
                "agent": agent.model_dump(mode="json") if agent else None,
                "heartbeat_age_s": hb["age_s"] if hb else None,
                "stale": hb["stale"] if hb else None,
                "events": {
                    "available": ev_ok,
                    "count": len(slot_events) if ev_ok else None,
                    "last_ts": _iso(slot_events[-1].ts) if slot_events else None,
                    # Exact counts over the whole stream (views fetch only a window of events).
                    "by_kind": dict(Counter(e.kind.value for e in slot_events)) if ev_ok else None,
                    "by_mode": dict(Counter(e.mode.value for e in slot_events)) if ev_ok else None,
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

    def high(m: Any) -> bool:
        return m.confidence == "HIGH" and m.validation_state == "VALIDATED"

    def unresolved(m: Any) -> bool:
        return m.validation_state in ("UNVERIFIED", "PROVISIONAL") or m.status == "REVIEW"

    return {
        "available": True,
        "total": len(mems),
        "by_type": dict(Counter(m.type.value for m in mems)),
        "by_confidence": dict(Counter(m.confidence for m in mems)),
        "by_validation_state": dict(Counter(m.validation_state for m in mems)),
        "by_status": dict(Counter(m.status for m in mems)),
        "by_origin": dict(Counter(m.origin.value for m in mems)),
        "high_confidence_findings": sum(1 for m in mems if high(m)),
        "unresolved": sum(1 for m in mems if unresolved(m)),
        # The merged totals above must never be shown without these per-origin splits.
        "high_confidence_by_origin": dict(Counter(m.origin.value for m in mems if high(m))),
        "unresolved_by_origin": dict(Counter(m.origin.value for m in mems if unresolved(m))),
        "rejected_assumptions": sum(
            1 for m in mems if m.type.value == "REJECTED_ASSUMPTION" or m.status == "REJECTED"
        ),
        "contradicted": sum(1 for m in mems if m.validation_state == "CONTRADICTED"),
        "recent": [m.memory_id for m in reversed(mems[-10:])],
        "growth": growth,
    }


#: Evidence kinds that point at research records (trials / experiments) and become graph edges.
RESEARCH_EVIDENCE_KINDS = ("TRIAL", "EXPERIMENT", "BACKTEST", "OUT_OF_SAMPLE", "ROBUSTNESS", "COST_SENSITIVITY")

#: Reference fields drawn as edges (shown by the graph view so the claim is checkable).
GRAPH_REFERENCE_FIELDS = (
    "hypothesis.programme_id",
    "hypothesis.trial_numbers",
    "hypothesis.strategy_id",
    "trial.hypothesis_id",
    "strategy_version.lineage",
    "proposal.strategy_id",
    "proposal.evidence_refs (memories, trials)",
    "memory.source.programme_id",
    "memory.source.trial_ids",
    "memory.source.experiment_ids",
    "memory.related_experiments",
    "memory.evidence (research kinds)",
    "memory.related_strategies",
    "memory.related_memories",
)


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
    trial_ids: set[str] = set()
    experiment_to_trials: dict[str, list[str]] = {}
    if research:
        for p in research.programmes:
            node(p.programme_id, "PROGRAMME", p.name, p.status.value, p.origin.value)
        for t in research.trials:
            node(t.trial_id, "TRIAL", t.experiment or t.trial_id, t.outcome.value, t.origin.value)
            trial_ids.add(t.trial_id)
            if t.trial_number is not None:
                trials_by_number[t.trial_number] = t.trial_id
            if t.experiment_id:
                experiment_to_trials.setdefault(t.experiment_id, []).append(t.trial_id)
        for h in research.hypotheses:
            node(h.hypothesis_id, "HYPOTHESIS", h.title, h.status.value, h.origin.value)
    memory_ids: set[str] = set()
    if strategies:
        for s in strategies.strategies:
            node(s.strategy_id, "STRATEGY", s.name, s.status.value, s.origin.value)
        for p in strategies.proposals:
            node(p.proposal_id, "PROPOSAL", p.summary, p.state.value, None)
    if memory:
        for m in memory.memories:
            node(m.memory_id, "MEMORY", m.title, m.validation_state, m.origin.value)
            memory_ids.add(m.memory_id)

    def research_targets(rid: str) -> list[str]:
        """An experiment / trial reference: the trial itself, every trial of that experiment, or UNRESOLVED."""
        if rid in trial_ids:
            return [f"TRIAL:{rid}"]
        if rid in experiment_to_trials:
            return [f"TRIAL:{t}" for t in experiment_to_trials[rid]]
        return [ref("TRIAL", rid)]

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
            for r in p.evidence_refs:
                # Only references that resolve to a graph entity become edges (documents do not).
                if r in memory_ids:
                    edge(pk, f"MEMORY:{r}", "CITES", p.proposal_id)
                elif r in trial_ids or r in experiment_to_trials:
                    for target in research_targets(r):
                        edge(pk, target, "CITES", p.proposal_id)
    if memory:
        for m in memory.memories:
            mk = f"MEMORY:{m.memory_id}"
            if m.source.programme_id:
                edge(mk, ref("PROGRAMME", m.source.programme_id), "SOURCED_FROM", m.memory_id)
            for tid in m.source.trial_ids:
                edge(mk, ref("TRIAL", tid), "SOURCED_FROM", m.memory_id)
            for eid in m.source.experiment_ids:
                for target in research_targets(eid):
                    edge(mk, target, "SOURCED_FROM", m.memory_id)
            for eid in m.related_experiments:
                for target in research_targets(eid):
                    edge(mk, target, "RELATES_TO", m.memory_id)
            for ev in m.evidence:
                if ev.kind in RESEARCH_EVIDENCE_KINDS:
                    targets = [ref("TRIAL", ev.ref)] if ev.kind == "TRIAL" else research_targets(ev.ref)
                    for target in targets:
                        edge(mk, target, ev.stance, m.memory_id)
            for sid in m.related_strategies:
                edge(mk, ref("STRATEGY", sid), "RELATES_TO", m.memory_id)
            for oid in m.related_memories:
                edge(mk, ref("MEMORY", oid), "RELATES_TO", m.memory_id)
    return {
        "available": available,
        "nodes": list(nodes.values()),
        "edges": edges,
        "unresolved": sum(1 for n in nodes.values() if n["state"] == "UNRESOLVED"),
        "reference_fields": list(GRAPH_REFERENCE_FIELDS),
    }


# ---------------------------------------------------------------------------
# Learning loop
# ---------------------------------------------------------------------------


def derive_learning(events: EventsResult | None, strategies: StrategiesState | None) -> dict[str, Any]:
    ev_ok = _events_ok(events)
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
    by_state = Counter(p.state for p in proposals) if proposals is not None else None
    stages += [
        {
            "key": key,
            "label": label,
            # cumulative: every proposal that has passed through this gate (a released version
            # was necessarily validated and approved); REJECTED proposals are counted separately.
            "count": sum(by_state.get(st, 0) for st in states) if by_state is not None else None,
            "owner": owner,
            "counts": "cumulative",
        }
        for key, label, owner, states in GATED_PROPOSAL_STAGES
    ]
    return {
        "events_available": ev_ok,
        "proposals_available": proposals is not None,
        "stages": stages,
        "proposals_by_state": {k.value: n for k, n in by_state.items()} if by_state is not None else None,
        "proposals_rejected": by_state.get(ProposalState.REJECTED, 0) if by_state is not None else None,
        "gated_counts": "cumulative",
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
        # hypotheses_total merges origins; any display of it must use this split alongside.
        out["hypotheses_total_by_origin"] = dict(Counter(h.origin.value for h in research.hypotheses))
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

#: Declared states that assert the subsystem is healthy and producing.
_HEALTHY_DECLARED = {SubsystemState.ONLINE, SubsystemState.IDLE}


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
        broken = sorted(k for k, v in states.items() if v in ("INVALID", "UNREADABLE"))
        problem = None
        if d is not None:
            display = d.state.value
            # The declaration is kept verbatim (``declared``); the display state is qualified when the
            # subsystem's own documents contradict a healthy declaration.
            if d.state in _HEALTHY_DECLARED and broken:
                display = "SOURCE_ERROR"
                problem = f"Declared {d.state.value}, but " + ", ".join(
                    f"{sources[k].file if k in sources else k} is {states[k]}" for k in broken
                )
            elif d.state in _HEALTHY_DECLARED and states and all(v in ("MISSING", "NOT_CONFIGURED") for v in states.values()):
                display = "SOURCE_MISSING"
                problem = f"Declared {d.state.value}, but none of its documents has been produced"
        elif any(v == "OK" for v in states.values()):
            display = "REPORTING"
        elif broken:
            display = "SOURCE_ERROR"
        elif any(v == "MISSING" for v in states.values()):
            # A state directory is configured but this subsystem's documents were never produced.
            display = "NOT_PRODUCED"
        else:
            display = "NOT_CONNECTED"
        out.append(
            {
                "key": key.value,
                "label": SUBSYSTEM_LABELS[key],
                "state": display,
                "declared": d.model_dump(mode="json") if d else None,
                "source_problem": problem,
                "sources": states,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Controls (all read-only in this build; reasons are explicit)
# ---------------------------------------------------------------------------

READ_ONLY_REASON = "Command Centre is read-only: no command channel exists in this build"


def derive_controls(
    strategies_src: SourceResult | None,
    agents_src: SourceResult | None,
    handoffs: list[dict[str, Any]],
) -> dict[str, Any]:
    strategies: StrategiesState | None = _data(strategies_src)
    agents: AgentsState | None = _data(agents_src)
    eligible = [h["strategy_id"] for h in handoffs if h["deployment_eligible"]]
    deploy_blockers = [READ_ONLY_REASON]
    if strategies is None:
        deploy_blockers.append(source_phrase(strategies_src, "Strategy registry"))
    elif not eligible:
        deploy_blockers.append("No strategy is validated, approved and packaged for deployment")
    runtime_blockers = [READ_ONLY_REASON]
    if agents is None:
        if _status(agents_src) in ("NOT_CONFIGURED",):
            runtime_blockers.append("No agent runtime connected")
        else:
            runtime_blockers.append(source_phrase(agents_src, "Agent runtime state"))
    live_blockers = list(deploy_blockers)
    if strategies is not None:
        live_eligible = [h["strategy_id"] for h in handoffs if h["deployment_eligible"] and h.get("live_scope")]
        if not live_eligible:
            live_blockers.append("No deployment-eligible strategy holds a LIVE-scope governance approval")
    return {
        "read_only": True,
        "deployment_eligible": eligible if strategies is not None else None,
        "actions": [
            {"key": "ASSIGN_STRATEGY", "label": "Assign strategy", "enabled": False, "blockers": deploy_blockers},
            {"key": "START_SIMULATION", "label": "Start simulation", "enabled": False, "blockers": deploy_blockers},
            {"key": "ENABLE_LIVE", "label": "Enable live trading", "enabled": False, "blockers": live_blockers},
            {"key": "HALT_AGENT", "label": "Halt agent", "enabled": False, "blockers": runtime_blockers},
            {"key": "TRIP_KILL_SWITCH", "label": "Trip kill switch", "enabled": False, "blockers": runtime_blockers},
        ],
    }


# ---------------------------------------------------------------------------
# Cross-check coverage: which families of checks could actually run
# ---------------------------------------------------------------------------

#: (key, label, sources every check in the family needs). "agent_events" is the event stream.
CHECK_FAMILIES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("provenance", "Provenance & source validity", ()),
    ("trial_accounting", "Trial accounting", ("research",)),
    ("research_records", "Hypothesis trial records", ("research",)),
    ("governance", "Governance checks & referee", ("governance",)),
    ("strategy_rules", "Strategy validation & deployment rules", ("strategies",)),
    ("agent_eligibility", "Agent assignment eligibility", ("agents", "strategies")),
    ("agent_activity", "Agent activity vs event stream", ("agents", "agent_events")),
    ("data_citations", "Dataset citations", ("research", "datasets")),
    ("live_approval", "Live trading vs LIVE-scope approval", ("live", "strategies")),
    ("risk", "Risk limits & kill switch", ("risk",)),
    ("memory", "Memory evidence", ("memory",)),
    ("freshness", "Heartbeat freshness (declared bounds)", ("agents", "live", "execution", "system")),
)


def derive_check_coverage(
    sources: dict[str, SourceResult], events: EventsResult | None, freshness: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """For each family of cross-checks: did it run, and if not, which source is missing.

    "No findings" only ever means "no findings from the checks that ran"; this list says which ran.
    """
    def ok(key: str) -> bool:
        if key == "agent_events":
            return _events_ok(events)
        return sources.get(key) is not None and sources[key].ok

    def describe(key: str) -> dict[str, str]:
        if key == "agent_events":
            return {"source": key, "file": "agent_events.jsonl", "status": _status(events)}
        src = sources.get(key)
        return {"source": key, "file": src.file if src else DOCUMENTS[key][0], "status": _status(src)}

    # Provenance / validity checks need at least one document that exists (valid or not).
    any_source = any(s.status.value in ("OK", "INVALID", "UNREADABLE") for s in sources.values()) or (
        events is not None and events.status.value in ("OK", "INVALID", "UNREADABLE")
    )
    out = []
    for key, label, needs in CHECK_FAMILIES:
        if key == "provenance":
            ran = any_source
            missing = [] if ran else [{"source": "*", "file": "state directory", "status": "NOT_CONFIGURED"}]
            note = None
        elif key == "freshness":
            judged = [k for k in needs if freshness and freshness.get(k) and freshness[k]["judged"]]
            ran = bool(judged)
            missing = [describe(k) for k in needs if not ok(k)]
            note = None if ran else "no producer declared meta.heartbeat_max_age_s"
        else:
            missing = [describe(k) for k in needs if not ok(k)]
            ran = not missing
            note = None
        out.append({"key": key, "label": label, "requires": list(needs), "ran": ran, "missing": missing, "note": note})
    return out


# ---------------------------------------------------------------------------
# Consistency findings (governance cross-checks on declared state)
# ---------------------------------------------------------------------------


def derive_consistency(
    sources: dict[str, SourceResult],
    events: EventsResult | None,
    freshness: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
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

    # -- trial accounting / research records ---------------------------------
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
        if ta.reconstructed_baseline is not None and recon_records > ta.reconstructed_baseline:
            findings.append(
                _finding(
                    "WARNING",
                    "RECONSTRUCTED_RECORDS_EXCEED_BASELINE",
                    f"{recon_records} RECONSTRUCTED trial records are present but the ledger declares a "
                    f"reconstructed baseline of {ta.reconstructed_baseline}.",
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
    if research is not None:
        numbers = {t.trial_number for t in research.trials if t.trial_number is not None}
        for h in research.hypotheses:
            absent = [n for n in h.trial_numbers if n not in numbers]
            if absent:
                findings.append(
                    _finding(
                        "INFO",
                        "HYPOTHESIS_TRIAL_RECORD_MISSING",
                        f"{h.hypothesis_id} declares trial number(s) {', '.join(f'#{n}' for n in absent)} "
                        "with no trial record present. Missing records are not estimated.",
                        "research",
                        [h.hypothesis_id],
                    )
                )

    # -- governance ---------------------------------------------------------
    if governance is not None:
        block = governance.referee
        if block is not None and block.state in ("DIFFERS", "ERROR"):
            findings.append(
                _finding(
                    "WARNING" if block.state == "DIFFERS" else "CRITICAL",
                    "REFEREE_" + block.state,
                    f"Referee reports {block.state}" + (f": {block.detail}" if block.detail else ""),
                    "governance",
                    [GovernanceCheckKey.REFEREE.value],
                )
            )
        ref_check = next((c for c in governance.checks if c.key is GovernanceCheckKey.REFEREE), None)
        for c in governance.checks:
            if c.state in (GovernanceState.FAIL, GovernanceState.DIFFERS):
                # Skip only when the referee block already reported a failure for the same condition.
                if c.key is GovernanceCheckKey.REFEREE and block is not None and block.state in ("DIFFERS", "ERROR"):
                    continue
                findings.append(
                    _finding(
                        "CRITICAL" if c.state is GovernanceState.FAIL else "WARNING",
                        f"GOVERNANCE_{c.state.value}",
                        f"{c.key.value}: {c.state.value}" + (f" — {c.detail}" if c.detail else ""),
                        "governance",
                        [c.key.value],
                    )
                )
        if block is not None and ref_check is not None:
            cs = ref_check.state
            disagree = (
                (block.state == "MATCH" and cs in (GovernanceState.FAIL, GovernanceState.DIFFERS))
                or (block.state in ("DIFFERS", "ERROR") and cs is GovernanceState.PASS)
                or (block.state == "NOT_RUN" and cs in (GovernanceState.PASS, GovernanceState.FAIL, GovernanceState.DIFFERS))
            )
            if disagree:
                findings.append(
                    _finding(
                        "WARNING",
                        "REFEREE_STATE_DISAGREES",
                        f"Referee block reports {block.state} but the referee governance check is {cs.value}",
                        "governance",
                        [GovernanceCheckKey.REFEREE.value],
                    )
                )

    # -- strategies ---------------------------------------------------------
    strat_by_id = {s.strategy_id: s for s in strategies.strategies} if strategies else {}
    if strategies is not None:
        proposals_by_id = {p.proposal_id: p for p in strategies.proposals}
        for s in strategies.strategies:
            v = _current(s)
            sid = s.strategy_id
            label = f"{sid} v{v.version}"
            approved = _approved(v)
            packaged = v.deployment_package is not None
            if s.status in DEPLOYED_STATUSES:
                if v.validation_status is not ValidationStatus.VALIDATED:
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "DEPLOYED_WITHOUT_VALIDATION",
                            f"{label} is {s.status.value} but validation status is {v.validation_status.value}",
                            "strategies",
                            [sid],
                        )
                    )
                if not approved:
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "DEPLOYED_WITHOUT_APPROVAL",
                            f"{label} is {s.status.value} without an APPROVED governance decision",
                            "strategies",
                            [sid],
                        )
                    )
            if s.status in RUNNING_STATUSES and not packaged:
                findings.append(
                    _finding(
                        "CRITICAL",
                        "DEPLOYED_WITHOUT_PACKAGE",
                        f"{label} is {s.status.value} without a deployment package",
                        "strategies",
                        [sid],
                    )
                )
            if s.status in LIVE_STATUSES and not _live_scope(v):
                findings.append(
                    _finding(
                        "CRITICAL",
                        "DEPLOYED_LIVE_WITHOUT_LIVE_SCOPE",
                        f"{label} is {s.status.value} but holds no APPROVED LIVE-scope decision"
                        + (f" (approval scope {v.approval.scope})" if approved else ""),
                        "strategies",
                        [sid],
                    )
                )
            if approved and v.validation_status is not ValidationStatus.VALIDATED:
                findings.append(
                    _finding(
                        "CRITICAL",
                        "APPROVAL_WITHOUT_VALIDATION",
                        f"{label} carries an APPROVED governance decision while validation status is "
                        f"{v.validation_status.value}",
                        "strategies",
                        [sid],
                    )
                )
            if packaged and not approved:
                findings.append(
                    _finding(
                        "CRITICAL",
                        "PACKAGE_WITHOUT_APPROVAL",
                        f"{label} has deployment package {v.deployment_package.package_id} without an APPROVED decision",
                        "strategies",
                        [sid],
                    )
                )
            # status vs declared validation of the current version
            if s.status is StrategyStatus.VALIDATED and v.validation_status is not ValidationStatus.VALIDATED:
                findings.append(
                    _finding(
                        "WARNING",
                        "STATUS_VALIDATION_MISMATCH",
                        f"{sid} is declared VALIDATED but its current version v{v.version} has validation status "
                        f"{v.validation_status.value}",
                        "strategies",
                        [sid],
                    )
                )
            if (
                s.status in (StrategyStatus.CANDIDATE, StrategyStatus.IN_VALIDATION)
                and v.validation_status is ValidationStatus.VALIDATED
            ):
                findings.append(
                    _finding(
                        "WARNING",
                        "STATUS_VALIDATION_MISMATCH",
                        f"{sid} is declared {s.status.value} but its current version v{v.version} is VALIDATED",
                        "strategies",
                        [sid],
                    )
                )
            if s.status not in WITHDRAWN_STATUSES and v.status is not s.status:
                findings.append(
                    _finding(
                        "WARNING",
                        "STATUS_VALIDATION_MISMATCH",
                        f"{sid} is declared {s.status.value} but its current version v{v.version} is {v.status.value}",
                        "strategies",
                        [sid],
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
                                f"{label} declared VALIDATED but {name} is "
                                f"{chk.state.value if chk else 'NOT REPORTED'}",
                                "strategies",
                                [sid],
                            )
                        )
                failed = [
                    name
                    for name in ValidationChecks.model_fields
                    if name not in REQUIRED_VALIDATION_CHECKS
                    and getattr(v.validation, name) is not None
                    and getattr(v.validation, name).state is CheckState.FAIL
                ]
                if failed:
                    findings.append(
                        _finding(
                            "WARNING",
                            "VALIDATED_WITH_FAILED_CHECK",
                            f"{label} declared VALIDATED but reports FAIL on {', '.join(failed)}",
                            "strategies",
                            [sid],
                        )
                    )
                for name in ("sharpe", "expected_return", "net_return"):
                    m = getattr(v.metrics, name)
                    if m is not None and m.basis.value == "IN_SAMPLE":
                        findings.append(
                            _finding(
                                "WARNING",
                                "HEADLINE_METRIC_IN_SAMPLE",
                                f"{label}: headline {name} is in-sample only",
                                "strategies",
                                [sid],
                            )
                        )
            if (
                v.multiple_testing is not None
                and v.validation.multiple_testing is not None
                and v.multiple_testing.state is not v.validation.multiple_testing.state
            ):
                findings.append(
                    _finding(
                        "WARNING",
                        "MULTIPLE_TESTING_DISAGREES",
                        f"{label}: multiple-testing treatment is {v.multiple_testing.state.value} but the "
                        f"multiple_testing validation check is {v.validation.multiple_testing.state.value}",
                        "strategies",
                        [sid],
                    )
                )
            # versions must come through a released proposal
            numbers = {x.version for x in s.versions}
            for ver in s.versions:
                if ver.proposal_id is None:
                    continue
                p = proposals_by_id.get(ver.proposal_id)
                if p is None:
                    findings.append(
                        _finding(
                            "WARNING",
                            "VERSION_PROPOSAL_UNKNOWN",
                            f"{sid} v{ver.version} cites proposal {ver.proposal_id}, which is not in the registry",
                            "strategies",
                            [sid, ver.proposal_id],
                        )
                    )
                elif p.state is not ProposalState.RELEASED_AS_VERSION:
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "VERSION_FROM_UNRELEASED_PROPOSAL",
                            f"{sid} v{ver.version} cites proposal {p.proposal_id}, which is {p.state.value} — "
                            "a new version must come through research validation and governance",
                            "strategies",
                            [sid, p.proposal_id],
                        )
                    )
            if s.assigned_agent is not None and agents is not None:
                a = next((x for x in agents.agents if x.slot == s.assigned_agent), None)
                if a is None or a.assignment is None or a.assignment.strategy_id != sid:
                    findings.append(
                        _finding(
                            "WARNING",
                            "ASSIGNMENT_MISMATCH",
                            f"{sid} lists Agent {s.assigned_agent:02d} but that agent does not report it",
                            "agents",
                            [sid, _slot_ref(s.assigned_agent)],
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
            target = strat_by_id.get(p.strategy_id)
            if target is None:
                findings.append(
                    _finding(
                        "INFO",
                        "UNRESOLVED_REFERENCE",
                        f"{p.proposal_id} references unknown strategy {p.strategy_id}",
                        "strategies",
                        [p.proposal_id, p.strategy_id],
                    )
                )
                continue
            versions = {x.version for x in target.versions}
            if p.state is ProposalState.RELEASED_AS_VERSION and (
                p.resulting_version is None or p.resulting_version not in versions
            ):
                findings.append(
                    _finding(
                        "WARNING",
                        "PROPOSAL_RELEASE_UNRESOLVED",
                        f"{p.proposal_id} is RELEASED_AS_VERSION but "
                        + (
                            "declares no resulting version"
                            if p.resulting_version is None
                            else f"v{p.resulting_version} does not exist in {p.strategy_id}"
                        ),
                        "strategies",
                        [p.strategy_id, p.proposal_id],
                    )
                )
            if p.resulting_version is not None and p.state is not ProposalState.RELEASED_AS_VERSION:
                findings.append(
                    _finding(
                        "WARNING",
                        "PROPOSAL_VERSION_BEFORE_RELEASE",
                        f"{p.proposal_id} is {p.state.value} but already declares resulting version v{p.resulting_version}",
                        "strategies",
                        [p.strategy_id, p.proposal_id],
                    )
                )

    # -- agents -------------------------------------------------------------
    if agents is not None:
        for a in agents.agents:
            label = f"Agent {a.slot:02d}"
            slot_ref = _slot_ref(a.slot)
            assigned_id = a.assignment.strategy_id if a.assignment else None
            refs = [slot_ref] + ([assigned_id] if assigned_id else [])
            # Alerts are checked for every agent, assigned or not, before anything can skip them.
            for al in a.alerts:
                if al.severity.value == "CRITICAL":
                    findings.append(_finding("CRITICAL", "AGENT_ALERT", f"{label}: {al.message}", "agents", refs))
            if a.assignment is None:
                if a.status in ACTIVE_AGENT_STATUSES:
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "AGENT_ACTIVE_WITHOUT_STRATEGY",
                            f"{label} is {a.status.value} with no assigned strategy",
                            "agents",
                            [slot_ref],
                        )
                    )
                if a.positions or a.orders or a.recent_trades:
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "AGENT_EXPOSURE_WITHOUT_STRATEGY",
                            f"{label} reports positions/orders/trades with no assigned strategy",
                            "agents",
                            [slot_ref],
                        )
                    )
                continue
            if strategies is None:
                if a.assignment.mode is AgentMode.LIVE or a.status is AgentStatus.LIVE:
                    findings.append(
                        _finding(
                            "CRITICAL",
                            "AGENT_LIVE_UNVERIFIABLE",
                            f"{label} is LIVE on {assigned_id} v{a.assignment.version} but the strategy registry is "
                            f"unavailable ({_status(sources.get('strategies'))}): its approval cannot be verified",
                            "agents",
                            refs,
                        )
                    )
                continue
            s = strat_by_id.get(assigned_id)
            if s is None:
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_STRATEGY_UNKNOWN",
                        f"{label} is assigned {assigned_id}, which is not in the strategy registry",
                        "agents",
                        [assigned_id, slot_ref],
                    )
                )
                continue
            v = next((x for x in s.versions if x.version == a.assignment.version), None)
            if v is None:
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_VERSION_UNKNOWN",
                        f"{label} runs {s.strategy_id} v{a.assignment.version}, which does not exist",
                        "agents",
                        [s.strategy_id, slot_ref],
                    )
                )
                continue
            approved = _approved(v)
            if not (v.validation_status is ValidationStatus.VALIDATED and approved and v.deployment_package):
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_ASSIGNMENT_NOT_ELIGIBLE",
                        f"{label} is assigned {s.strategy_id} v{v.version}, which is not validated, approved and "
                        "packaged",
                        "agents",
                        [s.strategy_id, slot_ref],
                    )
                )
            if a.assignment.mode is AgentMode.LIVE and not _live_scope(v):
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_LIVE_WITHOUT_LIVE_APPROVAL",
                        f"{label} is in LIVE mode without a LIVE-scope approval for {s.strategy_id} v{v.version}",
                        "agents",
                        [s.strategy_id, slot_ref],
                    )
                )
            if v.status in WITHDRAWN_STATUSES or s.status in WITHDRAWN_STATUSES:
                what = f"v{v.version} is {v.status.value}" if v.status in WITHDRAWN_STATUSES else f"the strategy is {s.status.value}"
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_RUNS_WITHDRAWN_VERSION",
                        f"{label} runs {s.strategy_id} v{v.version}, but {what}",
                        "agents",
                        [s.strategy_id, slot_ref],
                    )
                )
            elif v.version != s.current_version:
                findings.append(
                    _finding(
                        "WARNING",
                        "AGENT_RUNS_NON_CURRENT_VERSION",
                        f"{label} runs {s.strategy_id} v{v.version}; the registry's current version is v{s.current_version}",
                        "agents",
                        [s.strategy_id, slot_ref],
                    )
                )

    # -- agent activity vs the event stream ----------------------------------
    if _events_ok(events):
        by_slot = {a.slot: a for a in agents.agents} if agents is not None else {}
        per_slot: dict[int, list[Any]] = {}
        last_change: dict[int, datetime] = {}
        for e in events.events:
            per_slot.setdefault(e.agent_slot, []).append(e)
            if e.kind is AgentEventKind.STATE_CHANGE:
                last_change[e.agent_slot] = e.ts
        for slot, evs in sorted(per_slot.items()):
            slot_ref = _slot_ref(slot)
            since = last_change.get(slot)
            trading = [
                e
                for e in evs
                if (e.kind in TRADING_EVENT_KINDS or e.mode in TRADING_EVENT_MODES) and (since is None or e.ts >= since)
            ]
            if not trading:
                continue
            kinds = ", ".join(sorted({e.kind.value for e in trading}))
            modes = ", ".join(sorted({e.mode.value for e in trading}))
            scope = " since the slot's last STATE_CHANGE event" if since is not None else ""
            if agents is None:
                findings.append(
                    _finding(
                        "WARNING",
                        "AGENT_ACTIVITY_UNVERIFIABLE",
                        f"Agent {slot:02d}: event stream records {len(trading)} trading event(s) ({kinds}; mode {modes}) "
                        f"but agents.json is {_status(sources.get('agents'))}, so its assignment cannot be verified",
                        "agents",
                        [slot_ref],
                    )
                )
                continue
            a = by_slot.get(slot)
            if a is None or a.assignment is None or a.status is AgentStatus.SLEEPING:
                why = (
                    "agents.json does not report this slot"
                    if a is None
                    else ("agents.json reports it SLEEPING" if a.status is AgentStatus.SLEEPING else "it has no assigned strategy")
                )
                findings.append(
                    _finding(
                        "CRITICAL",
                        "AGENT_ACTIVITY_WITHOUT_STRATEGY",
                        f"Agent {slot:02d}: event stream records {len(trading)} trading event(s){scope} "
                        f"({kinds}; mode {modes}) but {why}",
                        "agents",
                        [slot_ref],
                    )
                )
                continue
            asg = a.assignment
            mismatched = [
                e
                for e in trading
                if e.ts >= asg.assigned_at
                and e.refs.strategy_id is not None
                and (e.refs.strategy_id != asg.strategy_id or (e.refs.version is not None and e.refs.version != asg.version))
            ]
            if mismatched:
                cited = ", ".join(sorted({f"{e.refs.strategy_id} v{e.refs.version}" for e in mismatched}))
                findings.append(
                    _finding(
                        "WARNING",
                        "EVENT_STRATEGY_MISMATCH",
                        f"Agent {slot:02d}: {len(mismatched)} event(s) since its assignment cite {cited}, "
                        f"not the assigned {asg.strategy_id} v{asg.version}",
                        "agents",
                        [slot_ref, asg.strategy_id],
                    )
                )

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
        if strategies is None:
            findings.append(
                _finding(
                    "CRITICAL",
                    "LIVE_ENABLED_APPROVAL_UNVERIFIABLE",
                    "Live trading enabled; LIVE-scope approval cannot be verified: strategies.json "
                    f"{_status(sources.get('strategies'))}",
                    "live",
                )
            )
        elif not any(_live_scope(_current(s)) for s in strat_by_id.values()):
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
            refs = [_slot_ref(b.agent_slot)] if b.agent_slot else []
            findings.append(
                _finding(b.severity.value, "RISK_BREACH", f"{b.limit_key}: {b.detail or 'breach'}", "risk", refs)
            )

    # -- heartbeat freshness (only against a declared bound) -----------------
    for key, fr in (freshness or {}).items():
        if fr and fr["stale"]:
            stale = [i for i in fr["items"] if i["stale"]]
            findings.append(
                _finding(
                    "WARNING",
                    "HEARTBEAT_STALE",
                    f"{DOCUMENTS[key][0]}: {len(stale)} heartbeat(s) older than the declared "
                    f"{fr['max_age_s']}s bound — " + ", ".join(i["label"] for i in stale[:6])
                    + (" …" if len(stale) > 6 else ""),
                    "live" if key in ("live", "execution") else ("agents" if key == "agents" else "data"),
                    fr["stale"],
                )
            )

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
            elif m.validation_state == "VALIDATED" and not supporting:
                findings.append(
                    _finding(
                        "WARNING",
                        "MEMORY_VALIDATED_WITHOUT_EVIDENCE",
                        f"{m.memory_id} is VALIDATED with no supporting evidence attached",
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


def derive_all(
    sources: dict[str, SourceResult], events: EventsResult | None, now: datetime | None = None
) -> dict[str, Any]:
    """Every derivation, each isolated: one malformed record can fail only its own section,
    which is then reported (``derived.errors`` + a DERIVATION_ERROR finding), never the snapshot."""
    now = now or datetime.now(timezone.utc)
    errors: list[dict[str, str]] = []

    def safe(section: str, fn: Callable[[], Any], fallback: Any) -> Any:
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — isolate, report, never take the snapshot down
            log.exception("derivation %s failed", section)
            errors.append({"section": section, "error": f"{type(exc).__name__}: {exc}"})
            return fallback

    research: ResearchState | None = _data(sources.get("research"))
    strategies: StrategiesState | None = _data(sources.get("strategies"))
    agents: AgentsState | None = _data(sources.get("agents"))
    memory: MemoryState | None = _data(sources.get("memory"))
    unavailable = {"available": False, "error": "derivation failed"}
    agents_phrase = source_phrase(sources.get("agents"), "Agent runtime")
    handoffs = safe(
        "handoffs",
        lambda: [derive_handoff(s, agents, agents_phrase) for s in strategies.strategies] if strategies else [],
        [],
    )
    freshness = safe("freshness", lambda: derive_freshness(sources, now), {})
    consistency = safe("consistency", lambda: derive_consistency(sources, events, freshness), [])
    origins = {k: s.meta.origin.value for k, s in sources.items() if s.meta is not None}
    out = {
        "system": safe("system", lambda: derive_system(sources, events), []),
        "pipeline": safe("pipeline", lambda: derive_pipeline(research, strategies), unavailable),
        "trial_accounting": safe("trial_accounting", lambda: derive_trial_accounting(research), unavailable),
        "research_summary": safe(
            "research_summary",
            lambda: derive_research_summary(research, strategies),
            {"research_available": False, "strategies_available": False},
        ),
        "handoffs": handoffs,
        "agent_slots": safe(
            "agent_slots", lambda: derive_agent_slots(sources.get("agents"), strategies, events, freshness), []
        ),
        "memory_stats": safe("memory_stats", lambda: derive_memory_stats(memory), {"available": False}),
        "knowledge_graph": safe(
            "knowledge_graph", lambda: derive_knowledge_graph(research, strategies, memory), unavailable
        ),
        "learning": safe("learning", lambda: derive_learning(events, strategies), {"stages": []}),
        "controls": safe(
            "controls", lambda: derive_controls(sources.get("strategies"), sources.get("agents"), handoffs), None
        ),
        "freshness": freshness,
        "check_coverage": safe("check_coverage", lambda: derive_check_coverage(sources, events, freshness), []),
        "validation_requirements": list(REQUIRED_VALIDATION_CHECKS),
        "document_origins": origins,
        "reconstructed_sources": sorted(k for k, o in origins.items() if o == Origin.RECONSTRUCTED.value),
    }
    for e in errors:
        consistency.append(
            _finding(
                "CRITICAL" if e["section"] == "consistency" else "WARNING",
                "DERIVATION_ERROR",
                f"Derived section '{e['section']}' could not be computed from the declared state: {e['error']}",
                "governance",
                [e["section"]],
            )
        )
    out["errors"] = errors
    out["consistency"] = consistency
    out["alert_counts"] = dict(Counter(f["severity"] for f in consistency))
    out["synthetic"] = any(f["code"] == "SYNTHETIC_FIXTURE_LOADED" for f in consistency) or any(
        o == Origin.SYNTHETIC_FIXTURE.value for o in origins.values()
    )
    return out
