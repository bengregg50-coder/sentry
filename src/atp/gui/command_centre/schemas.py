"""SENTRY Command Centre state contract (v1).

The Command Centre is an observability and control surface. It never authors
SENTRY state. Producers (research engine, validation, deployment, agents,
execution, data pipeline) write *documents* that conform to the models in this
module; the Command Centre validates and renders them.

Design rules encoded here:

* Absence is information. Every value a producer has not reported is ``None``
  and is rendered as empty — never coerced to zero.
* Provenance is mandatory. Every document carries a :class:`DocumentMeta`
  envelope whose ``origin`` distinguishes ORIGINAL evidence from RECONSTRUCTED
  material and from SYNTHETIC_FIXTURE test data.
* Metrics carry their basis (in-sample, out-of-sample, live, ...), so an
  in-sample number can never be displayed as validation evidence.
* Unknown fields are rejected (``extra="forbid"``) so contract drift between
  producer and UI is visible as an INVALID source rather than silently lost.
* Timestamps must carry a timezone and numbers must be finite. A naive
  timestamp or a NaN/Infinity makes the document INVALID with an explicit error
  instead of being silently served as ``null`` (or crashing a comparison).
* Time series (equity curves, bars) must be strictly ascending in time with no
  duplicate timestamps.

The JSON Schemas exported from these models (see :mod:`.contract`) are the
artefact producers should validate against.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

CONTRACT_VERSION = "1"

AGENT_SLOTS = (1, 2, 3, 4, 5)


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, use_enum_values=False, allow_inf_nan=False)


def _strictly_ascending(points: list, name: str) -> list:
    """Series must be ordered oldest → newest with unique timestamps (charts cannot plot anything else)."""
    for prev, cur in zip(points, points[1:]):
        if cur.t <= prev.t:
            raise ValueError(
                f"{name} must be strictly ascending in time with unique timestamps "
                f"({cur.t.isoformat()} follows {prev.t.isoformat()})"
            )
    return points


# ---------------------------------------------------------------------------
# Shared vocabulary
# ---------------------------------------------------------------------------


class Origin(str, Enum):
    """Where a record came from. Never merge counts across origins."""

    ORIGINAL = "ORIGINAL"  # produced at the time by the governed process
    RECONSTRUCTED = "RECONSTRUCTED"  # rebuilt after source loss; not sealed evidence
    SYNTHETIC_FIXTURE = "SYNTHETIC_FIXTURE"  # test/design data; never SENTRY state


class Severity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class Stage(str, Enum):
    """The research → deployment pipeline, in order."""

    DISCOVERY = "DISCOVERY"
    HYPOTHESIS = "HYPOTHESIS"
    BACKTEST = "BACKTEST"
    ROBUSTNESS = "ROBUSTNESS"
    OOS = "OOS"
    VALIDATION = "VALIDATION"
    APPROVED = "APPROVED"
    SIM = "SIM"
    LIVE = "LIVE"
    SCALED = "SCALED"


PIPELINE_STAGES: tuple[Stage, ...] = tuple(Stage)


class Terminal(str, Enum):
    """How an item stopped progressing. ``None`` on an item means still active."""

    REJECTED = "REJECTED"
    BLOCKED_BY_DATA = "BLOCKED_BY_DATA"
    PENDING = "PENDING"  # awaiting more evidence
    ABANDONED = "ABANDONED"  # dropped by researcher decision (still a counted trial)
    RETIRED = "RETIRED"  # previously deployed, withdrawn


class CheckState(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    PENDING = "PENDING"
    NOT_RUN = "NOT_RUN"
    BLOCKED = "BLOCKED"
    INCONCLUSIVE = "INCONCLUSIVE"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class Basis(str, Enum):
    """What evidence a metric was computed on."""

    IN_SAMPLE = "IN_SAMPLE"
    OUT_OF_SAMPLE = "OUT_OF_SAMPLE"
    WALK_FORWARD = "WALK_FORWARD"
    MONTE_CARLO = "MONTE_CARLO"
    SIMULATION = "SIMULATION"
    PAPER = "PAPER"
    LIVE = "LIVE"


class Window(Model):
    label: str | None = None
    role: (
        Literal[
            "DISCOVERY",
            "IN_SAMPLE",
            "PRIMARY_EVIDENCE",
            "CONFIRMATION",
            "HOLDOUT",
            "OUT_OF_SAMPLE",
            "IMPLEMENTATION_VERIFICATION",
            "OTHER",
        ]
        | None
    ) = None
    start: date | None = None
    end: date | None = None


class Metric(Model):
    """A single reported number with its basis and provenance."""

    value: float
    unit: Literal["ratio", "pct", "bps", "count", "currency", "contracts", "ms", "days", "years"]
    basis: Basis
    component: Literal["GROSS", "COST", "NET"] | None = None
    cost_multiplier: float | None = Field(default=None, gt=0)
    currency: str | None = None
    window_start: date | None = None
    window_end: date | None = None
    source_ref: str | None = None


class NamedMetric(Model):
    key: str
    label: str
    metric: Metric


class LineageRef(Model):
    kind: Literal[
        "PROGRAMME", "HYPOTHESIS", "TRIAL", "STRATEGY_VERSION", "MEMORY", "PROPOSAL", "DOCUMENT", "LITERATURE"
    ]
    ref: str
    note: str | None = None


class Check(Model):
    state: CheckState
    detail: str | None = None
    evidence_refs: list[str] = Field(default_factory=list)
    checked_at: AwareDatetime | None = None


# ---------------------------------------------------------------------------
# Document envelope
# ---------------------------------------------------------------------------


class DocumentMeta(Model):
    schema_version: Literal["1"]
    producer: str = Field(min_length=1)
    generated_at: AwareDatetime
    origin: Origin
    #: Producer-declared freshness bound: a heartbeat in this document older than this many
    #: seconds means the producer is stale. ``None`` = no bound declared (staleness is not judged).
    heartbeat_max_age_s: int | None = Field(default=None, gt=0)
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# system.json
# ---------------------------------------------------------------------------


class SubsystemKey(str, Enum):
    RESEARCH_ENGINE = "research_engine"
    TRADING_ENGINE = "trading_engine"
    AGENT_NETWORK = "agent_network"
    DATA = "data"
    GOVERNANCE = "governance"
    MEMORY = "memory"


class SubsystemState(str, Enum):
    ONLINE = "ONLINE"
    DEGRADED = "DEGRADED"
    OFFLINE = "OFFLINE"
    IDLE = "IDLE"
    NOT_BUILT = "NOT_BUILT"
    UNKNOWN = "UNKNOWN"


class SubsystemStatus(Model):
    key: SubsystemKey
    state: SubsystemState
    detail: str | None = None
    version: str | None = None
    heartbeat_at: AwareDatetime | None = None


class SystemState(Model):
    subsystems: list[SubsystemStatus] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> SystemState:
        keys = [s.key for s in self.subsystems]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate subsystem key")
        return self


# ---------------------------------------------------------------------------
# research.json
# ---------------------------------------------------------------------------


class ProgrammeStatus(str, Enum):
    PROPOSED = "PROPOSED"
    SPEC_DRAFT = "SPEC_DRAFT"
    SPEC_FROZEN = "SPEC_FROZEN"
    RUNNING = "RUNNING"
    COMPLETE = "COMPLETE"
    SEALED = "SEALED"
    DEFERRED = "DEFERRED"
    ABANDONED = "ABANDONED"


class Programme(Model):
    programme_id: str
    name: str
    family: str | None = None
    mechanism: str | None = None
    status: ProgrammeStatus
    outcome: str | None = None
    universe_status: Literal["PROVISIONAL", "VERIFIED", "FROZEN"] | None = None
    spec_ref: str | None = None
    spec_hash: str | None = None
    frozen_at: AwareDatetime | None = None
    sealed_at: AwareDatetime | None = None
    evaluation_windows: list[Window] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    origin: Origin


class HypothesisStatus(str, Enum):
    PROPOSED = "PROPOSED"
    PREREGISTERED = "PREREGISTERED"
    TESTING = "TESTING"
    PENDING = "PENDING"
    REJECTED = "REJECTED"
    BLOCKED_BY_DATA = "BLOCKED_BY_DATA"
    VALIDATED = "VALIDATED"
    ABANDONED = "ABANDONED"


class Hypothesis(Model):
    hypothesis_id: str
    title: str
    programme_id: str | None = None
    family: str | None = None
    statement: str | None = None
    mechanism: str | None = None
    economic_rationale: str | None = None
    status: HypothesisStatus
    stage_reached: Stage
    terminal: Terminal | None = None
    preregistered_at: AwareDatetime | None = None
    prereg_ref: str | None = None
    created_at: AwareDatetime | None = None
    decided_at: AwareDatetime | None = None
    decision_reason: str | None = None
    strategy_id: str | None = None
    trial_numbers: list[int] = Field(default_factory=list)
    origin: Origin


class TrialKind(str, Enum):
    DISCOVERY = "DISCOVERY"
    BACKTEST = "BACKTEST"
    ROBUSTNESS = "ROBUSTNESS"
    COST_SENSITIVITY = "COST_SENSITIVITY"
    PARAMETER_STABILITY = "PARAMETER_STABILITY"
    REGIME = "REGIME"
    OOS = "OOS"
    WALK_FORWARD = "WALK_FORWARD"
    MONTE_CARLO = "MONTE_CARLO"
    VALIDATION = "VALIDATION"
    DATA_CHECK = "DATA_CHECK"
    OTHER = "OTHER"


class TrialOutcome(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    INCONCLUSIVE = "INCONCLUSIVE"
    RUNNING = "RUNNING"
    BLOCKED = "BLOCKED"
    VOID = "VOID"


class EvidenceState(str, Enum):
    ORIGINAL = "ORIGINAL"
    RECONSTRUCTED = "RECONSTRUCTED"
    LOST = "LOST"
    PENDING = "PENDING"


class Trial(Model):
    trial_id: str
    trial_number: int | None = Field(default=None, ge=1)
    programme_id: str | None = None
    hypothesis_id: str | None = None
    family: str | None = None
    experiment: str | None = None  # free-text label
    #: Identity of the experiment this trial belongs to; memory ``experiment_ids`` /
    #: ``related_experiments`` and EXPERIMENT evidence resolve against this or ``trial_id``.
    experiment_id: str | None = None
    kind: TrialKind
    stage: Stage
    outcome: TrialOutcome
    rejection_reason: str | None = None
    evidence_state: EvidenceState
    oos_state: CheckState | None = None
    validation_state: CheckState | None = None
    started_at: AwareDatetime | None = None
    recorded_at: AwareDatetime | None = None
    data_used: list[str] = Field(default_factory=list)
    window_start: date | None = None
    window_end: date | None = None
    metrics: list[NamedMetric] = Field(default_factory=list)
    lineage: list[LineageRef] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    origin: Origin


class TrialAccounting(Model):
    """Declared by the research ledger. The UI cross-checks; it never recomputes."""

    reconstructed_baseline: int | None = Field(default=None, ge=0)
    live_recorded: int | None = Field(default=None, ge=0)
    global_count: int | None = Field(default=None, ge=0)
    ledger_ref: str | None = None
    ledger_hash: str | None = None
    sealed_evidence_separate: bool | None = None
    as_of: AwareDatetime | None = None
    notes: list[str] = Field(default_factory=list)


class IntegrityNotice(Model):
    notice_id: str
    severity: Severity
    title: str
    detail: str | None = None
    occurred_on: date | None = None
    reference: str | None = None
    affects: list[str] = Field(default_factory=list)


class ResearchAreaStatus(str, Enum):
    CANDIDATE_AREA = "CANDIDATE_AREA"
    ACTIVE = "ACTIVE"
    DEFERRED = "DEFERRED"
    EXHAUSTED = "EXHAUSTED"


class ResearchArea(Model):
    area_id: str
    name: str
    mechanism_class: str | None = None
    status: ResearchAreaStatus
    rationale: str | None = None
    literature: list[str] = Field(default_factory=list)
    programme_ids: list[str] = Field(default_factory=list)


class ResearchRole(str, Enum):
    LEAD_RESEARCHER = "LEAD_RESEARCHER"
    QUANT_RESEARCHER = "QUANT_RESEARCHER"
    DATA_ANALYST = "DATA_ANALYST"
    CODER = "CODER"
    BACKTESTER = "BACKTESTER"
    ADVERSARIAL_REFEREE = "ADVERSARIAL_REFEREE"
    GOVERNANCE = "GOVERNANCE"


class RoleStatus(Model):
    role: ResearchRole
    state: Literal["NOT_BUILT", "IDLE", "ACTIVE", "BLOCKED", "OFFLINE"]
    detail: str | None = None
    last_activity_at: AwareDatetime | None = None


class ResearchFocus(Model):
    programme_id: str | None = None
    hypothesis_id: str | None = None
    family: str | None = None  # the current research family, as the research engine declares it
    summary: str | None = None
    next_action: str | None = None


class ResearchState(Model):
    focus: ResearchFocus | None = None
    programmes: list[Programme] = Field(default_factory=list)
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    trials: list[Trial] = Field(default_factory=list)
    trial_accounting: TrialAccounting | None = None
    integrity_notices: list[IntegrityNotice] = Field(default_factory=list)
    research_areas: list[ResearchArea] = Field(default_factory=list)
    roles: list[RoleStatus] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# strategies.json
# ---------------------------------------------------------------------------


class StrategyStatus(str, Enum):
    CANDIDATE = "CANDIDATE"
    IN_VALIDATION = "IN_VALIDATION"
    VALIDATED = "VALIDATED"
    APPROVED = "APPROVED"
    DEPLOYED_SIM = "DEPLOYED_SIM"
    DEPLOYED_LIVE = "DEPLOYED_LIVE"
    SCALED = "SCALED"
    RETIRED = "RETIRED"
    REJECTED = "REJECTED"


class ValidationStatus(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    VALIDATED = "VALIDATED"
    FAILED = "FAILED"


class StrategyMetrics(Model):
    expected_return: Metric | None = None
    gross_return: Metric | None = None
    costs: Metric | None = None
    net_return: Metric | None = None
    expectancy: Metric | None = None
    sharpe: Metric | None = None
    sortino: Metric | None = None
    max_drawdown: Metric | None = None
    trade_count: Metric | None = None
    win_rate: Metric | None = None
    slippage: Metric | None = None
    capacity: Metric | None = None
    additional: list[NamedMetric] = Field(default_factory=list)


class ValidationChecks(Model):
    """Each check is ``None`` until the research engine reports it."""

    economic_rationale: Check | None = None
    positive_expectancy: Check | None = None
    realistic_costs: Check | None = None
    cost_sensitivity: Check | None = None
    robustness: Check | None = None
    parameter_stability: Check | None = None
    regime_analysis: Check | None = None
    out_of_sample: Check | None = None
    walk_forward: Check | None = None
    monte_carlo: Check | None = None
    multiple_testing: Check | None = None
    execution_realism: Check | None = None
    sample_size: Check | None = None


class MultipleTesting(Model):
    state: CheckState
    method: str | None = None
    trials_in_family: int | None = Field(default=None, ge=0)
    global_trials_at_decision: int | None = Field(default=None, ge=0)
    adjusted_threshold: float | None = None
    deflated_sharpe: float | None = None
    detail: str | None = None


class Approval(Model):
    decision: Literal["APPROVED", "REJECTED", "REVOKED"]
    scope: Literal["SIM", "PAPER", "LIVE_SMALL", "LIVE"]
    decided_at: AwareDatetime
    decided_by: str
    decision_ref: str | None = None
    conditions: list[str] = Field(default_factory=list)


class DeploymentPackage(Model):
    package_id: str
    created_at: AwareDatetime
    spec_hash: str | None = None
    data_identity: str | None = None
    executor_identity: str | None = None
    cost_model_identity: str | None = None
    risk_limits_ref: str | None = None
    notes: list[str] = Field(default_factory=list)


class RegimeResult(Model):
    regime: str
    window: Window | None = None
    metrics: list[NamedMetric] = Field(default_factory=list)
    state: CheckState | None = None


class StrategyVersion(Model):
    version: int = Field(ge=1)
    status: StrategyStatus
    created_at: AwareDatetime
    parent_version: int | None = Field(default=None, ge=1)
    change_summary: str | None = None
    change_rationale: str | None = None
    proposed_by: str | None = None
    proposal_id: str | None = None
    spec_ref: str | None = None
    spec_hash: str | None = None
    lineage: list[LineageRef] = Field(default_factory=list)
    metrics: StrategyMetrics = Field(default_factory=StrategyMetrics)
    validation_status: ValidationStatus = ValidationStatus.NOT_STARTED
    validation: ValidationChecks = Field(default_factory=ValidationChecks)
    multiple_testing: MultipleTesting | None = None
    regimes: list[RegimeResult] = Field(default_factory=list)
    approval: Approval | None = None
    deployment_package: DeploymentPackage | None = None


class Strategy(Model):
    strategy_id: str
    name: str
    mechanism: str | None = None
    economic_rationale: str | None = None
    market: str | None = None
    instrument: str | None = None
    timeframe: str | None = None
    status: StrategyStatus
    current_version: int = Field(ge=1)
    versions: list[StrategyVersion] = Field(min_length=1)
    assigned_agent: int | None = Field(default=None, ge=1, le=5)
    last_update: AwareDatetime | None = None
    #: Furthest research → deployment stage the research engine declares this strategy reached,
    #: and how it stopped. Optional: when absent the Command Centre does not infer pre-validation
    #: research stages from the registry status.
    stage_reached: Stage | None = None
    terminal: Terminal | None = None
    origin: Origin

    @model_validator(mode="after")
    def _versions(self) -> Strategy:
        numbers = [v.version for v in self.versions]
        if len(numbers) != len(set(numbers)):
            raise ValueError(f"{self.strategy_id}: duplicate version numbers")
        if self.current_version not in numbers:
            raise ValueError(f"{self.strategy_id}: current_version {self.current_version} not in versions")
        for v in self.versions:
            if v.parent_version is not None and v.parent_version not in numbers:
                raise ValueError(f"{self.strategy_id} v{v.version}: parent v{v.parent_version} missing")
            if v.parent_version is not None and v.parent_version >= v.version:
                raise ValueError(f"{self.strategy_id} v{v.version}: parent must be an earlier version")
        return self


class ProposalState(str, Enum):
    PROPOSED = "PROPOSED"
    IN_RESEARCH = "IN_RESEARCH"
    REJECTED = "REJECTED"
    VALIDATED = "VALIDATED"
    APPROVED = "APPROVED"
    RELEASED_AS_VERSION = "RELEASED_AS_VERSION"


class ImprovementProposal(Model):
    """A proposed change. It can only ever become a *new* strategy version."""

    proposal_id: str
    proposed_at: AwareDatetime
    proposed_by: str
    agent_slot: int | None = Field(default=None, ge=1, le=5)
    strategy_id: str
    base_version: int = Field(ge=1)
    summary: str
    rationale: str | None = None
    evidence_refs: list[str] = Field(default_factory=list)
    state: ProposalState
    resulting_version: int | None = Field(default=None, ge=1)


class StrategiesState(Model):
    strategies: list[Strategy] = Field(default_factory=list)
    proposals: list[ImprovementProposal] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> StrategiesState:
        ids = [s.strategy_id for s in self.strategies]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate strategy_id")
        return self


# ---------------------------------------------------------------------------
# agents.json  (+ agent_events.jsonl)
# ---------------------------------------------------------------------------


class AgentStatus(str, Enum):
    SLEEPING = "SLEEPING"
    STANDBY = "STANDBY"
    SIMULATING = "SIMULATING"
    PAPER = "PAPER"
    LIVE = "LIVE"
    PAUSED = "PAUSED"
    HALTED = "HALTED"
    ERROR = "ERROR"


class AgentMode(str, Enum):
    RESEARCH = "RESEARCH"
    SIM = "SIM"
    PAPER = "PAPER"
    LIVE = "LIVE"


class AgentAssignment(Model):
    strategy_id: str
    version: int = Field(ge=1)
    mode: AgentMode
    assigned_at: AwareDatetime
    approval_ref: str | None = None
    package_id: str | None = None


class SignalState(Model):
    state: Literal["NO_SIGNAL", "FLAT", "LONG", "SHORT"]
    as_of: AwareDatetime
    detail: str | None = None


class Position(Model):
    instrument: str
    side: Literal["LONG", "SHORT"]
    quantity: float = Field(gt=0)
    avg_price: float | None = None
    unrealized_pnl: Metric | None = None
    mode: AgentMode
    as_of: AwareDatetime


class Order(Model):
    order_id: str
    instrument: str
    side: Literal["BUY", "SELL"]
    quantity: float = Field(gt=0)
    order_type: Literal["MARKET", "LIMIT", "STOP", "STOP_LIMIT", "OTHER"]
    limit_price: float | None = None
    status: Literal["WORKING", "PARTIAL", "FILLED", "CANCELLED", "REJECTED"]
    mode: AgentMode
    submitted_at: AwareDatetime
    agent_slot: int | None = Field(default=None, ge=1, le=5)


class Trade(Model):
    trade_id: str
    instrument: str
    side: Literal["BUY", "SELL"]
    quantity: float = Field(gt=0)
    price: float
    executed_at: AwareDatetime
    mode: AgentMode
    slippage_bps: float | None = None
    pnl: Metric | None = None
    agent_slot: int | None = Field(default=None, ge=1, le=5)


class PnL(Model):
    mode: AgentMode
    as_of: AwareDatetime
    realized: Metric | None = None
    unrealized: Metric | None = None
    day: Metric | None = None


class SeriesPoint(Model):
    t: AwareDatetime
    v: float


class RiskLimit(Model):
    key: str
    label: str
    limit: float
    used: float | None = None
    unit: Literal["ratio", "pct", "bps", "count", "currency", "contracts"]
    currency: str | None = None  # ISO code when unit == "currency"
    state: Literal["OK", "WARN", "BREACH", "UNKNOWN"]


class ExecutionStats(Model):
    as_of: AwareDatetime
    latency_ms_p50: float | None = None
    latency_ms_p95: float | None = None
    slippage_bps_mean: float | None = None
    slippage_model_bps: float | None = None
    fills: int | None = Field(default=None, ge=0)
    rejects: int | None = Field(default=None, ge=0)


class ConnectionState(str, Enum):
    CONNECTED = "CONNECTED"
    DEGRADED = "DEGRADED"
    DISCONNECTED = "DISCONNECTED"
    NOT_CONFIGURED = "NOT_CONFIGURED"


class Connection(Model):
    name: str
    kind: Literal["MARKET_DATA", "BROKER", "RESEARCH_BUS", "MEMORY", "OTHER"]
    state: ConnectionState
    last_heartbeat: AwareDatetime | None = None
    detail: str | None = None


class Alert(Model):
    alert_id: str
    at: AwareDatetime
    severity: Severity
    message: str
    ref: str | None = None


class Bar(Model):
    t: AwareDatetime
    o: float
    h: float
    l: float  # noqa: E741
    c: float
    v: float | None = None


class AgentState(Model):
    slot: int = Field(ge=1, le=5)
    status: AgentStatus
    codename: str | None = None
    specialisation: str | None = None
    status_detail: str | None = None
    assignment: AgentAssignment | None = None
    market: str | None = None
    timeframe: str | None = None
    signal: SignalState | None = None
    positions: list[Position] = Field(default_factory=list)
    orders: list[Order] = Field(default_factory=list)
    recent_trades: list[Trade] = Field(default_factory=list)
    pnl: PnL | None = None
    equity: list[SeriesPoint] = Field(default_factory=list)
    drawdown: Metric | None = None
    risk_limits: list[RiskLimit] = Field(default_factory=list)
    execution: ExecutionStats | None = None
    connections: list[Connection] = Field(default_factory=list)
    alerts: list[Alert] = Field(default_factory=list)
    memory_refs: list[str] = Field(default_factory=list)
    bars: list[Bar] = Field(default_factory=list)
    last_heartbeat: AwareDatetime | None = None

    @field_validator("equity")
    @classmethod
    def _equity_ordered(cls, v: list[SeriesPoint]) -> list[SeriesPoint]:
        return _strictly_ascending(v, "equity")

    @field_validator("bars")
    @classmethod
    def _bars_ordered(cls, v: list[Bar]) -> list[Bar]:
        return _strictly_ascending(v, "bars")


class AgentsState(Model):
    agents: list[AgentState] = Field(default_factory=list)

    @model_validator(mode="after")
    def _slots(self) -> AgentsState:
        slots = [a.slot for a in self.agents]
        if len(slots) != len(set(slots)):
            raise ValueError("duplicate agent slot")
        return self


class AgentEventKind(str, Enum):
    OBSERVATION = "OBSERVATION"
    INTERPRETATION = "INTERPRETATION"
    MEMORY_RECALL = "MEMORY_RECALL"
    HYPOTHESIS = "HYPOTHESIS"
    TEST = "TEST"
    EVALUATION = "EVALUATION"
    LEARNING = "LEARNING"
    MEMORY_WRITE = "MEMORY_WRITE"
    PROPOSAL = "PROPOSAL"
    #: An agent tested whether a shared memory applies to its own market/strategy
    #: (refs.memory_ids names the memory under test).
    APPLICABILITY_TEST = "APPLICABILITY_TEST"
    SIGNAL_EVALUATION = "SIGNAL_EVALUATION"
    NO_TRADE = "NO_TRADE"
    DECISION = "DECISION"
    ORDER = "ORDER"
    FILL = "FILL"
    RESEARCH_OBSERVATION = "RESEARCH_OBSERVATION"
    STATE_CHANGE = "STATE_CHANGE"
    ALERT = "ALERT"
    ERROR = "ERROR"


class EventRefs(Model):
    memory_ids: list[str] = Field(default_factory=list)
    strategy_id: str | None = None
    version: int | None = None
    trial_ids: list[str] = Field(default_factory=list)
    hypothesis_ids: list[str] = Field(default_factory=list)
    programme_id: str | None = None
    order_id: str | None = None
    proposal_id: str | None = None


class AgentEvent(Model):
    """One line of ``agent_events.jsonl`` (append-only)."""

    event_id: str
    ts: AwareDatetime
    agent_slot: int = Field(ge=1, le=5)
    kind: AgentEventKind
    mode: AgentMode
    summary: str
    detail: str | None = None
    refs: EventRefs = Field(default_factory=EventRefs)
    origin: Origin


# ---------------------------------------------------------------------------
# memory.json
# ---------------------------------------------------------------------------


class MemoryType(str, Enum):
    FINDING = "FINDING"
    LESSON = "LESSON"
    FAILED_MECHANISM = "FAILED_MECHANISM"
    FAILED_HYPOTHESIS = "FAILED_HYPOTHESIS"
    REJECTED_ASSUMPTION = "REJECTED_ASSUMPTION"
    REGIME_OBSERVATION = "REGIME_OBSERVATION"
    EXECUTION_OBSERVATION = "EXECUTION_OBSERVATION"
    VOLATILITY_OBSERVATION = "VOLATILITY_OBSERVATION"
    USEFUL_FEATURE = "USEFUL_FEATURE"
    DANGEROUS_FEATURE = "DANGEROUS_FEATURE"
    PARAMETER_SENSITIVITY = "PARAMETER_SENSITIVITY"
    STRATEGY_INTERACTION = "STRATEGY_INTERACTION"
    DATA_NOTE = "DATA_NOTE"


class EvidenceItem(Model):
    evidence_id: str
    kind: Literal[
        "EXPERIMENT",
        "TRIAL",
        "BACKTEST",
        "OUT_OF_SAMPLE",
        "ROBUSTNESS",
        "COST_SENSITIVITY",
        "SIMULATION",
        "LIVE_OBSERVATION",
        "LITERATURE",
        "DOCUMENT",
    ]
    ref: str
    stance: Literal["SUPPORTS", "CONTRADICTS", "NEUTRAL"]
    result: CheckState | None = None
    summary: str | None = None
    independent: bool | None = None
    recorded_at: AwareDatetime | None = None


class MemorySource(Model):
    actor: Literal["RESEARCH_ENGINE", "AGENT", "HUMAN", "VALIDATION", "EXECUTION"]
    agent_slot: int | None = Field(default=None, ge=1, le=5)
    programme_id: str | None = None
    experiment_ids: list[str] = Field(default_factory=list)
    trial_ids: list[str] = Field(default_factory=list)


class Memory(Model):
    memory_id: str
    type: MemoryType
    title: str
    created_at: AwareDatetime
    source: MemorySource
    hypothesis: str | None = None
    observation: str | None = None
    evidence: list[EvidenceItem] = Field(default_factory=list)
    oos: CheckState | None = None
    robustness: CheckState | None = None
    cost_sensitivity: CheckState | None = None
    confidence: Literal["HIGH", "MEDIUM", "LOW", "UNRATED"]
    validation_state: Literal["VALIDATED", "PROVISIONAL", "UNVERIFIED", "CONTRADICTED", "REJECTED"]
    status: Literal["RETAIN", "REVIEW", "DEPRECATED", "REJECTED"]
    related_strategies: list[str] = Field(default_factory=list)
    related_experiments: list[str] = Field(default_factory=list)
    related_memories: list[str] = Field(default_factory=list)
    last_reviewed: AwareDatetime | None = None
    origin: Origin


class MemoryState(Model):
    memories: list[Memory] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> MemoryState:
        ids = [m.memory_id for m in self.memories]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate memory_id")
        return self


# ---------------------------------------------------------------------------
# governance.json
# ---------------------------------------------------------------------------


class GovernanceCheckKey(str, Enum):
    TRIAL_ACCOUNTING = "trial_accounting"
    GLOBAL_TRIAL_COUNT = "global_trial_count"
    RESEARCH_LIVE_SEPARATION = "research_live_separation"
    OOS_SEPARATION = "oos_separation"
    MULTIPLE_TESTING = "multiple_testing"
    REFEREE = "referee"
    DATA_INTEGRITY = "data_integrity"
    DATASET_IDENTITY = "dataset_identity"
    VALIDATION_STATUS = "validation_status"
    RECONSTRUCTION_STATUS = "reconstruction_status"
    STRATEGY_APPROVAL = "strategy_approval"


class GovernanceState(str, Enum):
    PASS = "PASS"
    WARN = "WARN"
    FAIL = "FAIL"
    DIFFERS = "DIFFERS"
    RECONSTRUCTED = "RECONSTRUCTED"
    PENDING = "PENDING"
    UNKNOWN = "UNKNOWN"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class GovernanceCheck(Model):
    key: GovernanceCheckKey
    state: GovernanceState
    detail: str | None = None
    evidence_ref: str | None = None
    checked_at: AwareDatetime | None = None


class RefereeStatus(Model):
    state: Literal["MATCH", "DIFFERS", "NOT_RUN", "ERROR"]
    detail: str | None = None
    lock_ref: str | None = None
    lock_hash: str | None = None
    last_run_at: AwareDatetime | None = None


class ChangeRecord(Model):
    change_id: str
    at: AwareDatetime
    actor: str
    kind: Literal[
        "SPEC_FREEZE",
        "SEAL",
        "GOVERNANCE_CHANGE",
        "APPROVAL",
        "REJECTION",
        "RETIREMENT",
        "RECONSTRUCTION",
        "DATA_CHANGE",
        "OTHER",
    ]
    summary: str
    ref: str | None = None
    approved_before_results: bool | None = None


class GovernanceDoc(Model):
    checks: list[GovernanceCheck] = Field(default_factory=list)
    referee: RefereeStatus | None = None
    change_history: list[ChangeRecord] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> GovernanceDoc:
        keys = [c.key for c in self.checks]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate governance check key")
        return self


# ---------------------------------------------------------------------------
# datasets.json
# ---------------------------------------------------------------------------


class DatasetGap(Model):
    start: date
    end: date
    reason: str | None = None


class Dataset(Model):
    dataset_id: str
    root: str
    name: str | None = None
    venue: str | None = None
    asset_class: str | None = None
    kind: str | None = None
    bar_size: str | None = None
    timezone: str | None = None
    coverage_start: date | None = None
    coverage_end: date | None = None
    session_count: int | None = Field(default=None, ge=0)
    row_count: int | None = Field(default=None, ge=0)
    sessions_by_year: dict[str, int] = Field(default_factory=dict)
    content_hash: str | None = None
    manifest_ref: str | None = None
    integrity: Literal["PASS", "WARN", "FAIL", "UNKNOWN"]
    integrity_notes: list[str] = Field(default_factory=list)
    reconstructed: bool | None = None
    reconstruction_detail: str | None = None
    gaps: list[DatasetGap] = Field(default_factory=list)
    last_verified_at: AwareDatetime | None = None
    used_by: list[str] = Field(default_factory=list)
    origin: Origin


class DatasetsState(Model):
    datasets: list[Dataset] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# portfolio.json / risk.json / execution.json / live.json
# ---------------------------------------------------------------------------


class Exposure(Model):
    key: str
    label: str
    gross: Metric | None = None
    net: Metric | None = None


class Allocation(Model):
    agent_slot: int = Field(ge=1, le=5)
    strategy_id: str
    version: int = Field(ge=1)
    weight: Metric | None = None
    capital: Metric | None = None


class PortfolioState(Model):
    mode: AgentMode
    as_of: AwareDatetime
    positions: list[Position] = Field(default_factory=list)
    exposures: list[Exposure] = Field(default_factory=list)
    allocations: list[Allocation] = Field(default_factory=list)
    pnl: PnL | None = None
    equity: list[SeriesPoint] = Field(default_factory=list)
    drawdown: Metric | None = None

    @field_validator("equity")
    @classmethod
    def _equity_ordered(cls, v: list[SeriesPoint]) -> list[SeriesPoint]:
        return _strictly_ascending(v, "equity")


class KillSwitch(Model):
    state: Literal["ARMED", "TRIPPED", "NOT_CONFIGURED"]
    detail: str | None = None
    tripped_at: AwareDatetime | None = None


class RiskBreach(Model):
    breach_id: str
    at: AwareDatetime
    limit_key: str
    severity: Severity
    detail: str | None = None
    agent_slot: int | None = Field(default=None, ge=1, le=5)


class RiskState(Model):
    as_of: AwareDatetime
    kill_switch: KillSwitch | None = None
    portfolio_limits: list[RiskLimit] = Field(default_factory=list)
    daily_limits: list[RiskLimit] = Field(default_factory=list)
    execution_limits: list[RiskLimit] = Field(default_factory=list)
    breaches: list[RiskBreach] = Field(default_factory=list)


class ExecutionState(Model):
    as_of: AwareDatetime
    connections: list[Connection] = Field(default_factory=list)
    open_orders: list[Order] = Field(default_factory=list)
    fills: list[Trade] = Field(default_factory=list)
    stats: ExecutionStats | None = None


class LiveEngineState(Model):
    as_of: AwareDatetime
    engine_state: Literal["OFFLINE", "STARTING", "RUNNING", "DEGRADED", "STOPPED", "NOT_BUILT"]
    trading_mode: Literal["DISABLED", "SIM", "PAPER", "LIVE"]
    trading_enabled: bool
    detail: str | None = None
    connections: list[Connection] = Field(default_factory=list)
    heartbeat_at: AwareDatetime | None = None
    positions_open: int | None = Field(default=None, ge=0)
    orders_working: int | None = Field(default=None, ge=0)
    pnl: PnL | None = None


# ---------------------------------------------------------------------------
# insights.json
# ---------------------------------------------------------------------------


class Insight(Model):
    insight_id: str
    at: AwareDatetime
    kind: Literal["RESEARCH_DIGEST", "NULL_RESULT", "DATA", "EXECUTION", "GOVERNANCE", "MEMORY", "OTHER"]
    title: str
    body: str | None = None
    source: str
    evidence_refs: list[str] = Field(default_factory=list)
    origin: Origin


class InsightsState(Model):
    insights: list[Insight] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Document registry
# ---------------------------------------------------------------------------

#: document key -> (file name, payload model, human label)
DOCUMENTS: dict[str, tuple[str, type[Model], str]] = {
    "system": ("system.json", SystemState, "System status"),
    "research": ("research.json", ResearchState, "Research engine"),
    "strategies": ("strategies.json", StrategiesState, "Strategy registry"),
    "agents": ("agents.json", AgentsState, "Agent runtime"),
    "memory": ("memory.json", MemoryState, "Memory store"),
    "governance": ("governance.json", GovernanceDoc, "Governance"),
    "datasets": ("datasets.json", DatasetsState, "Data catalogue"),
    "portfolio": ("portfolio.json", PortfolioState, "Portfolio"),
    "risk": ("risk.json", RiskState, "Risk"),
    "execution": ("execution.json", ExecutionState, "Execution"),
    "live": ("live.json", LiveEngineState, "Live engine"),
    "insights": ("insights.json", InsightsState, "Insights"),
}

AGENT_EVENTS_FILE = "agent_events.jsonl"


def document_model(key: str) -> type[BaseModel]:
    """Envelope model ``{"meta": DocumentMeta, "data": <payload>}`` for a document key."""
    _, payload, _ = DOCUMENTS[key]
    name = f"{payload.__name__}Document"
    return type(
        name,
        (Model,),
        {"__annotations__": {"meta": DocumentMeta, "data": payload}, "__module__": __name__},
    )


DOCUMENT_MODELS: dict[str, type[BaseModel]] = {key: document_model(key) for key in DOCUMENTS}
