"""Attach the Command Centre (API + static UI) to a FastAPI application."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .api import create_router
from .provider import StateProvider

STATIC_DIR = Path(__file__).parent / "static"
STATIC_URL = "/cc/static"

#: Host headers accepted by default. The server binds to loopback; rejecting every other Host
#: header defeats DNS-rebinding pages that would otherwise read the snapshot (state, paths).
DEFAULT_ALLOWED_HOSTS: tuple[str, ...] = ("127.0.0.1", "localhost")

_NO_STORE = {"Cache-Control": "no-store"}


def mount_command_centre(
    app: FastAPI,
    provider: StateProvider,
    *,
    path: str = "/",
    allowed_hosts: Sequence[str] | None = DEFAULT_ALLOWED_HOSTS,
) -> FastAPI:
    """Register ``/api/cc/*``, ``/cc/static/*`` and the UI shell at ``path``.

    ``allowed_hosts`` installs a Host-header allow-list (``None`` leaves host checking to the
    embedding application).
    """
    app.include_router(create_router(provider))
    app.mount(STATIC_URL, StaticFiles(directory=STATIC_DIR), name="cc-static")
    index = STATIC_DIR / "index.html"

    @app.get(path, include_in_schema=False)
    def command_centre_index() -> FileResponse:
        return FileResponse(index, media_type="text/html", headers=_NO_STORE)

    @app.middleware("http")
    async def _nosniff(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        return response

    if allowed_hosts is not None:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(allowed_hosts))

    app.state.command_centre_provider = provider
    return app
