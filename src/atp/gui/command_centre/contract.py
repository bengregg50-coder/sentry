"""Export the state contract as JSON Schema for producers.

    python -m atp.gui.command_centre.contract export [DIR]
    python -m atp.gui.command_centre.contract check  [DIR]

The committed schemas live in ``command_centre/contract/``; ``check`` fails if
they have drifted from the models (a test enforces this too).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from .schemas import CONTRACT_VERSION, DOCUMENT_MODELS, AgentEvent

CONTRACT_DIR = Path(__file__).parent / "contract"


def json_schemas() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for key, model in DOCUMENT_MODELS.items():
        schema = model.model_json_schema()
        schema["$id"] = f"sentry-command-centre/v{CONTRACT_VERSION}/{key}.schema.json"
        out[key] = schema
    ev = AgentEvent.model_json_schema()
    ev["$id"] = f"sentry-command-centre/v{CONTRACT_VERSION}/agent_event.schema.json"
    out["agent_event"] = ev
    return out


def render(schema: dict[str, Any]) -> str:
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def export(target: Path = CONTRACT_DIR) -> list[Path]:
    target.mkdir(parents=True, exist_ok=True)
    written = []
    for key, schema in json_schemas().items():
        path = target / f"{key}.schema.json"
        path.write_text(render(schema), encoding="utf-8")
        written.append(path)
    return written


def drift(target: Path = CONTRACT_DIR) -> list[str]:
    problems = []
    expected = json_schemas()
    for key, schema in expected.items():
        path = target / f"{key}.schema.json"
        if not path.exists():
            problems.append(f"missing {path.name}")
        elif path.read_text(encoding="utf-8") != render(schema):
            problems.append(f"stale {path.name}")
    for path in target.glob("*.schema.json"):
        if path.name.removesuffix(".schema.json") not in expected:
            problems.append(f"unexpected {path.name}")
    return problems


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in {"export", "check"}:
        print(__doc__)
        return 2
    target = Path(argv[1]) if len(argv) > 1 else CONTRACT_DIR
    if argv[0] == "export":
        for p in export(target):
            print(p)
        return 0
    problems = drift(target)
    for p in problems:
        print(p)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
