// Shared display helpers for the memory views (Overview, Knowledge Graph,
// Findings / Lessons, Evidence, Agent Memories, Memory Detail).
//
// Everything here filters, groups, sorts and counts rows of memory.json /
// agents.json / agent_events for display. Nothing computes a confidence, a
// validation verdict or a research outcome: those are declared by producers
// (memory.json) or derived server-side (snapshot.derived).

import { html, raw, cx } from "../core/html.js";
import { isNil, fmtCount, fmtDate, humanize, pad2 } from "../core/format.js";
import { toneOf, toneClass } from "../core/tones.js";
import { doc, source, derived } from "../core/state.js";
import { badge, val, originBadge, sourceTag } from "../components/ui.js";
import { icon } from "../components/icons.js";

/* ------------------------------------------------------------ vocabulary
   Contract enums (schemas.py: MemoryType, Memory, EvidenceItem, MemorySource). */

export const MEMORY_TYPES = [
  "FINDING",
  "LESSON",
  "FAILED_MECHANISM",
  "FAILED_HYPOTHESIS",
  "REJECTED_ASSUMPTION",
  "REGIME_OBSERVATION",
  "EXECUTION_OBSERVATION",
  "VOLATILITY_OBSERVATION",
  "USEFUL_FEATURE",
  "DANGEROUS_FEATURE",
  "PARAMETER_SENSITIVITY",
  "STRATEGY_INTERACTION",
  "DATA_NOTE",
];
export const FINDING_TYPES = MEMORY_TYPES.filter((t) => t !== "LESSON");
export const CONFIDENCE = ["HIGH", "MEDIUM", "LOW", "UNRATED"];
export const VALIDATION_STATES = ["VALIDATED", "PROVISIONAL", "UNVERIFIED", "CONTRADICTED", "REJECTED"];
export const STATUSES = ["RETAIN", "REVIEW", "DEPRECATED", "REJECTED"];
export const ORIGINS = ["ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"];
export const ORIGIN_SHORT = { ORIGINAL: "ORIG", RECONSTRUCTED: "RECON", SYNTHETIC_FIXTURE: "SYNTH" };
export const ACTORS = ["RESEARCH_ENGINE", "AGENT", "HUMAN", "VALIDATION", "EXECUTION"];
export const EVIDENCE_KINDS = [
  "EXPERIMENT",
  "TRIAL",
  "BACKTEST",
  "OUT_OF_SAMPLE",
  "ROBUSTNESS",
  "COST_SENSITIVITY",
  "SIMULATION",
  "LIVE_OBSERVATION",
  "LITERATURE",
  "DOCUMENT",
];
export const STANCES = ["SUPPORTS", "CONTRADICTS", "NEUTRAL"];
export const SLOTS = [1, 2, 3, 4, 5];
export const MEMORY_EVENT_KINDS = ["MEMORY_RECALL", "MEMORY_WRITE"];

/* ------------------------------------------------------------ state access */

/** memory.json payload, its source, and derived.memory_stats. `mems` is null when not connected. */
export function memState(ctx) {
  const d = doc(ctx, "memory");
  return { d, mems: d ? d.memories : null, src: source(ctx, "memory"), stats: derived(ctx, "memory_stats") };
}

export function memoryIndex(mems) {
  return new Map((mems ?? []).map((m) => [m.memory_id, m]));
}

/* ------------------------------------------------------------ links */

export const memHref = (id) => `#/memory/item/${encodeURIComponent(id)}`;
export const strategyHref = (id) => `#/strategy/${encodeURIComponent(id)}`;
export const trialHref = (id) => `#/research/history?focus=${encodeURIComponent(id)}`;
export const hypothesisHref = (id) => `#/research/hypotheses?focus=${encodeURIComponent(id)}`;
export const agentHref = (slot) => `#/agents/${encodeURIComponent(slot)}`;

/** Query-string link that keeps the other filters. Empty values drop the key. */
export function qhref(path, query, patch) {
  const q = { ...query, ...patch };
  for (const k of Object.keys(q)) if (isNil(q[k]) || q[k] === "") delete q[k];
  const qs = new URLSearchParams(q).toString();
  return `#${path}${qs ? "?" + qs : ""}`;
}

export function memLink(id, { known = true } = {}) {
  if (isNil(id)) return val(null);
  if (!known) return html`<span class="mem-unres" title="Referenced id is not present in memory.json">${id}<span class="mem-unres__tag">UNRESOLVED</span></span>`;
  return html`<a class="ref" href="${memHref(id)}">${id}</a>`;
}

export function agentLabel(slot) {
  return `AGENT ${pad2(slot)}`;
}

/* ------------------------------------------------------------ counting (display only) */

export function countBy(list, keyFn) {
  const out = {};
  for (const x of list ?? []) {
    const k = keyFn(x);
    out[k] = tally(out, k) + 1;
  }
  return out;
}

/**
 * Lookup in a display tally. `counts` null = source not connected -> null.
 * Tallies of a connected source omit keys never seen: an absent key is a recorded zero.
 */
export function tally(counts, key) {
  if (isNil(counts)) return null;
  return Object.prototype.hasOwnProperty.call(counts, key) ? counts[key] : 0;
}

/** Stance / independence counts of one memory's attached evidence rows. */
export function evidenceCounts(m) {
  const out = { supports: 0, contradicts: 0, neutral: 0, independent: 0, independenceReported: 0, total: m.evidence.length };
  for (const e of m.evidence) {
    if (e.stance === "SUPPORTS") out.supports++;
    else if (e.stance === "CONTRADICTS") out.contradicts++;
    else out.neutral++;
    if (!isNil(e.independent)) out.independenceReported++;
    if (e.independent === true) out.independent++;
  }
  return out;
}

/** Every evidence row of every memory, flattened, with its owning memory. */
export function flattenEvidence(mems) {
  if (!mems) return null;
  const rows = [];
  for (const m of mems) for (const e of m.evidence) rows.push({ ...e, memory: m });
  return rows;
}

/* ------------------------------------------------------------ small atoms */

/** A contract CheckState badge, or an explicit NOT REPORTED when the producer left it null. */
export function checkBadge(state) {
  if (isNil(state)) return html`<span class="mem-nr">NOT REPORTED</span>`;
  return badge(state);
}

/** A memory with no evidence attached is untraceable: a warning, never neutral. */
export function untraceableBadge(label = "UNTRACEABLE") {
  return badge("WARN", { label, title: "No evidence item is attached to this memory" });
}

export function typeBadge(type) {
  return badge(type, { label: humanize(type), ghost: true });
}

export function stanceBadge(stance) {
  return badge(stance);
}

export function originSplit(records, originOf = (r) => r.origin) {
  if (!records) return val(null);
  if (records.length === 0) return html`<span class="mem-orig mem-orig--zero">0 RECORDED</span>`;
  const counts = countBy(records, originOf);
  return html`<span class="mem-origs">${ORIGINS.filter((o) => counts[o]).map(
    (o) => html`<span class="mem-orig" title="${humanize(o)} records — counted separately, never merged with other origins"><b class="v" data-v>${fmtCount(counts[o])}</b>${
      o === "ORIGINAL" ? html`<span class="mem-orig__k">ORIGINAL</span>` : originBadge(o)
    }</span>`,
  )}</span>`;
}

export function sectionLabel(text, extra) {
  return html`<div class="mem-label">${text}${extra ? html` <span class="mem-label__extra">${extra}</span>` : ""}</div>`;
}

export function sourceTags(ctx, keys) {
  return html`<div class="mem-srcs">${keys.map((k) => sourceTag(source(ctx, k), { now: ctx.now }))}</div>`;
}

/* ------------------------------------------------------------ distribution bars */

/**
 * rows: [{key, label?, n: number|null, tone?, href?}] — n null means not connected.
 * Bar length is relative to the largest row (display scaling only). A tone
 * class is applied only to a bar that has something to show, so an empty
 * panel never carries a state colour.
 */
export function bars(rows, { neutral = false } = {}) {
  const max = Math.max(0, ...rows.filter((r) => !isNil(r.n)).map((r) => r.n));
  return html`<div class="mem-bars">${rows.map((r) => {
    const empty = isNil(r.n);
    const has = !empty && r.n > 0;
    const pct = has && max > 0 ? (r.n / max) * 100 : 0;
    const tone = has ? r.tone ?? (neutral ? null : toneOf(r.key)) : null;
    const label = r.label ?? humanize(r.key);
    const inner = html`<span class="mem-bar__label" title="${label}">${label}</span>
      <span class="mem-bar__track">${has ? html`<i class="${cx("mem-bar__fill", tone ? `tone-${tone}` : "mem-bar__fill--neutral")}" style="width:${raw(pct.toFixed(1))}%"></i>` : ""}</span>
      <span class="mem-bar__n">${val(empty ? null : fmtCount(r.n))}</span>`;
    const cls = cx("mem-bar", empty && "is-empty", !empty && r.n === 0 && "is-zero", r.href && "mem-bar--link", r.active && "is-active");
    return r.href ? html`<a class="${cls}" href="${r.href}" data-bar="${r.key}">${inner}</a>` : html`<div class="${cls}" data-bar="${r.key}">${inner}</div>`;
  })}</div>`;
}

/* ------------------------------------------------------------ tables with a fixed frame */

/**
 * Like ui.table, but the column frame always renders: with no rows the body
 * holds the empty state, so an empty terminal still shows what will appear.
 */
export function frameTable({ columns, rows, empty, dense = true, rowHref, rowAttrs, maxHeight, cls }) {
  const has = rows && rows.length > 0;
  return html`<div class="${cx("table-wrap mem-table", cls)}" ${maxHeight ? raw(`style="max-height:${Number(maxHeight)}px"`) : ""}>
    <table class="${cx("table", dense && "table--dense")}">
      <thead><tr>${columns.map((c) => html`<th class="${cx(c.num && "num", c.cls)}">${c.label}</th>`)}</tr></thead>
      <tbody>
        ${has
          ? rows.map((r) => {
              const href = rowHref ? rowHref(r) : null;
              return html`<tr ${href ? html`data-href="${href}"` : ""} ${rowAttrs ? rowAttrs(r) : ""}>${columns.map((c) => {
                const v = c.render ? c.render(r) : r[c.key];
                return html`<td class="${cx(c.num && "num", c.cls)}">${isNil(v) || v === "" ? val(null) : v}</td>`;
              })}</tr>`;
            })
          : html`<tr class="mem-table__empty"><td colspan="${columns.length}">${empty}</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

/* ------------------------------------------------------------ the memory card */

function evidenceLine(m) {
  const c = evidenceCounts(m);
  if (c.total === 0) {
    return html`<span class="mem-ev-line">${untraceableBadge("NO EVIDENCE ATTACHED")}</span>`;
  }
  const indep =
    c.independenceReported === 0
      ? html`<span class="muted">(independence not reported)</span>`
      : html`<span class="muted">(<b class="v" data-v>${c.independent}</b> independent)</span>`;
  return html`<span class="mem-ev-line">
    <span class="mem-ev-n ${toneClass("SUPPORTS")}"><b class="v" data-v>${c.supports}</b> supporting</span>
    <span class="mem-ev-sep">/</span>
    <span class="mem-ev-n ${toneClass(c.contradicts ? "CONTRADICTS" : null)}"><b class="v" data-v>${c.contradicts}</b> contradicting</span>
    ${c.neutral ? html`<span class="mem-ev-sep">/</span><span class="mem-ev-n ${toneClass("NEUTRAL")}"><b class="v" data-v>${c.neutral}</b> neutral</span>` : ""}
    ${indep}
  </span>
  ${stanceStrip(c)}`;
}

/** Proportional strip of supporting / contradicting / neutral evidence rows. */
export function stanceStrip(c) {
  if (!c.total) return "";
  const seg = (n, stance) => (n ? html`<i class="${toneClass(stance)}" style="flex:${raw(String(n))}" title="${n} ${humanize(stance)}"></i>` : "");
  return html`<span class="mem-strip" aria-hidden="true">${seg(c.supports, "SUPPORTS")}${seg(c.contradicts, "CONTRADICTS")}${seg(c.neutral, "NEUTRAL")}</span>`;
}

function sourceLine(src) {
  const parts = [humanize(src.actor)];
  if (!isNil(src.agent_slot)) parts.push(agentLabel(src.agent_slot));
  if (src.programme_id) parts.push(src.programme_id);
  return parts.join(" · ");
}

/**
 * MEMORY #ID · Hypothesis · Evidence: N supporting / M contradicting (K independent)
 * · OOS · Robustness · Cost sensitivity · Confidence · Status.
 */
export function memoryCard(m) {
  return html`<article class="mem-card ${toneClass(m.validation_state)}" data-memory-id="${m.memory_id}" data-type="${m.type}" data-validation="${m.validation_state}">
    <header class="mem-card__head">
      <a class="mem-card__id" href="${memHref(m.memory_id)}"><span class="mem-card__kw">MEMORY</span> #${m.memory_id}</a>
      ${typeBadge(m.type)}
      <span class="mem-card__flags">${badge(m.validation_state)}</span>
    </header>
    <a class="mem-card__title" href="${memHref(m.memory_id)}">${m.title}</a>
    <dl class="mem-card__fields">
      <div class="mem-card__row mem-card__row--wide"><dt>Hypothesis</dt><dd>${m.hypothesis ? html`<span class="mem-card__text">${m.hypothesis}</span>` : val(null)}</dd></div>
      <div class="mem-card__row mem-card__row--wide"><dt>Evidence</dt><dd>${evidenceLine(m)}</dd></div>
      <div class="mem-card__checks">
        <div class="mem-card__check"><dt>OOS</dt><dd>${checkBadge(m.oos)}</dd></div>
        <div class="mem-card__check"><dt>Robustness</dt><dd>${checkBadge(m.robustness)}</dd></div>
        <div class="mem-card__check"><dt title="Cost sensitivity">Cost sens.</dt><dd>${checkBadge(m.cost_sensitivity)}</dd></div>
        <div class="mem-card__check"><dt>Confidence</dt><dd>${badge(m.confidence)}</dd></div>
        <div class="mem-card__check"><dt>Status</dt><dd>${badge(m.status)}</dd></div>
      </div>
    </dl>
    <footer class="mem-card__foot">
      <span title="Created">${icon("clock")}<span class="v" data-v>${fmtDate(m.created_at)}</span></span>
      <span class="mem-card__src" title="Source">${sourceLine(m.source)}</span>
      ${originBadge(m.origin)}
      <a class="mem-card__open" href="${memHref(m.memory_id)}">OPEN ${icon("expand")}</a>
    </footer>
  </article>`;
}

/* ------------------------------------------------------------ the record anatomy (contract, no values) */

export const ANATOMY = [
  ["Hypothesis", "The claim the memory records — stated, never assumed true"],
  ["Evidence", "Supporting and contradicting items, each with a reference and an independence flag"],
  ["OOS", "Out-of-sample check state, as reported"],
  ["Robustness", "Robustness check state, as reported"],
  ["Cost sensitivity", "Whether the observation survives realistic and stressed costs"],
  ["Confidence", "HIGH · MEDIUM · LOW · UNRATED — declared by the producer"],
  ["Validation", "VALIDATED · PROVISIONAL · UNVERIFIED · CONTRADICTED · REJECTED"],
  ["Status", "RETAIN · REVIEW · DEPRECATED · REJECTED"],
];

export function anatomy({ compact = false, cols = 1 } = {}) {
  return html`<dl class="${cx("mem-anatomy", compact && "mem-anatomy--compact", cols === 2 && "mem-anatomy--2col")}">${ANATOMY.map(
    ([k, d]) => html`<div class="mem-anatomy__row"><dt>${k}</dt><dd>${d}</dd></div>`,
  )}</dl>`;
}
