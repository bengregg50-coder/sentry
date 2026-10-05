// Agent Memories — five agent lanes: memories each agent wrote (source.actor
// AGENT, grouped by source.agent_slot), memories each agent references
// (agents.json memory_refs), and each agent's MEMORY_RECALL / MEMORY_WRITE
// events. Cross-agent sharing ("agent X recalled what agent Y wrote") is shown
// only where an event's memory ids resolve to a memory another agent wrote.

import { html } from "../core/html.js";
import { isNil, fmtCount, fmtDateTime, humanize } from "../core/format.js";
import { doc, source, sourceReason, sourceShort, agentSlot } from "../core/state.js";
import { fetchEvents } from "../core/api.js";
import { pageHeader, panel, badge, dot, stat, statRow, val, emptyState, notice } from "../components/ui.js";
import { toneOf } from "../core/tones.js";
import { SLOTS, MEMORY_EVENT_KINDS, memState, memoryIndex, memHref, agentHref, agentLabel, memLink, frameTable, sectionLabel, sourceTags, typeBadge, tally } from "./_memory-common.js";

const EVENT_LIMIT = 500;
const KIND_SHORT = { MEMORY_RECALL: "RECALL", MEMORY_WRITE: "WRITE" };
const OTHER = "OTHER";
const UNRESOLVED = "UNRESOLVED";

/** Who wrote a memory, as a matrix column: an agent slot, OTHER (non-agent or slot not declared), or UNRESOLVED. */
function writerOf(id, idx) {
  const m = idx.get(id);
  if (!m) return UNRESOLVED;
  if (m.source.actor === "AGENT" && !isNil(m.source.agent_slot)) return m.source.agent_slot;
  return OTHER;
}

function writerText(w, id, idx) {
  if (w === UNRESOLVED) return "not in memory.json";
  if (w === OTHER) {
    const m = idx.get(id);
    return m.source.actor === "AGENT" ? "an agent (slot not declared)" : humanize(m.source.actor);
  }
  return agentLabel(w);
}

function eventsState(extra) {
  if (!extra || extra.error) return { ok: false, events: null, src: extra?.source ?? null, error: extra?.error ?? null };
  const status = extra.source?.status;
  const ok = status === "OK" || status === "INVALID";
  return { ok, events: ok ? extra.events : null, src: extra.source, error: null, truncated: ok && extra.events.length >= EVENT_LIMIT };
}

/* ------------------------------------------------------------ one lane */

function lane(ctx, slot, data) {
  const { written, refs, evs, idx, mems, ev } = data;
  const sl = agentSlot(ctx, slot);
  const agent = sl?.agent;
  const status = sl?.status ?? "NOT_REPORTED";
  const nothing = (!written || !written.length) && (!refs || !refs.length) && (!evs || !evs.length);
  const mini = (label, v) => html`<div class="mem-lane__stat"><span class="mem-k">${label}</span>${val(isNil(v) ? null : fmtCount(v))}</div>`;

  let body;
  if (nothing) {
    const reasons = [];
    reasons.push(mems ? `memory.json: no memory sourced from ${agentLabel(slot)}` : `memory.json ${sourceShort(source(ctx, "memory")).toLowerCase()}`);
    reasons.push(doc(ctx, "agents") ? (agent ? "no memory_refs declared" : "slot not reported by the runtime") : `agents.json ${sourceShort(source(ctx, "agents")).toLowerCase()}`);
    reasons.push(ev.ok ? "no recall / write events" : `agent_events.jsonl ${ev.src ? sourceShort(ev.src).toLowerCase() : "unavailable"}`);
    body = emptyState({
      title: "NO AGENT MEMORIES",
      reason: reasons.join(" · "),
      hint: "Memories this agent writes, the memories it references and its recall / write events appear in this lane.",
      compact: true,
      iconName: "agentmem",
      code: `agent-lane-${slot}-empty`,
    });
  } else {
    body = html`
      <div class="mem-lane__sec" data-lane-section="written">
        ${sectionLabel(`Written by ${agentLabel(slot)}`)}
        ${written === null
          ? html`<div class="mem-lane__none">${sourceShort(source(ctx, "memory"))}</div>`
          : written.length
            ? html`<ul class="mem-lane__list">${written.map(
                (m) => html`<li class="mem-lane__mem" data-memory-id="${m.memory_id}">
                  <a class="ref" href="${memHref(m.memory_id)}">${m.memory_id}</a>
                  <a class="mem-lane__title" href="${memHref(m.memory_id)}" title="${m.title}">${m.title}</a>
                  <span class="mem-lane__flags">${typeBadge(m.type)}${badge(m.validation_state)}</span>
                </li>`,
              )}</ul>`
            : html`<div class="mem-lane__none">None recorded</div>`}
      </div>
      <div class="mem-lane__sec" data-lane-section="refs">
        ${sectionLabel("References", "memory_refs")}
        ${refs === null
          ? html`<div class="mem-lane__none">${doc(ctx, "agents") ? "Slot not reported" : sourceShort(source(ctx, "agents"))}</div>`
          : refs.length
            ? html`<div class="mem-lane__refs">${refs.map((id) => {
                const w = mems ? writerOf(id, idx) : null;
                return html`<span class="mem-lane__ref">${memLink(id, { known: !mems || idx.has(id) })}${
                  w !== null && w !== UNRESOLVED ? html`<span class="mem-lane__from">${w === slot ? "own" : `from ${writerText(w, id, idx)}`}</span>` : ""
                }</span>`;
              })}</div>`
            : html`<div class="mem-lane__none">None declared</div>`}
      </div>
      <div class="mem-lane__sec" data-lane-section="events">
        ${sectionLabel("Memory events", "recall · write")}
        ${evs === null
          ? html`<div class="mem-lane__none">${ev.src ? sourceShort(ev.src) : "Unavailable"}</div>`
          : evs.length
            ? html`<ul class="mem-lane__events">${evs.slice(0, 12).map((e) => {
                const ids = e.refs?.memory_ids ?? [];
                return html`<li class="mem-lane__ev" data-event-id="${e.event_id}" data-kind="${e.kind}">
                  <div class="mem-lane__evhead"><span class="mem-evkind mem-evkind--${KIND_SHORT[e.kind].toLowerCase()}">${KIND_SHORT[e.kind]}</span><span class="mono muted">${fmtDateTime(e.ts)}</span></div>
                  <div class="mem-lane__evids">${ids.length
                    ? ids.map((id) => {
                        const w = mems ? writerOf(id, idx) : null;
                        const cross = e.kind === "MEMORY_RECALL" && typeof w === "number" && w !== slot;
                        return html`<span class="mem-lane__ref">${memLink(id, { known: !mems || idx.has(id) })}${
                          cross ? html`<span class="mem-xagent" data-cross-agent="${w}">WRITTEN BY ${agentLabel(w)}</span>` : w !== null && w !== UNRESOLVED && e.kind === "MEMORY_RECALL" ? html`<span class="mem-lane__from">${w === slot ? "own memory" : writerText(w, id, idx)}</span>` : ""
                        }</span>`;
                      })
                    : html`<span class="mem-lane__none">No memory ids referenced</span>`}</div>
                  <div class="mem-lane__evsum">${e.summary}</div>
                </li>`;
              })}${evs.length > 12 ? html`<li class="mem-lane__more">+${evs.length - 12} earlier</li>` : ""}</ul>`
            : html`<div class="mem-lane__none">None recorded</div>`}
      </div>`;
  }

  return html`<section class="${nothing ? "mem-lane is-empty" : "mem-lane"}" data-agent-lane="${slot}">
    <header class="mem-lane__head">
      <a class="mem-lane__id" href="${agentHref(slot)}">${agentLabel(slot)}</a>
      ${dot(status)}${badge(status)}
    </header>
    <div class="mem-lane__who">${agent?.codename ?? agent?.specialisation ?? sl?.status_reason ?? "Not reported"}</div>
    <div class="mem-lane__stats">${mini("Written", written?.length)}${mini("Refs", refs?.length)}${mini("Events", evs?.length)}</div>
    <div class="mem-lane__body">${body}</div>
  </section>`;
}

/* ------------------------------------------------------------ sharing matrix */

function matrix(memEvents, idx, mems, ev) {
  const cols = [...SLOTS, OTHER, UNRESOLVED];
  const can = ev.ok && !!mems;
  const cell = {};
  if (can) {
    for (const e of memEvents) {
      if (e.kind !== "MEMORY_RECALL") continue;
      for (const id of e.refs?.memory_ids ?? []) {
        const k = `${e.agent_slot}|${writerOf(id, idx)}`;
        cell[k] = tally(cell, k) + 1;
      }
    }
  }
  const head = (c) => (typeof c === "number" ? agentLabel(c).replace("AGENT ", "A") : c === OTHER ? "OTHER" : "UNRES.");
  const tip = (c) => (typeof c === "number" ? `Written by ${agentLabel(c)}` : c === OTHER ? "Written by a non-agent source, or by an agent with no declared slot" : "Memory id not present in memory.json");
  return html`<div class="mem-matrix-wrap"><table class="mem-matrix" data-matrix="recall">
    <thead>
      <tr><th class="mem-matrix__corner">READER ↓ WRITER →</th>${cols.map((c) => html`<th title="${tip(c)}">${head(c)}</th>`)}</tr>
    </thead>
    <tbody>${SLOTS.map(
      (r) => html`<tr><th>${agentLabel(r)}</th>${cols.map((c) => {
        const n = can ? tally(cell, `${r}|${c}`) : null;
        const kind = typeof c === "number" ? (c === r ? "self" : "cross") : c === OTHER ? "other" : "unres";
        return html`<td class="mem-matrix__cell mem-matrix__cell--${kind} ${n ? "has" : ""}" data-cell="${r}-${c}">${val(isNil(n) ? null : fmtCount(n))}</td>`;
      })}</tr>`,
    )}</tbody>
  </table></div>
  <div class="mem-matrix-legend"><span><i class="mem-matrix-key mem-matrix-key--self"></i>Own memory</span><span><i class="mem-matrix-key mem-matrix-key--cross"></i>Cross-agent recall</span><span><i class="mem-matrix-key mem-matrix-key--other"></i>Other: non-agent source</span><span><i class="mem-matrix-key"></i>Unres.: id not in memory.json</span></div>`;
}

function crossTable(memEvents, idx, mems, ev) {
  const rows = [];
  if (ev.ok && mems) {
    for (const e of memEvents) {
      if (e.kind !== "MEMORY_RECALL") continue;
      for (const id of e.refs?.memory_ids ?? []) {
        const w = writerOf(id, idx);
        if (typeof w === "number" && w !== e.agent_slot) rows.push({ e, id, w });
      }
    }
  }
  const recallRefs = ev.ok && mems ? memEvents.filter((e) => e.kind === "MEMORY_RECALL").reduce((n, e) => n + (e.refs?.memory_ids ?? []).length, 0) : null;
  return frameTable({
    rows: ev.ok && mems ? rows : null,
    maxHeight: 320,
    columns: [
      { key: "ts", label: "When", render: (r) => html`<span class="mono v" data-v>${fmtDateTime(r.e.ts)}</span>` },
      { key: "reader", label: "Recalled by", render: (r) => html`<a class="ref" href="${agentHref(r.e.agent_slot)}">${agentLabel(r.e.agent_slot)}</a>` },
      { key: "memory", label: "Memory", render: (r) => html`<a class="ref" href="${memHref(r.id)}">${r.id}</a>` },
      { key: "writer", label: "Written by", render: (r) => html`<a class="ref" href="${agentHref(r.w)}">${agentLabel(r.w)}</a>` },
      { key: "event", label: "Event", render: (r) => html`<span class="mono">${r.e.event_id}</span>` },
      { key: "summary", label: "Summary", cls: "wrap", render: (r) => r.e.summary },
    ],
    empty:
      ev.ok && mems
        ? emptyState({
            title: "No cross-agent recall recorded",
            reason: recallRefs
              ? `${fmtCount(recallRefs)} recalled memory reference(s) in the scanned events — none resolves to a memory written by a different agent.`
              : "No recall event references a memory.",
            hint: "A row appears here when one agent's MEMORY_RECALL event references a memory another agent wrote.",
            compact: true,
            iconName: "agentmem",
            code: "cross-agent-none",
          })
        : emptyState({
            title: "Sharing not observable",
            reason: [
              mems ? null : "memory.json is not connected, so the writer of a recalled memory cannot be resolved.",
              ev.ok ? null : "The agent event stream is not connected, so no recall is observable.",
            ]
              .filter(Boolean)
              .join(" "),
            hint: "Cross-agent sharing is shown only where a recall event's memory ids resolve to a memory written by another agent.",
            compact: true,
            iconName: "agentmem",
            code: "cross-agent-unavailable",
          }),
  });
}

export default {
  title: "Agent Memories",
  async load() {
    try {
      const res = await fetchEvents({ limit: EVENT_LIMIT });
      return { events: res.events, source: res.source, error: null };
    } catch (err) {
      return { events: null, source: null, error: String(err && err.message ? err.message : err) };
    }
  },
  render(ctx) {
    const { mems, src: memSrc } = memState(ctx);
    const idx = memoryIndex(mems);
    const agents = doc(ctx, "agents");
    const ev = eventsState(ctx.extra);
    const memEvents = ev.ok ? ev.events.filter((e) => MEMORY_EVENT_KINDS.includes(e.kind)) : null;
    const agentMems = mems ? mems.filter((m) => m.source.actor === "AGENT") : null;
    const noSlot = agentMems ? agentMems.filter((m) => isNil(m.source.agent_slot)) : null;

    const perSlot = SLOTS.map((slot) => {
      const a = agents?.agents.find((x) => x.slot === slot);
      return {
        slot,
        written: agentMems ? agentMems.filter((m) => m.source.agent_slot === slot).sort((x, y) => (x.created_at < y.created_at ? 1 : -1)) : null,
        refs: agents ? (a ? a.memory_refs : null) : null,
        evs: memEvents ? memEvents.filter((e) => e.agent_slot === slot) : null,
        idx,
        mems,
        ev,
      };
    });

    let crossCount = null;
    if (memEvents && mems) {
      crossCount = 0;
      for (const e of memEvents) {
        if (e.kind !== "MEMORY_RECALL") continue;
        for (const id of e.refs?.memory_ids ?? []) {
          const w = writerOf(id, idx);
          if (typeof w === "number" && w !== e.agent_slot) crossCount++;
        }
      }
    }
    const contributing = agentMems ? new Set(agentMems.filter((m) => !isNil(m.source.agent_slot)).map((m) => m.source.agent_slot)).size : null;
    const evWhy = ev.src ? sourceShort(ev.src) : "UNAVAILABLE";
    const memWhy = sourceShort(memSrc);

    return html`
      ${pageHeader({
        kicker: "MEMORY",
        code: "MEM-A",
        title: "Agent Memories",
        sub: "What each of the five agents has written to shared memory, what it relies on, and when it recalled it. Sharing between agents is shown only where the event record proves it.",
        right: sourceTags(ctx, ["memory", "agents", "agent_events"]),
      })}

      ${ev.error ? notice({ title: "Agent event stream could not be fetched", body: ev.error, tone: toneOf("ERROR") }) : ""}

      <div class="grid">
        ${panel({
          span: 12,
          code: "MEM-A01",
          title: "Shared memory activity",
          sub: ev.ok ? `Latest ${fmtCount(ev.events.length)} event(s) scanned${ev.truncated ? " · older events not shown" : ""}` : ev.src ? sourceReason(ev.src) : "Event stream unavailable",
          body: statRow(
            [
              stat({ label: "Agent-sourced memories", value: agentMems ? fmtCount(agentMems.length) : null, hint: "source.actor AGENT", emptyLabel: memWhy }),
              stat({ label: "Agents contributing", value: contributing === null ? null : `${fmtCount(contributing)} / 5`, hint: "Distinct writing slots", emptyLabel: memWhy }),
              stat({ label: "Memory writes", value: memEvents ? fmtCount(memEvents.filter((e) => e.kind === "MEMORY_WRITE").length) : null, hint: "MEMORY_WRITE events", emptyLabel: evWhy }),
              stat({ label: "Memory recalls", value: memEvents ? fmtCount(memEvents.filter((e) => e.kind === "MEMORY_RECALL").length) : null, hint: "MEMORY_RECALL events", emptyLabel: evWhy }),
              stat({ label: "Cross-agent recalls", value: crossCount === null ? null : fmtCount(crossCount), hint: "Recalled a memory another agent wrote", emptyLabel: memEvents ? memWhy : evWhy }),
            ],
            { min: 150 },
          ),
        })}
      </div>

      <div class="mem-lanes">${perSlot.map((d) => lane(ctx, d.slot, d))}</div>

      ${noSlot && noSlot.length
        ? html`<div class="grid">${panel({
            span: 12,
            code: "MEM-A02",
            title: "Agent-sourced · slot not declared",
            sub: "source.actor AGENT without source.agent_slot — not attributed to any lane",
            body: html`<div class="mem-lane__refs">${noSlot.map((m) => html`<span class="mem-lane__ref"><a class="ref" href="${memHref(m.memory_id)}">${m.memory_id}</a><span class="mem-lane__from">${m.title}</span></span>`)}</div>`,
          })}</div>`
        : ""}

      <div class="grid">
        ${panel({
          span: 5,
          code: "MEM-A03",
          title: "Recall matrix",
          sub: "Memory references in recall events, by reader and writer",
          body: matrix(memEvents ?? [], idx, mems, ev),
          cls: "lg-span-12",
        })}
        ${panel({
          span: 7,
          code: "MEM-A04",
          title: "Cross-agent sharing",
          sub: "Agent X recalled a memory written by agent Y",
          body: crossTable(memEvents ?? [], idx, mems, ev),
          cls: "lg-span-12",
        })}
      </div>
    `;
  },
};
