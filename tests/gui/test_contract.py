"""State contract: schemas validate real producer shapes and reject drift."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from atp.gui.command_centre import contract
from atp.gui.command_centre.schemas import DOCUMENT_MODELS, DOCUMENTS, AgentEvent, Strategy, StrategiesState

from .conftest import FIXTURE_DIR


@pytest.mark.parametrize("key", list(DOCUMENTS))
def test_fixture_documents_validate(key):
    raw = json.loads((FIXTURE_DIR / DOCUMENTS[key][0]).read_text())
    doc = DOCUMENT_MODELS[key].model_validate(raw)
    assert doc.meta.origin.value == "SYNTHETIC_FIXTURE"


def test_fixture_events_validate():
    lines = (FIXTURE_DIR / "agent_events.jsonl").read_text().splitlines()
    assert lines
    for line in lines:
        AgentEvent.model_validate_json(line)


def test_unknown_fields_are_rejected():
    raw = json.loads((FIXTURE_DIR / "research.json").read_text())
    raw["data"]["surprise_field"] = 1
    with pytest.raises(ValidationError):
        DOCUMENT_MODELS["research"].model_validate(raw)


def test_meta_requires_origin_and_version():
    raw = json.loads((FIXTURE_DIR / "system.json").read_text())
    del raw["meta"]["origin"]
    with pytest.raises(ValidationError):
        DOCUMENT_MODELS["system"].model_validate(raw)
    raw = json.loads((FIXTURE_DIR / "system.json").read_text())
    raw["meta"]["schema_version"] = "2"
    with pytest.raises(ValidationError):
        DOCUMENT_MODELS["system"].model_validate(raw)


def _strategy(**over):
    base = {
        "strategy_id": "X-1",
        "name": "x",
        "status": "CANDIDATE",
        "current_version": 1,
        "versions": [{"version": 1, "status": "CANDIDATE", "created_at": "2026-01-01T00:00:00Z"}],
        "origin": "ORIGINAL",
    }
    base.update(over)
    return base


def test_strategy_versions_must_be_consistent():
    Strategy.model_validate(_strategy())
    with pytest.raises(ValidationError, match="current_version"):
        Strategy.model_validate(_strategy(current_version=2))
    with pytest.raises(ValidationError, match="duplicate version"):
        Strategy.model_validate(
            _strategy(
                versions=[
                    {"version": 1, "status": "CANDIDATE", "created_at": "2026-01-01T00:00:00Z"},
                    {"version": 1, "status": "CANDIDATE", "created_at": "2026-01-02T00:00:00Z"},
                ]
            )
        )
    with pytest.raises(ValidationError, match="parent"):
        Strategy.model_validate(
            _strategy(
                current_version=2,
                versions=[
                    {"version": 2, "status": "CANDIDATE", "created_at": "2026-01-01T00:00:00Z", "parent_version": 3},
                ],
            )
        )


def test_assigned_agent_must_be_a_real_slot():
    with pytest.raises(ValidationError):
        Strategy.model_validate(_strategy(assigned_agent=6))


def test_duplicate_strategy_ids_rejected():
    with pytest.raises(ValidationError, match="duplicate strategy_id"):
        StrategiesState.model_validate({"strategies": [_strategy(), _strategy()]})


def test_metric_requires_basis():
    raw = json.loads((FIXTURE_DIR / "strategies.json").read_text())
    del raw["data"]["strategies"][2]["versions"][1]["metrics"]["sharpe"]["basis"]
    with pytest.raises(ValidationError):
        DOCUMENT_MODELS["strategies"].model_validate(raw)


def test_committed_json_schemas_match_models():
    assert contract.drift() == [], "run: python -m atp.gui.command_centre.contract export"


def test_contract_export(tmp_path):
    written = contract.export(tmp_path)
    assert {p.name for p in written} == {f"{k}.schema.json" for k in DOCUMENTS} | {"agent_event.schema.json"}
    assert contract.drift(tmp_path) == []
