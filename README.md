# SENTRY — Command Centre

The permanent observability and control surface for SENTRY: a governed quantitative research
system that may eventually operate five specialised trading agents with shared, evidence-backed
memory.

**Current state of SENTRY (as reflected by this UI): no validated strategy, no live trading, no
agent runtime.** The interface is complete; it shows honest empty states until real state is
connected. It never fabricates P&L, trades, positions, signals, metrics, memories or counts.

## Run

```bash
pip install -e ".[dev]"            # fastapi, uvicorn, pydantic (+ pytest, httpx)
python -m atp.gui                  # http://127.0.0.1:8765 — nothing connected
python -m atp.gui --state-dir DIR  # or SENTRY_STATE_DIR=DIR
```

Preview populated layouts with **synthetic** data (red banner: not SENTRY state):

```bash
python -m atp.gui --state-dir tests/gui/fixtures/synthetic_state
```

## What is here

| path | purpose |
|---|---|
| `src/atp/gui/command_centre/schemas.py` | the state contract (typed, versioned, provenance-tagged) |
| `src/atp/gui/command_centre/contract/` | exported JSON Schemas for producers |
| `src/atp/gui/command_centre/provider.py` | reads state; reports OK / MISSING / INVALID / NOT_CONFIGURED per source |
| `src/atp/gui/command_centre/derive.py` | aggregates and cross-checks declared state (never decides research) |
| `src/atp/gui/command_centre/producer.py` | validated, atomic writers for producers (research engine, agents) |
| `src/atp/gui/command_centre/api.py` | read-only `GET /api/cc/*` |
| `src/atp/gui/command_centre/static/` | offline-first UI (no build step, no CDN, CSP `'self'`) |
| `tests/gui/` | contract, provider, derivation, API, offline, and headless-browser tests |

Integration details: [`src/atp/gui/command_centre/README.md`](src/atp/gui/command_centre/README.md).

## Tests

```bash
pip install -e ".[dev,browser]"
python -m pytest tests/gui -q                 # browser tests skip if Playwright/Chromium are absent
python -m pytest tests/gui -q -m "not browser"
```

## Provenance note

This repository was empty when the Command Centre was built (2026-10-05). The pre-existing
`src/atp/gui` application, research ledger and datasets described in the SENTRY project were not
available here, so nothing from them is hardcoded. The Command Centre is packaged as
`atp.gui.command_centre` with a single integration seam (`mount_command_centre(app, provider)`) so
it can be mounted into the existing FastAPI GUI, and the existing state logic can be exposed through a
`StateProvider` or by exporting contract documents.
