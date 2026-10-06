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
import { doc, source, derived, sourceTitle } from "../core/state.js";
import { fetchEvents } from "../core/api.js";
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
/** Agent event kinds that name memories (refs.memory_ids): recall, write, and an applicability test of a shared memory. */
export const MEMORY_EVENT_KINDS = ["MEMORY_RECALL", "MEMORY_WRITE", "APPLICABILITY_TEST"];

/* ------------------------------------------------------------ state access */

/** memory.json payload, its source, and derived.memory_stats. `mems` is null when not connected. */
export function memState(ctx) {
  const d = doc(ctx, "memory");
  return { d, mems: d ? d.memories : null, src: source(ctx, "memory"), stats: derived(ctx, "memory_stats") };
}

export function memoryIndex(mems) {
  return new Map((mems ?? []).map((m) => [m.memory_id, m]));
}

/** "memory.json not produced" / "… rejected by the contract" / "… not connected" — never one fixed phrase. */
export function srcPhrase(src, what) {
  return sourceTitle(src, what ?? src?.file ?? "source");
}

/** True when derive's family of memory cross-checks ran (derived.check_coverage). */
export function memoryChecksRan(ctx) {
  const fam = (derived(ctx, "check_coverage") ?? []).find((c) => c.key === "memory");
  return { ran: !!fam?.ran, note: fam?.note ?? null };
}

/* ------------------------------------------------------------ memory events (MEMORY_RECALL / MEMORY_WRITE / APPLICABILITY_TEST) */

/** Per-kind fetch window. A stream with more memory events of one kind is labelled partial, never extrapolated. */
export const MEMORY_EVENT_LIMIT = 5000;

/** View load(): every MEMORY_RECALL, MEMORY_WRITE and APPLICABILITY_TEST event (newest first), fetched per kind. */
export async function loadMemoryEvents() {
  try {
    const res = await Promise.all(MEMORY_EVENT_KINDS.map((kind) => fetchEvents({ kind, limit: MEMORY_EVENT_LIMIT })));
    const events = res.flatMap((r) => r.events).sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    const fetched = Object.fromEntries(MEMORY_EVENT_KINDS.map((k, i) => [k, res[i].events.length]));
    return { events, source: res[0].source, fetched, error: null };
  } catch (err) {
    return { events: null, source: null, fetched: null, error: String(err && err.message ? err.message : err) };
  }
}

/** Exact count of one event kind over the whole stream (derived.agent_slots[].events.by_kind), or null. */
export function streamKindTotal(ctx, kind) {
  const slots = derived(ctx, "agent_slots");
  if (!slots || !slots.length || slots.some((s) => !s.events?.available || isNil(s.events.by_kind))) return null;
  return slots.reduce((n, s) => n + tally(s.events.by_kind, kind), 0);
}

/**
 * The fetched memory events: ok (stream readable — OK, or INVALID with valid
 * lines kept), and complete when the fetch holds every memory event the whole
 * stream has (checked against derive's exact per-kind counts).
 */
export function memEvents(ctx, extra) {
  if (!extra || extra.error || !extra.source) return { ok: false, complete: false, events: null, src: extra?.source ?? null, error: extra?.error ?? null };
  const ok = extra.source.status === "OK" || extra.source.status === "INVALID";
  const complete = ok && MEMORY_EVENT_KINDS.every((k) => {
    const total = streamKindTotal(ctx, k);
    return !isNil(total) && extra.fetched?.[k] === total;
  });
  return { ok, complete, events: ok ? extra.events : null, src: extra.source, error: null };
}

/** Hint for a count over the fetched memory events. */
export function memEventsScope(ev) {
  return ev.complete ? "Whole stream" : `Latest ${fmtCount(MEMORY_EVENT_LIMIT)} fetched`;
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

/* ------------------------------------------------------------ per-origin counts (never merged)
   A count of records is always shown per record origin: ORIGINAL untagged,
   every other origin tagged (RECON amber, SYNTH red). Rows without an origin
   field (e.g. proposals in the graph) are UNDECLARED; graph placeholders for
   references that resolve to nothing are UNRESOLVED. */

export const ORIGIN_TAG = { RECONSTRUCTED: "RECON", SYNTHETIC_FIXTURE: "SYNTH", UNDECLARED: "NO ORIGIN", UNRESOLVED: "UNRES." };
const SPLIT_ORDER = [...ORIGINS, "UNDECLARED", "UNRESOLVED"];

/** Records per origin (optionally only those matching `pred`). null rows (source not connected) -> null. */
export function originCounts(rows, pred, originOf = (r) => r.origin) {
  if (!Array.isArray(rows)) return null;
  const out = {};
  for (const r of rows) {
    if (pred && !pred(r)) continue;
    const o = originOf(r) ?? "UNDECLARED";
    out[o] = tally(out, o) + 1;
  }
  return out;
}

/** Origins with at least one record, in display order. */
export function splitParts(split) {
  if (isNil(split)) return [];
  const rank = (o) => (SPLIT_ORDER.includes(o) ? SPLIT_ORDER.indexOf(o) : SPLIT_ORDER.length);
  return Object.keys(split)
    .filter((o) => split[o] > 0)
    .sort((a, b) => rank(a) - rank(b));
}

/** True when a split holds any record that is not ORIGINAL (so a single plain number would hide it). */
export function hasOtherOrigins(split) {
  return splitParts(split).some((o) => o !== "ORIGINAL");
}

/** Records in a split, for bar scaling and zero checks only — never displayed as a number. */
export function splitSize(split) {
  return isNil(split) ? null : splitParts(split).reduce((n, o) => n + split[o], 0);
}

function originTagTone(o) {
  if (o === "SYNTHETIC_FIXTURE") return toneClass("INVALID");
  if (o === "RECONSTRUCTED") return toneClass("RECONSTRUCTED");
  return toneClass(null);
}

/**
 * One number per origin present ("4 · 2 RECON"). A connected source with no
 * matching record renders a single real 0. null (not connected) -> null, so
 * stat() / val() / tabs() render their own empty state.
 */
export function splitVal(split, { cls } = {}) {
  if (isNil(split)) return null;
  const parts = splitParts(split);
  if (!parts.length) return html`<span class="${cx("mem-split", cls)}" data-origin-split><span class="mem-split__n" data-origin="NONE">${val(fmtCount(0))}</span></span>`;
  return html`<span class="${cx("mem-split", cls)}" data-origin-split>${parts.map(
    (o) => html`<span class="mem-split__n" data-origin="${o}" title="${fmtCount(split[o])} ${humanize(o).toLowerCase()} — counted separately, never merged with other origins">${val(fmtCount(split[o]))}${
      o === "ORIGINAL" ? "" : html`<span class="${cx("mem-split__tag", originTagTone(o))}">${ORIGIN_TAG[o] ?? o}</span>`
    }</span>`,
  )}</span>`;
}

/** Plain-text split, e.g. "4 original · 2 reconstructed" (never one merged total). */
export function splitText(split, noun = "") {
  if (isNil(split)) return "";
  const parts = splitParts(split).map((o) => `${fmtCount(split[o])} ${humanize(o).toLowerCase()}`);
  return (parts.length ? parts.join(" · ") : "0") + (noun ? ` ${noun}` : "");
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
 * rows: [{key, label?, n?: number|null, split?: {origin: n}|null, tone?, href?}]
 * — n / split null means not connected. With a `split`, the number is shown per
 * origin whenever any record is not ORIGINAL (never one merged figure). Bar
 * length is relative to the largest row (display scaling only). A tone class
 * is applied only to a bar that has something to show, so an empty panel
 * never carries a state colour.
 */
export function bars(rows, { neutral = false } = {}) {
  const sized = rows.map((r) => ({ ...r, n: r.split !== undefined ? splitSize(r.split) : r.n }));
  const max = Math.max(0, ...sized.filter((r) => !isNil(r.n)).map((r) => r.n));
  const splitMode = sized.some((r) => hasOtherOrigins(r.split));
  return html`<div class="${cx("mem-bars", splitMode && "mem-bars--split")}">${sized.map((r) => {
    const empty = isNil(r.n);
    const has = !empty && r.n > 0;
    const pct = has && max > 0 ? (r.n / max) * 100 : 0;
    const tone = has ? r.tone ?? (neutral ? null : toneOf(r.key)) : null;
    const label = r.label ?? humanize(r.key);
    const num = hasOtherOrigins(r.split) ? splitVal(r.split, { cls: "mem-split--bar" }) : val(empty ? null : fmtCount(r.n));
    const inner = html`<span class="mem-bar__label" title="${label}">${label}</span>
      <span class="mem-bar__track">${has ? html`<i class="${cx("mem-bar__fill", tone ? `tone-${tone}` : "mem-bar__fill--neutral")}" style="width:${raw(pct.toFixed(1))}%"></i>` : ""}</span>
      <span class="mem-bar__n">${num}</span>`;
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
      <span class="mem-card__date" title="Created">${icon("clock")}<span class="v" data-v>${fmtDate(m.created_at)}</span></span>
      <span class="mem-card__src" title="Source: ${sourceLine(m.source)}">${sourceLine(m.source)}</span>
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
