// Research → deployment pipeline diagram (SVG) and per-item branching tracks.
// Counts come only from derived.pipeline. Unavailable => "—"; zero => "0".
// Stages nobody has reached are drawn dormant (dashed); flow animation only
// runs on connections that items have actually traversed.
// Items whose stage nobody declared (pipeline.undeclared) are never counted as
// having reached any stage: they are disclosed separately, and their tracks are
// drawn as "not declared", never as traversed.

import { html, raw, esc } from "../core/html.js";
import { humanize, isNil, EMPTY } from "../core/format.js";
import { toneOf } from "../core/tones.js";
import { emptyState, badge, originBadge } from "./ui.js";

export const STAGES = ["DISCOVERY", "HYPOTHESIS", "BACKTEST", "ROBUSTNESS", "OOS", "VALIDATION", "APPROVED", "SIM", "LIVE", "SCALED"];
const STAGE_LABEL = { OOS: "OOS", SIM: "SIM", BLOCKED_BY_DATA: "BLOCKED BY DATA" };
export const TERMINALS = ["REJECTED", "BLOCKED_BY_DATA", "PENDING", "ABANDONED", "RETIRED"];
const TERMINAL_TONE = { REJECTED: "bad", BLOCKED_BY_DATA: "warn", PENDING: "warn", ABANDONED: "muted", RETIRED: "muted" };
const GROUPS = [
  { label: "RESEARCH ENGINE", from: 0, to: 5 },
  { label: "GOVERNANCE", from: 6, to: 6 },
  { label: "DEPLOYMENT · AGENTS", from: 7, to: 9 },
];

const ORIGIN_ORDER = ["ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"];
const ORIGIN_SHORT = { ORIGINAL: "", RECONSTRUCTED: "R", SYNTHETIC_FIXTURE: "S" };
const ORIGIN_COLOUR = { ORIGINAL: "var(--text-2)", RECONSTRUCTED: "var(--warn)", SYNTHETIC_FIXTURE: "var(--bad)" };

const TONE_VAR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--cyan-2)", accent: "var(--blue-2)", muted: "var(--muted)" };

function label(s) {
  return STAGE_LABEL[s] ?? s;
}

/**
 * @param pipeline derived.pipeline
 * @param opts.compact  hide the terminal lanes (home page)
 */
export function pipelineDiagram(pipeline, { compact = false } = {}) {
  const available = !!pipeline?.available;
  const stages = pipeline?.stages ?? STAGES.map((s) => ({ stage: s, reached: null, active: null, terminals: null }));
  const W = 1200;
  const left = compact ? 54 : 190; // lane labels are end-anchored left of the first node
  const right = 54; // node half-width + glow must stay inside the viewBox
  const step = (W - left - right) / (STAGES.length - 1);
  const xs = STAGES.map((_, i) => left + i * step);
  const nodeW = Math.min(92, step - 14);
  const yMain = 92;
  const laneTop = 176;
  const laneGap = 22;
  const und = available ? pipeline?.undeclared ?? null : null;
  const undCount = und?.count ?? 0;
  const baseH = compact ? 150 : laneTop + laneGap * TERMINALS.length + 6;
  const H = baseH + (undCount ? 20 : 0);

  const parts = [];
  let anyDisclosure = false;
  let anyPartial = false;
  let anyUnavailable = null;

  // group brackets
  for (const g of GROUPS) {
    const x1 = xs[g.from] - nodeW / 2;
    const x2 = xs[g.to] + nodeW / 2;
    parts.push(
      `<path d="M${x1} 40 V34 H${x2} V40" fill="none" stroke="var(--line-3)" stroke-width="1"/>` +
        `<text x="${(x1 + x2) / 2}" y="26" text-anchor="middle" class="svg-label svg-label--muted">${esc(g.label)}</text>`,
    );
  }

  // connectors
  for (let i = 0; i < STAGES.length - 1; i++) {
    const a = xs[i] + nodeW / 2;
    const b = xs[i + 1] - nodeW / 2;
    const traversed = available && (stages[i + 1]?.reached ?? 0) > 0;
    if (traversed) {
      parts.push(`<line x1="${a}" y1="${yMain}" x2="${b}" y2="${yMain}" stroke="rgba(34,211,238,.25)" stroke-width="2"/>`);
      parts.push(`<line class="flow-dash" x1="${a}" y1="${yMain}" x2="${b}" y2="${yMain}" stroke="var(--cyan-2)" stroke-width="1.5"/>`);
    } else {
      parts.push(`<line x1="${a}" y1="${yMain}" x2="${b}" y2="${yMain}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 4"/>`);
    }
    parts.push(`<path d="M${b - 5} ${yMain - 3} L${b} ${yMain} L${b - 5} ${yMain + 3}" fill="none" stroke="${traversed ? "var(--cyan-2)" : "var(--faint)"}" stroke-width="1"/>`);
  }

  // lanes
  if (!compact) {
    TERMINALS.forEach((t, li) => {
      const y = laneTop + li * laneGap;
      parts.push(`<text x="${left - nodeW / 2 - 14}" y="${y + 3.5}" text-anchor="end" class="svg-label" fill="${TONE_VAR[TERMINAL_TONE[t]]}" style="fill:${TONE_VAR[TERMINAL_TONE[t]]};opacity:.85">${esc(humanize(t))}</text>`);
      parts.push(`<line x1="${left - nodeW / 2 - 6}" y1="${y}" x2="${W - right + nodeW / 2}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`);
    });
  }

  // nodes
  stages.forEach((st, i) => {
    const x = xs[i];
    const reached = st.reached;
    const live = available && reached > 0;
    const stroke = live ? "var(--cyan-2)" : "var(--line-3)";
    const dash = live ? "" : `stroke-dasharray="3 3"`;
    const fill = live ? "rgba(34,211,238,.06)" : "rgba(13,20,30,.9)";
    parts.push(`<g class="pl-node" data-stage="${st.stage}">`);
    if (live) parts.push(`<rect x="${x - nodeW / 2 - 3}" y="${yMain - 31}" width="${nodeW + 6}" height="62" rx="5" fill="none" stroke="rgba(34,211,238,.15)"/>`);
    parts.push(`<rect x="${x - nodeW / 2}" y="${yMain - 28}" width="${nodeW}" height="56" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1" ${dash}/>`);
    parts.push(`<text x="${x}" y="${yMain - 11}" text-anchor="middle" class="svg-label ${live ? "svg-label--strong" : ""}">${esc(label(st.stage))}</text>`);
    const valueText = isNil(reached) ? EMPTY : String(reached);
    parts.push(`<text x="${x}" y="${yMain + 13}" text-anchor="middle" class="svg-value ${isNil(reached) || reached === 0 ? "is-empty" : ""}" data-v ${isNil(reached) ? 'data-empty="1"' : ""}>${esc(valueText)}</text>`);
    const byOrigin = st.reached_by_origin ?? {};
    const nonOriginal = Object.entries(byOrigin).some(([o, n]) => o !== "ORIGINAL" && n > 0);
    if (nonOriginal) {
      // The headline is a total across origins, so every origin is itemised beside it — never merged silently.
      anyDisclosure = true;
      // "7 +1R +3S": unmarked = original; R / S suffixes mark reconstructed / synthetic records.
      const segs = ORIGIN_ORDER.filter((o) => (byOrigin[o] ?? 0) > 0).map((o, i) =>
        o === "ORIGINAL"
          ? `<tspan style="fill:${ORIGIN_COLOUR[o]}">${byOrigin[o]}</tspan>`
          : `<tspan style="fill:${ORIGIN_COLOUR[o]}">${i ? "+" : ""}${byOrigin[o]}${ORIGIN_SHORT[o]}</tspan>`,
      );
      const tip = ORIGIN_ORDER.filter((o) => (byOrigin[o] ?? 0) > 0).map((o) => `${byOrigin[o]} ${o}`).join(", ");
      parts.push(`<text x="${x}" y="${yMain - 34}" text-anchor="middle" class="svg-label" style="font-size:8.5px;letter-spacing:.06em" data-origin-disclosure="${esc(Object.keys(byOrigin).join(" "))}"><title>${esc(`${reached} reached ${label(st.stage)}: ${tip}`)}</title>${segs.join(" ")}</text>`);
    }
    let activeText = isNil(st.active) ? "" : `${st.active} ACTIVE`;
    if (st.available === false) {
      activeText = "NO SOURCE";
      anyUnavailable = st.unavailable_source ?? anyUnavailable;
    } else if (st.partial?.length) {
      activeText += " *";
      anyPartial = true;
    }
    if (activeText) parts.push(`<text x="${x}" y="${yMain + 44}" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:9px">${esc(activeText)}</text>`);
    parts.push(`</g>`);

    if (!compact) {
      const tcount = st.terminals;
      parts.push(`<line x1="${x}" y1="${yMain + 50}" x2="${x}" y2="${laneTop + laneGap * (TERMINALS.length - 1)}" stroke="var(--line-2)" stroke-width="1" stroke-dasharray="1 3"/>`);
      TERMINALS.forEach((t, li) => {
        const y = laneTop + li * laneGap;
        const n = tcount ? tcount[t] : null;
        if (isNil(n)) return;
        if (n > 0) {
          const col = TONE_VAR[TERMINAL_TONE[t]];
          const recon = st.terminals_by_origin?.RECONSTRUCTED?.[t] ?? 0;
          parts.push(`<g class="pl-lane-chip" data-lane-terminal="${t}" ${recon ? `data-recon="${recon}"` : ""}>`);
          if (recon) {
            // Reconstructed outcomes are marked, never merged silently into a plain count.
            parts.push(`<title>${esc(`${recon} of ${n} ${humanize(t)} at ${label(st.stage)} RECONSTRUCTED`)}</title>`);
            parts.push(`<rect x="${x - 18}" y="${y - 10}" width="36" height="20" rx="3" fill="none" stroke="var(--warn)" stroke-dasharray="2 2" stroke-opacity=".9"/>`);
          }
          parts.push(`<rect x="${x - 15}" y="${y - 8}" width="30" height="16" rx="2" fill="${col}" fill-opacity=".14" stroke="${col}" stroke-opacity=".6"/>`);
          parts.push(`<text x="${x}" y="${y + 3.5}" text-anchor="middle" class="svg-label" style="fill:${col};font-weight:700" data-v>${n}</text>`);
          if (recon) parts.push(`<text x="${x + 21}" y="${y - 4}" class="svg-label" style="font-size:8px;fill:var(--warn);font-weight:700" data-origin-disclosure="RECONSTRUCTED">R${recon < n ? recon : ""}</text>`);
          parts.push(`</g>`);
        } else {
          parts.push(`<circle cx="${x}" cy="${y}" r="1.6" fill="var(--faint)"/>`);
        }
      });
    }
  });

  if (undCount) {
    const ids = und.ids ?? [];
    const shown = ids.slice(0, 4).join(", ") + (ids.length > 4 ? ` +${ids.length - 4}` : "");
    const terms = Object.entries(und.terminals ?? {}).map(([t, n]) => `${n} ${humanize(t)}`).join(" · ");
    parts.push(
      `<text x="${xs[0] - nodeW / 2}" y="${baseH + 12}" class="svg-label" style="font-size:9px;fill:var(--warn)" data-undeclared="${undCount}"><title>${esc(
        "Stage not declared by any producer — these items are not counted as having reached any stage",
      )}</title>+${undCount} NOT PLACED · STAGE NOT DECLARED (${esc(shown)})${terms ? ` · ${esc(terms)}` : ""}</text>`,
    );
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Research to deployment pipeline" preserveAspectRatio="xMidYMid meet">${parts.join("")}</svg>`;
  const notes = [];
  if (anyDisclosure)
    notes.push(html`<span>Stage totals span record origins — unmarked: original</span><span><b style="color:var(--warn)">R</b> reconstructed</span><span><b style="color:var(--bad)">S</b> synthetic fixture</span>`);
  if (anyPartial) notes.push(html`<span data-pipeline-partial="1">* hypotheses only — strategies are not included in these counts</span>`);
  if (anyUnavailable) notes.push(html`<span data-pipeline-unavailable="${anyUnavailable}">NO SOURCE: ${anyUnavailable}.json is not available, so these stages are not counted</span>`);
  const key = notes.length ? html`<div class="legend pipeline__origins" data-origin-key="${anyDisclosure ? "1" : "0"}">${notes}</div>` : "";
  return html`<div class="diagram pipeline" data-pipeline-available="${available ? "1" : "0"}" style="--diagram-min:${raw(compact ? "680px" : "820px")}">${raw(svg)}</div>${key}`;
}

/**
 * Per-item branching tracks: each item runs from DISCOVERY to its furthest
 * stage and terminates in its terminal state (or an open end if active).
 */
export function pipelineTracks(items, { limit = 24, hrefFor } = {}) {
  if (!items) return emptyState({ title: "Pipeline not connected", compact: true });
  if (items.length === 0) return emptyState({ title: "No items in the pipeline", reason: "The connected sources report no hypotheses or strategies.", compact: true });
  const shown = items.slice(0, limit);
  return html`<div class="tracks">
    <div class="tracks__head"><span></span>${STAGES.map((s) => html`<span class="tracks__stage">${label(s)}</span>`)}<span class="tracks__stage">OUTCOME</span></div>
    ${shown.map((it) => {
      const declared = !isNil(it.stage_reached);
      const reachedIdx = declared ? STAGES.indexOf(it.stage_reached) : -1;
      const href = hrefFor ? hrefFor(it) : null;
      const tone = it.terminal ? toneOf(it.terminal) : "info";
      return html`<div class="tracks__row ${declared ? "" : "tracks__row--undeclared"}" data-item="${it.id}" data-stage-basis="${it.stage_basis ?? ""}" title="${declared ? "" : "Stage not declared by any producer — no stage is shown as traversed"}">
        <span class="tracks__label">${href ? html`<a href="${href}">${it.id}</a>` : it.id}<span class="tracks__title" title="${it.label}">${it.label}</span>${originBadge(it.origin)}</span>
        ${declared
          ? STAGES.map((s, i) => {
              const cls = i < reachedIdx ? "on" : i === reachedIdx ? `end tone-${tone}` : "off";
              return html`<span class="tracks__cell ${cls}"><i></i></span>`;
            })
          : html`<span class="tracks__cell tracks__cell--span unknown"><i></i><span class="tracks__nodecl">STAGE NOT DECLARED · NOT PLACED</span></span>`}
        <span class="tracks__outcome">${it.terminal ? badge(it.terminal) : badge("ACTIVE", { label: "ACTIVE · " + humanize(it.status) })}</span>
      </div>`;
    })}
    ${items.length > limit ? html`<div class="small muted" style="padding:6px 0">+${items.length - limit} more items</div>` : ""}
  </div>`;
}
