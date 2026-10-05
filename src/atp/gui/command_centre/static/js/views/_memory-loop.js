// The self-improvement loop for the memory views.
//
// Same vocabulary as components/flow.js cycleRing — dashed = source not
// connected, the .flow-dash animation only runs between two connected stages —
// but stages are pill nodes with the (two-line) stage name inside, so names
// such as "BETTER HYPOTHESES" never overflow a 27px circle. No values are drawn
// on the ring: it shows which stages have a connected source, nothing more.

import { html, raw, esc } from "../core/html.js";

/**
 * stages: [{key, top?: string, label: string, connected: bool}]
 */
export function memLoop(stages, { center = "SENTRY", centerSub = "MEMORY LOOP", aria = "Self-improvement loop" } = {}) {
  const W = 600;
  const H = 446;
  const cx = W / 2;
  const cy = H / 2;
  const r = 180;
  const pw = 124; // pill width
  const ph = 44; // pill height
  const n = stages.length;
  const pts = stages.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), a];
  });
  // Angular clearance so an arc starts/ends just outside a pill.
  const clear = (a) => (Math.abs(Math.sin(a)) * (pw / 2) + Math.abs(Math.cos(a)) * (ph / 2) + 9) / r;

  const parts = [];
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="1"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${(r * 0.46).toFixed(1)}" fill="rgba(37,99,235,.05)" stroke="var(--line-2)" stroke-dasharray="2 4"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${(r * 0.46 + 7).toFixed(1)}" fill="none" stroke="rgba(59,130,246,.10)"/>`);

  for (let i = 0; i < n; i++) {
    const a1 = pts[i][2];
    const a2 = i + 1 < n ? pts[i + 1][2] : pts[0][2] + 2 * Math.PI;
    const both = stages[i].connected && stages[(i + 1) % n].connected;
    const sa = a1 + clear(a1);
    const ea = a2 - clear(a2);
    if (ea <= sa) continue;
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

  stages.forEach((s, i) => {
    const [x, y] = pts[i];
    const on = !!s.connected;
    const x0 = (x - pw / 2).toFixed(1);
    const y0 = (y - ph / 2).toFixed(1);
    parts.push(`<g class="mem-loop__node" data-loop-stage="${esc(s.key)}" data-connected="${on ? "1" : "0"}">`);
    if (on) parts.push(`<rect x="${(x - pw / 2 - 4).toFixed(1)}" y="${(y - ph / 2 - 4).toFixed(1)}" width="${pw + 8}" height="${ph + 8}" rx="6" fill="none" stroke="rgba(34,211,238,.16)"/>`);
    parts.push(`<rect x="${x0}" y="${y0}" width="${pw}" height="${ph}" rx="3" fill="var(--panel)"/>`);
    parts.push(
      `<rect x="${x0}" y="${y0}" width="${pw}" height="${ph}" rx="3" fill="${on ? "rgba(34,211,238,.07)" : "var(--panel)"}" stroke="${on ? "var(--cyan-2)" : "var(--line-3)"}" ${on ? "" : 'stroke-dasharray="3 3"'}/>`,
    );
    parts.push(`<text x="${(x - pw / 2 + 6).toFixed(1)}" y="${(y - ph / 2 + 11).toFixed(1)}" class="svg-label ${on ? "" : "svg-label--muted"}" style="font-size:8.5px;letter-spacing:.08em;${on ? "fill:var(--cyan-2)" : ""}">${String(i + 1).padStart(2, "0")}</text>`);
    if (s.top) {
      parts.push(`<text x="${x.toFixed(1)}" y="${(y - 1).toFixed(1)}" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:9px;letter-spacing:.24em">${esc(s.top)}</text>`);
      parts.push(`<text x="${x.toFixed(1)}" y="${(y + 13).toFixed(1)}" text-anchor="middle" class="svg-label ${on ? "svg-label--strong" : ""}" style="font-size:12.5px;letter-spacing:.08em">${esc(s.label)}</text>`);
    } else {
      parts.push(`<text x="${x.toFixed(1)}" y="${(y + 6).toFixed(1)}" text-anchor="middle" class="svg-label ${on ? "svg-label--strong" : ""}" style="font-size:13px;letter-spacing:.1em">${esc(s.label)}</text>`);
    }
    parts.push(`</g>`);
  });
  parts.push(`<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="svg-label svg-label--strong" style="font-size:16px;letter-spacing:.34em">${esc(center)}</text>`);
  if (centerSub) parts.push(`<text x="${cx}" y="${cy + 17}" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:10px;letter-spacing:.22em">${esc(centerSub)}</text>`);
  return html`<div class="mem-loop">${raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`)}</div>`;
}
