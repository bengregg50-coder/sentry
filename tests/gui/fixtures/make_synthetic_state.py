"""Generate the SYNTHETIC test fixture state directory.

Nothing here is SENTRY state. Every document and record is tagged
``origin = SYNTHETIC_FIXTURE`` and every identifier is prefixed ``FX``/``FIXTURE``
so it cannot be mistaken for research output. The Command Centre shows a
permanent red banner whenever any of it is loaded.

It exists to (a) exercise every rendering branch in tests and (b) let a human
preview populated layouts:  python -m atp.gui --state-dir tests/gui/fixtures/synthetic_state

Regenerate with:  python tests/gui/fixtures/make_synthetic_state.py
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).parent / "synthetic_state"
FX = "SYNTHETIC_FIXTURE"
T0 = datetime(2026, 1, 5, 14, 30, tzinfo=timezone.utc)
GEN = datetime(2026, 1, 20, 12, 0, tzinfo=timezone.utc)


def iso(dt: datetime | date) -> str:
    return dt.isoformat()


def meta(producer: str) -> dict:
    return {
        "schema_version": "1",
        "producer": f"fixture:{producer}",
        "generated_at": iso(GEN),
        "origin": FX,
        "notes": ["SYNTHETIC TEST FIXTURE — not SENTRY state"],
    }


def m(value, unit, basis, **kw):
    return {"value": value, "unit": unit, "basis": basis, **kw}


class LCG:
    """Deterministic pseudo-random numbers (no global RNG, stable across runs)."""

    def __init__(self, seed: int) -> None:
        self.s = seed

    def next(self) -> float:
        self.s = (1103515245 * self.s + 12345) % (2**31)
        return self.s / 2**31


def bars(n: int, start: float, seed: int) -> list[dict]:
    r = LCG(seed)
    out, px = [], start
    for i in range(n):
        o = px
        c = o * (1 + (r.next() - 0.5) * 0.004)
        h = max(o, c) * (1 + r.next() * 0.0015)
        lo = min(o, c) * (1 - r.next() * 0.0015)
        out.append({"t": iso(T0 + timedelta(minutes=15 * i)), "o": round(o, 2), "h": round(h, 2), "l": round(lo, 2), "c": round(c, 2), "v": round(100 + r.next() * 900)})
        px = c
    return out


def series(n: int, start: float, seed: int, drift: float = 0.0) -> list[dict]:
    r = LCG(seed)
    v, out = start, []
    for i in range(n):
        v += drift + (r.next() - 0.5) * 2
        out.append({"t": iso(T0 + timedelta(days=i)), "v": round(v, 2)})
    return out


def check(state, detail=None, refs=()):
    return {"state": state, "detail": detail, "evidence_refs": list(refs), "checked_at": iso(GEN)}


def build() -> dict[str, dict]:
    docs: dict[str, dict] = {}

    docs["system"] = {
        "meta": meta("system"),
        "data": {
            "subsystems": [
                {"key": "research_engine", "state": "ONLINE", "detail": "FIXTURE: research engine heartbeat", "heartbeat_at": iso(GEN)},
                {"key": "trading_engine", "state": "DEGRADED", "detail": "FIXTURE: simulation only"},
                {"key": "agent_network", "state": "ONLINE"},
                {"key": "data", "state": "ONLINE"},
                {"key": "governance", "state": "ONLINE"},
                {"key": "memory", "state": "IDLE"},
            ]
        },
    }

    programmes = [
        {"programme_id": "FX-P01", "name": "FIXTURE sealed intraday family", "family": "FIXTURE-intraday", "status": "SEALED", "outcome": "NO APPROVED STRATEGY", "sealed_at": iso(T0 - timedelta(days=60)), "origin": FX},
        {"programme_id": "FX-P02", "name": "FIXTURE daily premia replication", "family": "FIXTURE-trend", "mechanism": "FIXTURE time-series momentum", "status": "SPEC_FROZEN", "universe_status": "PROVISIONAL", "spec_ref": "fixture/spec.md", "spec_hash": "fx0000000000000000000000000000000000000000000000000000000000a1", "frozen_at": iso(T0), "evaluation_windows": [{"label": "FIXTURE primary", "role": "PRIMARY_EVIDENCE", "start": "2000-01-01", "end": "2015-12-31"}, {"label": "FIXTURE confirmation", "role": "CONFIRMATION", "start": "2016-01-01", "end": "2024-12-31"}], "origin": FX},
        {"programme_id": "FX-P03", "name": "FIXTURE carry study", "family": "FIXTURE-carry", "status": "PROPOSED", "origin": FX},
        {"programme_id": "FX-P04", "name": "FIXTURE order-flow pilot", "family": "FIXTURE-orderflow", "status": "DEFERRED", "notes": ["FIXTURE: data not purchased"], "origin": FX},
    ]

    hyps = [
        ("FX-H001", "FIXTURE opening-range continuation", "FIXTURE-intraday", "REJECTED", "OOS", "REJECTED", "FIXTURE: failed OOS after costs", [1, 2, 3]),
        ("FX-H002", "FIXTURE session reversal", "FIXTURE-intraday", "REJECTED", "BACKTEST", "REJECTED", "FIXTURE: negative net expectancy", [4]),
        ("FX-H003", "FIXTURE order-flow absorption", "FIXTURE-orderflow", "BLOCKED_BY_DATA", "HYPOTHESIS", "BLOCKED_BY_DATA", "FIXTURE: requires unpurchased data", []),
        ("FX-H004", "FIXTURE volatility-conditioned breakout", "FIXTURE-intraday", "PENDING", "ROBUSTNESS", "PENDING", "FIXTURE: awaiting cost-sensitivity rerun", [5, 6]),
        ("FX-H005", "FIXTURE cross-asset trend", "FIXTURE-trend", "VALIDATED", "VALIDATION", None, None, [7, 8, 9]),
        ("FX-H006", "FIXTURE calendar drift", "FIXTURE-calendar", "ABANDONED", "DISCOVERY", "ABANDONED", "FIXTURE: researcher dropped pre-test", []),
        ("FX-H007", "FIXTURE term-structure carry", "FIXTURE-carry", "PREREGISTERED", "HYPOTHESIS", None, None, []),
        ("FX-H008", "FIXTURE equity event drift", "FIXTURE-event", "TESTING", "BACKTEST", None, None, [10]),
    ]
    hypotheses = []
    for hid, title, fam, status, stage, term, reason, trials in hyps:
        hypotheses.append(
            {
                "hypothesis_id": hid,
                "title": title,
                "programme_id": "FX-P02" if fam == "FIXTURE-trend" else ("FX-P01" if fam == "FIXTURE-intraday" else None),
                "family": fam,
                "statement": f"{title} (synthetic statement)",
                "mechanism": "FIXTURE mechanism text",
                "economic_rationale": "FIXTURE rationale text",
                "status": status,
                "stage_reached": stage,
                "terminal": term,
                "preregistered_at": iso(T0 - timedelta(days=30)) if status != "ABANDONED" else None,
                "created_at": iso(T0 - timedelta(days=40)),
                "decided_at": iso(T0 - timedelta(days=5)) if term else None,
                "decision_reason": reason,
                "strategy_id": "FX-S003" if hid == "FX-H005" else None,
                "trial_numbers": trials,
                "origin": "RECONSTRUCTED" if hid == "FX-H002" else "ORIGINAL",
            }
        )

    trial_specs = [
        (1, "FX-H001", "BACKTEST", "BACKTEST", "PASS", None, "ORIGINAL", None),
        (2, "FX-H001", "COST_SENSITIVITY", "ROBUSTNESS", "PASS", None, "ORIGINAL", None),
        (3, "FX-H001", "OOS", "OOS", "FAIL", "FIXTURE: OOS net expectancy negative", "ORIGINAL", "FAIL"),
        (4, "FX-H002", "BACKTEST", "BACKTEST", "FAIL", "FIXTURE: net of costs < 0", "RECONSTRUCTED", None),
        (5, "FX-H004", "BACKTEST", "BACKTEST", "PASS", None, "ORIGINAL", None),
        (6, "FX-H004", "ROBUSTNESS", "ROBUSTNESS", "INCONCLUSIVE", None, "ORIGINAL", None),
        (7, "FX-H005", "BACKTEST", "BACKTEST", "PASS", None, "ORIGINAL", None),
        (8, "FX-H005", "OOS", "OOS", "PASS", None, "ORIGINAL", "PASS"),
        (9, "FX-H005", "WALK_FORWARD", "VALIDATION", "PASS", None, "ORIGINAL", "PASS"),
        (10, "FX-H008", "BACKTEST", "BACKTEST", "RUNNING", None, "ORIGINAL", None),
    ]
    trials = []
    for n, hid, kind, stage, outcome, reason, ev, oos in trial_specs:
        recon = ev == "RECONSTRUCTED"
        trials.append(
            {
                "trial_id": f"FX-T{n:03d}",
                "trial_number": n,
                "programme_id": "FX-P02" if hid == "FX-H005" else "FX-P01",
                "hypothesis_id": hid,
                "family": next(h[2] for h in hyps if h[0] == hid),
                "experiment": f"FIXTURE {kind.lower().replace('_', ' ')} #{n}",
                "kind": kind,
                "stage": stage,
                "outcome": outcome,
                "rejection_reason": reason,
                "evidence_state": "LOST" if recon else "ORIGINAL",
                "oos_state": oos,
                "validation_state": "PASS" if hid == "FX-H005" and stage == "VALIDATION" else None,
                "started_at": iso(T0 - timedelta(days=20 - n)),
                "recorded_at": None if recon else iso(T0 - timedelta(days=19 - n)),
                "data_used": ["FX-DS-A"] if hid != "FX-H005" else ["FX-DS-A", "FX-DS-B", "FX-DS-C"],
                "window_start": "2019-06-01",
                "window_end": "2023-12-31",
                "metrics": []
                if recon
                else [
                    {"key": "gross", "label": "Gross return", "metric": m(round(4.1 - n * 0.3, 2), "pct", "OUT_OF_SAMPLE" if kind == "OOS" else "IN_SAMPLE", component="GROSS")},
                    {"key": "cost", "label": "Costs", "metric": m(-1.2, "pct", "OUT_OF_SAMPLE" if kind == "OOS" else "IN_SAMPLE", component="COST", cost_multiplier=1.0)},
                    {"key": "net", "label": "Net return", "metric": m(round(2.9 - n * 0.3, 2), "pct", "OUT_OF_SAMPLE" if kind == "OOS" else "IN_SAMPLE", component="NET")},
                ],
                "lineage": [{"kind": "HYPOTHESIS", "ref": hid}],
                "evidence_refs": [] if recon else [f"fixture/evidence/T{n:03d}.json"],
                # Records simulate real provenance so origin accounting is exercised;
                # the document envelope (meta.origin) marks the whole file SYNTHETIC_FIXTURE.
                "origin": "RECONSTRUCTED" if recon else "ORIGINAL",
            }
        )
    # a reconstructed trial with no number (lost)
    trials.append(
        {
            "trial_id": "FX-T-RECON-LOST",
            "trial_number": None,
            "programme_id": "FX-P01",
            "family": "FIXTURE-intraday",
            "experiment": "FIXTURE reconstructed entry (original record lost)",
            "kind": "OTHER",
            "stage": "BACKTEST",
            "outcome": "FAIL",
            "evidence_state": "LOST",
            "origin": "RECONSTRUCTED",
        }
    )

    docs["research"] = {
        "meta": meta("research"),
        "data": {
            "focus": {"programme_id": "FX-P02", "hypothesis_id": "FX-H007", "summary": "FIXTURE focus summary", "next_action": "FIXTURE: run implementation verification"},
            "programmes": programmes,
            "hypotheses": hypotheses,
            "trials": trials,
            "trial_accounting": {
                "reconstructed_baseline": 5,
                "live_recorded": 9,
                "global_count": 14,
                "ledger_ref": "fixture/ledger.jsonl",
                "ledger_hash": "fx" + "0" * 62,
                "sealed_evidence_separate": True,
                "as_of": iso(GEN),
                "notes": ["FIXTURE accounting"],
            },
            "integrity_notices": [
                {"notice_id": "FX-N1", "severity": "WARNING", "title": "FIXTURE: original files lost", "detail": "FIXTURE notice — synthetic loss event for rendering tests", "occurred_on": "2025-12-01", "reference": "fixture/reconstruction.md", "affects": ["research"]},
            ],
            "research_areas": [
                {"area_id": "FX-A1", "name": "FIXTURE diversified trend", "mechanism_class": "trend", "status": "ACTIVE", "rationale": "FIXTURE rationale", "literature": ["FIXTURE et al. (2000)"], "programme_ids": ["FX-P02"]},
                {"area_id": "FX-A2", "name": "FIXTURE carry", "mechanism_class": "carry", "status": "CANDIDATE_AREA", "programme_ids": ["FX-P03"]},
                {"area_id": "FX-A3", "name": "FIXTURE intraday timing", "mechanism_class": "timing", "status": "EXHAUSTED"},
                {"area_id": "FX-A4", "name": "FIXTURE order flow", "mechanism_class": "microstructure", "status": "DEFERRED"},
            ],
            "roles": [
                {"role": "LEAD_RESEARCHER", "state": "ACTIVE", "last_activity_at": iso(GEN)},
                {"role": "QUANT_RESEARCHER", "state": "IDLE"},
                {"role": "DATA_ANALYST", "state": "IDLE"},
                {"role": "CODER", "state": "ACTIVE"},
                {"role": "BACKTESTER", "state": "BLOCKED", "detail": "FIXTURE: waiting on data"},
                {"role": "ADVERSARIAL_REFEREE", "state": "IDLE"},
                {"role": "GOVERNANCE", "state": "NOT_BUILT"},
            ],
        },
    }

    def version(v, status, vstatus, *, parent=None, approval=None, package=None, proposal=None, metrics=None, checks=None, mt=None, lineage=None):
        return {
            "version": v,
            "status": status,
            "created_at": iso(T0 + timedelta(days=v)),
            "parent_version": parent,
            "change_summary": f"FIXTURE v{v} change" if parent else "FIXTURE initial version",
            "change_rationale": "FIXTURE rationale" if parent else None,
            "proposed_by": "agent:02" if proposal else "research_engine",
            "proposal_id": proposal,
            "spec_hash": f"fx{v:062d}",
            "lineage": lineage or [],
            "metrics": metrics or {},
            "validation_status": vstatus,
            "validation": checks or {},
            "multiple_testing": mt,
            "approval": approval,
            "deployment_package": package,
        }

    full_checks = {k: check("PASS", "FIXTURE") for k in ("economic_rationale", "positive_expectancy", "realistic_costs", "cost_sensitivity", "robustness", "parameter_stability", "out_of_sample", "walk_forward", "multiple_testing", "execution_realism", "sample_size")}
    full_checks["regime_analysis"] = check("INCONCLUSIVE", "FIXTURE: one regime weak")
    full_checks["monte_carlo"] = check("NOT_RUN")
    s3_metrics = {
        "gross_return": m(8.4, "pct", "OUT_OF_SAMPLE", component="GROSS"),
        "costs": m(-1.9, "pct", "OUT_OF_SAMPLE", component="COST", cost_multiplier=1.0),
        "net_return": m(6.5, "pct", "OUT_OF_SAMPLE", component="NET"),
        "sharpe": m(0.61, "ratio", "OUT_OF_SAMPLE"),
        "sortino": m(0.88, "ratio", "OUT_OF_SAMPLE"),
        "max_drawdown": m(-14.2, "pct", "OUT_OF_SAMPLE"),
        "trade_count": m(412, "count", "OUT_OF_SAMPLE"),
        "win_rate": m(41.0, "pct", "OUT_OF_SAMPLE"),
        "slippage": m(1.5, "bps", "SIMULATION"),
        "additional": [{"key": "net_2x", "label": "Net @2× costs", "metric": m(4.6, "pct", "OUT_OF_SAMPLE", component="NET", cost_multiplier=2.0)}],
    }
    approval = {"decision": "APPROVED", "scope": "SIM", "decided_at": iso(T0 + timedelta(days=4)), "decided_by": "fixture-governance", "decision_ref": "fixture/approval.md", "conditions": ["FIXTURE: SIM only"]}
    package = {"package_id": "FX-PKG-003-2", "created_at": iso(T0 + timedelta(days=5)), "spec_hash": "fx" + "2" * 62, "data_identity": "fx-data-id", "executor_identity": "fx-exec-id", "cost_model_identity": "fx-cost-id", "risk_limits_ref": "fixture/risk.json"}
    strategies = [
        {
            "strategy_id": "FX-S001", "name": "FIXTURE candidate A", "mechanism": "FIXTURE carry", "market": "FIXTURE-MKT", "instrument": "FXB", "timeframe": "1D",
            "status": "CANDIDATE", "current_version": 1, "versions": [version(1, "CANDIDATE", "NOT_STARTED")], "origin": FX, "last_update": iso(GEN),
        },
        {
            "strategy_id": "FX-S002", "name": "FIXTURE in validation B", "mechanism": "FIXTURE breakout", "market": "FIXTURE-MKT", "instrument": "FXA", "timeframe": "15m",
            "status": "IN_VALIDATION", "current_version": 1,
            "versions": [version(1, "IN_VALIDATION", "IN_PROGRESS", metrics={"sharpe": m(1.9, "ratio", "IN_SAMPLE"), "trade_count": m(88, "count", "IN_SAMPLE")}, checks={"economic_rationale": check("PASS"), "out_of_sample": check("PENDING"), "cost_sensitivity": check("FAIL", "FIXTURE: fails at 2× costs")}, mt={"state": "PENDING", "method": "FIXTURE deflated Sharpe", "trials_in_family": 6})],
            "origin": FX, "last_update": iso(GEN),
        },
        {
            "strategy_id": "FX-S003", "name": "FIXTURE validated trend C", "mechanism": "FIXTURE cross-asset trend", "economic_rationale": "FIXTURE rationale", "market": "FIXTURE multi-asset", "instrument": "FXA/FXB/FXC", "timeframe": "1D",
            "status": "DEPLOYED_SIM", "current_version": 2,
            "versions": [
                version(1, "RETIRED", "VALIDATED", metrics=s3_metrics, checks=full_checks, mt={"state": "PASS", "method": "FIXTURE deflated Sharpe", "trials_in_family": 3, "global_trials_at_decision": 12, "deflated_sharpe": 0.4}, lineage=[{"kind": "HYPOTHESIS", "ref": "FX-H005"}, {"kind": "TRIAL", "ref": "FX-T008"}]),
                version(2, "DEPLOYED_SIM", "VALIDATED", parent=1, approval=approval, package=package, proposal="FX-PR1", metrics=s3_metrics, checks=full_checks, mt={"state": "PASS", "method": "FIXTURE deflated Sharpe", "trials_in_family": 4, "global_trials_at_decision": 14, "deflated_sharpe": 0.35}, lineage=[{"kind": "STRATEGY_VERSION", "ref": "FX-S003@1"}, {"kind": "PROPOSAL", "ref": "FX-PR1"}, {"kind": "MEMORY", "ref": "FX-M0003"}]),
            ],
            "assigned_agent": 2, "origin": FX, "last_update": iso(GEN),
        },
        {
            "strategy_id": "FX-S004", "name": "FIXTURE retired D", "mechanism": "FIXTURE calendar", "market": "FIXTURE-MKT", "instrument": "FXC", "timeframe": "1D",
            "status": "RETIRED", "current_version": 1, "versions": [version(1, "DEPLOYED_SIM", "VALIDATED", approval=approval, package={**package, "package_id": "FX-PKG-004-1"}, checks=full_checks)], "origin": FX,
        },
        {
            "strategy_id": "FX-S005", "name": "FIXTURE rejected E", "mechanism": "FIXTURE session effect", "market": "FIXTURE-MKT", "instrument": "FXA", "timeframe": "5m",
            "status": "REJECTED", "current_version": 1, "versions": [version(1, "REJECTED", "FAILED", checks={"out_of_sample": check("FAIL", "FIXTURE: OOS failed")})],
            # declared by the research engine: stopped at OOS (its OOS check failed)
            "stage_reached": "OOS", "terminal": "REJECTED", "origin": FX,
        },
    ]
    proposals = [
        {"proposal_id": "FX-PR1", "proposed_at": iso(T0 + timedelta(days=2)), "proposed_by": "agent:02", "agent_slot": 2, "strategy_id": "FX-S003", "base_version": 1, "summary": "FIXTURE: tighten roll timing", "rationale": "FIXTURE rationale", "evidence_refs": ["FX-M0003"], "state": "RELEASED_AS_VERSION", "resulting_version": 2},
        {"proposal_id": "FX-PR2", "proposed_at": iso(GEN - timedelta(days=1)), "proposed_by": "agent:02", "agent_slot": 2, "strategy_id": "FX-S003", "base_version": 2, "summary": "FIXTURE: volatility scaling tweak", "state": "IN_RESEARCH"},
    ]
    docs["strategies"] = {"meta": meta("strategies"), "data": {"strategies": strategies, "proposals": proposals}}

    eq2 = series(30, 100.0, 7, 0.05)
    docs["agents"] = {
        "meta": meta("agents"),
        "data": {
            "agents": [
                {"slot": 1, "status": "SLEEPING", "status_detail": "FIXTURE: no assignment"},
                {
                    "slot": 2, "status": "SIMULATING", "codename": "FIXTURE-TREND", "specialisation": "FIXTURE daily trend",
                    "assignment": {"strategy_id": "FX-S003", "version": 2, "mode": "SIM", "assigned_at": iso(T0 + timedelta(days=6)), "approval_ref": "fixture/approval.md", "package_id": "FX-PKG-003-2"},
                    "market": "FIXTURE multi-asset", "timeframe": "15m",  # matches its 15-minute bars
                    "signal": {"state": "LONG", "as_of": iso(GEN), "detail": "FIXTURE signal"},
                    "positions": [{"instrument": "FXA", "side": "LONG", "quantity": 2, "avg_price": 101.25, "unrealized_pnl": m(310.0, "currency", "SIMULATION", currency="USD"), "mode": "SIM", "as_of": iso(GEN)}],
                    "orders": [{"order_id": "FX-O1", "instrument": "FXB", "side": "SELL", "quantity": 1, "order_type": "LIMIT", "limit_price": 99.5, "status": "WORKING", "mode": "SIM", "submitted_at": iso(GEN), "agent_slot": 2}],
                    "recent_trades": [{"trade_id": "FX-TR1", "instrument": "FXA", "side": "BUY", "quantity": 2, "price": 101.25, "executed_at": iso(GEN - timedelta(hours=3)), "mode": "SIM", "slippage_bps": 1.2, "agent_slot": 2}],
                    "pnl": {"mode": "SIM", "as_of": iso(GEN), "realized": m(1250.0, "currency", "SIMULATION", currency="USD"), "unrealized": m(310.0, "currency", "SIMULATION", currency="USD"), "day": m(85.0, "currency", "SIMULATION", currency="USD")},
                    "equity": eq2,
                    "drawdown": m(-3.1, "pct", "SIMULATION"),
                    "risk_limits": [
                        {"key": "max_contracts", "label": "Max contracts", "limit": 6, "used": 2, "unit": "contracts", "state": "OK"},
                        {"key": "daily_loss", "label": "Daily loss limit", "limit": 2000, "used": 0, "unit": "currency", "currency": "USD", "state": "OK"},
                    ],
                    "execution": {"as_of": iso(GEN), "latency_ms_p50": 42.0, "latency_ms_p95": 120.0, "slippage_bps_mean": 1.2, "slippage_model_bps": 1.5, "fills": 14, "rejects": 0},
                    "connections": [{"name": "FIXTURE sim feed", "kind": "MARKET_DATA", "state": "CONNECTED", "last_heartbeat": iso(GEN)}, {"name": "FIXTURE sim broker", "kind": "BROKER", "state": "CONNECTED", "last_heartbeat": iso(GEN)}],
                    "alerts": [{"alert_id": "FX-AL1", "at": iso(GEN), "severity": "INFO", "message": "FIXTURE: roll window approaching"}],
                    "memory_refs": ["FX-M0003"],
                    "bars": bars(120, 100.0, 11),
                    "last_heartbeat": iso(GEN),
                },
                {"slot": 3, "status": "SLEEPING"},
                {"slot": 4, "status": "STANDBY", "codename": "FIXTURE-STANDBY", "status_detail": "FIXTURE: awaiting deployment package"},
            ]
        },
    }

    kinds = ["OBSERVATION", "INTERPRETATION", "MEMORY_RECALL", "SIGNAL_EVALUATION", "NO_TRADE", "OBSERVATION", "HYPOTHESIS", "TEST", "EVALUATION", "LEARNING", "MEMORY_WRITE", "PROPOSAL", "RESEARCH_OBSERVATION", "ORDER", "FILL"]
    events = []
    for i, k in enumerate(kinds):
        events.append(
            {
                "event_id": f"FX-E{i:04d}",
                "ts": iso(GEN - timedelta(minutes=(len(kinds) - i) * 7)),
                "agent_slot": 2,
                "kind": k,
                "mode": "RESEARCH" if k in ("HYPOTHESIS", "TEST", "EVALUATION", "LEARNING", "MEMORY_WRITE", "PROPOSAL") else "SIM",
                "summary": f"FIXTURE {k.lower().replace('_', ' ')} event",
                "refs": {"memory_ids": ["FX-M0003"] if k in ("MEMORY_RECALL", "MEMORY_WRITE") else [], "strategy_id": "FX-S003", "version": 2, "proposal_id": "FX-PR2" if k == "PROPOSAL" else None},
                "origin": FX,
            }
        )

    def mem(i, mtype, title, conf, vstate, status, evidence, **kw):
        return {
            "memory_id": f"FX-M{i:04d}",
            "type": mtype,
            "title": title,
            "created_at": iso(T0 + timedelta(days=i)),
            "source": kw.pop("source", {"actor": "RESEARCH_ENGINE", "programme_id": "FX-P01", "trial_ids": []}),
            "hypothesis": kw.pop("hypothesis", "FIXTURE hypothesis text"),
            "observation": kw.pop("observation", "FIXTURE observation text"),
            "evidence": evidence,
            "confidence": conf,
            "validation_state": vstate,
            "status": status,
            "origin": FX,
            "last_reviewed": iso(GEN),
            **kw,
        }

    ev = lambda eid, kind, ref, stance, result=None: {"evidence_id": eid, "kind": kind, "ref": ref, "stance": stance, "result": result, "summary": "FIXTURE evidence", "independent": True, "recorded_at": iso(GEN)}  # noqa: E731
    memories = [
        mem(1, "FAILED_MECHANISM", "FIXTURE: opening-range continuation fails net of costs", "HIGH", "VALIDATED", "RETAIN", [ev("FX-EV1", "TRIAL", "FX-T003", "SUPPORTS", "FAIL"), ev("FX-EV2", "TRIAL", "FX-T001", "SUPPORTS", "PASS")], oos="FAIL", robustness="PASS", cost_sensitivity="PASS", source={"actor": "RESEARCH_ENGINE", "programme_id": "FX-P01", "trial_ids": ["FX-T003"]}),
        mem(2, "REJECTED_ASSUMPTION", "FIXTURE: session effects are not stable", "MEDIUM", "VALIDATED", "REJECTED", [ev("FX-EV3", "TRIAL", "FX-T004", "SUPPORTS", "FAIL")]),
        mem(3, "VOLATILITY_OBSERVATION", "FIXTURE: roll-window volatility observation", "MEDIUM", "PROVISIONAL", "REVIEW", [ev("FX-EV4", "SIMULATION", "fixture/sim/obs1", "SUPPORTS"), ev("FX-EV5", "LIVE_OBSERVATION", "fixture/sim/obs2", "CONTRADICTS")], related_strategies=["FX-S003"], source={"actor": "AGENT", "agent_slot": 2, "trial_ids": []}),
        mem(4, "LESSON", "FIXTURE lesson: freeze specs before data", "HIGH", "VALIDATED", "RETAIN", [ev("FX-EV6", "DOCUMENT", "fixture/postmortem.md", "SUPPORTS")]),
        mem(5, "DANGEROUS_FEATURE", "FIXTURE: look-ahead in session labels", "HIGH", "VALIDATED", "RETAIN", [ev("FX-EV7", "EXPERIMENT", "fixture/exp/la", "SUPPORTS", "FAIL")], related_memories=["FX-M0004", "FX-M9999"]),
        mem(6, "EXECUTION_OBSERVATION", "FIXTURE: sim slippage below model", "LOW", "UNVERIFIED", "REVIEW", [], source={"actor": "AGENT", "agent_slot": 2, "trial_ids": []}, related_strategies=["FX-S003"]),
    ]
    docs["memory"] = {"meta": meta("memory"), "data": {"memories": memories}}

    docs["governance"] = {
        "meta": meta("governance"),
        "data": {
            "checks": [
                {"key": "trial_accounting", "state": "PASS", "detail": "FIXTURE: ledger append-only", "checked_at": iso(GEN)},
                {"key": "global_trial_count", "state": "PASS", "detail": "FIXTURE"},
                {"key": "research_live_separation", "state": "PASS"},
                {"key": "oos_separation", "state": "PASS"},
                {"key": "multiple_testing", "state": "WARN", "detail": "FIXTURE: family count provisional"},
                {"key": "referee", "state": "DIFFERS", "detail": "FIXTURE: referee reproduction differs"},
                {"key": "data_integrity", "state": "PASS"},
                {"key": "dataset_identity", "state": "PASS"},
                {"key": "validation_status", "state": "PENDING"},
                {"key": "reconstruction_status", "state": "RECONSTRUCTED", "detail": "FIXTURE: baseline reconstructed after loss"},
            ],
            "referee": {"state": "DIFFERS", "detail": "FIXTURE: 2 of 14 trial results differ", "lock_ref": "fixture/referee.lock", "lock_hash": "fx" + "9" * 62, "last_run_at": iso(GEN)},
            "change_history": [
                {"change_id": "FX-C1", "at": iso(T0 - timedelta(days=60)), "actor": "fixture-governance", "kind": "SEAL", "summary": "FIXTURE: sealed intraday programme", "approved_before_results": True},
                {"change_id": "FX-C2", "at": iso(T0), "actor": "fixture-governance", "kind": "SPEC_FREEZE", "summary": "FIXTURE: froze replication spec", "approved_before_results": True},
                {"change_id": "FX-C3", "at": iso(T0 + timedelta(days=4)), "actor": "fixture-governance", "kind": "APPROVAL", "summary": "FIXTURE: approved FX-S003 v2 for SIM", "ref": "fixture/approval.md", "approved_before_results": None},
                {"change_id": "FX-C4", "at": iso(T0 - timedelta(days=30)), "actor": "fixture-operator", "kind": "RECONSTRUCTION", "summary": "FIXTURE: rebuilt baseline after loss"},
            ],
        },
    }

    def ds(i, root, start, end, sessions, integrity, notes, recon=False):
        years = {}
        y0, y1 = int(start[:4]), int(end[:4])
        for y in range(y0, y1 + 1):
            years[str(y)] = 250 if y not in (y0, y1) else 120
        return {
            "dataset_id": f"FX-DS-{root[-1]}", "root": root, "name": f"FIXTURE dataset {root}", "venue": "FIXTURE-VENUE", "asset_class": "FIXTURE futures",
            "kind": "FUTURES_INTRADAY", "bar_size": "1m", "timezone": "UTC", "coverage_start": start, "coverage_end": end, "session_count": sessions,
            "sessions_by_year": years, "content_hash": f"fx{i:062d}", "manifest_ref": f"fixture/{root}.manifest", "integrity": integrity, "integrity_notes": notes,
            "reconstructed": recon, "reconstruction_detail": "FIXTURE: manifest rebuilt" if recon else None,
            "gaps": [{"start": "2020-03-16", "end": "2020-03-20", "reason": "FIXTURE gap"}] if root == "FXB" else [],
            "last_verified_at": iso(GEN), "used_by": ["FX-P01"], "origin": FX,
        }

    docs["datasets"] = {
        "meta": meta("datasets"),
        "data": {
            "datasets": [
                ds(1, "FXA", "2018-01-02", "2025-12-31", 2000, "PASS", []),
                ds(2, "FXB", "2018-01-02", "2025-12-31", 1995, "WARN", ["FIXTURE: 5-session gap"]),
                ds(3, "FXC", "2019-06-03", "2025-12-31", 1640, "PASS", [], recon=True),
            ]
        },
    }

    docs["portfolio"] = {
        "meta": meta("portfolio"),
        "data": {
            "mode": "SIM", "as_of": iso(GEN),
            "positions": docs["agents"]["data"]["agents"][1]["positions"],
            "exposures": [{"key": "fx-equity", "label": "FIXTURE equity index", "gross": m(42.0, "pct", "SIMULATION"), "net": m(42.0, "pct", "SIMULATION")}, {"key": "fx-rates", "label": "FIXTURE rates", "gross": m(18.0, "pct", "SIMULATION"), "net": m(-18.0, "pct", "SIMULATION")}],
            "allocations": [{"agent_slot": 2, "strategy_id": "FX-S003", "version": 2, "weight": m(100.0, "pct", "SIMULATION"), "capital": m(100000.0, "currency", "SIMULATION", currency="USD")}],
            "pnl": docs["agents"]["data"]["agents"][1]["pnl"],
            "equity": eq2,
            "drawdown": m(-3.1, "pct", "SIMULATION"),
        },
    }
    docs["risk"] = {
        "meta": meta("risk"),
        "data": {
            "as_of": iso(GEN),
            "kill_switch": {"state": "ARMED", "detail": "FIXTURE kill switch"},
            "portfolio_limits": [{"key": "gross", "label": "Gross exposure", "limit": 150, "used": 60, "unit": "pct", "state": "OK"}],
            "daily_limits": [{"key": "daily_loss", "label": "Daily loss", "limit": 2000, "used": 1700, "unit": "currency", "currency": "USD", "state": "WARN"}],
            "execution_limits": [{"key": "slippage", "label": "Slippage vs model", "limit": 3, "used": 1.2, "unit": "bps", "state": "OK"}],
            "breaches": [{"breach_id": "FX-B1", "at": iso(GEN), "limit_key": "daily_loss", "severity": "WARNING", "detail": "FIXTURE: 85% of daily loss limit", "agent_slot": 2}],
        },
    }
    docs["execution"] = {
        "meta": meta("execution"),
        "data": {
            "as_of": iso(GEN),
            "connections": docs["agents"]["data"]["agents"][1]["connections"],
            "open_orders": docs["agents"]["data"]["agents"][1]["orders"],
            "fills": docs["agents"]["data"]["agents"][1]["recent_trades"],
            "stats": docs["agents"]["data"]["agents"][1]["execution"],
        },
    }
    docs["live"] = {
        "meta": meta("live"),
        "data": {
            "as_of": iso(GEN), "engine_state": "RUNNING", "trading_mode": "SIM", "trading_enabled": False, "detail": "FIXTURE: simulation only; live trading disabled",
            "connections": docs["agents"]["data"]["agents"][1]["connections"], "heartbeat_at": iso(GEN), "positions_open": 1, "orders_working": 1,
            "pnl": docs["agents"]["data"]["agents"][1]["pnl"],
        },
    }
    docs["insights"] = {
        "meta": meta("insights"),
        "data": {
            "insights": [
                {"insight_id": "FX-I1", "at": iso(GEN), "kind": "NULL_RESULT", "title": "FIXTURE: intraday family exhausted", "body": "FIXTURE insight body", "source": "fixture:research", "evidence_refs": ["FX-M0001"], "origin": FX},
                {"insight_id": "FX-I2", "at": iso(GEN - timedelta(days=2)), "kind": "GOVERNANCE", "title": "FIXTURE: referee differs on 2 trials", "source": "fixture:governance", "origin": FX},
            ]
        },
    }
    return docs, events


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    docs, events = build()
    for key, doc in docs.items():
        (OUT / f"{key}.json").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    (OUT / "agent_events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
    print(f"wrote {len(docs)} documents + {len(events)} events to {OUT}")


if __name__ == "__main__":
    main()
