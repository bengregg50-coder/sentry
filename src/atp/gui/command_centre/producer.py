"""Helpers for *producers* (research engine, agents, execution) to publish state.

The Command Centre itself never calls these — it is read-only. They exist so a
producer can emit contract-valid documents without re-implementing the
envelope, validation, or atomic replacement::

    from atp.gui.command_centre.producer import write_document, append_event
    write_document(state_dir, "research", payload, producer="atp.research.ledger_export", origin="RECONSTRUCTED")

Documents are validated before anything touches disk and are replaced
atomically (temp file + rename), so a reader never sees a half-written file.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .schemas import AGENT_EVENTS_FILE, CONTRACT_VERSION, DOCUMENT_MODELS, DOCUMENTS, AgentEvent, Origin


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def build_document(
    key: str,
    payload: BaseModel | dict[str, Any],
    *,
    producer: str,
    origin: Origin | str,
    notes: list[str] | None = None,
    generated_at: datetime | None = None,
) -> BaseModel:
    """Wrap and validate a payload; raises ``pydantic.ValidationError`` if it breaks the contract."""
    if key not in DOCUMENTS:
        raise KeyError(f"unknown document {key!r}; expected one of {sorted(DOCUMENTS)}")
    data = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
    envelope = {
        "meta": {
            "schema_version": CONTRACT_VERSION,
            "producer": producer,
            "generated_at": (generated_at or datetime.now(timezone.utc)).isoformat(),
            "origin": Origin(origin).value,
            "notes": list(notes or []),
        },
        "data": data,
    }
    return DOCUMENT_MODELS[key].model_validate(envelope)


def write_document(state_dir: str | Path, key: str, payload: BaseModel | dict[str, Any], **kw: Any) -> Path:
    """Validate and atomically write ``<state_dir>/<key>.json``. Returns the path."""
    doc = build_document(key, payload, **kw)
    path = Path(state_dir) / DOCUMENTS[key][0]
    _atomic_write(path, json.dumps(doc.model_dump(mode="json"), indent=2) + "\n")
    return path


def append_event(state_dir: str | Path, event: AgentEvent | dict[str, Any]) -> Path:
    """Validate and append one event to the append-only ``agent_events.jsonl``."""
    ev = event if isinstance(event, AgentEvent) else AgentEvent.model_validate(event)
    path = Path(state_dir) / AGENT_EVENTS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(ev.model_dump(mode="json")) + "\n"
    with open(path, "a", encoding="utf-8") as f:
        f.write(line)
        f.flush()
        os.fsync(f.fileno())
    return path
