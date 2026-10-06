// Knowledge graph: layered layout by node type. Nodes and edges come only
// from derived.knowledge_graph (explicit references). Unresolved references
// are drawn dashed — they are shown, not invented or hidden.

import { html, raw, esc } from "../core/html.js";
import { toneOf } from "../core/tones.js";
import { emptyState } from "./ui.js";

export const GRAPH_COLUMNS = ["PROGRAMME", "HYPOTHESIS", "TRIAL", "MEMORY", "STRATEGY", "PROPOSAL"];
const COLUMN_LABEL = {
  PROGRAMME: "PROGRAMMES",
  HYPOTHESIS: "HYPOTHESES",
  TRIAL: "EXPERIMENTS / TRIALS",
  MEMORY: "MEMORY",
  STRATEGY: "STRATEGIES",
  PROPOSAL: "PROPOSALS",
};
const TONE_VAR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--cyan-2)", accent: "var(--blue-2)", muted: "var(--muted)" };

export function hrefForNode(n) {
  switch (n.type) {
    case "STRATEGY":
      return `#/strategy/${encodeURIComponent(n.id)}`;
    case "MEMORY":
      return `#/memory/item/${encodeURIComponent(n.id)}`;
    case "HYPOTHESIS":
      return `#/research/hypotheses?focus=${encodeURIComponent(n.id)}`;
    case "TRIAL":
      return `#/research/history?focus=${encodeURIComponent(n.id)}`;
    default:
      return null;
  }
}

/** Schematic shown when nothing is connected: the relationship model, no nodes. */
export function graphSchematic() {
  const W = 1100;
  const H = 168;
  const boxW = 136;
  const half = boxW / 2;
  const boxY = 110;
  const midY = boxY + 17;
  const xs = GRAPH_COLUMNS.map((_, i) => 90 + i * ((W - 180) / (GRAPH_COLUMNS.length - 1)));
  const schematicLabel = { ...COLUMN_LABEL, TRIAL: "TRIALS" };
  const parts = [];
  // Adjacent columns: straight connectors between box edges at mid-height; the label sits above
  // the boxes' top edge, centred on the gap, so it never overlaps a box border.
  const adjacent = [
    [1, 0, "PART OF"],
    [2, 1, "TESTS"],
    [3, 2, "SOURCED FROM"],
    [3, 4, "RELATES TO"],
    [5, 4, "PROPOSES"],
  ];
  adjacent.forEach(([a, b, lbl]) => {
    const left = Math.min(xs[a], xs[b]) + half;
    const right = Math.max(xs[a], xs[b]) - half;
    parts.push(`<line x1="${left}" y1="${midY}" x2="${right}" y2="${midY}" stroke="var(--faint)" stroke-dasharray="2 4"/>`);
    parts.push(`<text x="${(left + right) / 2}" y="${boxY - 7}" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:8px;letter-spacing:.06em">${esc(lbl)}</text>`);
  });
  // The one long relationship arcs over the top.
  const x1 = xs[1];
  const x2 = xs[4];
  parts.push(`<path d="M${x1} ${boxY} C${x1} 36, ${x2} 36, ${x2} ${boxY}" fill="none" stroke="var(--faint)" stroke-dasharray="2 4"/>`);
  parts.push(`<text x="${(x1 + x2) / 2}" y="52" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:8px;letter-spacing:.06em">BECAME</text>`);
  GRAPH_COLUMNS.forEach((c, i) => {
    parts.push(`<rect x="${xs[i] - half}" y="${boxY}" width="${boxW}" height="34" rx="3" fill="rgba(13,20,30,.9)" stroke="var(--line-3)" stroke-dasharray="3 3"/>`);
    parts.push(`<text x="${xs[i]}" y="${boxY + 21}" text-anchor="middle" class="svg-label">${esc(schematicLabel[c])}</text>`);
  });
  return html`<div class="diagram" style="--diagram-min:880px">${raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Knowledge graph relationship model">${parts.join("")}</svg>`)}</div>`;
}

/**
 * @param graph derived.knowledge_graph
 */
export function knowledgeGraph(graph, { perColumn = 30, focus } = {}) {
  if (!graph || !graph.available) return null;
  if (graph.nodes.length === 0) {
    return emptyState({ title: "No relationships recorded", reason: "Connected sources contain no programmes, hypotheses, trials, strategies or memories.", compact: true });
  }
  const cols = GRAPH_COLUMNS.map((t) => graph.nodes.filter((n) => n.type === t));
  const overflow = cols.map((c) => Math.max(0, c.length - perColumn));
  const shown = cols.map((c) => c.slice(0, perColumn));
  const rowH = 30;
  const maxRows = Math.max(1, ...shown.map((c) => c.length));
  const W = 1200;
  const top = 46;
  const H = top + maxRows * rowH + 30;
  const colX = GRAPH_COLUMNS.map((_, i) => 90 + i * ((W - 180) / (GRAPH_COLUMNS.length - 1)));
  const pos = new Map();
  shown.forEach((c, ci) => c.forEach((n, ri) => pos.set(n.key, [colX[ci], top + 16 + ri * rowH])));

  const parts = [];
  GRAPH_COLUMNS.forEach((t, i) => {
    parts.push(`<text x="${colX[i]}" y="20" text-anchor="middle" class="svg-label svg-label--muted">${esc(COLUMN_LABEL[t])} · ${cols[i].length}</text>`);
    parts.push(`<line x1="${colX[i]}" y1="30" x2="${colX[i]}" y2="${H - 16}" stroke="var(--line)" />`);
    if (overflow[i]) parts.push(`<text x="${colX[i]}" y="${H - 4}" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:8.5px">+${overflow[i]} MORE</text>`);
  });
  graph.edges.forEach((e, i) => {
    const a = pos.get(e.source);
    const b = pos.get(e.target);
    if (!a || !b) return;
    const tone = e.relation === "CONTRADICTS" ? "bad" : e.relation === "SUPPORTS" ? "info" : "muted";
    const col = TONE_VAR[tone];
    const mx = (a[0] + b[0]) / 2;
    const d = a[0] === b[0] ? `M${a[0]} ${a[1]} C${a[0] + 60} ${a[1]}, ${b[0] + 60} ${b[1]}, ${b[0]} ${b[1]}` : `M${a[0]} ${a[1]} C${mx} ${a[1]}, ${mx} ${b[1]}, ${b[0]} ${b[1]}`;
    parts.push(`<path class="kg-edge" data-edge="${i}" data-a="${esc(e.source)}" data-b="${esc(e.target)}" d="${d}" fill="none" stroke="${col}" stroke-opacity=".45" stroke-width="1"><title>${esc(e.relation)} · declared by ${esc(e.declared_by)}</title></path>`);
  });
  shown.forEach((c) =>
    c.forEach((n) => {
      const [x, y] = pos.get(n.key);
      const unresolved = n.state === "UNRESOLVED";
      const tone = unresolved ? "muted" : toneOf(n.state);
      const col = TONE_VAR[tone];
      const href = unresolved ? null : hrefForNode(n);
      const label = String(n.id).length > 18 ? String(n.id).slice(0, 17) + "…" : String(n.id);
      const isFocus = focus && (n.id === focus || n.key === focus);
      const nodeSvg =
        `<g class="kg-node" data-key="${esc(n.key)}" data-type="${esc(n.type)}" data-state="${esc(n.state ?? "")}">` +
        `<rect x="${x - 66}" y="${y - 10}" width="132" height="20" rx="2" fill="${isFocus ? "rgba(34,211,238,.14)" : "rgba(13,20,30,.95)"}" stroke="${unresolved ? "var(--faint)" : col}" stroke-opacity="${unresolved ? 1 : 0.6}" ${unresolved ? 'stroke-dasharray="3 3"' : ""}/>` +
        `<circle cx="${x - 56}" cy="${y}" r="3" fill="${col}"/>` +
        `<text x="${x - 48}" y="${y + 3.5}" class="svg-label" style="font-size:9px;letter-spacing:.04em;text-transform:none;fill:${unresolved ? "var(--muted)" : "var(--text)"}">${esc(label)}</text>` +
        `<title>${esc(n.type)} ${esc(n.id)} — ${esc(n.label ?? "")} [${esc(n.state ?? "")}]${n.origin ? " · " + esc(n.origin) : ""}</title></g>`;
      parts.push(href ? `<a href="${esc(href)}">${nodeSvg}</a>` : nodeSvg);
    }),
  );
  return html`<div class="diagram kg" style="--diagram-min:980px">${raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Knowledge graph">${parts.join("")}</svg>`)}</div>`;
}

/** Hover highlighting: connected edges brighten. Returns cleanup. */
export function mountGraph(root) {
  const svg = root.querySelector(".kg svg");
  if (!svg) return null;
  const onOver = (ev) => {
    const g = ev.target.closest(".kg-node");
    if (!g) return;
    const key = g.dataset.key;
    svg.querySelectorAll(".kg-edge").forEach((p) => {
      const on = p.dataset.a === key || p.dataset.b === key;
      p.setAttribute("stroke-opacity", on ? "1" : ".08");
      p.setAttribute("stroke-width", on ? "1.6" : "1");
    });
  };
  const onOut = () => svg.querySelectorAll(".kg-edge").forEach((p) => {
    p.setAttribute("stroke-opacity", ".45");
    p.setAttribute("stroke-width", "1");
  });
  svg.addEventListener("mouseover", onOver);
  svg.addEventListener("mouseleave", onOut);
  return () => {
    svg.removeEventListener("mouseover", onOver);
    svg.removeEventListener("mouseleave", onOut);
  };
}
