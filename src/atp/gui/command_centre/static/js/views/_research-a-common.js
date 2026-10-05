// Shared display helpers for the research-a views (overview, discovery,
// hypotheses, experiments). Filtering, grouping, sorting and counting rows
// only — no research logic, no verdicts, no estimates.
//
// Origins are never merged: every count helper here returns per-origin
// counts, and splitVal() renders each origin's number separately.

import { html, cx } from "../core/html.js";
import { isNil, fmtCount, fmtDate, fmtDateTime, humanize } from "../core/format.js";
import { toneOf, toneClass } from "../core/tones.js";
import { doc, source } from "../core/state.js";
import { table, val, badge, dot, chip, originBadge, metric } from "../components/ui.js";
import { STAGES } from "../components/pipeline.js";

/* ------------------------------------------------------------ vocabulary */
// Contract enums (schemas.py). Architecture labels, not data.

export const HYP_STATUSES = ["PROPOSED", "PREREGISTERED", "TESTING", "PENDING", "REJECTED", "BLOCKED_BY_DATA", "VALIDATED", "ABANDONED"];
export const HYP_FLOW = ["PROPOSED", "PREREGISTERED", "TESTING", "VALIDATED"];
export const HYP_STOPS = ["PENDING", "REJECTED", "BLOCKED_BY_DATA", "ABANDONED"];
export const HYP_STATUS_DESC = {
  PROPOSED: "Registered idea; not yet preregistered",
  PREREGISTERED: "Statement, tests and thresholds fixed before data",
  TESTING: "Trials running against the frozen specification",
  VALIDATED: "Declared validated by the research engine",
  PENDING: "Stopped awaiting further evidence",
  REJECTED: "Failed a preregistered test — kept as evidence",
  BLOCKED_BY_DATA: "Cannot be tested with the data available",
  ABANDONED: "Dropped by researcher decision — still counted",
};

export const TRIAL_KINDS = [
  "DISCOVERY", "BACKTEST", "ROBUSTNESS", "COST_SENSITIVITY", "PARAMETER_STABILITY", "REGIME",
  "OOS", "WALK_FORWARD", "MONTE_CARLO", "VALIDATION", "DATA_CHECK", "OTHER",
];
export const TRIAL_OUTCOMES = ["PASS", "FAIL", "INCONCLUSIVE", "RUNNING", "BLOCKED", "VOID"];
export const EVIDENCE_STATES = ["ORIGINAL", "RECONSTRUCTED", "LOST", "PENDING"];
export const AREA_STATUSES = ["CANDIDATE_AREA", "ACTIVE", "DEFERRED", "EXHAUSTED"];
export const RECORD_ORIGINS = ["ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"];
export const ORIGIN_SHORT = { ORIGINAL: "ORIG", RECONSTRUCTED: "RECON", SYNTHETIC_FIXTURE: "SYNTH" };

export const ROLES = [
  ["LEAD_RESEARCHER", "Lead researcher", "Sets the agenda; owns go / no-go decisions"],
  ["QUANT_RESEARCHER", "Quant researcher", "Turns mechanisms into preregistered hypotheses"],
  ["DATA_ANALYST", "Data analyst", "Data provenance, coverage and integrity"],
  ["CODER", "Coder", "Implements frozen specifications exactly"],
  ["BACKTESTER", "Backtester", "Runs trials; records every result to the ledger"],
  ["ADVERSARIAL_REFEREE", "Adversarial referee", "Independently reproduces and attacks results"],
  ["GOVERNANCE", "Governance", "Freezes, seals and approvals — process enforcement"],
];

/* ------------------------------------------------------------ state */

export function research(ctx) {
  return { rs: doc(ctx, "research"), src: source(ctx, "research") };
}

/* ------------------------------------------------------------ links */

export const hypHref = (id) => `#/research/hypotheses?focus=${encodeURIComponent(id)}`;
export const trialHref = (id) => `#/research/history?focus=${encodeURIComponent(id)}`;
export const programmeHref = (id) => `#/research?programme=${encodeURIComponent(id)}`;
export const strategyHref = (id) => `#/strategy/${encodeURIComponent(id)}`;

/** Pipeline item -> its detail route (hypotheses get the focus panel, strategies their page). */
export function itemHref(it) {
  if (it.kind === "STRATEGY") return strategyHref(it.id);
  if (it.kind === "HYPOTHESIS") return hypHref(it.id);
  return null;
}

/** Route href with a query; null / empty values are dropped. */
export function qhref(path, query = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (!isNil(v) && v !== "") q.set(k, v);
  const s = q.toString();
  return `#${path}${s ? "?" + s : ""}`;
}

export function ref(id, href, attrs) {
  if (isNil(id)) return val(null);
  return href ? html`<a class="ref" href="${href}" ${attrs ?? ""}>${id}</a>` : html`<span class="ref">${id}</span>`;
}

/* ------------------------------------------------------------ counting rows */

/** Count rows per origin. null rows (source not connected) => null. */
export function splitByOrigin(rows) {
  if (!rows) return null;
  const out = { ORIGINAL: 0, RECONSTRUCTED: 0, SYNTHETIC_FIXTURE: 0 };
  for (const r of rows) out[r.origin] = (out[r.origin] ?? 0) + 1;
  return out;
}

/** Group rows by a key function into a Map preserving first-seen order. */
export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/** Origins to show as separate columns: ORIGINAL and RECONSTRUCTED always, SYNTHETIC only when present. */
export function originColumns(rows) {
  const cols = ["ORIGINAL", "RECONSTRUCTED"];
  if ((rows ?? []).some((r) => r.origin === "SYNTHETIC_FIXTURE")) cols.push("SYNTHETIC_FIXTURE");
  return cols;
}

/**
 * Per-origin count, each origin's number shown separately (never summed).
 * ORIGINAL is untagged; other origins carry a tag. A connected source with
 * no rows shows a factual 0.
 */
export function splitVal(split) {
  if (!split) return null;
  const parts = [];
  const others = ["RECONSTRUCTED", "SYNTHETIC_FIXTURE"].filter((o) => split[o] > 0);
  if (split.ORIGINAL > 0 || others.length === 0) parts.push(html`<span class="rsa-split__n">${val(fmtCount(split.ORIGINAL))}</span>`);
  for (const o of others) {
    parts.push(
      html`<span class="rsa-split__n" title="${split[o]} ${humanize(o)} record(s), counted separately">${val(fmtCount(split[o]))}<span class="rsa-split__tag ${toneClass(o)}">${ORIGIN_SHORT[o]}</span></span>`,
    );
  }
  return html`<span class="rsa-split">${parts}</span>`;
}

export const count = (n) => (isNil(n) ? null : fmtCount(n));

/** Plain-text per-origin count for subtitles, e.g. "9 original · 2 reconstructed" (never one merged total). */
export function splitText(rows, noun = "") {
  const split = splitByOrigin(rows);
  if (!split) return "";
  const parts = RECORD_ORIGINS.filter((o) => split[o] > 0).map((o) => `${fmtCount(split[o])} ${humanize(o).toLowerCase()}`);
  return (parts.length ? parts.join(" · ") : "0") + (noun ? " " + noun : "");
}

/* ------------------------------------------------------------ cells */

export function dateVal(iso) {
  return val(iso ? fmtDate(iso) : null);
}

export function dateTimeVal(iso) {
  return val(iso ? fmtDateTime(iso) : null);
}

export function windowVal(start, end) {
  if (isNil(start) && isNil(end)) return val(null);
  return html`<span class="rsa-win">${val(start ? fmtDate(start) : null)}<span class="rsa-win__arrow">→</span>${val(end ? fmtDate(end) : null)}</span>`;
}

/** ORIGINAL records get a quiet label; others get the shared origin badge. */
export function originCell(origin) {
  if (origin === "ORIGINAL") return html`<span class="rsa-orig">ORIGINAL</span>`;
  return originBadge(origin);
}

/** Ten-tick stage indicator for a declared stage_reached (+ terminal tone). */
export function stageBar(stage, terminal) {
  const idx = STAGES.indexOf(stage);
  const tone = terminal ? toneOf(terminal) : "info";
  return html`<span class="rsa-stagebar" aria-hidden="true">${STAGES.map(
    (_, i) => html`<i class="${i < idx ? "on" : i === idx ? `end tone-${tone}` : ""}"></i>`,
  )}</span>`;
}

export function stageCell(stage, terminal) {
  if (isNil(stage)) return val(null);
  return html`<span class="rsa-stage">${stageBar(stage, terminal)}<span class="rsa-stage__label">${humanize(stage)}</span></span>`;
}

/** Terminal outcome; null means the item is still open (contract semantics). */
export function terminalCell(terminal) {
  return terminal ? badge(terminal) : chip("OPEN", { title: "No terminal outcome declared — item still active" });
}

export function preregCell(h) {
  if (!h.preregistered_at) return html`<span class="rsa-stack-cell">${badge("NOT_PREREGISTERED", { label: "NOT PREREGISTERED", ghost: true })}</span>`;
  return html`<span class="rsa-stack-cell">${badge("PREREGISTERED")}<span class="rsa-sub">${fmtDate(h.preregistered_at)}${h.prereg_ref ? html` · <span class="ref">${h.prereg_ref}</span>` : ""}</span></span>`;
}

/** Contract NamedMetric list -> stacked gross / cost / net (+ others), each via metric(). */
export function metricsCell(list) {
  if (!list || list.length === 0) return val(null);
  const order = { GROSS: 0, COST: 1, NET: 2 };
  const sorted = [...list].sort((a, b) => (order[a.metric.component] ?? 3) - (order[b.metric.component] ?? 3));
  return html`<div class="rsa-metrics">${sorted.map(
    (nm) => html`<div class="rsa-metrics__row" title="${nm.label}">${nm.metric.component ? "" : html`<span class="rsa-metrics__k">${nm.label}</span>`}${metric(nm.metric)}</div>`,
  )}</div>`;
}

export function trialNumber(n) {
  return isNil(n) ? val(null) : html`<span class="v" data-v>#${n}</span>`;
}

/* ------------------------------------------------------------ tables */

/**
 * table() when there are rows; otherwise the table's column frame with the
 * empty state inside, so an empty register still shows its structure.
 */
export function frameTable({ columns, rows, empty, dense = false, ...rest }) {
  if (rows && rows.length) return table({ columns, rows, dense, ...rest });
  return html`<div class="table-wrap rsa-frame"><table class="${cx("table", dense && "table--dense")}">
    <thead><tr>${columns.map((c) => html`<th class="${cx(c.num && "num", c.cls)}">${c.label}</th>`)}</tr></thead>
    <tbody><tr><td class="rsa-frame__cell" colspan="${String(columns.length)}">${empty}</td></tr></tbody>
  </table></div>`;
}

/** The pipeline-tracks column header with an empty state below (structure when not connected). */
export function tracksFrame(empty) {
  return html`<div class="rsa-tracks"><div class="tracks rsa-tracks-frame">
    <div class="tracks__head"><span></span>${STAGES.map((s) => html`<span class="tracks__stage">${s}</span>`)}<span class="tracks__stage">OUTCOME</span></div>
  </div></div><div class="rsa-autoh">${empty}</div>`;
}

/* ------------------------------------------------------------ distributions */

/**
 * Category × origin matrix. rows: [{key, label?, href?, counts: {origin: n} | undefined}]
 * Each origin has its own count column and its own bar track (scaled to the
 * largest single cell) — origins are never stacked or summed.
 */
export function originMatrix(rows, { origins, available, caption, labelWidth = 150 }) {
  const max = available ? Math.max(1, ...rows.flatMap((r) => origins.map((o) => r.counts?.[o] ?? 0))) : 1;
  const pct = (n) => String(Math.round((n / max) * 1000) / 10);
  return html`<div class="rsa-matrix" style="--rsa-label:${String(Number(labelWidth))}px;--rsa-cols:${String(origins.length)}" data-available="${available ? "1" : "0"}">
    <div class="rsa-matrix__row rsa-matrix__row--head">
      <span></span><span class="rsa-matrix__cap">${caption ?? ""}</span><span></span>
      ${origins.map((o) => html`<span class="rsa-matrix__col" title="${humanize(o)} records">${ORIGIN_SHORT[o]}</span>`)}
    </div>
    ${rows.map((r) => {
      const label = html`<span class="rsa-matrix__label">${r.label ?? humanize(r.key)}</span>`;
      return html`<div class="rsa-matrix__row" data-key="${r.key}">
        <span class="rsa-matrix__dot">${dot(available && origins.some((o) => (r.counts?.[o] ?? 0) > 0) ? r.key : null)}</span>
        ${r.href ? html`<a class="rsa-matrix__name" href="${r.href}">${label}</a>` : html`<span class="rsa-matrix__name">${label}</span>`}
        <span class="rsa-bars">${origins.map((o) => {
          const n = r.counts?.[o] ?? 0;
          return html`<span class="${cx("rsa-bar", o !== "ORIGINAL" && "rsa-bar--alt", !available && "is-empty")}" title="${humanize(o)}">${
            available && n > 0 ? html`<i class="${cx("rsa-bar__fill", toneClass(r.key))}" style="width:${pct(n)}%"></i>` : ""
          }</span>`;
        })}</span>
        ${origins.map((o) => html`<span class="rsa-matrix__n">${val(available ? fmtCount(r.counts?.[o] ?? 0) : null)}</span>`)}
      </div>`;
    })}
  </div>`;
}

/** Count rows into {key: {origin: n}} for a matrix. */
export function countMatrix(rows, keyFn) {
  if (!rows) return null;
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    out[k] ??= { ORIGINAL: 0, RECONSTRUCTED: 0, SYNTHETIC_FIXTURE: 0 };
    out[k][r.origin] = (out[k][r.origin] ?? 0) + 1;
  }
  return out;
}

export function byTrialNumber(a, b) {
  if (isNil(a.trial_number) && isNil(b.trial_number)) return a.trial_id.localeCompare(b.trial_id);
  if (isNil(a.trial_number)) return 1;
  if (isNil(b.trial_number)) return -1;
  return a.trial_number - b.trial_number;
}

export function byId(key) {
  return (a, b) => String(a[key]).localeCompare(String(b[key]), "en", { numeric: true });
}
