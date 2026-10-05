"""SENTRY Command Centre: the observability and control surface for SENTRY.

Integration seam::

    from atp.gui.command_centre import mount_command_centre
    from atp.gui.command_centre.provider import FileStateProvider

    mount_command_centre(app, FileStateProvider(state_dir))

The Command Centre reads producer-written state through a
:class:`~atp.gui.command_centre.provider.StateProvider` and never writes it.
"""

from __future__ import annotations

__version__ = "1.0.0"

from .mount import STATIC_DIR, mount_command_centre  # noqa: E402

__all__ = ["STATIC_DIR", "__version__", "mount_command_centre"]
