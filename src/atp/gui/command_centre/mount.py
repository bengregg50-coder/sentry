"""Attach the Command Centre (API + static UI) to a FastAPI application."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import create_router
from .provider import StateProvider

STATIC_DIR = Path(__file__).parent / "static"
STATIC_URL = "/cc/static"

_NO_STORE = {"Cache-Control": "no-store"}


def mount_command_centre(app: FastAPI, provider: StateProvider, *, path: str = "/") -> FastAPI:
    """Register ``/api/cc/*``, ``/cc/static/*`` and the UI shell at ``path``."""
    app.include_router(create_router(provider))
    app.mount(STATIC_URL, StaticFiles(directory=STATIC_DIR), name="cc-static")
    index = STATIC_DIR / "index.html"

    @app.get(path, include_in_schema=False)
    def command_centre_index() -> FileResponse:
        return FileResponse(index, media_type="text/html", headers=_NO_STORE)

    app.state.command_centre_provider = provider
    return app
