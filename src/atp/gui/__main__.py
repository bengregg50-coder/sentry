"""Launch the SENTRY Command Centre: ``python -m atp.gui [--state-dir DIR]``."""

from __future__ import annotations

import argparse
from pathlib import Path

from .app import STATE_DIR_ENV, create_app, default_allowed_hosts, default_provider
from .command_centre.provider import FileStateProvider


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m atp.gui", description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--state-dir",
        type=Path,
        default=None,
        help=f"SENTRY state directory (defaults to ${STATE_DIR_ENV}; unset = nothing connected)",
    )
    args = parser.parse_args(argv)
    provider = FileStateProvider(args.state_dir) if args.state_dir else default_provider()

    import uvicorn

    hosts = default_allowed_hosts()
    if args.host not in ("0.0.0.0", "::") and args.host not in hosts:
        hosts.append(args.host)  # the address the operator chose to bind is an accepted Host header
    uvicorn.run(create_app(provider, allowed_hosts=hosts), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
