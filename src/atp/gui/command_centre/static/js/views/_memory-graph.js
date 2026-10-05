// Knowledge-graph helpers for the memory views: relation vocabulary, a
// display-safe copy of derived.knowledge_graph, filtering, degree counts and a
// small ego graph for a single memory. Nodes and edges come only from
// derived.knowledge_graph — nothing here creates a relationship.

import { html, raw, esc } from "../core/html.js";
import { toneOf } from "../core/tones.js";
import { doc, derived } from "../core/state.js";
import { hrefForNode } from "../components/graph.js";
import { tally } from "./_memory-common.js";

/** Edge relations emitted by derive_knowledge_graph, with who declares them. */
export const RELATIONS = [
  ["SUPPORTS", "Memory → trial", "Evidence item (kind TRIAL) with stance SUPPORTS"],
  ["CONTRADICTS", "Memory → trial", "Evidence item (kind TRIAL) with stance CONTRADICTS"],
  ["TESTS", "Trial → hypothesis", "trial.hypothesis_id"],
  ["TESTED_BY", "Hypothesis → trial", "hypothesis.trial_numbers"],
  ["PART_OF", "Hypothesis → programme", "hypothesis.programme_id"],
  ["BECAME", "Hypothesis → strategy", "hypothesis.strategy_id"],
  ["DERIVED_FROM", "Strategy → lineage", "strategy version lineage refs"],
  ["SOURCED_FROM", "Memory → trial", "memory.source.trial_ids"],
  ["RELATES_TO", "Memory → strategy / memory", "related_strategies · related_memories"],
  ["PROPOSES_CHANGE", "Proposal → strategy", "proposal.strategy_id"],
];

export const TYPE_LABEL = {
  PROGRAMME: "Programmes",
  HYPOTHESIS: "Hypotheses",
  TRIAL: "Trials",
  MEMORY: "Memories",
  STRATEGY: "Strategies",
  PROPOSAL: "Proposals",
};

/** "DERIVED_FROM(v2)" -> "DERIVED_FROM" */
export const baseRelation = (r) => String(r).replace(/\(.*\)$/, "");

/** Edge colour follows the tone system: SUPPORTS info, CONTRADICTS bad, all else muted. */
export const relationTone = (r) => toneOf(baseRelation(r));

/**
 * derived.knowledge_graph with one local correction: derive.py registers
 * proposal nodes only after strategy lineage edges were drawn, so a proposal
 * referenced from a lineage is left as an UNRESOLVED placeholder even when
 * strategies.json declares it. Such a placeholder is replaced by the declared
 * proposal (explicit reference, nothing inferred). Reported as a shared request.
 */
export function graphFor(ctx) {
  const kg = derived(ctx, "knowledge_graph");
  if (!kg) return null;
  const proposals = new Map((doc(ctx, "strategies")?.proposals ?? []).map((p) => [p.proposal_id, p]));
  const nodes = kg.nodes.map((n) => {
    if (n.type === "PROPOSAL" && n.state === "UNRESOLVED" && proposals.has(n.id)) {
      const p = proposals.get(n.id);
      return { ...n, label: p.summary, state: p.state, origin: null };
    }
    return n;
  });
  return { ...kg, nodes, unresolved: nodes.filter((n) => n.state === "UNRESOLVED").length };
}

/** Edge count per node key (display tally of derived edges). */
export function degreeMap(graph) {
  const deg = {};
  for (const e of graph?.edges ?? []) {
    deg[e.source] = tally(deg, e.source) + 1;
    deg[e.target] = tally(deg, e.target) + 1;
  }
  return deg;
}

/** Nodes of one type, plus every node they share an edge with, and those edges. */
export function filterByType(graph, type) {
  if (!graph || !type) return graph;
  const core = new Set(graph.nodes.filter((n) => n.type === type).map((n) => n.key));
  const edges = graph.edges.filter((e) => core.has(e.source) || core.has(e.target));
  const keep = new Set(core);
  for (const e of edges) {
    keep.add(e.source);
    keep.add(e.target);
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.key));
  return { ...graph, nodes, edges, unresolved: nodes.filter((n) => n.state === "UNRESOLVED").length };
}

/** Edges touching one node key: [{edge, dir: "out"|"in", other: node}] */
export function edgesOf(graph, key) {
  if (!graph) return [];
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const out = [];
  for (const e of graph.edges) {
    if (e.source === key) out.push({ edge: e, dir: "out", other: byKey.get(e.target) ?? { key: e.target, id: e.target, type: "?", state: "UNRESOLVED" } });
    else if (e.target === key) out.push({ edge: e, dir: "in", other: byKey.get(e.source) ?? { key: e.source, id: e.source, type: "?", state: "UNRESOLVED" } });
  }
  return out;
}

const TONE_VAR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--cyan-2)", accent: "var(--blue-2)", muted: "var(--muted)" };

/**
 * Ego graph: the memory in the centre, nodes it references on the right
 * (outgoing edges), nodes that reference it on the left (incoming).
 */
export function egoGraph(center, links) {
  const left = links.filter((l) => l.dir === "in");
  const right = links.filter((l) => l.dir === "out");
  const rowH = 40;
  const rows = Math.max(1, left.length, right.length);
  const W = 860;
  const H = Math.max(150, rows * rowH + 50);
  const cx = W / 2;
  const cy = H / 2;
  const lx = 120;
  const rx = W - 120;
  const parts = [];
  parts.push(`<text x="${lx}" y="16" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:8.5px">REFERENCES THIS MEMORY · ${left.length}</text>`);
  parts.push(`<text x="${rx}" y="16" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:8.5px">REFERENCED BY THIS MEMORY · ${right.length}</text>`);
  const place = (list, x) =>
    list.map((l, i) => {
      const y = cy + (i - (list.length - 1) / 2) * rowH;
      return { ...l, x, y };
    });
  const L = place(left, lx);
  const R = place(right, rx);
  const edge = (l, fromX, fromY, toX, toY) => {
    const tone = relationTone(l.edge.relation);
    const col = TONE_VAR[tone];
    const mx = (fromX + toX) / 2;
    parts.push(`<path class="mem-ego__edge" d="M${fromX} ${fromY.toFixed(1)} C${mx} ${fromY.toFixed(1)}, ${mx} ${toY.toFixed(1)}, ${toX} ${toY.toFixed(1)}" fill="none" stroke="${col}" stroke-opacity=".6" stroke-width="1.1"/>`);
    // arrow head at the target end
    const dir = toX > fromX ? 1 : -1;
    parts.push(`<path d="M${toX - dir * 6} ${(toY - 3).toFixed(1)} L${toX} ${toY.toFixed(1)} L${toX - dir * 6} ${(toY + 3).toFixed(1)}" fill="none" stroke="${col}" stroke-width="1"/>`);
    const lblX = fromX + (toX - fromX) * 0.5;
    const lblY = fromY + (toY - fromY) * 0.5 - 5;
    parts.push(`<text x="${lblX.toFixed(1)}" y="${lblY.toFixed(1)}" text-anchor="middle" class="svg-label" style="font-size:8px;fill:${col}">${esc(l.edge.relation)}</text>`);
  };
  L.forEach((l) => edge(l, l.x + 80, l.y, cx - 92, cy));
  R.forEach((l) => edge(l, cx + 92, cy, l.x - 80, l.y));
  const node = (n, x, y, w, strong) => {
    const unresolved = n.state === "UNRESOLVED";
    const tone = unresolved ? "muted" : toneOf(n.state);
    const col = TONE_VAR[tone];
    const href = unresolved ? null : hrefForNode(n);
    const id = String(n.id).length > 20 ? String(n.id).slice(0, 19) + "…" : String(n.id);
    const g =
      `<g class="mem-ego__node" data-key="${esc(n.key)}" data-state="${esc(n.state ?? "")}">` +
      `<rect x="${x - w / 2}" y="${y - 15}" width="${w}" height="30" rx="3" fill="${strong ? "rgba(34,211,238,.10)" : "rgba(13,20,30,.95)"}" stroke="${unresolved ? "var(--faint)" : col}" stroke-opacity="${unresolved ? 1 : 0.7}" ${unresolved ? 'stroke-dasharray="3 3"' : ""}/>` +
      `<circle cx="${x - w / 2 + 10}" cy="${y}" r="3" fill="${col}"/>` +
      `<text x="${x - w / 2 + 19}" y="${y - 3}" class="svg-label svg-label--muted" style="font-size:7.5px">${esc(n.type)}${unresolved ? " · UNRESOLVED" : ""}</text>` +
      `<text x="${x - w / 2 + 19}" y="${y + 9}" class="svg-label" style="font-size:9.5px;letter-spacing:.04em;text-transform:none;fill:${unresolved ? "var(--muted)" : "var(--text)"}">${esc(id)}</text>` +
      `<title>${esc(n.type)} ${esc(n.id)}${n.label ? " — " + esc(n.label) : ""} [${esc(n.state ?? "")}]</title></g>`;
    parts.push(href && !strong ? `<a href="${esc(href)}">${g}</a>` : g);
  };
  L.forEach((l) => node(l.other, l.x, l.y, 160, false));
  R.forEach((l) => node(l.other, l.x, l.y, 160, false));
  node(center, cx, cy, 184, true);
  return html`<div class="diagram mem-ego" style="--diagram-min:640px">${raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Relationships of this memory">${parts.join("")}</svg>`)}</div>`;
}
