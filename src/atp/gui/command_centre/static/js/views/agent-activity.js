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

/* ------------------------------------------------------------------ loaded window */

/**
 * What the loaded window covers. The API returns this slot's newest
 * EVENT_WINDOW events, so a count over the window is the slot's recorded total
 * only when the window holds every event (fewer than the limit came back, or as
 * many as derived.agent_slots counts for the slot). Otherwise it is partial.
 */
function windowOf(ctx, sv, res) {
  const evOk = eventsAvailable(ctx, res);
  const events = res?.events ?? [];
  const total = evOk ? sv.slot?.events?.count ?? null : null;
  const loaded = events.length;
  const complete = evOk && (loaded < EVENT_WINDOW || (!isNil(total) && loaded >= total));
  return { evOk, events, total, loaded, complete, partial: evOk && !complete };
}

/** "the latest 1,000 of 1,200 recorded events" — what a partial window holds. */
function windowScope(w) {
  return isNil(w.total) ? `the latest ${fmtCount(w.loaded)} recorded events` : `the latest ${fmtCount(w.loaded)} of ${fmtCount(w.total)} recorded events`;
}

/**
 * A count over the loaded window: exact when the window is complete, a lower
 * bound ("≥n") when it is partial, and empty for a partial zero — older,
 * unloaded events may hold that kind, so it is never shown as a recorded 0.
 */
function windowCount(w, c) {
  if (!w.evOk) return null;
  if (w.complete) return fmtCount(c);
  return c > 0 ? `≥${fmtCount(c)}` : null;
}

/** windowCount as a marked value. */
function windowVal(w, c) {
  const v = windowCount(w, c);
  if (!isNil(v)) return html`<span class="v" data-v>${v}</span>`;
  return w.partial ? html`<span class="v is-empty" data-v data-empty="1" title="None in ${windowScope(w)}; older events are not loaded">—</span>` : val(null);
}

/** Amber marker for a partial window. */
function partialBadge(w) {
  if (!w.partial) return "";
  return badge("PARTIAL", {
    label: isNil(w.total) ? `PARTIAL · LATEST ${fmtCount(w.loaded)}` : `PARTIAL · ${fmtCount(w.loaded)} OF ${fmtCount(w.total)}`,
    title: `Counts cover ${windowScope(w)}; older events are not loaded`,
  });
}

function countBy(events, key) {
  const m = new Map();
  for (const e of events) m.set(e[key], (m.get(e[key]) ?? 0) + 1);
  return m;
}

/* ------------------------------------------------------------------ learning loop */

function learningLoop(ctx, n, res, w) {
  const strategies = doc(ctx, "strategies");
  const props = strategies ? strategies.proposals.filter((p) => p.agent_slot === n) : null;
  const byKind = countBy(w.events, "kind");
  const list = [
    ...LOOP_STAGES.map(([key, label, kind]) => ({
      key,
      label,
      count: windowCount(w, byKind.get(kind) ?? 0),
      owner: `AGENT · ${humanize(kind)}`,
    })),
    // cumulative by state membership: a proposal counts at every gate it has reached
    ...GATED_STAGES.map(([key, label, owner, states], i) => ({
      key,
      label,
      count: props ? props.filter((p) => states.includes(p.state)).length : null,
      owner: `${owner} · PROPOSALS REACHED`,
      boundary: i === 0,
    })),
  ];
  const rejected = props ? props.filter((p) => p.state === "REJECTED").length : null;
  return html`
    <div class="ag-loop">${steps(list, { cls: "ag-loop__steps" })}
      <div class="ag-loop__zones" aria-hidden="true">
        <span class="ag-loop__zone ag-loop__zone--agent" style="grid-column: span ${LOOP_STAGES.length}">AGENT-AUTONOMOUS · RESEARCH MODE · WITHIN DECLARED LIMITS</span>
        <span class="ag-loop__zone ag-loop__zone--gated" style="grid-column: span ${GATED_STAGES.length}">GATED · RESEARCH + GOVERNANCE</span>
      </div>
    </div>
    <div class="${cx("ag-loop__note", w.partial && "is-partial")}" data-window="${!w.evOk ? "unavailable" : w.complete ? "complete" : "partial"}">
      ${!w.evOk
        ? html`<span class="muted">Agent-stage counts unavailable: ${eventsAbsence(ctx, res)}</span>`
        : w.complete
          ? html`Agent-stage counts are this slot's recorded events of each kind (all ${fmtCount(w.loaded)} loaded).`
          : html`${partialBadge(w)} Agent-stage counts cover only ${windowScope(w)}: ≥ marks a lower bound and — means none in the loaded window. Older events are not loaded, so no stage is shown as zero.`}
      ${props
        ? html` Research and governance stages count proposals from ${agentLabel(n)} that have reached each gate, cumulatively (a released version passed validation and approval); ${fmtCount(rejected)} rejected.`
        : html` <span class="muted">Gated-stage counts unavailable: strategies.json is not connected.</span>`}
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

function kindIndex(n, w, active) {
  const counts = countBy(w.events, "kind");
  return html`<div class="ag-kinds">
    ${w.partial ? html`<div class="ag-kinds__window">${partialBadge(w)}<span>Counts in ${windowScope(w)}</span></div>` : ""}
    ${KIND_GROUPS.map(
      (g) => html`<div class="ag-kinds__group">
        <div class="ag-kinds__label">${g.label}</div>
        ${g.kinds.map((k) => {
          const c = counts.get(k) ?? 0;
          return html`<a class="${cx("ag-kinds__row", k === active && "is-active", (!w.evOk || !c) && "is-zero")}" href="#/agents/${n}/activity?kind=${k}" data-kind-index="${k}">
            <span class="ag-kinds__k">${humanize(k)}</span>
            ${windowVal(w, c)}
          </a>`;
        })}
      </div>`,
    )}
  </div>`;
}

function streamSummary(ctx, w) {
  const { evOk, events, total } = w;
  const modes = countBy(events, "mode");
  const newest = events[0]?.ts ?? null;
  const oldest = events.length ? events[events.length - 1].ts : null;
  const cell = (k, v) => html`<div class="ag-sum__cell"><div class="ag-sum__k">${k}</div><div class="ag-sum__v">${v}</div></div>`;
  return html`<div class="ag-sum">
    ${cell("Events (slot)", evOk && !isNil(total) ? val(fmtCount(total)) : val(null))}
    ${cell("Loaded", evOk ? val(fmtCount(w.loaded)) : val(null))}
    ${cell("Newest", newest ? ageVal(newest, ctx.now) : evOk ? html`<span class="ag-none">NONE</span>` : val(null))}
    ${cell("Oldest loaded", oldest ? html`<span class="v mono" data-v>${fmtDateTime(oldest)}</span>` : val(null))}
  </div>
  ${subhead("By mode", w.partial ? partialBadge(w) : "")}
  <div class="ag-modes" data-window="${!evOk ? "unavailable" : w.complete ? "complete" : "partial"}">
    ${["RESEARCH", "SIM", "PAPER", "LIVE"].map(
      (m) => html`<div class="ag-modes__cell" data-mode="${m}"><span class="ag-modes__k">${m}</span>${windowVal(w, modes.get(m) ?? 0)}</div>`,
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

function memoryTraffic(ctx, w) {
  const { evOk, events } = w;
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
    <div class="ag-traffic__head"><span>${title}</span>${windowVal(w, items.length)}</div>
    ${items.length
      ? items.map(([id, ts]) => {
          const m = findMemory(ctx, id);
          return html`<a class="ag-traffic__row" href="${memoryHref(id)}">
            <span class="ref">${id}</span>
            <span class="ag-traffic__title">${m ? m.title : memOk ? "Not found in memory store" : "memory.json not connected"}</span>
            <span class="ag-traffic__meta">${m ? badge(m.validation_state) : ""}${originBadge(m?.origin)}${ageVal(ts, ctx.now)}</span>
          </a>`;
        })
      : html`<div class="ag-traffic__none">${!evOk ? "Event stream not connected." : w.complete ? `No ${humanize(kind)} events reference a memory.` : `No ${humanize(kind)} event in ${windowScope(w)} references a memory; older events are not loaded.`}</div>`}
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
    const kind = EVENT_KINDS.includes(ctx.query?.kind) ? ctx.query.kind : null;
    // A kind filter is served by the API over every recorded event, not by
    // filtering the loaded window (whose oldest events may be cut off).
    const [events, kindEvents] = await Promise.all([
      loadEvents({ slot: n, limit: EVENT_WINDOW }),
      kind ? loadEvents({ slot: n, limit: EVENT_WINDOW, kind }) : null,
    ]);
    return { events, kindEvents };
  },
  render(ctx) {
    const n = parseSlot(ctx.params.slot);
    if (!n) return unknownSlotPage(ctx, ctx.params.slot, { pageHeader, panel, emptyState });
    const sv = slotView(ctx, n);
    const res = ctx.extra?.events ?? null;
    const w = windowOf(ctx, sv, res);
    const { evOk, events } = w;
    const requested = ctx.query?.kind ?? null;
    const kind = requested && EVENT_KINDS.includes(requested) ? requested : null;
    const kindRes = kind ? ctx.extra?.kindEvents ?? null : null;
    const streamRes = kind ? kindRes : res;
    const shown = kind ? kindRes?.events ?? [] : events;
    // the filtered stream is complete for its kind when the API returned fewer than the limit
    const kindComplete = !!kind && eventsAvailable(ctx, kindRes) && shown.length < EVENT_WINDOW;
    const counts = countBy(events, "kind");
    const tabItems = [
      { key: "ALL", label: "All", href: `#/agents/${n}/activity`, count: evOk ? fmtCount(w.loaded) : null },
      ...EVENT_KINDS.filter((k) => counts.get(k) || k === kind).map((k) => ({
        key: k,
        label: humanize(k),
        href: `#/agents/${n}/activity?kind=${k}`,
        count: k === kind && eventsAvailable(ctx, kindRes) ? (kindComplete ? fmtCount(shown.length) : `≥${fmtCount(shown.length)}`) : windowCount(w, counts.get(k) ?? 0),
      })),
    ];
    const streamSub = !evOk
      ? "agent_events.jsonl"
      : kind
        ? `${humanize(kind)} · ${kindComplete ? `all ${fmtCount(shown.length)} recorded` : `latest ${fmtCount(shown.length)}`}, newest first`
        : w.complete
          ? `All ${fmtCount(w.loaded)} recorded events, newest first`
          : `Latest ${fmtCount(w.loaded)}${isNil(w.total) ? "" : ` of ${fmtCount(w.total)}`} events, newest first`;

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
          body: learningLoop(ctx, n, res, w),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 8,
          code: "AA-02",
          title: "Reasoning stream",
          sub: streamSub,
          actions: html`${sourceTag(res?.source ?? source(ctx, "agent_events"), { now: ctx.now })}`,
          body: html`
            <div class="ag-tabs">${tabs(tabItems, kind ?? "ALL")}</div>
            ${requested && !kind ? html`<div class="ag-filter-note">${icon("alert", "icon")}Unknown event kind “${requested}” — showing all events.</div>` : ""}
            ${eventLog(ctx, shown, {
              maxHeight: 760,
              prompt: shown.length ? `sentry://agents/${pad2(n)}/reasoning${kind ? ` --kind ${kind}` : ""}` : null,
              empty: logEmpty({
                reason: eventsAbsence(ctx, streamRes, { slot: n, kind }),
                hint: "Each recorded step — observation, interpretation, memory recall, hypothesis, test, evaluation, learning, memory write, proposal — appears here as a timestamped line with links to the memories, strategy and proposal it references.",
              }),
            })}`,
          cls: "ag-fillbody",
        })}
        <div class="span-4 stack">
          ${panel({ code: "AA-03", title: "Stream", sub: "This slot's recorded events", body: streamSummary(ctx, w) })}
          ${panel({ code: "AA-04", title: "Event kinds", sub: "Filter the stream by kind", body: kindIndex(n, w, kind) })}
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
          body: memoryTraffic(ctx, w),
          cls: "ag-xl-12",
        })}
      </div>
    </div>`;
  },
};
