// Knowledge Graph — programmes, hypotheses, trials, memories, strategies and
// proposals linked only by references their producers declared. Unresolved
// references are drawn dashed and listed; nothing is inferred or hidden.

import { html } from "../core/html.js";
import { fmtCount, humanize, isNil } from "../core/format.js";
import { source, sourceShort, sourceTitle } from "../core/state.js";
import { pageHeader, panel, badge, stat, statRow, val, originBadge, emptyState, tabs, legend } from "../components/ui.js";
import { knowledgeGraph, graphSchematic, GRAPH_COLUMNS, hrefForNode } from "../components/graph.js";
import { icon } from "../components/icons.js";
import { qhref, sourceTags, frameTable, sectionLabel, tally, originCounts, splitVal } from "./_memory-common.js";
import { RELATIONS, TYPE_LABEL, baseRelation, relationTone, graphFor, degreeMap, filterByType } from "./_memory-graph.js";

const NODE_TONES = [
  ["Passed · validated", "ok"],
  ["Pending · provisional", "warn"],
  ["Failed · rejected · contradicted", "bad"],
  ["Active · in progress", "info"],
  ["Sealed · frozen", "accent"],
  ["Unknown / unresolved", "muted"],
];

function graphSources(ctx) {
  return ["research", "strategies", "memory"].map((k) => source(ctx, k));
}

/** One status shared by every graph source, or null when they differ. */
function sharedStatus(ctx) {
  const states = [...new Set(graphSources(ctx).map((s) => s?.status ?? "NO_SNAPSHOT"))];
  return states.length === 1 ? graphSources(ctx)[0] : null;
}

/**
 * Title for a panel whose graph is unavailable: names the source state
 * ("Graph sources not connected", "… not produced", "… rejected by the
 * contract"), never a zero such as "No nodes" — not connected is not none recorded.
 */
function unavailableTitle(ctx) {
  const one = sharedStatus(ctx);
  return one ? sourceTitle(one, "Graph sources") : "Graph sources unavailable";
}

/** Why the graph is unavailable, source by source. */
function unavailableReason(ctx) {
  return graphSources(ctx)
    .map((s) => (s ? sourceTitle(s, s.file) : "No snapshot"))
    .join(" · ")
    .concat(".");
}

/** Short empty label for graph stats: the shared state, else UNAVAILABLE. */
function unavailableShort(ctx) {
  const one = sharedStatus(ctx);
  return one ? sourceShort(one) : "UNAVAILABLE";
}

/** Which document declares each node type / edge relation. A count whose declaring source is not
 *  connected is unknown (empty), never 0. */
const TYPE_SOURCE = { PROGRAMME: "research", HYPOTHESIS: "research", TRIAL: "research", MEMORY: "memory", STRATEGY: "strategies", PROPOSAL: "strategies" };
const REL_SOURCE = {
  SUPPORTS: "memory", CONTRADICTS: "memory", SOURCED_FROM: "memory", RELATES_TO: "memory",
  TESTS: "research", TESTED_BY: "research", PART_OF: "research", BECAME: "research",
  DERIVED_FROM: "strategies", PROPOSES_CHANGE: "strategies",
};
const srcOk = (ctx, key) => source(ctx, key)?.status === "OK";

/** Graph nodes per record origin: proposals declare none (NO ORIGIN); unresolved placeholders are not records (UNRES.). */
const nodeOrigin = (n) => (n.state === "UNRESOLVED" ? "UNRESOLVED" : n.origin ?? "UNDECLARED");

function summary(ctx, graph, why) {
  const avail = !!graph?.available;
  const memOk = srcOk(ctx, "memory");
  const n = (v) => (avail ? fmtCount(v) : null);
  const rel = (r) => (avail && srcOk(ctx, REL_SOURCE[r]) ? graph.edges.filter((e) => baseRelation(e.relation) === r).length : null);
  const nodes = (pred) => (avail ? splitVal(originCounts(graph.nodes, pred, nodeOrigin), { cls: "mem-split--sm" }) : null);
  return html`<div class="mem-stats-6">${statRow(
    [
      stat({ label: "Nodes", value: nodes((x) => x.state !== "UNRESOLVED"), hint: "Declared records · per origin", emptyLabel: why }),
      stat({ label: "Edges", value: n(graph?.edges.length), hint: "Explicit references", emptyLabel: why }),
      stat({ label: "Unresolved refs", value: n(graph?.unresolved), hint: "Targets not found in state", emptyLabel: why }),
      stat({ label: "Memory nodes", value: memOk ? nodes((x) => x.type === "MEMORY" && x.state !== "UNRESOLVED") : null, hint: "Resolved memories · per origin", emptyLabel: memOk ? why : sourceShort(source(ctx, "memory")) }),
      stat({ label: "Supports", value: n(rel("SUPPORTS")), hint: "Memory → trial evidence", emptyLabel: memOk ? why : sourceShort(source(ctx, "memory")) }),
      stat({ label: "Contradicts", value: n(rel("CONTRADICTS")), hint: "Memory → trial evidence", emptyLabel: memOk ? why : sourceShort(source(ctx, "memory")) }),
    ],
    { min: 130 },
  )}</div>`;
}

function typeTabs(ctx, graph, active) {
  const avail = !!graph?.available;
  const count = (t) =>
    avail && (!t || srcOk(ctx, TYPE_SOURCE[t])) ? splitVal(originCounts(graph.nodes, t ? (n) => n.type === t : null, nodeOrigin), { cls: "mem-split--sm" }) : null;
  return tabs(
    [
      // The all-types count is the Nodes stat directly above (per origin); the tab carries none.
      { key: "ALL", label: "All types", href: qhref("/memory/graph", ctx.query, { type: null }) },
      ...GRAPH_COLUMNS.map((t) => ({ key: t, label: TYPE_LABEL[t], href: qhref("/memory/graph", ctx.query, { type: t }), count: count(t) })),
    ],
    active,
  );
}

function graphBody(ctx, graph, shown, type) {
  const anyConnected = graphSources(ctx).some((s) => s?.status === "OK");
  if (!graph?.available || !anyConnected) {
    const memSrc = source(ctx, "memory");
    return html`<div class="mem-graph" data-graph-mode="schematic">
      ${graphSchematic()}
      <div class="mem-graph__note">${emptyState({
        title: unavailableTitle(ctx),
        reason: unavailableReason(ctx),
        compact: true,
        iconName: graphSources(ctx).some((x) => x?.status === "INVALID" || x?.status === "UNREADABLE") ? "alert" : "empty",
        code: `source-graph-${sharedStatus(ctx)?.status ?? "MIXED"}`,
        hint: "Relationships are only drawn from explicit references — none are inferred. Programmes, hypotheses, trials, memories, strategies and proposals appear in these columns once research.json, strategies.json or memory.json is available.",
      })}</div>
    </div>`;
  }
  if (graph.nodes.length === 0) {
    return html`<div class="mem-graph" data-graph-mode="schematic">
      ${graphSchematic()}
      <div class="mem-graph__note">${emptyState({ title: "No relationships recorded", reason: "Connected sources contain no programmes, hypotheses, trials, memories, strategies or proposals.", hint: "Relationships are only drawn from explicit references — none are inferred.", compact: true })}</div>
    </div>`;
  }
  if (type && shown.nodes.length === 0) {
    return html`<div class="mem-graph" data-graph-mode="filtered-empty">${emptyState({ title: `No ${TYPE_LABEL[type] ?? humanize(type)} in the graph`, reason: "No connected source declares a record of this type.", compact: true, code: "graph-type-empty" })}</div>`;
  }
  return html`<div class="mem-graph" data-graph-mode="${type ? "filtered" : "full"}" data-graph-type="${type ?? ""}">${knowledgeGraph(shown, { focus: ctx.query.focus })}</div>`;
}

function legendPanel(ctx, graph, { wide = false } = {}) {
  const avail = !!graph?.available;
  const relCount = (r) => (avail && srcOk(ctx, REL_SOURCE[r]) ? graph.edges.filter((e) => baseRelation(e.relation) === r).length : null);
  return html`<div class="mem-legend ${wide ? "mem-legend--wide" : ""}">
    <div class="mem-legend__states">
    ${sectionLabel("Node state", "colour follows the tone system")}
    ${avail
      ? legend(NODE_TONES)
      : html`<p class="mem-legend-prose">Each node is outlined in the tone of its declared state — passed or validated, pending or provisional, failed, rejected or contradicted, active, sealed — and muted when the state is unknown. The key is shown once a graph is connected.</p>`}
    <div class="mem-legend-unres"><i></i>Dashed outline — referenced but not found in any connected source</div>
    </div>
    <div class="divider"></div>
    <div class="mem-legend__rels">
    ${sectionLabel("Edge relations", "declared by")}
    <div class="mem-rels">
      ${RELATIONS.map(
        ([r, path, by]) => html`<div class="mem-rel" data-relation="${r}">
          <span class="mem-rel__swatch tone-${relationTone(r)}"></span>
          <span class="mem-rel__name">${r}</span>
          <span class="mem-rel__n">${val(isNil(relCount(r)) ? null : fmtCount(relCount(r)))}</span>
          <span class="mem-rel__path">${path}</span>
          <span class="mem-rel__by">${by}</span>
        </div>`,
      )}
    </div>
    </div>
  </div>`;
}

function unresolvedPanel(ctx, graph) {
  if (!graph?.available) return emptyState({ compact: true, title: unavailableTitle(ctx), reason: unavailableReason(ctx), hint: "References whose target is not present in any connected source are listed here — never dropped.", code: `source-graph-${sharedStatus(ctx)?.status ?? "MIXED"}` });
  const unresolved = graph.nodes.filter((n) => n.state === "UNRESOLVED");
  if (!unresolved.length) return emptyState({ title: "All references resolve", reason: "Every declared reference points at a record present in connected state.", compact: true, iconName: "link" });
  return html`<ul class="mem-unres-list">${unresolved.map((n) => {
    const by = graph.edges.filter((e) => e.target === n.key || e.source === n.key);
    return html`<li data-unresolved="${n.key}">
      <div class="mem-unres-list__head"><span class="mem-k">${n.type}</span><span class="mem-unres">${n.id}<span class="mem-unres__tag">UNRESOLVED</span></span></div>
      <div class="mem-unres-list__by">${by.map((e) => html`<span><span class="mono">${e.relation}</span> · declared by <span class="ref">${e.declared_by}</span></span>`)}</div>
    </li>`;
  })}</ul>`;
}

function nodeTable(ctx, graph, shown) {
  const deg = degreeMap(graph);
  const order = new Map(GRAPH_COLUMNS.map((t, i) => [t, i]));
  const rows = shown?.available ? [...shown.nodes].sort((a, b) => (order.get(a.type) ?? 9) - (order.get(b.type) ?? 9) || String(a.id).localeCompare(String(b.id))) : null;
  const focus = ctx.query.focus;
  return frameTable({
    maxHeight: 940,
    rows,
    rowHref: (n) => (n.state === "UNRESOLVED" ? null : hrefForNode(n)),
    rowAttrs: (n) => html`data-node="${n.key}" ${focus && (n.id === focus || n.key === focus) ? html`class="mem-row-focus"` : ""}`,
    columns: [
      { key: "type", label: "Type", render: (n) => html`<span class="mem-k">${n.type}</span>` },
      {
        key: "id",
        label: "ID",
        render: (n) => (n.state === "UNRESOLVED" ? html`<span class="mem-unres">${n.id}<span class="mem-unres__tag">UNRESOLVED</span></span>` : hrefForNode(n) ? html`<a class="ref" href="${hrefForNode(n)}">${n.id}</a>` : html`<span class="ref">${n.id}</span>`),
      },
      { key: "label", label: "Label", cls: "wrap", render: (n) => (n.state === "UNRESOLVED" ? html`<span class="muted">Referenced, not declared</span>` : n.label) },
      { key: "state", label: "State", render: (n) => badge(n.state) },
      { key: "origin", label: "Origin", render: (n) => (n.origin ? (n.origin === "ORIGINAL" ? html`<span class="mem-k">ORIGINAL</span>` : originBadge(n.origin)) : null) },
      { key: "degree", label: "Degree", num: true, render: (n) => html`<span class="v" data-v>${fmtCount(tally(deg, n.key))}</span>` },
    ],
    empty: graph?.available
      ? emptyState({ title: "No nodes", reason: "No declared record matches this filter.", compact: true })
      : emptyState({ compact: true, title: unavailableTitle(ctx), reason: unavailableReason(ctx), hint: "Each programme, hypothesis, trial, memory, strategy and proposal is listed here with its state, origin and degree.", code: `source-graph-${sharedStatus(ctx)?.status ?? "MIXED"}` }),
  });
}

export default {
  title: "Knowledge Graph",
  render(ctx) {
    const graph = graphFor(ctx);
    const type = GRAPH_COLUMNS.includes(ctx.query.type) ? ctx.query.type : null;
    const shown = filterByType(graph, type);
    const memSrc = source(ctx, "memory");
    const why = graph?.available ? null : unavailableShort(ctx);
    const memMissing = graph?.available && memSrc?.status !== "OK";
    const whySub = why ? why.charAt(0) + why.slice(1).toLowerCase() : null;
    const g03 = (opts = {}) => panel({ ...opts, code: "MEM-G03", title: "Unresolved references", sub: graph?.available ? `${fmtCount(graph.unresolved)} target(s) not found` : whySub, body: unresolvedPanel(ctx, graph) });
    const g04 = (cls) => panel({
      span: 8,
      code: "MEM-G04",
      title: "Nodes",
      sub: shown?.available ? (type ? `${TYPE_LABEL[type]} + neighbours · state, origin, degree` : "Every node · state, origin, degree") : whySub,
      body: nodeTable(ctx, graph, shown),
      cls,
    });
    // With nothing to list, the node table is a compact empty state: the legend
    // takes its own full-width row so no panel is stretched around blank space.
    const noNodes = !shown?.available || shown.nodes.length === 0;
    const fullLower = html`<div class="grid">
        <div class="span-4 lg-span-12 stack">
          ${panel({ code: "MEM-G02", title: "Legend", sub: "Node states · edge relations", body: legendPanel(ctx, graph) })}
          ${g03()}
        </div>
        ${g04("lg-span-12")}
      </div>`;
    const compactLower = html`<div class="grid">
        ${panel({ span: 12, code: "MEM-G02", title: "Legend", sub: "Node states · edge relations", body: legendPanel(ctx, graph, { wide: true }) })}
      </div>
      <div class="grid mem-graph-lower" data-graph-lower="compact">
        ${g03({ span: 4, cls: "lg-span-12" })}
        ${g04("lg-span-12")}
      </div>`;
    return html`
      ${pageHeader({
        kicker: "MEMORY",
        code: "MEM-G",
        title: "Knowledge Graph",
        sub: "How research, memory and strategies reference one another. Every edge is a reference a producer declared; unresolved targets stay visible as dashed nodes.",
        right: sourceTags(ctx, ["research", "strategies", "memory"]),
      })}

      <div class="grid">
        ${panel({
          span: 12,
          code: "MEM-G01",
          title: "Knowledge graph",
          sub: graph?.available
            ? type
              ? `${TYPE_LABEL[type]} and the records they reference`
              : "All declared relationships"
            : sharedStatus(ctx)?.status === "NOT_CONFIGURED"
              ? "No SENTRY state directory is configured"
              : unavailableReason(ctx),
          actions: legend([
            ["Supports", relationTone("SUPPORTS")],
            ["Contradicts", relationTone("CONTRADICTS")],
            ["Other relation", relationTone("RELATES_TO")],
          ]),
          body: html`
            ${summary(ctx, graph, why)}
            ${memMissing ? html`<div class="mem-inline-note" data-graph-missing="memory">${icon("alert")}<span>${sourceTitle(memSrc, "memory.json")}: memory nodes and their evidence edges are absent, not zero.</span></div>` : ""}
            <div class="mem-graph-tabs">${typeTabs(ctx, graph, type ?? "ALL")}</div>
            ${graphBody(ctx, graph, shown, type)}`,
          foot: html`Relationships are only drawn from explicit references — none are inferred. Hover a node to trace its edges; click to open it.`,
        })}
      </div>

      ${noNodes ? compactLower : fullLower}
    `;
  },
};
