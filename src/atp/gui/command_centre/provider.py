"""State providers: the only path by which SENTRY state reaches the Command Centre.

A provider reads producer-written documents and reports, for every document,
whether it is connected, valid, and where it came from. It never fills gaps:
a missing or invalid document yields ``data=None`` with an explicit status.

``FileStateProvider`` reads a *state directory* laid out as::

    <state_dir>/
        system.json  research.json  strategies.json  agents.json
        memory.json  governance.json  datasets.json  portfolio.json
        risk.json    execution.json   live.json      insights.json
        agent_events.jsonl          (append-only, one AgentEvent per line)

Each ``*.json`` file is ``{"meta": DocumentMeta, "data": <payload>}`` — see
:mod:`.schemas`. Integrators with existing state logic (for example a research
ledger reader) can implement :class:`StateProvider` directly instead of
exporting files; the API and UI only depend on the protocol.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, ValidationError

from .schemas import AGENT_EVENTS_FILE, DOCUMENT_MODELS, DOCUMENTS, AgentEvent, DocumentMeta


class SourceStatus(str, Enum):
    OK = "OK"
    MISSING = "MISSING"  # state dir configured, document absent
    INVALID = "INVALID"  # present but fails the contract
    UNREADABLE = "UNREADABLE"  # present but cannot be read / parsed as JSON
    NOT_CONFIGURED = "NOT_CONFIGURED"  # no state source configured at all


@dataclass(frozen=True)
class SourceResult:
    key: str
    label: str
    file: str
    status: SourceStatus
    path: str | None = None
    modified_at: datetime | None = None
    size: int | None = None
    error: str | None = None
    meta: DocumentMeta | None = None
    data: BaseModel | None = None

    @property
    def ok(self) -> bool:
        return self.status is SourceStatus.OK

    def describe(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "file": self.file,
            "status": self.status.value,
            "path": self.path,
            "modified_at": self.modified_at.isoformat() if self.modified_at else None,
            "size": self.size,
            "error": self.error,
            "meta": self.meta.model_dump(mode="json") if self.meta else None,
        }


@dataclass(frozen=True)
class EventsResult:
    status: SourceStatus
    path: str | None = None
    modified_at: datetime | None = None
    events: tuple[AgentEvent, ...] = ()
    invalid_lines: int = 0
    first_error: str | None = None
    total_lines: int = 0

    def describe(self) -> dict[str, Any]:
        return {
            "key": "agent_events",
            "label": "Agent event stream",
            "file": AGENT_EVENTS_FILE,
            "status": self.status.value,
            "path": self.path,
            "modified_at": self.modified_at.isoformat() if self.modified_at else None,
            "total_lines": self.total_lines,
            "valid_events": len(self.events),
            "invalid_lines": self.invalid_lines,
            "error": self.first_error,
        }


@runtime_checkable
class StateProvider(Protocol):
    """What the Command Centre needs from SENTRY. Read-only by construction."""

    kind: str

    def location(self) -> str | None: ...

    def load(self, key: str) -> SourceResult: ...

    def load_events(self) -> EventsResult: ...

    def revision(self) -> str: ...


def _format_validation_error(exc: ValidationError, limit: int = 5) -> str:
    parts = []
    for err in exc.errors()[:limit]:
        loc = ".".join(str(p) for p in err.get("loc", ()))
        parts.append(f"{loc}: {err.get('msg')}")
    more = len(exc.errors()) - limit
    if more > 0:
        parts.append(f"(+{more} more)")
    return "; ".join(parts)


@dataclass
class _CacheEntry:
    signature: tuple[int, int]
    result: Any


@dataclass
class FileStateProvider:
    """Reads contract documents from a directory. ``state_dir=None`` means not configured."""

    state_dir: Path | None
    kind: str = "file"
    _cache: dict[str, _CacheEntry] = field(default_factory=dict, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def __post_init__(self) -> None:
        if self.state_dir is not None:
            self.state_dir = Path(self.state_dir)

    # -- protocol -----------------------------------------------------------

    def location(self) -> str | None:
        return str(self.state_dir) if self.state_dir is not None else None

    def load(self, key: str) -> SourceResult:
        file, _, label = DOCUMENTS[key]
        if self.state_dir is None:
            return SourceResult(key, label, file, SourceStatus.NOT_CONFIGURED)
        path = self.state_dir / file
        try:
            st = path.stat()
        except FileNotFoundError:
            return SourceResult(key, label, file, SourceStatus.MISSING, path=str(path))
        except OSError as exc:
            return SourceResult(key, label, file, SourceStatus.UNREADABLE, path=str(path), error=str(exc))
        signature = (st.st_mtime_ns, st.st_size)
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None and cached.signature == signature:
                return cached.result
        result = self._read_document(key, path, st)
        with self._lock:
            self._cache[key] = _CacheEntry(signature, result)
        return result

    def load_events(self) -> EventsResult:
        if self.state_dir is None:
            return EventsResult(SourceStatus.NOT_CONFIGURED)
        path = self.state_dir / AGENT_EVENTS_FILE
        try:
            st = path.stat()
        except FileNotFoundError:
            return EventsResult(SourceStatus.MISSING, path=str(path))
        except OSError as exc:
            return EventsResult(SourceStatus.UNREADABLE, path=str(path), first_error=str(exc))
        signature = (st.st_mtime_ns, st.st_size)
        with self._lock:
            cached = self._cache.get("__events__")
            if cached is not None and cached.signature == signature:
                return cached.result
        result = self._read_events(path, st)
        with self._lock:
            self._cache["__events__"] = _CacheEntry(signature, result)
        return result

    def revision(self) -> str:
        """Changes whenever any source file changes (used for cheap UI polling)."""
        if self.state_dir is None:
            return "not-configured"
        h = hashlib.sha256()
        for name in sorted([f for f, _, _ in DOCUMENTS.values()] + [AGENT_EVENTS_FILE]):
            try:
                st = (self.state_dir / name).stat()
                h.update(f"{name}:{st.st_mtime_ns}:{st.st_size};".encode())
            except OSError:
                h.update(f"{name}:-;".encode())
        return h.hexdigest()[:16]

    # -- internals ----------------------------------------------------------

    def _read_document(self, key: str, path: Path, st: Any) -> SourceResult:
        file, _, label = DOCUMENTS[key]
        common = {
            "path": str(path),
            "modified_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
            "size": st.st_size,
        }
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            return SourceResult(key, label, file, SourceStatus.UNREADABLE, error=str(exc), **common)
        try:
            doc = DOCUMENT_MODELS[key].model_validate(raw)
        except ValidationError as exc:
            meta = None
            if isinstance(raw, dict) and isinstance(raw.get("meta"), dict):
                try:
                    meta = DocumentMeta.model_validate(raw["meta"])
                except ValidationError:
                    meta = None
            return SourceResult(
                key, label, file, SourceStatus.INVALID, error=_format_validation_error(exc), meta=meta, **common
            )
        return SourceResult(key, label, file, SourceStatus.OK, meta=doc.meta, data=doc.data, **common)

    def _read_events(self, path: Path, st: Any) -> EventsResult:
        modified = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc)
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError) as exc:
            return EventsResult(SourceStatus.UNREADABLE, path=str(path), modified_at=modified, first_error=str(exc))
        events: list[AgentEvent] = []
        invalid = 0
        first_error: str | None = None
        total = 0
        for n, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            total += 1
            try:
                events.append(AgentEvent.model_validate_json(line))
            except ValidationError as exc:
                invalid += 1
                if first_error is None:
                    first_error = f"line {n}: {_format_validation_error(exc, limit=2)}"
        events.sort(key=lambda e: e.ts)
        status = SourceStatus.OK if invalid == 0 else SourceStatus.INVALID
        return EventsResult(
            status,
            path=str(path),
            modified_at=modified,
            events=tuple(events),
            invalid_lines=invalid,
            first_error=first_error,
            total_lines=total,
        )


def empty_provider() -> FileStateProvider:
    """A provider with no state source: every document is NOT_CONFIGURED."""
    return FileStateProvider(None)


def load_all(provider: StateProvider, keys: Iterable[str] = DOCUMENTS) -> dict[str, SourceResult]:
    return {key: provider.load(key) for key in keys}
