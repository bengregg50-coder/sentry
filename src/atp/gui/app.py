"""FastAPI application factory for the SENTRY GUI."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

from .command_centre import __version__, mount_command_centre
from .command_centre.provider import FileStateProvider, StateProvider

STATE_DIR_ENV = "SENTRY_STATE_DIR"


def default_provider() -> StateProvider:
    """State source from ``$SENTRY_STATE_DIR``; unconfigured if unset (everything shows NOT CONNECTED)."""
    raw = os.environ.get(STATE_DIR_ENV)
    return FileStateProvider(Path(raw) if raw else None)


def create_app(provider: StateProvider | None = None) -> FastAPI:
    app = FastAPI(title="SENTRY Command Centre", version=__version__, docs_url=None, redoc_url=None)
    mount_command_centre(app, provider if provider is not None else default_provider())
    return app
