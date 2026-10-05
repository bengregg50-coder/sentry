// Agent activity — the thinking view. A reverse-chronological terminal log of
// what one agent recorded (observe → interpret → recall → hypothesise → test →
// evaluate → learn → write memory → propose), its learning loop with the
// autonomy boundary, its improvement proposals and the memories it touched.
// Every line is a recorded event; nothing is narrated or summarised by the UI.

import { html, cx } from "../core/html.js";
import { fmtCount, fmtDateTime, humanize, isNil } from "../core/format.js";
import { doc, source, findMemory } from "../core/state.js";
import { pageHeader, panel, badge, val, chip, originBadge, sourceTag, sourceEmpty, emptyState, table, tabs } from "../components/ui.js";
import { steps } from "../components/flow.js";
import { icon } from "../components/icons.js";
import {
  KIND_GROUPS,
  EVENT_KINDS,
  LOOP_STAGES,
  GATED_STAGES,
  parseSlot,
  agentLabel,
  slotView,
  slotSwitcher,
  statusMark,
  loadEvents,
  eventsAvailable,
  eventsAbsence,
  eventLog,
  logEmpty,
  ageVal,
  subhead,
  goLink,
  memoryHref,
  strategyHref,
  unknownSlotPage,
  pad2,
} from "./_agents-common.js";

const EVENT_WINDOW = 1000;

/* ------------------------------------------------------------------ learning loop */

function learningLoop(ctx, n, res, events) {
  const evOk = eventsAvailable(ctx, res);
  const strategies = doc(ctx, "strategies");
  const props = strategies ? strategies.proposals.filter((p) => p.agent_slot === n) : null;
  const byKind = new Map();
  for (const e of events) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  const list = [
    ...LOOP_STAGES.map(([key, label, kind]) => ({
      key,
      label,
      count: evOk ? byKind.get(kind) ?? 0 : null,
      owner: `AGENT · ${humanize(kind)}`,
    })),
    ...GATED_STAGES.map(([key, label, owner, states], i) => ({
      key,
      label,
      count: props ? props.filter((p) => states.includes(p.state)).length : null,
      owner: `${owner} · PROPOSALS`,
      boundary: i === 0,
    })),
  ];
  return html`
    <div class="ag-loop">${steps(list, { cls: "ag-loop__steps" })}
      <div class="ag-loop__zones" aria-hidden="true">
        <span class="ag-loop__zone ag-loop__zone--agent" style="grid-column: span ${LOOP_STAGES.length}">AGENT-AUTONOMOUS · RESEARCH MODE · WITHIN DECLARED LIMITS</span>
        <span class="ag-loop__zone ag-loop__zone--gated" style="grid-column: span ${GATED_STAGES.length}">GATED · RESEARCH + GOVERNANCE</span>
      </div>
    </div>
    <div class="ag-loop__note">
      ${evOk ? html`Agent-stage counts are this slot's recorded events of each kind (${fmtCount(events.length)} loaded).` : html`<span class="muted">Agent-stage counts unavailable: ${eventsAbsence(ctx, res)}</span>`}
      ${props ? html` Research and governance stages count proposals from ${agentLabel(n)} by state.` : html` <span class="muted">Gated-stage counts unavailable: strategies.json is not connected.</span>`}
    </div>
    <div class="ag-boundary">
      <div class="ag-boundary__side ag-boundary__side--agent">
        <div class="ag-boundary__title">${icon("cpu", "icon")}Autonomous research learning</div>
        <p>Within declared limits an agent may learn on its own: observe, interpret, recall evidence-backed memory, form and test hypotheses in research mode, evaluate, write memory and propose improvements. None of this touches a running strategy.</p>
      </div>
      <div class="ag-boundary__line" aria-hidden="true"><span>BOUNDARY</span></div>
      <div class="ag-boundary__side ag-boundary__side--gated">
        <div class="ag-boundary__title">${icon("governance", "icon")}Production change is gated</div>
        <p>A proposal changes nothing by itself. It must pass research validation and governance approval, and it is released as a <b>new strategy version</b>. A deployed version is never modified in place.</p>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ stream side panels */

function kindIndex(ctx, n, res, events, active) {
  const evOk = eventsAvailable(ctx, res);
  const counts = new Map();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return html`<div class="ag-kinds">
    ${KIND_GROUPS.map(
      (g) => html`<div class="ag-kinds__group">
        <div class="ag-kinds__label">${g.label}</div>
        ${g.kinds.map((k) => {
          const c = evOk ? counts.get(k) ?? 0 : null;
          return html`<a class="${cx("ag-kinds__row", k === active && "is-active", !c && "is-zero")}" href="#/agents/${n}/activity?kind=${k}" data-kind-index="${k}">
            <span class="ag-kinds__k">${humanize(k)}</span>
            ${isNil(c) ? val(null) : html`<span class="v" data-v>${c}</span>`}
          </a>`;
        })}
      </div>`,
    )}
  </div>`;
}

function streamSummary(ctx, sv, res, events) {
  const evOk = eventsAvailable(ctx, res);
  const total = sv.slot?.events?.count;
  const modes = new Map();
  for (const e of events) modes.set(e.mode, (modes.get(e.mode) ?? 0) + 1);
  const newest = events[0]?.ts ?? null;
  const oldest = events.length ? events[events.length - 1].ts : null;
  const cell = (k, v) => html`<div class="ag-sum__cell"><div class="ag-sum__k">${k}</div><div class="ag-sum__v">${v}</div></div>`;
  return html`<div class="ag-sum">
    ${cell("Events (slot)", evOk && !isNil(total) ? val(fmtCount(total)) : val(null))}
    ${cell("Loaded", evOk ? val(fmtCount(events.length)) : val(null))}
    ${cell("Newest", newest ? ageVal(newest, ctx.now) : evOk ? html`<span class="ag-none">NONE</span>` : val(null))}
    ${cell("Oldest loaded", oldest ? html`<span class="v mono" data-v>${fmtDateTime(oldest)}</span>` : val(null))}
  </div>
  ${subhead("By mode")}
  <div class="ag-modes">
    ${["RESEARCH", "SIM", "PAPER", "LIVE"].map(
      (m) => html`<div class="ag-modes__cell"><span class="ag-modes__k">${m}</span>${evOk ? html`<span class="v" data-v>${modes.get(m) ?? 0}</span>` : val(null)}</div>`,
    )}
  </div>`;
}

/* ------------------------------------------------------------------ proposals + memory */

function proposalsArea(ctx, n) {
  const src = source(ctx, "strategies");
  const strategies = doc(ctx, "strategies");
  if (!strategies) {
    return sourceEmpty(src, {
      title: "Proposals not connected",
      hint: "Improvement proposals from this agent — with their state and the strategy version they produced — appear when strategies.json is produced.",
      compact: true,
    });
  }
  const rows = strategies.proposals.filter((p) => p.agent_slot === n).sort((a, b) => (a.proposed_at < b.proposed_at ? 1 : -1));
  return table({
    dense: true,
    columns: [
      { key: "proposal_id", label: "Proposal", render: (r) => html`<span class="ref" data-proposal="${r.proposal_id}">${r.proposal_id}</span>` },
      { key: "proposed_at", label: "Proposed", cls: "ag-nowrap", render: (r) => html`<span class="mono">${fmtDateTime(r.proposed_at)}</span>` },
      { key: "strategy_id", label: "Strategy", cls: "ag-nowrap", render: (r) => html`<a class="ref" href="${strategyHref(r.strategy_id)}">${r.strategy_id}</a> <span class="mono muted">from v${r.base_version}</span>` },
      { key: "summary", label: "Summary", cls: "wrap", render: (r) => html`${r.summary}${r.rationale ? html`<div class="muted small">${r.rationale}</div>` : ""}` },
      { key: "state", label: "State", render: (r) => badge(r.state) },
      {
        key: "resulting_version",
        label: "Result",
        cls: "ag-nowrap",
        render: (r) => (isNil(r.resulting_version) ? html`<span class="ag-none">NO NEW VERSION</span>` : html`<span class="mono strong">v${r.resulting_version}</span> <span class="muted small">new version</span>`),
      },
      {
        key: "evidence_refs",
        label: "Evidence",
        render: (r) =>
          r.evidence_refs.length
            ? html`<span class="cluster">${r.evidence_refs.map((id) => (findMemory(ctx, id) ? html`<a class="ref" href="${memoryHref(id)}">${id}</a>` : html`<span class="ref">${id}</span>`))}</span>`
            : null,
      },
    ],
    rows,
    empty: emptyState({
      title: "No proposals from this agent",
      reason: `strategies.json is connected; ${agentLabel(n)} has made no improvement proposals.`,
      hint: "A proposal can only ever become a new strategy version after research validation and governance approval.",
      compact: true,
      iconName: "version",
    }),
  });
}

function memoryTraffic(ctx, n, res, events) {
  const evOk = eventsAvailable(ctx, res);
  const memOk = source(ctx, "memory")?.status === "OK";
  const collect = (kind) => {
    const seen = new Map();
    for (const e of events) {
      if (e.kind !== kind) continue;
      for (const id of e.refs?.memory_ids ?? []) if (!seen.has(id)) seen.set(id, e.ts);
    }
    return [...seen.entries()];
  };
  const col = (title, kind, items) => html`<div class="ag-traffic__col" data-traffic="${kind}">
    <div class="ag-traffic__head"><span>${title}</span>${evOk ? html`<span class="v" data-v>${items.length}</span>` : val(null)}</div>
    ${items.length
      ? items.map(([id, ts]) => {
          const m = findMemory(ctx, id);
          return html`<a class="ag-traffic__row" href="${memoryHref(id)}">
            <span class="ref">${id}</span>
            <span class="ag-traffic__title">${m ? m.title : memOk ? "Not found in memory store" : "memory.json not connected"}</span>
            <span class="ag-traffic__meta">${m ? badge(m.validation_state) : ""}${originBadge(m?.origin)}${ageVal(ts, ctx.now)}</span>
          </a>`;
        })
      : html`<div class="ag-traffic__none">${evOk ? `No ${humanize(kind)} events reference a memory.` : "Event stream not connected."}</div>`}
  </div>`;
  return html`<div class="ag-traffic">
    ${col("Recalled", "MEMORY_RECALL", collect("MEMORY_RECALL"))}
    ${col("Written", "MEMORY_WRITE", collect("MEMORY_WRITE"))}
  </div>`;
}

/* ------------------------------------------------------------------ view */

export default {
  title(ctx) {
    const n = parseSlot(ctx.params.slot);
    return n ? `Agent ${pad2(n)} · Activity` : "Unknown slot";
  },
  async load(ctx) {
    const n = parseSlot(ctx.params.slot);
    if (!n) return { invalid: true };
    return { events: await loadEvents({ slot: n, limit: EVENT_WINDOW }) };
  },
  render(ctx) {
    const n = parseSlot(ctx.params.slot);
    if (!n) return unknownSlotPage(ctx, ctx.params.slot, { pageHeader, panel, emptyState });
    const sv = slotView(ctx, n);
    const res = ctx.extra?.events ?? null;
    const evOk = eventsAvailable(ctx, res);
    const events = res?.events ?? [];
    const requested = ctx.query?.kind ?? null;
    const kind = requested && EVENT_KINDS.includes(requested) ? requested : null;
    const shown = kind ? events.filter((e) => e.kind === kind) : events;
    const counts = new Map();
    for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    const tabItems = [
      { key: "ALL", label: "All", href: `#/agents/${n}/activity`, count: evOk ? events.length : null },
      ...EVENT_KINDS.filter((k) => counts.get(k) || k === kind).map((k) => ({ key: k, label: humanize(k), href: `#/agents/${n}/activity?kind=${k}`, count: counts.get(k) ?? 0 })),
    ];

    return html`<div class="ag-page ag-page--activity">
      ${pageHeader({
        kicker: html`TRADING FLOOR · ${agentLabel(n)}`,
        code: `AGT-${pad2(n)}`,
        title: `Agent ${pad2(n)} · Activity & reasoning`,
        sub: "What this agent observed, recalled, hypothesised, tested and learned — and what it proposed — newest first. Every line is a recorded event; nothing is narrated by the Command Centre.",
        right: html`${statusMark(sv.status)}${slotSwitcher(ctx, n, { suffix: "/activity" })}${goLink(`#/agents/${n}`, "Terminal")}`,
      })}

      <div class="grid">
        ${panel({
          span: 12,
          code: "AA-01",
          title: "Learning loop",
          sub: `${agentLabel(n)} · observe → propose is autonomous; validation, approval and release are not`,
          body: learningLoop(ctx, n, res, events),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 8,
          code: "AA-02",
          title: "Reasoning stream",
          sub: evOk ? (kind ? `${humanize(kind)} · ${shown.length} of ${events.length} loaded` : `${events.length} events loaded, newest first`) : "agent_events.jsonl",
          actions: html`${sourceTag(res?.source ?? source(ctx, "agent_events"), { now: ctx.now })}`,
          body: html`
            <div class="ag-tabs">${tabs(tabItems, kind ?? "ALL")}</div>
            ${requested && !kind ? html`<div class="ag-filter-note">${icon("alert", "icon")}Unknown event kind “${requested}” — showing all events.</div>` : ""}
            ${eventLog(ctx, shown, {
              maxHeight: 760,
              prompt: shown.length ? `sentry://agents/${pad2(n)}/reasoning${kind ? ` --kind ${kind}` : ""}` : null,
              empty: logEmpty({
                reason: eventsAbsence(ctx, res, { slot: n, kind }),
                hint: "Each recorded step — observation, interpretation, memory recall, hypothesis, test, evaluation, learning, memory write, proposal — appears here as a timestamped line with links to the memories, strategy and proposal it references.",
              }),
            })}`,
          cls: "ag-fillbody",
        })}
        <div class="span-4 stack">
          ${panel({ code: "AA-03", title: "Stream", sub: "This slot's recorded events", body: streamSummary(ctx, sv, res, events) })}
          ${panel({ code: "AA-04", title: "Event kinds", sub: "Filter the stream by kind", body: kindIndex(ctx, n, res, events, kind) })}
        </div>
      </div>

      <div class="grid">
        ${panel({
          span: 7,
          code: "AA-05",
          title: "Improvement proposals",
          sub: `Proposed by ${agentLabel(n)} · each can only become a new version`,
          body: proposalsArea(ctx, n),
          cls: "ag-xl-12",
        })}
        ${panel({
          span: 5,
          code: "AA-06",
          title: "Memory traffic",
          sub: "Memories recalled and written, from event references",
          body: memoryTraffic(ctx, n, res, events),
          cls: "ag-xl-12",
        })}
      </div>
    </div>`;
  },
};
