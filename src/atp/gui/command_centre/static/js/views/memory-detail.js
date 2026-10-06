// Memory Detail — one memory with everything it rests on: source, hypothesis,
// observation, supporting and contradicting evidence side by side, declared
// checks, confidence and status, its declared relationships (local graph),
// the records that reference it, and cross-checks naming it.

import { html } from "../core/html.js";
import { isNil, fmtCount, fmtDate, fmtDateTime, humanize } from "../core/format.js";
import { doc, source, derived, sourceTitle, findingsFor } from "../core/state.js";
import { fetchEvents } from "../core/api.js";
import { pageHeader, panel, badge, val, kv, originBadge, emptyState, sourceEmpty, findingsList, notice } from "../components/ui.js";
import { icon } from "../components/icons.js";
import { toneOf, toneClass } from "../core/tones.js";
import {
  memState,
  memoryIndex,
  memHref,
  strategyHref,
  trialHref,
  agentHref,
  agentLabel,
  memLink,
  evidenceCounts,
  stanceStrip,
  checkBadge,
  typeBadge,
  untraceableBadge,
  sectionLabel,
  sourceTags,
  frameTable,
  anatomy,
  srcPhrase,
  originCounts,
  splitText,
} from "./_memory-common.js";
import { graphFor, edgesOf, egoGraph } from "./_memory-graph.js";

const EVENT_LIMIT = 500;

/* ------------------------------------------------------------ evidence */

function evidenceItem(e) {
  return html`<article class="mem-ev ${toneClass(e.stance)}" data-evidence-id="${e.evidence_id}" data-stance="${e.stance}">
    <header class="mem-ev__head">
      <span class="mem-ev__id">${e.evidence_id}</span>
      <span class="mem-k">${humanize(e.kind)}</span>
      <span class="mem-ev__flags">${isNil(e.result) ? html`<span class="mem-nr">RESULT NOT REPORTED</span>` : badge(e.result)}</span>
    </header>
    <div class="mem-ev__ref">${icon("link")}${e.kind === "TRIAL" ? html`<a class="ref" href="${trialHref(e.ref)}">${e.ref}</a>` : html`<span class="ref">${e.ref}</span>`}</div>
    ${e.summary ? html`<p class="mem-ev__sum">${e.summary}</p>` : ""}
    <footer class="mem-ev__foot">
      <span>INDEPENDENT ${isNil(e.independent) ? val(null) : html`<b class="${e.independent ? "mem-yes" : "mem-no"}">${e.independent ? "YES" : "NO"}</b>`}</span>
      <span>RECORDED ${e.recorded_at ? html`<span class="v" data-v>${fmtDateTime(e.recorded_at)}</span>` : val(null)}</span>
    </footer>
  </article>`;
}

function evidenceColumn(m, stance) {
  const items = m.evidence.filter((e) => e.stance === stance);
  if (items.length) return html`<div class="mem-ev-col" data-evidence-col="${stance}">${items.map(evidenceItem)}</div>`;
  const what = stance === "SUPPORTS" ? "supporting" : stance === "CONTRADICTS" ? "contradicting" : "neutral";
  return html`<div class="mem-ev-col" data-evidence-col="${stance}">${emptyState({
    title: `No ${what} evidence attached`,
    reason: m.evidence.length ? `This memory carries ${fmtCount(m.evidence.length)} evidence item(s), none ${stance === "SUPPORTS" ? "supporting" : stance === "CONTRADICTS" ? "contradicting" : "neutral"}.` : "This memory carries no evidence at all.",
    compact: true,
    iconName: "evidence",
    code: `evidence-${stance.toLowerCase()}-none`,
  })}</div>`;
}

/* ------------------------------------------------------------ record */

function verdictStrip(m) {
  const c = evidenceCounts(m);
  const tile = (label, body, key) => html`<div class="mem-vtile" data-tile="${key}"><div class="mem-k">${label}</div><div class="mem-vtile__v">${body}</div></div>`;
  return html`<div class="mem-vstrip">
    ${tile("Confidence", badge(m.confidence, { size: "lg" }), "confidence")}
    ${tile("Validation state", badge(m.validation_state, { size: "lg" }), "validation")}
    ${tile("Status", badge(m.status, { size: "lg" }), "status")}
    ${tile(
      "Evidence",
      c.total
        ? html`<span class="mem-vtile__ev"><b class="v" data-v>${c.supports}</b><span class="mem-vtile__u">for</span><span class="mem-vtile__sep">/</span><b class="v" data-v>${c.contradicts}</b><span class="mem-vtile__u">against</span></span>
            <span class="mem-vtile__hint">${c.independenceReported ? html`<span class="v" data-v>${c.independent}</span> independent` : "independence not reported"}${c.neutral ? html` · <span class="v" data-v>${c.neutral}</span> neutral` : ""}</span>${stanceStrip(c)}`
        : untraceableBadge(),
      "evidence",
    )}
    ${tile("Origin", m.origin === "ORIGINAL" ? html`<span class="mem-k mem-k--strong">ORIGINAL</span>` : originBadge(m.origin), "origin")}
  </div>`;
}

function textBlock(label, text, emptyWhy) {
  return html`<div class="mem-text">
    ${sectionLabel(label)}
    ${text ? html`<p class="mem-text__body">${text}</p>` : html`<p class="mem-text__body mem-text__body--empty">${val(null)} <span class="muted small">${emptyWhy}</span></p>`}
  </div>`;
}

function sourcePanel(ctx, m) {
  const s = m.source;
  const rs = doc(ctx, "research");
  const prog = s.programme_id && rs ? rs.programmes.find((p) => p.programme_id === s.programme_id) : null;
  // One column in the narrow side column; a row of five when the panel is full width (v-memory.css).
  return html`<div class="mem-src-kv">${kv(
    [
      ["Actor", html`<span class="mem-k mem-k--strong">${humanize(s.actor)}</span>`],
      ["Agent", isNil(s.agent_slot) ? null : html`<a class="ref" href="${agentHref(s.agent_slot)}">${agentLabel(s.agent_slot)}</a>`],
      ["Programme", s.programme_id ? html`<span class="ref">${s.programme_id}</span>${prog ? html` <span class="muted small">${prog.name}</span>` : ""}` : null],
      ["Experiments", s.experiment_ids.length ? html`<span class="cluster">${s.experiment_ids.map((x) => html`<span class="ref">${x}</span>`)}</span>` : null],
      ["Trials", s.trial_ids.length ? html`<span class="cluster">${s.trial_ids.map((t) => html`<a class="ref" href="${trialHref(t)}">${t}</a>`)}</span>` : null],
    ],
    { cols: 1 },
  )}</div>`;
}

function checksPanel(m) {
  const tile = (label, state, desc) => html`<div class="mem-check ${toneClass(state)}" data-check="${label}" data-state="${state ?? "NOT_REPORTED"}">
    <div class="split"><span class="mem-check__label">${label}</span>${checkBadge(state)}</div>
    <div class="mem-check__desc">${desc}</div>
  </div>`;
  return html`<div class="mem-checks" data-checks="memory">
    ${tile("OOS", m.oos, "Holds on data untouched during development")}
    ${tile("Robustness", m.robustness, "Survives perturbation of data, rules and sampling")}
    ${tile("Cost sensitivity", m.cost_sensitivity, "Survives realistic and stressed costs")}
  </div>`;
}

/* ------------------------------------------------------------ related */

function relatedPanel(ctx, m, idx) {
  const st = doc(ctx, "strategies");
  const stSrc = source(ctx, "strategies");
  const strat = (sid) => {
    if (!st) return html`<span class="mem-lane__ref"><span class="ref">${sid}</span><span class="mem-lane__from">${srcPhrase(stSrc, "strategies.json")}</span></span>`;
    const s = st.strategies.find((x) => x.strategy_id === sid);
    if (!s) return html`<span class="mem-unres" title="Not present in strategies.json">${sid}<span class="mem-unres__tag">UNRESOLVED</span></span>`;
    return html`<span class="mem-lane__ref"><a class="ref" href="${strategyHref(sid)}">${sid}</a><span class="mem-lane__from">${s.name}</span>${badge(s.status)}</span>`;
  };
  const group = (label, items, render, none) => html`<div class="mem-rel-group">
    ${sectionLabel(label, items.length ? fmtCount(items.length) : null)}
    ${items.length ? html`<div class="mem-rel-group__items">${items.map(render)}</div>` : html`<div class="mem-lane__none">${none}</div>`}
  </div>`;
  return html`
    ${group("Related strategies", m.related_strategies, strat, "None declared")}
    ${group("Related experiments", m.related_experiments, (x) => html`<span class="ref">${x}</span>`, "None declared")}
    ${group(
      "Related memories",
      m.related_memories,
      (oid) => html`<span class="mem-lane__ref">${memLink(oid, { known: idx.has(oid) })}${idx.has(oid) ? html`<span class="mem-lane__from">${idx.get(oid).title}</span>` : ""}</span>`,
      "None declared",
    )}
`;
}

function relationsPanel(ctx, m) {
  const graph = graphFor(ctx);
  const key = `MEMORY:${m.memory_id}`;
  const links = edgesOf(graph, key);
  const center = graph?.nodes.find((n) => n.key === key) ?? { key, id: m.memory_id, type: "MEMORY", state: m.validation_state };
  if (!links.length) {
    // "No record references it" can only be said of the sources that are readable.
    const unread = ["research", "strategies"].map((k) => source(ctx, k)).filter((x) => x?.status !== "OK");
    return emptyState({
      title: "No declared relationships",
      reason: `This memory declares no trial ids, TRIAL evidence, related strategies or related memories${
        unread.length
          ? `. References to it from other records cannot be checked: ${unread.map((x) => srcPhrase(x)).join(" · ")}.`
          : ", and no record references it in its lineage."
      }`,
      hint: "Relationships are only drawn from explicit references — none are inferred.",
      compact: true,
      iconName: "graph",
      code: "memory-relations-none",
    });
  }
  return html`${egoGraph(center, links)}
    <div class="mem-gap">${frameTable({
      rows: links,
      columns: [
        { key: "dir", label: "Direction", render: (l) => html`<span class="mem-k">${l.dir === "out" ? "THIS → " : "→ THIS"}</span>` },
        { key: "rel", label: "Relation", render: (l) => html`<span class="mono">${l.edge.relation}</span>` },
        { key: "type", label: "Type", render: (l) => html`<span class="mem-k">${l.other.type}</span>` },
        { key: "id", label: "Record", render: (l) => (l.other.state === "UNRESOLVED" ? html`<span class="mem-unres">${l.other.id}<span class="mem-unres__tag">UNRESOLVED</span></span>` : html`<span class="ref">${l.other.id}</span>`) },
        { key: "state", label: "State", render: (l) => badge(l.other.state) },
        { key: "by", label: "Declared by", render: (l) => html`<span class="mono muted">${l.edge.declared_by}</span>` },
      ],
    })}</div>
    <div class="mem-side-note">${icon("graph")}<span><a class="ref" href="#/memory/graph?type=MEMORY&focus=${encodeURIComponent(m.memory_id)}">Open in the knowledge graph</a></span></div>`;
}

/* ------------------------------------------------------------ referenced by */

function referencedBy(ctx, m, mems) {
  const id = m.memory_id;
  const agents = doc(ctx, "agents");
  const st = doc(ctx, "strategies");
  const ins = doc(ctx, "insights");
  const na = (k) => html`<div class="mem-lane__none" data-source-state="${source(ctx, k)?.status ?? "NO_SNAPSHOT"}">${srcPhrase(source(ctx, k), `${k}.json`)}</div>`;
  const group = (label, list, render, srcKey) => html`<div class="mem-rel-group" data-ref-group="${label}">
    ${sectionLabel(label, list && list.length ? fmtCount(list.length) : null)}
    ${list === null ? na(srcKey) : list.length ? html`<div class="mem-rel-group__items">${list.map(render)}</div>` : html`<div class="mem-lane__none">None</div>`}
  </div>`;
  const agentRefs = agents ? agents.agents.filter((a) => a.memory_refs.includes(id)) : null;
  const proposals = st ? st.proposals.filter((p) => p.evidence_refs.includes(id)) : null;
  const lineage = st ? st.strategies.flatMap((s) => s.versions.filter((v) => v.lineage.some((l) => l.kind === "MEMORY" && l.ref === id)).map((v) => ({ s, v }))) : null;
  const insights = ins ? ins.insights.filter((i) => i.evidence_refs.includes(id)) : null;
  const memRefs = mems.filter((o) => o.related_memories.includes(id));
  return html`
    ${group("Agents", agentRefs, (a) => html`<span class="mem-lane__ref"><a class="ref" href="${agentHref(a.slot)}">${agentLabel(a.slot)}</a><span class="mem-lane__from">memory_refs</span></span>`, "agents")}
    ${group("Strategy versions", lineage, ({ s, v }) => html`<span class="mem-lane__ref"><a class="ref" href="${strategyHref(s.strategy_id)}">${s.strategy_id} v${v.version}</a><span class="mem-lane__from">lineage</span>${badge(v.status)}</span>`, "strategies")}
    ${group("Improvement proposals", proposals, (p) => html`<span class="mem-lane__ref"><span class="ref">${p.proposal_id}</span><span class="mem-lane__from">→ <a class="ref" href="${strategyHref(p.strategy_id)}">${p.strategy_id}</a> v${p.base_version}</span>${badge(p.state)}</span>`, "strategies")}
    ${group("Insights", insights, (i) => html`<span class="mem-lane__ref"><a class="ref" href="#/insights">${i.insight_id}</a><span class="mem-lane__from">${i.title}</span></span>`, "insights")}
    ${group("Other memories", memRefs, (o) => html`<span class="mem-lane__ref"><a class="ref" href="${memHref(o.memory_id)}">${o.memory_id}</a><span class="mem-lane__from">related_memories</span></span>`, "memory")}`;
}

/* ------------------------------------------------------------ cross-checks + agent activity */

function mentions(f, id) {
  if ((f.refs ?? []).includes(id)) return true;
  // UNRESOLVED_REFERENCE findings carry no refs (see shared request); match the id as a whole token.
  if (f.section !== "memory") return false;
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${esc}($|[^A-Za-z0-9_-])`).test(f.message);
}

function activityPanel(ctx, m) {
  const findings = findingsFor(ctx).filter((f) => f.code !== "SYNTHETIC_FIXTURE_LOADED" && mentions(f, m.memory_id));
  const ex = ctx.extra;
  const evOk = ex && !ex.error && (ex.source?.status === "OK" || ex.source?.status === "INVALID");
  const evs = evOk ? ex.events.filter((e) => (e.refs?.memory_ids ?? []).includes(m.memory_id)) : null;
  // The fetch is a window of the newest events; say so whenever the stream holds more.
  const whole = evOk && !isNil(ex.source.valid_events) && ex.events.length >= ex.source.valid_events;
  return html`<div class="mem-activity">
    <div class="mem-activity__col">
      ${sectionLabel("Consistency findings", "naming this memory")}
      ${findingsList(findings, { empty: emptyState({ title: "No findings", reason: "No cross-check of connected state names this memory.", compact: true, iconName: "shield" }) })}
    </div>
    <div class="mem-activity__col">
      ${sectionLabel("Agent events", "referencing this memory")}
      ${evs === null
        ? emptyState({
            title: ex?.error || !ex?.source ? "Event stream could not be fetched" : sourceTitle(ex.source, "Agent event stream"),
            reason: ex?.error ? ex.error : ex?.source ? `${srcPhrase(ex.source, "agent_events.jsonl")}.` : "agent_events.jsonl unavailable.",
            compact: true,
            iconName: "agentmem",
            code: `memory-events-${ex?.source?.status ?? "unavailable"}`,
          })
        : evs.length
          ? html`<ul class="mem-evlist">${evs.map(
              (e) => html`<li data-event-id="${e.event_id}">
                <span class="mono muted">${fmtDateTime(e.ts)}</span>
                <a class="ref" href="${agentHref(e.agent_slot)}">${agentLabel(e.agent_slot)}</a>
                <span class="mem-evkind ${{ MEMORY_RECALL: "mem-evkind--recall", MEMORY_WRITE: "mem-evkind--write", APPLICABILITY_TEST: "mem-evkind--test" }[e.kind] ?? ""}">${humanize(e.kind)}</span>
                <span class="mem-evlist__sum">${e.summary}</span>
              </li>`,
            )}</ul>`
          : emptyState({
              title: whole ? "None recorded" : "None in the latest events",
              reason: whole
                ? "No event in the agent event stream references this memory."
                : `No event among the latest ${fmtCount(ex.events.length)} fetched references this memory; older events were not scanned.`,
              compact: true,
              iconName: "agentmem",
              code: whole ? "memory-events-none" : "memory-events-none-window",
            })}
    </div>
  </div>`;
}

/* ------------------------------------------------------------ states */

function notConnected(ctx, id, src) {
  return html`
    ${pageHeader({ kicker: "MEMORY", code: "MEM-D", title: `Memory ${id}`, sub: "Memory records are read from memory.json.", right: sourceTags(ctx, ["memory"]) })}
    <div class="grid">
      ${panel({ span: 8, code: "MEM-D01", title: "Memory record", body: sourceEmpty(src, { title: sourceTitle(src, "Memory store"), hint: `When memory.json is available, ${id} is shown here with its source, hypothesis, observation, evidence for and against, checks, confidence, status and relationships.` }), cls: "lg-span-12" })}
      ${panel({ span: 4, code: "MEM-D02", title: "What a record carries", sub: "Contract fields", body: anatomy({ compact: true }), cls: "lg-span-12" })}
    </div>`;
}

function notFound(ctx, id, mems) {
  const recent = (derived(ctx, "memory_stats")?.recent ?? []).slice(0, 6);
  const idx = memoryIndex(mems);
  return html`
    ${pageHeader({ kicker: "MEMORY", code: "MEM-D", title: "Memory not found", sub: "The requested id is not present in the connected memory store.", right: sourceTags(ctx, ["memory"]) })}
    <div class="grid">
      ${panel({
        span: 8,
        code: "MEM-D01",
        title: "Memory record",
        body: emptyState({
          title: "No such memory",
          reason: `No memory with id “${id}” exists in memory.json (${splitText(originCounts(mems), mems.length === 1 ? "memory" : "memories")} on record). Nothing is shown in its place.`,
          hint: html`<a class="ref" href="#/memory/findings">Browse findings</a> · <a class="ref" href="#/memory/lessons">Browse lessons</a>`,
          iconName: "memory",
          code: "memory-not-found",
        }),
        cls: "lg-span-12",
      })}
      ${panel({
        span: 4,
        code: "MEM-D02",
        title: "Recent memories",
        body: recent.length
          ? html`<ul class="mem-untrace">${recent.map((rid) => html`<li><a class="ref" href="${memHref(rid)}">${rid}</a><span class="mem-untrace__title">${idx.get(rid)?.title ?? ""}</span></li>`)}</ul>`
          : emptyState({ title: "None recorded", compact: true }),
        cls: "lg-span-12",
      })}
    </div>`;
}

export default {
  title: (ctx) => `Memory ${ctx.params.id ?? ""}`,
  async load() {
    try {
      const res = await fetchEvents({ limit: EVENT_LIMIT });
      return { events: res.events, source: res.source, error: null };
    } catch (err) {
      return { events: null, source: null, error: String(err && err.message ? err.message : err) };
    }
  },
  render(ctx) {
    const id = ctx.params.id;
    const { mems, src } = memState(ctx);
    if (!mems) return notConnected(ctx, id, src);
    const idx = memoryIndex(mems);
    const m = idx.get(id);
    if (!m) return notFound(ctx, id, mems);
    const c = evidenceCounts(m);

    return html`
      ${pageHeader({
        kicker: html`<span class="mem-kick-id">MEMORY #${m.memory_id}</span>`,
        code: "MEM-D",
        title: m.title,
        sub: html`${humanize(m.type)} · created ${fmtDate(m.created_at)} · source ${humanize(m.source.actor)}${isNil(m.source.agent_slot) ? "" : ` · ${agentLabel(m.source.agent_slot)}`}`,
        right: html`<div class="mem-head-flags">${typeBadge(m.type)}${originBadge(m.origin)}${badge(m.validation_state, { size: "lg" })}</div>${sourceTags(ctx, ["memory"])}`,
      })}

      ${c.total === 0 ? notice({ title: "Untraceable memory", body: "No evidence item is attached. Every important memory should be traceable to the experiment, trial or document that produced it.", tone: toneOf("WARN") }) : ""}

      <div class="grid">
        ${panel({
          span: 8,
          code: "MEM-D01",
          title: "Memory record",
          sub: "As declared in memory.json",
          cls: "lg-span-12 mem-record-panel",
          body: html`
            ${verdictStrip(m)}
            <div class="mem-gap">${sectionLabel("Declared checks", "on the memory itself")}${checksPanel(m)}</div>
            <div class="mem-gap">${kv(
              [
                ["ID", html`<span class="mono strong">${m.memory_id}</span>`],
                ["Type", html`<span class="mem-k mem-k--strong">${humanize(m.type)}</span>`],
                ["Created", html`<span class="mono v" data-v>${fmtDateTime(m.created_at)}</span>`],
                ["Last reviewed", m.last_reviewed ? html`<span class="mono v" data-v>${fmtDateTime(m.last_reviewed)}</span>` : null],
              ],
              { cols: 4 },
            )}</div>
            <div class="mem-texts">
              ${textBlock("Hypothesis", m.hypothesis, "No hypothesis declared")}
              ${textBlock("Observation", m.observation, "No observation declared")}
            </div>`,
        })}
        <div class="span-4 lg-span-12 stack">
          ${panel({ code: "MEM-D02", title: "Source", sub: "Who recorded it, from what", body: sourcePanel(ctx, m), cls: "mem-src-panel" })}
          ${panel({ code: "MEM-D03", title: "Related", sub: "Declared on this memory", body: relatedPanel(ctx, m, idx), cls: "mem-grow" })}
        </div>
      </div>

      <div class="grid">
        ${panel({ span: 6, code: "MEM-D04", title: "Supporting evidence", sub: `${fmtCount(c.supports)} item(s)`, body: evidenceColumn(m, "SUPPORTS"), cls: "md-span-6 mem-ev-panel" })}
        ${panel({ span: 6, code: "MEM-D05", title: "Contradicting evidence", sub: `${fmtCount(c.contradicts)} item(s)`, body: evidenceColumn(m, "CONTRADICTS"), cls: "md-span-6 mem-ev-panel" })}
      </div>
      ${c.neutral ? html`<div class="grid">${panel({ span: 12, code: "MEM-D06", title: "Neutral evidence", sub: `${fmtCount(c.neutral)} item(s)`, body: evidenceColumn(m, "NEUTRAL") })}</div>` : ""}

      <div class="grid">
        ${panel({ span: 7, code: "MEM-D07", title: "Local relationships", sub: "Edges of the knowledge graph touching this memory", body: relationsPanel(ctx, m), cls: "lg-span-12" })}
        ${panel({ span: 5, code: "MEM-D08", title: "Referenced by", sub: "Records that cite this memory", body: referencedBy(ctx, m, mems), cls: "lg-span-12" })}
      </div>

      <div class="grid">
        ${panel({ span: 12, code: "MEM-D09", title: "Cross-checks & activity", sub: "Consistency findings and agent events naming this memory", body: activityPanel(ctx, m) })}
      </div>
    `;
  },
};
