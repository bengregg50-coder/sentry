// Knowledge Graph — programmes, hypotheses, trials, memories, strategies and
// proposals linked only by references their producers declared. Unresolved
// references are drawn dashed and listed; nothing is inferred or hidden.

import { html } from "../core/html.js";
import { fmtCount, humanize } from "../core/format.js";
import { source, sourceReason, sourceShort } from "../core/state.js";
import { pageHeader, panel, badge, stat, statRow, val, originBadge, emptyState, sourceEmpty, tabs, legend } from "../components/ui.js";
import { knowledgeGraph, graphSchematic, GRAPH_COLUMNS, hrefForNode } from "../components/graph.js";
import { icon } from "../components/icons.js";
import { qhref, sourceTags, frameTable, sectionLabel, tally } from "./_memory-common.js";
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

function summary(graph, why) {
  const avail = !!graph?.available;
  const n = (v) => (avail ? fmtCount(v) : null);
  const rel = (r) => (avail ? graph.edges.filter((e) => baseRelation(e.relation) === r).length : null);
  return statRow(
    [
      stat({ label: "Nodes", value: n(graph?.nodes.length), hint: "Declared records", emptyLabel: why }),
      stat({ label: "Edges", value: n(graph?.edges.length), hint: "Explicit references", emptyLabel: why }),
      stat({ label: "Unresolved refs", value: n(graph?.unresolved), hint: "Targets not found in state", emptyLabel: why }),
      stat({ label: "Memory nodes", value: n(graph?.nodes.filter((x) => x.type === "MEMORY" && x.state !== "UNRESOLVED").length), hint: "Resolved memories", emptyLabel: why }),
      stat({ label: "Supports", value: n(rel("SUPPORTS")), hint: "Memory → trial evidence", emptyLabel: why }),
      stat({ label: "Contradicts", value: n(rel("CONTRADICTS")), hint: "Memory → trial evidence", emptyLabel: why }),
    ],
    { min: 130 },
  );
}

function typeTabs(ctx, graph, active) {
  const avail = !!graph?.available;
  const count = (t) => (avail ? graph.nodes.filter((n) => n.type === t).length : null);
  return tabs(
    [
      { key: "ALL", label: "All types", href: qhref("/memory/graph", ctx.query, { type: null }), count: avail ? graph.nodes.length : null },
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
      <div class="mem-graph__note">${sourceEmpty(memSrc, {
        title: "No relationships to draw",
        compact: true,
        hint: "Relationships are only drawn from explicit references — none are inferred. Programmes, hypotheses, trials, memories, strategies and proposals appear in these columns once research.json, strategies.json or memory.json is connected.",
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

function legendPanel(graph) {
  const avail = !!graph?.available;
  const relCount = (r) => (avail ? graph.edges.filter((e) => baseRelation(e.relation) === r).length : null);
  return html`
    ${sectionLabel("Node state", "colour follows the tone system")}
    ${avail
      ? legend(NODE_TONES)
      : html`<p class="mem-legend-prose">Each node is outlined in the tone of its declared state — passed or validated, pending or provisional, failed, rejected or contradicted, active, sealed — and muted when the state is unknown. The key is shown once a graph is connected.</p>`}
    <div class="mem-legend-unres"><i></i>Dashed outline — referenced but not found in any connected source</div>
    <div class="divider"></div>
    ${sectionLabel("Edge relations", "declared by")}
    <div class="mem-rels">
      ${RELATIONS.map(
        ([r, path, by]) => html`<div class="mem-rel" data-relation="${r}">
          <span class="mem-rel__swatch tone-${relationTone(r)}"></span>
          <span class="mem-rel__name">${r}</span>
          <span class="mem-rel__n">${val(avail ? fmtCount(relCount(r)) : null)}</span>
          <span class="mem-rel__path">${path}</span>
          <span class="mem-rel__by">${by}</span>
        </div>`,
      )}
    </div>`;
}

function unresolvedPanel(ctx, graph) {
  if (!graph?.available) return sourceEmpty(source(ctx, "memory"), { compact: true, title: "Nothing to resolve", hint: "References whose target is not present in any connected source are listed here — never dropped." });
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
      : sourceEmpty(source(ctx, "memory"), { compact: true, title: "No nodes", hint: "Each programme, hypothesis, trial, memory, strategy and proposal is listed here with its state, origin and degree." }),
  });
}

export default {
  title: "Knowledge Graph",
  render(ctx) {
    const graph = graphFor(ctx);
    const type = GRAPH_COLUMNS.includes(ctx.query.type) ? ctx.query.type : null;
    const shown = filterByType(graph, type);
    const memSrc = source(ctx, "memory");
    const why = graph?.available ? null : sourceShort(memSrc);
    const memMissing = graph?.available && memSrc?.status !== "OK";
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
          sub: graph?.available ? (type ? `${TYPE_LABEL[type]} and the records they reference` : "All declared relationships") : sourceReason(memSrc),
          actions: legend([
            ["Supports", relationTone("SUPPORTS")],
            ["Contradicts", relationTone("CONTRADICTS")],
            ["Other relation", relationTone("RELATES_TO")],
          ]),
          body: html`
            ${summary(graph, why)}
            ${memMissing ? html`<div class="mem-inline-note">${icon("alert")}<span>memory.json is ${sourceShort(memSrc).toLowerCase()}: memory nodes and their evidence edges are absent, not zero.</span></div>` : ""}
            <div class="mem-graph-tabs">${typeTabs(ctx, graph, type ?? "ALL")}</div>
            ${graphBody(ctx, graph, shown, type)}`,
          foot: html`Relationships are only drawn from explicit references — none are inferred. Hover a node to trace its edges; click to open it.`,
        })}
      </div>

      <div class="grid">
        <div class="span-4 lg-span-12 stack">
          ${panel({ code: "MEM-G02", title: "Legend", sub: "Node states · edge relations", body: legendPanel(graph) })}
          ${panel({ code: "MEM-G03", title: "Unresolved references", sub: graph?.available ? `${fmtCount(graph.unresolved)} target(s) not found` : "Not connected", body: unresolvedPanel(ctx, graph) })}
        </div>
        ${panel({
          span: 8,
          code: "MEM-G04",
          title: "Nodes",
          sub: shown?.available ? `${fmtCount(shown.nodes.length)} shown${type ? ` · filter ${TYPE_LABEL[type]} + neighbours` : ""}` : "Not connected",
          body: nodeTable(ctx, graph, shown),
          cls: "lg-span-12",
        })}
      </div>
    `;
  },
};
