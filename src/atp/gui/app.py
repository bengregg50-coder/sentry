"""FastAPI application factory for the SENTRY GUI."""

from __future__ import annotations

import os
from collections.abc import Sequence
from pathlib import Path

from fastapi import FastAPI

from .command_centre import __version__, mount_command_centre
from .command_centre.mount import DEFAULT_ALLOWED_HOSTS
from .command_centre.provider import FileStateProvider, StateProvider

STATE_DIR_ENV = "SENTRY_STATE_DIR"
ALLOWED_HOSTS_ENV = "SENTRY_ALLOWED_HOSTS"


def default_provider() -> StateProvider:
    """State source from ``$SENTRY_STATE_DIR``; unconfigured if unset (everything shows NOT CONNECTED)."""
    raw = os.environ.get(STATE_DIR_ENV)
    return FileStateProvider(Path(raw) if raw else None)


def default_allowed_hosts() -> list[str]:
    """Loopback names plus any comma-separated extras in ``$SENTRY_ALLOWED_HOSTS``."""
    extra = [h.strip() for h in os.environ.get(ALLOWED_HOSTS_ENV, "").split(",") if h.strip()]
    return list(DEFAULT_ALLOWED_HOSTS) + extra


def create_app(provider: StateProvider | None = None, *, allowed_hosts: Sequence[str] | None = None) -> FastAPI:
    # No interactive docs and no OpenAPI document: the surface is read-only and not for discovery.
    app = FastAPI(title="SENTRY Command Centre", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    mount_command_centre(
        app,
        provider if provider is not None else default_provider(),
        allowed_hosts=list(allowed_hosts) if allowed_hosts is not None else default_allowed_hosts(),
    )
    return app
