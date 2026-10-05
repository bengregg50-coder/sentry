// Step flows (deployment handoff, learning loop) and the system cycle ring.

import { html, raw, esc } from "../core/html.js";
import { isNil, EMPTY, humanize } from "../core/format.js";
import { toneOf } from "../core/tones.js";

const STEP_TONE = { COMPLETE: "ok", BLOCKED: "warn", NOT_REACHED: "muted", VIOLATION: "bad" };

/**
 * steps: [{label, state?, detail?, count?, owner?, boundary?}]
 *  - state: COMPLETE | BLOCKED | NOT_REACHED | VIOLATION | any contract state
 *  - count: number|null|undefined (undefined => no count row; null => empty)
 *  - boundary: draw an autonomy/governance boundary before this step
 */
export function steps(list, { cls } = {}) {
  return html`<div class="steps ${cls ?? ""}">
    ${list.map((s) => {
      const tone = STEP_TONE[s.state] ?? toneOf(s.state);
      return html`<div class="step tone-${tone} ${s.boundary ? "step--boundary" : ""}" data-step="${s.key ?? s.label}" data-state="${s.state ?? ""}">
        <div class="step__node"></div>
        <div class="step__label">${s.label}</div>
        ${s.state ? html`<div class="step__detail">${humanize(s.state)}${s.detail ? html` · ${s.detail}` : ""}</div>` : s.detail ? html`<div class="step__detail">${s.detail}</div>` : ""}
        ${s.count !== undefined ? html`<div class="step__count ${isNil(s.count) ? "is-empty" : ""}" data-v ${isNil(s.count) ? raw('data-empty="1"') : ""}>${isNil(s.count) ? EMPTY : s.count}</div>` : ""}
        ${s.owner ? html`<div class="step__owner">${s.owner}</div>` : ""}
      </div>`;
    })}
  </div>`;
}

/**
 * Circular system loop. nodes: [{key, label, sub?, connected: bool, value?: string|null}]
 * Arcs animate only when both endpoints are connected.
 */
export function cycleRing(nodes, { center = "SENTRY", centerSub = "", size = 360 } = {}) {
  const n = nodes.length;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const pts = nodes.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), a];
  });
  const parts = [];
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="1"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.52}" fill="rgba(37,99,235,.05)" stroke="var(--line-2)" stroke-dasharray="2 4"/>`);
  for (let i = 0; i < n; i++) {
    const [x1, y1, a1] = pts[i];
    const [x2, y2, a2] = pts[(i + 1) % n];
    const both = nodes[i].connected && nodes[(i + 1) % n].connected;
    const large = 0;
    const off = 0.17;
    const sx = cx + r * Math.cos(a1 + off);
    const sy = cy + r * Math.sin(a1 + off);
    let ea = a2 - off;
    const ex = cx + r * Math.cos(ea);
    const ey = cy + r * Math.sin(ea);
    const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} A${r} ${r} 0 ${large} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    parts.push(`<path d="${d}" fill="none" stroke="${both ? "rgba(34,211,238,.3)" : "var(--faint)"}" stroke-width="${both ? 2 : 1}" ${both ? "" : 'stroke-dasharray="2 4"'}/>`);
    if (both) parts.push(`<path class="flow-dash" d="${d}" fill="none" stroke="var(--cyan-2)" stroke-width="1.2"/>`);
    // arrow head
    const ah = 6;
    const tx = -Math.sin(ea);
    const ty = Math.cos(ea);
    parts.push(
      `<path d="M${(ex - tx * ah - ty * 3).toFixed(1)} ${(ey - ty * ah + tx * 3).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex - tx * ah + ty * 3).toFixed(1)} ${(ey - ty * ah - tx * 3).toFixed(1)}" fill="none" stroke="${both ? "var(--cyan-2)" : "var(--faint)"}" stroke-width="1"/>`,
    );
  }
  nodes.forEach((node, i) => {
    const [x, y] = pts[i];
    const on = node.connected;
    parts.push(`<g data-cycle-node="${esc(node.key)}">`);
    parts.push(`<circle cx="${x}" cy="${y}" r="27" fill="var(--panel)" stroke="${on ? "var(--cyan-2)" : "var(--line-3)"}" ${on ? "" : 'stroke-dasharray="3 3"'}/>`);
    if (on) parts.push(`<circle cx="${x}" cy="${y}" r="31" fill="none" stroke="rgba(34,211,238,.18)"/>`);
    parts.push(`<text x="${x}" y="${y - 2}" text-anchor="middle" class="svg-label ${on ? "svg-label--strong" : ""}" style="font-size:8.5px">${esc(node.label)}</text>`);
    const v = isNil(node.value) ? EMPTY : String(node.value);
    parts.push(`<text x="${x}" y="${y + 11}" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:8.5px" data-v ${isNil(node.value) ? 'data-empty="1"' : ""}>${esc(v)}</text>`);
    parts.push(`</g>`);
  });
  parts.push(`<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="svg-label svg-label--strong" style="font-size:11px;letter-spacing:.3em">${esc(center)}</text>`);
  if (centerSub) parts.push(`<text x="${cx}" y="${cy + 12}" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:8.5px">${esc(centerSub)}</text>`);
  return html`<div class="cycle" style="max-width:${raw(String(size))}px">${raw(`<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="System loop">${parts.join("")}</svg>`)}</div>`;
}
