// Local loop ring for the command views. Same vocabulary as components/flow.js
// cycleRing (dashed = not connected, .flow-dash only between two connected
// nodes, values marked data-v / data-empty) but with the count inside the node
// and multi-line labels outside it, so long stage names ("BETTER HYPOTHESES")
// never overflow the node. See shared request: cycleRing label overflow.

import { html, raw, esc } from "../core/html.js";
import { isNil, EMPTY } from "../core/format.js";

/**
 * nodes: [{key, label: string (use "\n" for a second line), sub?: string, connected: bool, value?: number|string|null}]
 */
export function ccRing(nodes, { center = "SENTRY", centerSub = "", width = 460, height = 400, r = 128, nodeR = 26, aria = "System loop" } = {}) {
  const n = nodes.length;
  const cx = width / 2;
  const cy = height / 2;
  const pts = nodes.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), a];
  });
  const parts = [];
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="1"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${(r * 0.5).toFixed(1)}" fill="rgba(37,99,235,.05)" stroke="var(--line-2)" stroke-dasharray="2 4"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${(r * 0.5 + 6).toFixed(1)}" fill="none" stroke="rgba(59,130,246,.10)"/>`);

  const off = (nodeR + 6) / r;
  for (let i = 0; i < n; i++) {
    const [, , a1] = pts[i];
    const a2 = i + 1 < n ? pts[i + 1][2] : pts[0][2] + 2 * Math.PI;
    const both = nodes[i].connected && nodes[(i + 1) % n].connected;
    const sa = a1 + off;
    const ea = a2 - off;
    const sx = cx + r * Math.cos(sa);
    const sy = cy + r * Math.sin(sa);
    const ex = cx + r * Math.cos(ea);
    const ey = cy + r * Math.sin(ea);
    const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} A${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    parts.push(`<path d="${d}" fill="none" stroke="${both ? "rgba(34,211,238,.3)" : "var(--faint)"}" stroke-width="${both ? 2 : 1}" ${both ? "" : 'stroke-dasharray="2 4"'}/>`);
    if (both) parts.push(`<path class="flow-dash" d="${d}" fill="none" stroke="var(--cyan-2)" stroke-width="1.2"/>`);
    const tx = -Math.sin(ea);
    const ty = Math.cos(ea);
    const ah = 6;
    parts.push(
      `<path d="M${(ex - tx * ah - ty * 3).toFixed(1)} ${(ey - ty * ah + tx * 3).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex - tx * ah + ty * 3).toFixed(1)} ${(ey - ty * ah - tx * 3).toFixed(1)}" fill="none" stroke="${both ? "var(--cyan-2)" : "var(--faint)"}" stroke-width="1"/>`,
    );
  }

  nodes.forEach((node, i) => {
    const [x, y, a] = pts[i];
    const on = !!node.connected;
    const empty = isNil(node.value);
    parts.push(`<g class="cc-ring__node" data-cycle-node="${esc(node.key)}" data-connected="${on ? "1" : "0"}">`);
    if (on) parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${nodeR + 4}" fill="none" stroke="rgba(34,211,238,.18)"/>`);
    // opaque base so the ring track never shows through the node
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${nodeR}" fill="var(--panel)"/>`);
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${nodeR}" fill="${on ? "rgba(34,211,238,.07)" : "var(--panel)"}" stroke="${on ? "var(--cyan-2)" : "var(--line-3)"}" ${on ? "" : 'stroke-dasharray="3 3"'}/>`,
    );
    parts.push(
      `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" class="svg-value${empty ? " is-empty" : ""}" style="font-size:14px" data-v ${empty ? 'data-empty="1"' : ""}>${esc(empty ? EMPTY : String(node.value))}</text>`,
    );

    // label block outside the node, radially
    const lines = String(node.label).split("\n");
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const dist = r + nodeR + 9;
    const lx = cx + dist * cos;
    const ly = cy + dist * sin;
    const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
    const lineH = 11;
    const blockH = lines.length * lineH + (node.sub ? 10 : 0);
    let top;
    if (sin < -0.75) top = ly - blockH;
    else if (sin > 0.75) top = ly;
    else top = ly - blockH / 2;
    lines.forEach((ln, li) => {
      parts.push(
        `<text x="${lx.toFixed(1)}" y="${(top + 8 + li * lineH).toFixed(1)}" text-anchor="${anchor}" class="svg-label ${on ? "svg-label--strong" : ""}" style="font-size:9px">${esc(ln)}</text>`,
      );
    });
    if (node.sub) {
      parts.push(
        `<text x="${lx.toFixed(1)}" y="${(top + 8 + lines.length * lineH).toFixed(1)}" text-anchor="${anchor}" class="svg-label svg-label--muted" style="font-size:7.5px;letter-spacing:.08em">${esc(node.sub)}</text>`,
      );
    }
    parts.push(`</g>`);
  });

  parts.push(`<text x="${cx}" y="${cy - 3}" text-anchor="middle" class="svg-label svg-label--strong" style="font-size:11px;letter-spacing:.3em">${esc(center)}</text>`);
  if (centerSub) parts.push(`<text x="${cx}" y="${cy + 12}" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:8px">${esc(centerSub)}</text>`);

  return html`<div class="cc-ring">${raw(`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`)}</div>`;
}
