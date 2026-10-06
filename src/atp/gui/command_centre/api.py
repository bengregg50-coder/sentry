"""Read-only HTTP API for the Command Centre.

Every route is GET. There is deliberately no endpoint that mutates SENTRY
state, places orders, assigns strategies or changes governance records.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from . import __version__
from .derive import derive_all
from .provider import StateProvider, load_all
from .schemas import AGENT_EVENTS_FILE, CONTRACT_VERSION, DOCUMENTS, AgentEventKind


def provider_revisions(provider: StateProvider) -> dict[str, str]:
    """{revision, documents, events}. Providers without split revisions report the combined one for both."""
    split = getattr(provider, "revisions", None)
    if callable(split):
        return dict(split())
    rev = provider.revision()
    return {"revision": rev, "documents": rev, "events": rev}


def build_snapshot(provider: StateProvider) -> dict[str, Any]:
    # The revision is taken BEFORE reading: a producer write that lands while the snapshot is
    # being built then changes the next /revision, so the client refetches instead of keeping
    # old data stamped with the new revision.
    revs = provider_revisions(provider)
    sources = load_all(provider)
    events = provider.load_events()
    documents = {
        key: (src.data.model_dump(mode="json") if src.ok and src.data is not None else None)
        for key, src in sources.items()
    }
    now = datetime.now(timezone.utc)
    derived = derive_all(sources, events, now=now)
    # The per-slot agent payload duplicates documents.agents; the client re-joins it by slot.
    for slot in derived.get("agent_slots") or []:
        slot.pop("agent", None)
    return {
        "generated_at": now.isoformat(),
        "revision": revs["revision"],
        "revisions": revs,
        "contract_version": CONTRACT_VERSION,
        "app_version": __version__,
        "read_only": True,
        "provider": {"kind": provider.kind, "location": provider.location()},
        "sources": {key: src.describe() for key, src in sources.items()},
        "events_source": events.describe(),
        "documents": documents,
        "derived": derived,
    }


def create_router(provider: StateProvider) -> APIRouter:
    router = APIRouter(prefix="/api/cc", tags=["command-centre"])

    @router.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "app_version": __version__,
            "contract_version": CONTRACT_VERSION,
            "read_only": True,
            "provider": {"kind": provider.kind, "location": provider.location()},
        }

    @router.get("/revision")
    def revision() -> dict[str, str]:
        revs = provider_revisions(provider)
        return {"revision": revs["revision"], "documents": revs["documents"], "events": revs["events"]}

    @router.get("/snapshot")
    def snapshot() -> dict[str, Any]:
        return build_snapshot(provider)

    @router.get("/sources")
    def sources() -> dict[str, Any]:
        return {
            "documents": {k: s.describe() for k, s in load_all(provider).items()},
            "events": provider.load_events().describe(),
        }

    @router.get("/events")
    def events(
        slot: int | None = Query(default=None, ge=1, le=5),
        limit: int = Query(default=200, ge=1, le=5000),
        kind: AgentEventKind | None = None,
    ) -> dict[str, Any]:
        res = provider.load_events()
        items = list(res.events)
        if slot is not None:
            items = [e for e in items if e.agent_slot == slot]
        if kind is not None:
            items = [e for e in items if e.kind is kind]
        items = items[-limit:]
        return {
            "source": res.describe(),
            "events": [e.model_dump(mode="json") for e in reversed(items)],
        }

    @router.get("/contract")
    def contract_index() -> dict[str, Any]:
        return {
            "contract_version": CONTRACT_VERSION,
            "documents": {k: {"file": f, "label": label} for k, (f, _, label) in DOCUMENTS.items()},
            "event_stream": AGENT_EVENTS_FILE,
        }

    @router.get("/contract/{name}")
    def contract_schema(name: str) -> dict[str, Any]:
        from .contract import json_schemas  # lazy: keeps `python -m ...contract` free of runpy warnings

        schemas = json_schemas()
        key = name.removesuffix(".schema.json")
        if key not in schemas:
            raise HTTPException(status_code=404, detail=f"unknown contract document {name!r}")
        return schemas[key]

    return router
