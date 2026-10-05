// Strategies group — diagrams: the strategy status lifecycle (SVG) and the
// library → live delivery flow. Counts are row counts of declared state, split
// by record origin; null (not connected) renders "—", a connected zero renders 0.

import { html, raw, esc } from "../core/html.js";
import { EMPTY, fmtCount } from "../core/format.js";
import { toneOf } from "../core/tones.js";
import { sourceShort } from "../core/state.js";
import { dot } from "../components/ui.js";
import { LIFECYCLE, STATUS_LABEL, originSplit, splitList, splitParts, splitVal } from "./_strategies-common.js";

const TONE_VAR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--cyan-2)", accent: "var(--blue-2)", muted: "var(--muted)" };

const GROUPS = [
  { label: "RESEARCH · VALIDATION", from: 0, to: 2 },
  { label: "GOVERNANCE", from: 3, to: 3 },
  { label: "DEPLOYMENT · AGENTS", from: 4, to: 6 },
];

/** Terminal exits: which lifecycle statuses each one drains, and where it sits. */
const EXITS = [
  { status: "REJECTED", from: 0, to: 3, caption: "REJECTED AT A RESEARCH OR GOVERNANCE GATE" },
  { status: "RETIRED", from: 4, to: 6, caption: "WITHDRAWN FROM DEPLOYMENT" },
];

function countText(split) {
  const list = splitList(split);
  if (!list) return { big: EMPTY, tag: null, empty: true, live: false };
  const live = splitParts(split).length > 0;
  if (list.length === 1) return { big: String(list[0].n), tag: list[0].tag, empty: false, live };
  return { big: list.map((p) => p.n).join(" · "), tag: list.map((p) => p.tag ?? "ORIG").join(" · "), empty: false, live };
}

/**
 * @param rows  [{s, v}] (null => strategy registry not connected)
 * @param highlight  Set of statuses to bracket as "in view"
 */
export function lifecycleDiagram(rows, { highlight = new Set() } = {}) {
  const available = Array.isArray(rows);
  const by = (status) => (available ? originSplit(rows.filter((r) => r.s.status === status).map((r) => r.s)) : null);
  const W = 1000;
  const H = 262;
  const left = 72;
  const right = 72;
  const step = (W - left - right) / (LIFECYCLE.length - 1);
  const xs = LIFECYCLE.map((_, i) => left + i * step);
  const nodeW = 122;
  const nodeH = 68;
  const yc = 104;
  const busY = 172;
  const tY = 206;
  const tW = 184;
  const tH = 48;
  const furthest = available
    ? Math.max(-1, ...rows.map((r) => LIFECYCLE.indexOf(r.s.status)))
    : -1;

  const p = [];

  // group brackets
  for (const g of GROUPS) {
    const x1 = xs[g.from] - nodeW / 2;
    const x2 = xs[g.to] + nodeW / 2;
    p.push(`<path d="M${x1} 52 V46 H${x2} V52" fill="none" stroke="var(--line-3)" stroke-width="1"/>`);
    p.push(`<text x="${(x1 + x2) / 2}" y="38" text-anchor="middle" class="svg-label svg-label--muted">${esc(g.label)}</text>`);
  }

  // main connectors
  for (let i = 0; i < LIFECYCLE.length - 1; i++) {
    const a = xs[i] + nodeW / 2;
    const b = xs[i + 1] - nodeW / 2;
    const traversed = available && furthest >= i + 1;
    if (traversed) {
      p.push(`<line x1="${a}" y1="${yc}" x2="${b}" y2="${yc}" stroke="rgba(34,211,238,.25)" stroke-width="2"/>`);
      p.push(`<line class="flow-dash" x1="${a}" y1="${yc}" x2="${b}" y2="${yc}" stroke="var(--cyan-2)" stroke-width="1.5"/>`);
    } else {
      p.push(`<line x1="${a}" y1="${yc}" x2="${b}" y2="${yc}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 4"/>`);
    }
    p.push(`<path d="M${b - 5} ${yc - 3} L${b} ${yc} L${b - 5} ${yc + 3}" fill="none" stroke="${traversed ? "var(--cyan-2)" : "var(--faint)"}" stroke-width="1"/>`);
  }

  // exit buses + terminal nodes
  for (const ex of EXITS) {
    const x1 = xs[ex.from];
    const x2 = xs[ex.to];
    const cx = (x1 + x2) / 2;
    const c = countText(by(ex.status));
    const tone = c.live ? TONE_VAR[toneOf(ex.status)] : "var(--line-3)";
    for (let i = ex.from; i <= ex.to; i++) {
      p.push(`<line x1="${xs[i]}" y1="${yc + nodeH / 2}" x2="${xs[i]}" y2="${busY}" stroke="var(--line-2)" stroke-width="1" stroke-dasharray="1 3"/>`);
    }
    p.push(`<line x1="${x1}" y1="${busY}" x2="${x2}" y2="${busY}" stroke="var(--line-2)" stroke-width="1" stroke-dasharray="1 3"/>`);
    p.push(`<line x1="${cx}" y1="${busY}" x2="${cx}" y2="${tY}" stroke="${c.live ? tone : "var(--line-2)"}" stroke-width="1" ${c.live ? "" : 'stroke-dasharray="1 3"'}/>`);
    p.push(`<path d="M${cx - 3} ${tY - 5} L${cx} ${tY} L${cx + 3} ${tY - 5}" fill="none" stroke="${c.live ? tone : "var(--faint)"}" stroke-width="1"/>`);
    p.push(`<text x="${x1 + 4}" y="${busY - 5}" class="svg-label svg-label--muted st-svg-xs">${esc(ex.caption)}</text>`);
    const hl = highlight.has(ex.status);
    p.push(`<g class="st-lc-node" data-status="${ex.status}" data-count="${c.empty ? "" : esc(c.big)}">`);
    if (hl) p.push(`<rect x="${cx - tW / 2 - 4}" y="${tY - 4}" width="${tW + 8}" height="${tH + 8}" rx="5" fill="none" stroke="var(--cyan-2)" stroke-opacity=".55" stroke-dasharray="6 3"/>`);
    p.push(
      `<rect x="${cx - tW / 2}" y="${tY}" width="${tW}" height="${tH}" rx="3" fill="${c.live ? "rgba(13,20,30,.95)" : "rgba(13,20,30,.9)"}" stroke="${tone}" stroke-width="1" ${c.live ? "" : 'stroke-dasharray="3 3"'}/>`,
    );
    if (c.live) p.push(`<rect x="${cx - tW / 2}" y="${tY}" width="3" height="${tH}" fill="${tone}"/>`);
    p.push(`<text x="${cx - tW / 2 + 14}" y="${tY + 20}" class="svg-label ${c.live ? "svg-label--strong" : ""}">${esc(STATUS_LABEL[ex.status])}</text>`);
    p.push(`<text x="${cx - tW / 2 + 14}" y="${tY + 36}" class="svg-label svg-label--muted st-svg-xs">TERMINAL</text>`);
    p.push(
      `<text x="${cx + tW / 2 - 12}" y="${tY + 30}" text-anchor="end" class="svg-value ${c.empty ? "is-empty" : c.live ? "" : "st-svg-zero"}" data-v ${c.empty ? 'data-empty="1"' : ""}>${esc(c.big)}</text>`,
    );
    if (c.tag) p.push(`<text x="${cx + tW / 2 - 12}" y="${tY + 42}" text-anchor="end" class="svg-label st-svg-tag">${esc(c.tag)}</text>`);
    p.push(`</g>`);
  }

  // lifecycle nodes
  LIFECYCLE.forEach((status, i) => {
    const x = xs[i];
    const c = countText(by(status));
    const tone = TONE_VAR[toneOf(status)];
    const hl = highlight.has(status);
    const stroke = c.live ? tone : "var(--line-3)";
    p.push(`<g class="st-lc-node" data-status="${status}" data-count="${c.empty ? "" : esc(c.big)}">`);
    if (hl) p.push(`<rect x="${x - nodeW / 2 - 4}" y="${yc - nodeH / 2 - 4}" width="${nodeW + 8}" height="${nodeH + 8}" rx="5" fill="none" stroke="var(--cyan-2)" stroke-opacity=".55" stroke-dasharray="6 3"/>`);
    else if (c.live) p.push(`<rect x="${x - nodeW / 2 - 3}" y="${yc - nodeH / 2 - 3}" width="${nodeW + 6}" height="${nodeH + 6}" rx="5" fill="none" stroke="${tone}" stroke-opacity=".18"/>`);
    p.push(
      `<rect x="${x - nodeW / 2}" y="${yc - nodeH / 2}" width="${nodeW}" height="${nodeH}" rx="3" fill="${c.live ? "rgba(34,211,238,.05)" : "rgba(13,20,30,.9)"}" stroke="${stroke}" stroke-width="1" ${c.live ? "" : 'stroke-dasharray="3 3"'}/>`,
    );
    p.push(`<text x="${x - nodeW / 2 + 7}" y="${yc - nodeH / 2 + 12}" class="svg-label svg-label--muted st-svg-xs">${String(i + 1).padStart(2, "0")}</text>`);
    p.push(`<text x="${x}" y="${yc - 9}" text-anchor="middle" class="svg-label ${c.live ? "svg-label--strong" : ""}">${esc(STATUS_LABEL[status])}</text>`);
    p.push(
      `<text x="${x}" y="${yc + 15}" text-anchor="middle" class="svg-value ${c.empty ? "is-empty" : c.live ? "" : "st-svg-zero"}" data-v ${c.empty ? 'data-empty="1"' : ""}>${esc(c.big)}</text>`,
    );
    if (c.tag) p.push(`<text x="${x}" y="${yc + 28}" text-anchor="middle" class="svg-label st-svg-tag">${esc(c.tag)}</text>`);
    p.push(`</g>`);
  });

  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Strategy status lifecycle" preserveAspectRatio="xMidYMid meet">${p.join("")}</svg>`;
  return html`<div class="diagram st-lifecycle" data-lifecycle-available="${available ? "1" : "0"}" style="--diagram-min:760px">${raw(svg)}</div>`;
}

/**
 * Which strategies sit at each status — one column per lifecycle node (the
 * columns line up with the diagram), terminals beneath their exit buses.
 */
export function lifecycleRoster(rows, { hrefFor } = {}) {
  const available = Array.isArray(rows);
  const cell = (status, style) => {
    const here = available ? rows.filter((r) => r.s.status === status) : null;
    return html`<div class="st-roster__cell" data-roster="${status}" ${style ? raw(`style="${style}"`) : ""}>
      ${style ? html`<span class="st-roster__k">${STATUS_LABEL[status]}</span>` : ""}
      ${
        !here
          ? html`<span class="v is-empty" data-v>${EMPTY}</span>`
          : here.length
            ? here.map(({ s }) => html`<a class="st-roster__id" href="${hrefFor ? hrefFor(s) : "#"}" title="${s.name}">${s.strategy_id}<span>v${s.current_version}</span></a>`)
            : html`<span class="st-roster__none">NONE</span>`
      }
    </div>`;
  };
  return html`<div class="st-roster" data-roster-available="${available ? "1" : "0"}">
    <div class="st-roster__row">${LIFECYCLE.map((st) => cell(st))}</div>
    <div class="st-roster__row st-roster__row--term">${cell("REJECTED", "grid-column:1 / span 4")}${cell("RETIRED", "grid-column:5 / span 3")}</div>
  </div>`;
}

/* ---------------------------------------------------------------- library → live delivery flow */

function connector(active) {
  const line = active
    ? `<line x1="0" y1="10" x2="30" y2="10" stroke="rgba(34,211,238,.25)" stroke-width="2"/><line class="flow-dash" x1="0" y1="10" x2="30" y2="10" stroke="var(--cyan-2)" stroke-width="1.5"/>`
    : `<line x1="0" y1="10" x2="30" y2="10" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 4"/>`;
  const head = `<path d="M25 6 L30 10 L25 14" fill="none" stroke="${active ? "var(--cyan-2)" : "var(--faint)"}" stroke-width="1"/>`;
  return html`<div class="st-flow__conn" aria-hidden="true">${raw(`<svg viewBox="0 0 30 20" preserveAspectRatio="none">${line}${head}</svg>`)}</div>`;
}

const isOn = (split) => splitParts(split).length > 0;

/**
 * stages: [{key, code, label, desc, href, value?: split|number|null, unit, sources?: [src]}]
 */
export function deliveryFlow(stages) {
  const on = stages.map((s) => (s.sources ? s.sources.some((x) => x?.status === "OK") : typeof s.value === "number" ? s.value > 0 : isOn(s.value)));
  return html`<div class="st-flow" data-flow>
    <div class="st-flow__track">
      ${stages.map(
        (s, i) => html`<a class="st-flow__stage ${on[i] ? "is-on" : ""}" href="${s.href}" data-flow-stage="${s.key}">
            <div class="st-flow__head"><span class="st-flow__n">${String(i + 1).padStart(2, "0")}</span><span class="st-flow__code">${s.code}</span></div>
            <div class="st-flow__label">${s.label}</div>
            <div class="st-flow__desc">${s.desc}</div>
            ${s.sources
              ? html`<div class="st-flow__srcs">${s.sources.map(
                  (src, j) => html`<span class="st-flow__src" data-source="${src?.key ?? s.sourceKeys?.[j] ?? ""}">${dot(src?.status === "OK" ? "CONNECTED" : src?.status ?? "UNKNOWN")}<span class="st-flow__srcname">${s.sourceLabels?.[j] ?? src?.label ?? ""}</span><span class="st-flow__srcstate">${sourceShort(src)}</span></span>`,
                )}</div>`
              : html`<div class="st-flow__val">${typeof s.value === "number" ? html`<span class="v" data-v>${fmtCount(s.value)}</span>` : splitVal(s.value)}</div>
                  <div class="st-flow__unit">${s.unit}</div>`}
          </a>
          ${i < stages.length - 1 ? connector(on[i] && on[i + 1]) : ""}`,
      )}
    </div>
    <div class="st-flow__return" aria-hidden="true"><span>LESSONS RETURN TO RESEARCH · NEW HYPOTHESES · NEW VERSIONS — NEVER EDITS IN PLACE</span></div>
  </div>`;
}

