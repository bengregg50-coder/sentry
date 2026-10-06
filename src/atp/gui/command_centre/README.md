# SENTRY Command Centre

The observability and control surface for SENTRY. It renders producer-written
state; it never authors, estimates, or backfills it.

```
RESEARCH ENGINE / VALIDATION / AGENTS / EXECUTION      (producers — not in this package)
        │  write contract documents (JSON) + agent_events.jsonl
        ▼
StateProvider  (provider.py)        → validates against schemas.py, reports per-source status
        ▼
derive.py                            → aggregates + cross-checks declared state (never decides research)
        ▼
GET /api/cc/*  (api.py, read-only)   → one snapshot: sources + documents + derived
        ▼
static/  (vanilla ES modules, no build step, no network)  → the UI
```

Run: `python -m atp.gui --state-dir <DIR>` (or `SENTRY_STATE_DIR`), served on `127.0.0.1:8765`.
Only loopback `Host` headers are accepted (DNS-rebinding guard); add names with
`SENTRY_ALLOWED_HOSTS=a,b` or by binding `--host` to a specific address.
With no state dir every panel shows NOT CONNECTED — that is the correct display of what is known.

Preview populated layouts with the **synthetic** fixture (a red banner marks it as not SENTRY state):
`python -m atp.gui --state-dir tests/gui/fixtures/synthetic_state`

## Integration seam

```python
from atp.gui.command_centre import mount_command_centre
from atp.gui.command_centre.provider import FileStateProvider
mount_command_centre(app, FileStateProvider(state_dir))   # adds /api/cc/*, /cc/static/*, and the UI at "/"
```

Producers either write the documents below into a state directory, or implement the
`StateProvider` protocol (`kind`, `location()`, `load(key)`, `load_events()`, `revision()`) over
existing state logic (e.g. a ledger reader). JSON Schemas: `contract/*.schema.json`
(`python -m atp.gui.command_centre.contract export|check`).

| file | payload model | what it carries |
|---|---|---|
| `system.json` | `SystemState` | declared subsystem status |
| `research.json` | `ResearchState` | programmes, hypotheses, trials, trial accounting, integrity notices, research areas, research roles |
| `strategies.json` | `StrategiesState` | strategies with **versions** (metrics with basis, validation checks, multiple testing, approval, deployment package) and improvement proposals |
| `agents.json` | `AgentsState` | the five agent slots: status, assignment, signal, positions, orders, trades, P&L, equity, risk, execution, connections, alerts, bars |
| `agent_events.jsonl` | `AgentEvent` per line | append-only agent activity / reasoning stream |
| `memory.json` | `MemoryState` | evidence-backed memories with supporting/contradicting evidence |
| `governance.json` | `GovernanceDoc` | governance checks, referee, change history |
| `datasets.json` | `DatasetsState` | dataset coverage, identity hashes, integrity, gaps, reconstruction |
| `portfolio.json` / `risk.json` / `execution.json` / `live.json` | … | operations state |
| `insights.json` | `InsightsState` | research digests, null results |

Every document is `{"meta": DocumentMeta, "data": <payload>}`; `meta.origin` is `ORIGINAL`,
`RECONSTRUCTED` or `SYNTHETIC_FIXTURE`. Records carry their own `origin` too. Counts of different
origins are never merged.

Contract rules a producer must meet (else the document is INVALID, with the error shown):
timestamps carry a timezone; numbers are finite (no NaN / Infinity); equity series and bars are
strictly ascending with unique timestamps. Optional declarations the UI uses when present:
`meta.heartbeat_max_age_s` (freshness bound — staleness is never judged without it),
`Strategy.stage_reached` / `terminal` (pipeline placement — never inferred from registry status),
`Trial.experiment_id`, `ResearchFocus.family`, `RiskLimit.currency`, `EventRefs.hypothesis_ids` /
`programme_id`, and the `APPLICABILITY_TEST` event kind.

## Honesty rules (enforced in code and tests)

* `null` is empty, never zero. Missing source ⇒ derived counts are `null`; connected-but-empty ⇒ `0`.
* "No findings" means only "none from the checks that ran": `derived.check_coverage` lists which
  families of cross-checks ran and which source each skipped family is missing. With nothing
  connected the UI says NOT CONNECTED, never NO FINDINGS.
* An INVALID / UNREADABLE source is a source error, never a calm default (e.g. agent slots become
  `SOURCE_ERROR`, not `SLEEPING`).
* Handoff steps are cumulative: a step is COMPLETE only if every earlier step is COMPLETE; a step
  declared out of order is a VIOLATION (and a consistency finding). An ongoing simulation is RUNNING.
* Every metric carries a `basis` (IN_SAMPLE / OUT_OF_SAMPLE / WALK_FORWARD / … / LIVE); the UI shows it.
* State colours come only from `static/js/core/tones.js`. Green = passed/validated/approved only.
  Amber = pending/blocked/DIFFERS/RECONSTRUCTED. Red = fail/reject/violation. Unknown = muted.
  `COMPLETE` is not a pass (a programme can complete with a null result); handoff step states use
  `stepTone()`, the only place a COMPLETE step is green.
* No mutating endpoints. Controls render locked with server-computed blockers (`derived.controls`).
* No external network: CSP `default-src 'self'`; fonts are system/local; charts are vendored.

## Frontend conventions

* `js/core/html.js` — `html\`\`` escapes every interpolation. Use `raw()` only for trusted constants.
* `js/core/state.js` — `doc(ctx,key)`, `source(ctx,key)`, `derived(ctx,key)`, `sourceReason(src)` …
* `js/components/ui.js` — `pageHeader, panel, badge, dot, stat, statRow, val, metric, basisChip,
  originBadge, emptyState, sourceEmpty, sourceTag, table, kv, tabs, findingsList, notice,
  integrityNotices, control, controlButton, meter, refLink, refList, legend`.
* Value helpers mark nodes with `data-v`; empty ones add `.is-empty` / `data-empty`. Tests assert that
  with no state connected, no `[data-v]` node displays a value.
* `derived.agent_slots[i].agent` is joined client-side from `documents.agents` (sent once).
  Polling refetches at once when documents change; event-stream-only changes refetch at most every 15 s.
* One failing derivation never takes the snapshot down: it is reported in `derived.errors` and as a
  `DERIVATION_ERROR` finding.
* Diagrams: `pipeline.js` (`pipelineDiagram`, `pipelineTracks`), `flow.js` (`steps`, `cycleRing`),
  `graph.js` (`knowledgeGraph`, `graphSchematic`), `chart.js` (`chartHost`, `sparkline`),
  `agent.js` (`agentMini`).
* A view module: `export default { title, load?(ctx), render(ctx) -> Safe, mount?(root, ctx) -> cleanup }`.
  `ctx = { snap, params, query, props, route, now, extra }`. Charts and graph hover are mounted
  automatically by the shell.
