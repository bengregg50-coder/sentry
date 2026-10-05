// Shared display helpers for the research-b views (Backtests, Robustness,
// Out-of-Sample, Validation, Research History).
//
// Everything here filters, groups, sorts and counts rows for display. Nothing
// computes a metric, a verdict, a confidence or an eligibility: those come
// from the contract documents or from snapshot.derived.
//
// Record counts are always split by record origin (ORIGINAL / RECONSTRUCTED /
// SYNTHETIC_FIXTURE) and never summed across origins.

import { html, raw, cx } from "../core/html.js";
import { isNil, fmtCount, fmtDate, fmtDateTime, humanize } from "../core/format.js";
import { toneClass } from "../core/tones.js";
import { doc, source, currentVersion } from "../core/state.js";
import { val, badge, chip, metric, originBadge, emptyState } from "../components/ui.js";
import { icon } from "../components/icons.js";

/* ------------------------------------------------------------ vocabulary
   Contract enums and architecture labels (schemas.py) — not data. */

export const TRIAL_OUTCOMES = ["PASS", "FAIL", "INCONCLUSIVE", "RUNNING", "BLOCKED", "VOID"];
export const ORIGINS = ["ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"];
export const ORIGIN_SHORT = { ORIGINAL: "ORIG", RECONSTRUCTED: "RECON", SYNTHETIC_FIXTURE: "SYNTH" };
export const CHECK_STATES = ["PASS", "FAIL", "PENDING", "INCONCLUSIVE", "BLOCKED", "NOT_RUN", "NOT_APPLICABLE"];
export const VALIDATION_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "VALIDATED", "FAILED"];
export const TERMINATED = ["REJECTED", "BLOCKED_BY_DATA", "ABANDONED"];

/** The thirteen validation checks of the contract (ValidationChecks), in contract order. */
export const CHECKS = [
  { key: "economic_rationale", label: "Economic rationale", short: "Econ. rationale", desc: "A causal mechanism stated before any test is run" },
  { key: "positive_expectancy", label: "Positive expectancy", short: "Pos. expectancy", desc: "Expectancy above zero after all costs" },
  { key: "realistic_costs", label: "Realistic costs", short: "Real. costs", desc: "Commission, spread and slippage modelled at realistic levels" },
  { key: "cost_sensitivity", label: "Cost sensitivity", short: "Cost sens.", desc: "Edge survives stressed cost multipliers" },
  { key: "robustness", label: "Robustness", short: "Robustness", desc: "Result survives perturbation of data, rules and sampling" },
  { key: "parameter_stability", label: "Parameter stability", short: "Param. stab.", desc: "No knife-edge optimum — neighbouring settings behave alike" },
  { key: "regime_analysis", label: "Regime analysis", short: "Regime", desc: "Behaviour across market regimes is reported and understood" },
  { key: "out_of_sample", label: "Out-of-sample", short: "OOS", desc: "Holds on data untouched during development" },
  { key: "walk_forward", label: "Walk-forward", short: "Walk-fwd", desc: "Holds when re-fitted and tested forward in time" },
  { key: "monte_carlo", label: "Monte Carlo", short: "Monte Carlo", desc: "Outcome distribution under resampling of trades or paths" },
  { key: "multiple_testing", label: "Multiple testing", short: "Mult. test", desc: "Significance corrected for every trial in the family" },
  { key: "execution_realism", label: "Execution realism", short: "Exec. real.", desc: "Fills, latency and capacity are achievable in practice" },
  { key: "sample_size", label: "Sample size", short: "Sample", desc: "Enough independent observations to support the claim" },
];
export const CHECK_BY_KEY = Object.fromEntries(CHECKS.map((c) => [c.key, c]));

/** StrategyMetrics field -> label (contract field names). */
export const METRIC_FIELDS = [
  ["expected_return", "Expected return"],
  ["gross_return", "Gross return"],
  ["costs", "Costs"],
  ["net_return", "Net return"],
  ["expectancy", "Expectancy"],
  ["sharpe", "Sharpe"],
  ["sortino", "Sortino"],
  ["max_drawdown", "Max drawdown"],
  ["trade_count", "Trade count"],
  ["win_rate", "Win rate"],
  ["slippage", "Slippage"],
  ["capacity", "Capacity"],
];

/* ------------------------------------------------------------ state access */

export function sources(ctx) {
  return {
    rs: doc(ctx, "research"),
    rsrc: source(ctx, "research"),
    st: doc(ctx, "strategies"),
    ssrc: source(ctx, "strategies"),
    gov: doc(ctx, "governance"),
    gsrc: source(ctx, "governance"),
  };
}

/** Strategies with their current version resolved: [{s, v}] or null when not connected. */
export function currentVersions(st) {
  if (!st) return null;
  return st.strategies.map((s) => ({ s, v: currentVersion(s) }));
}

/** Non-null current-version metrics as [{key, label, metric}] (named fields, then additional). */
export function versionMetrics(v) {
  const m = v?.metrics;
  if (!m) return [];
  const out = METRIC_FIELDS.filter(([k]) => !isNil(m[k])).map(([key, label]) => ({ key, label, metric: m[key] }));
  for (const nm of m.additional ?? []) out.push({ key: nm.key, label: nm.label, metric: nm.metric });
  return out;
}

/* ------------------------------------------------------------ links */

export const trialHref = (id) => `#/research/history?focus=${encodeURIComponent(id)}`;
export const hypHref = (id) => `#/research/hypotheses?focus=${encodeURIComponent(id)}`;
export const strategyHref = (id) => `#/strategy/${encodeURIComponent(id)}`;
export const memoryHref = (id) => `#/memory/item/${encodeURIComponent(id)}`;
export const programmeHref = (id) => `#/research/history?programme=${encodeURIComponent(id)}`;

/** Route href with a query; null / empty values are dropped. */
export function qhref(path, query = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (!isNil(v) && v !== "") q.set(k, v);
  const s = q.toString();
  return `#${path}${s ? "?" + s : ""}`;
}

export function refLink(id, href) {
  if (isNil(id)) return val(null);
  return href ? html`<a class="ref" href="${href}">${id}</a>` : html`<span class="ref">${id}</span>`;
}

/* ------------------------------------------------------------ rows */

export function byTrialNumber(a, b) {
  if (isNil(a.trial_number) && isNil(b.trial_number)) return String(a.trial_id).localeCompare(String(b.trial_id), "en", { numeric: true });
  if (isNil(a.trial_number)) return 1;
  if (isNil(b.trial_number)) return -1;
  return a.trial_number - b.trial_number;
}

/** Trials of the given kinds in ledger order, or null when research.json is not connected. */
export function trialsOfKinds(rs, kinds) {
  if (!rs) return null;
  return rs.trials.filter((t) => kinds.includes(t.kind)).sort(byTrialNumber);
}

export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/* ------------------------------------------------------------ counts (per origin, never merged) */

/** {ORIGINAL:n, RECONSTRUCTED:n, SYNTHETIC_FIXTURE:n} or null when rows is null. */
export function originSplit(rows) {
  if (!rows) return null;
  const out = { ORIGINAL: 0, RECONSTRUCTED: 0, SYNTHETIC_FIXTURE: 0 };
  for (const r of rows) out[r.origin] = r.origin in out ? out[r.origin] + 1 : 1; // row counter
  return out;
}

/**
 * Per-origin count with each origin's number shown separately. ORIGINAL is
 * untagged; other origins carry a tag. A connected source with no rows shows a
 * factual 0. Returns null (=> empty) when the source is not connected.
 */
export function splitVal(split) {
  if (!split) return null;
  const others = ["RECONSTRUCTED", "SYNTHETIC_FIXTURE"].filter((o) => split[o] > 0);
  const parts = [];
  if (split.ORIGINAL > 0 || others.length === 0) parts.push(html`<span class="rsb-split__n">${val(fmtCount(split.ORIGINAL))}</span>`);
  for (const o of others) {
    parts.push(
      html`<span class="rsb-split__n" title="${fmtCount(split[o])} ${humanize(o).toLowerCase()} record(s), counted separately">${val(fmtCount(split[o]))}<span class="rsb-split__tag ${toneClass(o)}">${ORIGIN_SHORT[o]}</span></span>`,
    );
  }
  return html`<span class="rsb-split">${parts}</span>`;
}

/** Plain text per-origin count, e.g. "3 original · 2 reconstructed" (never one merged total). */
export function splitText(split, noun = "") {
  if (!split) return "";
  const parts = ORIGINS.filter((o) => split[o] > 0).map((o) => `${fmtCount(split[o])} ${humanize(o).toLowerCase()}`);
  return (parts.length ? parts.join(" · ") : "0") + (noun ? " " + noun : "");
}

export const count = (n) => (isNil(n) ? null : fmtCount(n));

/* ------------------------------------------------------------ cells */

export function dateVal(iso) {
  return val(iso ? fmtDate(iso) : null);
}

export function dateTimeVal(iso) {
  return val(iso ? fmtDateTime(iso) : null);
}

export function windowCell(start, end) {
  if (isNil(start) && isNil(end)) return val(null);
  return html`<span class="rsb-win">${val(start ? fmtDate(start) : null)}<span class="rsb-win__arrow">→</span>${val(end ? fmtDate(end) : null)}</span>`;
}

/** Window stacked on two lines (start / → end) for narrow register columns. */
export function windowStack(start, end) {
  if (isNil(start) && isNil(end)) return val(null);
  return html`<span class="rsb-winst">${val(start ? fmtDate(start) : null)}<span><span class="rsb-win__arrow">→</span> ${val(end ? fmtDate(end) : null)}</span></span>`;
}

/** Evidence state + record origin + evidence refs in one cell. */
export function evidenceOriginCell(t) {
  return html`<div class="rsb-stack">
    <span class="cluster">${badge(t.evidence_state)}</span>
    ${originCell(t.origin)}
    ${t.evidence_refs?.length ? html`<span class="rsb-refs">${t.evidence_refs.map((r) => html`<span class="ref" title="${r}">${r}</span>`)}</span>` : ""}
  </div>`;
}

/** Plain number exactly as reported (no re-rounding), or empty. */
export function num(v) {
  return val(isNil(v) ? null : String(v));
}

export function trialNumber(n) {
  return isNil(n) ? html`<span class="v is-empty rsb-num" data-v title="No trial number recorded">#—</span>` : html`<span class="v rsb-num" data-v>#${n}</span>`;
}

/** Trial number + id (linking to its history row) + kind. */
export function trialCell(t, { kind = true, link = true } = {}) {
  return html`<div class="rsb-stack">
    <span class="rsb-trial">${trialNumber(t.trial_number)}${link ? refLink(t.trial_id, trialHref(t.trial_id)) : refLink(t.trial_id)}</span>
    ${kind ? html`<span class="rsb-kindlbl">${humanize(t.kind)}</span>` : ""}
    ${kind && t.stage && t.stage !== t.kind ? html`<span class="rsb-faint">STAGE ${humanize(t.stage)}</span>` : ""}
  </div>`;
}

/** Experiment text plus the hypothesis it tests (id, title, declared status). */
export function experimentCell(t, hypById) {
  const h = t.hypothesis_id ? hypById?.get(t.hypothesis_id) : null;
  return html`<div class="rsb-stack">
    <span class="rsb-title">${t.experiment ?? val(null)}</span>
    ${t.hypothesis_id
      ? html`<span class="rsb-sub">${refLink(t.hypothesis_id, hypHref(t.hypothesis_id))}${h ? html` ${h.title}` : html` <span class="rsb-faint" title="Not found in research.json hypotheses">UNRESOLVED</span>`}</span>`
      : html`<span class="rsb-sub rsb-faint">NO HYPOTHESIS LINKED</span>`}
  </div>`;
}

export function outcomeCell(t, { reason = true } = {}) {
  return html`<div class="rsb-stack">
    <span class="cluster" data-outcome="${t.outcome}">${badge(t.outcome)}</span>
    ${reason && t.rejection_reason ? html`<span class="rsb-reason">${t.rejection_reason}</span>` : ""}
  </div>`;
}

export function chipList(items, { max = 6 } = {}) {
  if (!items || items.length === 0) return val(null);
  const shown = items.slice(0, max);
  return html`<span class="rsb-chips">${shown.map((d) => chip(d, { title: d }))}${items.length > max ? html`<span class="rsb-faint">+${items.length - max}</span>` : ""}</span>`;
}

const LINEAGE_SHORT = { PROGRAMME: "PRG", HYPOTHESIS: "HYP", TRIAL: "TRL", STRATEGY_VERSION: "STR", MEMORY: "MEM", PROPOSAL: "PRP", DOCUMENT: "DOC", LITERATURE: "LIT" };

function lineageHref(l) {
  switch (l.kind) {
    case "PROGRAMME":
      return programmeHref(l.ref);
    case "HYPOTHESIS":
      return hypHref(l.ref);
    case "TRIAL":
      return trialHref(l.ref);
    case "STRATEGY_VERSION":
      return strategyHref(String(l.ref).split("@")[0]);
    case "MEMORY":
      return memoryHref(l.ref);
    default:
      return null;
  }
}

export function lineageCell(list) {
  if (!list || list.length === 0) return val(null);
  return html`<span class="rsb-lineage">${list.map(
    (l) => html`<span class="rsb-lineage__item" title="${humanize(l.kind)}${l.note ? " — " + l.note : ""}"><span class="rsb-lineage__k">${LINEAGE_SHORT[l.kind] ?? l.kind}</span>${refLink(l.ref, lineageHref(l))}</span>`,
  )}</span>`;
}

/** ORIGINAL records get a quiet label; others get the shared origin badge. */
export function originCell(origin) {
  if (origin === "ORIGINAL") return html`<span class="rsb-orig" title="Record origin: produced at the time by the governed process">ORIGINAL RECORD</span>`;
  return originBadge(origin);
}

export function evidenceCell(t, { refs = true } = {}) {
  return html`<div class="rsb-stack">
    <span class="cluster">${badge(t.evidence_state)}</span>
    ${refs && t.evidence_refs?.length ? html`<span class="rsb-refs">${t.evidence_refs.map((r) => html`<span class="ref" title="${r}">${r}</span>`)}</span>` : ""}
  </div>`;
}

/** Optional contract CheckState on a trial (oos_state / validation_state): null => not reported. */
export function stateCell(state) {
  return state ? badge(state) : val(null);
}

/** Trial metrics with a given component (GROSS / COST / NET), each via metric() so basis + multiplier show. */
export function componentCell(metrics, component) {
  const list = (metrics ?? []).filter((nm) => nm.metric.component === component);
  if (list.length === 0) return val(null);
  return html`<div class="rsb-metrics">${list.map(
    (nm) => html`<div class="rsb-metrics__row" title="${nm.label}">${list.length > 1 ? html`<span class="rsb-metrics__k">${nm.label}</span>` : ""}${metric(nm.metric)}</div>`,
  )}</div>`;
}

/** Trial metrics without a GROSS / COST / NET component. */
export function otherMetricsCell(metrics) {
  const list = (metrics ?? []).filter((nm) => !nm.metric.component);
  if (list.length === 0) return val(null);
  return html`<div class="rsb-metrics">${list.map(
    (nm) => html`<div class="rsb-metrics__row"><span class="rsb-metrics__k">${nm.label}</span>${metric(nm.metric)}</div>`,
  )}</div>`;
}

/** A named metric list rendered as label + metric() rows. */
export function namedMetrics(list, { grid = false } = {}) {
  if (!list || list.length === 0) return val(null);
  return html`<div class="${cx("rsb-metrics", grid && "rsb-metrics--grid")}">${list.map(
    (nm) => html`<div class="rsb-metrics__row"><span class="rsb-metrics__k">${nm.label}</span>${metric(nm.metric)}</div>`,
  )}</div>`;
}

/**
 * A validation check as a matrix cell. check null => NOT REPORTED (the
 * research engine has not reported it); state colours come from toneClass().
 */
export function checkCell(check, key, { connected = true } = {}) {
  const def = CHECK_BY_KEY[key];
  const state = check?.state ?? (connected ? "NOT_REPORTED" : "NOT_CONNECTED");
  const tip = `${def?.label ?? key}: ${humanize(state)}${check?.detail ? " — " + check.detail : ""}${check?.checked_at ? " · checked " + fmtDateTime(check.checked_at) : ""}`;
  return html`<span class="${cx("rsb-cell", toneClass(check?.state), !check && "rsb-cell--nr")}" data-check="${key}" data-state="${state}" title="${tip}">${
    humanize(state)
  }</span>`;
}

/* ------------------------------------------------------------ tables */

/**
 * A register table. With rows it renders them; without, it keeps the column
 * frame and puts the empty state inside, so the structure stays visible.
 *  columns: [{label, render(row), cls?, num?, title?}]
 *  rowAttrs(row) -> Safe attribute string; rowCls(row) -> class string
 *  groups: optional [{key, head: Safe, rows}] — one tbody per group with a header row
 */
export function regTable({ columns, rows, groups, empty, rowAttrs, rowCls, cls, maxHeight }) {
  const head = html`<thead><tr>${columns.map((c) => html`<th class="${cx(c.num && "num", c.hcls)}" ${c.title ? html`title="${c.title}"` : ""}>${c.label}</th>`)}</tr></thead>`;
  const row = (r) => html`<tr class="${rowCls ? rowCls(r) : ""}" ${rowAttrs ? rowAttrs(r) : ""}>${columns.map((c) => {
    const v = c.render(r);
    return html`<td class="${cx(c.num && "num", c.cls)}">${isNil(v) || v === "" ? val(null) : v}</td>`;
  })}</tr>`;
  const style = maxHeight ? raw(`style="max-height:${Number(maxHeight)}px"`) : "";
  const hasRows = groups ? groups.some((g) => g.rows.length) : rows && rows.length;
  if (!hasRows) {
    return html`<div class="${cx("table-wrap rsb-reg rsb-reg--empty", cls)}"><table class="table table--dense">${head}
      <tbody><tr><td class="rsb-frame" colspan="${String(columns.length)}">${empty}</td></tr></tbody></table></div>`;
  }
  const body = groups
    ? groups
        .filter((g) => g.rows.length)
        .map((g) => html`<tbody class="rsb-group" data-group="${g.key}"><tr class="rsb-group__head"><td colspan="${String(columns.length)}">${g.head}</td></tr>${g.rows.map(row)}</tbody>`)
    : html`<tbody>${rows.map(row)}</tbody>`;
  return html`<div class="${cx("table-wrap rsb-reg", cls)}" ${style}><table class="table table--dense">${head}${body}</table></div>`;
}

/* ------------------------------------------------------------ doctrine / gate chain */

const CHAIN = [
  { key: "HYPOTHESIS", label: "Preregistered hypothesis", href: "#/research/hypotheses" },
  { key: "BACKTEST", label: "Backtest", href: "#/research/backtests" },
  { key: "ROBUSTNESS", label: "Robustness", href: "#/research/robustness" },
  { key: "OOS", label: "Out-of-sample", href: "#/research/oos" },
  { key: "VALIDATION", label: "Validation gate", href: "#/research/validation" },
  { key: "APPROVAL", label: "Governance approval", href: "#/governance" },
];

/** The fixed credibility path a result must travel (architecture, not state). */
export function gateChain(current) {
  return html`<nav class="rsb-chain" aria-label="Credibility path">${CHAIN.map(
    (c, i) => html`${i ? html`<span class="rsb-chain__sep" aria-hidden="true">${icon("expand")}</span>` : ""}<a class="${cx("rsb-chain__step", c.key === current && "is-here")}" href="${c.href}" ${
      c.key === current ? raw('aria-current="step"') : ""
    }><span class="rsb-chain__n">${String(i + 1).padStart(2, "0")}</span>${c.label}</a>`,
  )}</nav>`;
}

/**
 * Prominent doctrine block: a statement, supporting points and the gate chain.
 * points: [[title, text]]
 */
export function doctrineHero({ statement, lead, points = [], current, code }) {
  return html`<div class="rsb-hero" ${code ? html`data-doctrine="${code}"` : ""}>
    <div class="rsb-hero__mark">${icon("shield")}<span>DOCTRINE</span></div>
    <div class="rsb-hero__statement">${statement}</div>
    ${lead ? html`<p class="rsb-hero__lead">${lead}</p>` : ""}
    ${points.length ? html`<div class="rsb-hero__points">${points.map(([t, d]) => html`<div class="rsb-hero__point"><b>${t}</b><span>${d}</span></div>`)}</div>` : ""}
    ${current ? gateChain(current) : ""}
  </div>`;
}

/** Small uppercase section label inside a panel body. */
export function label(text, extra) {
  return html`<div class="rsb-label">${text}${extra ? html` <span class="rsb-label__extra">${extra}</span>` : ""}</div>`;
}

/** Compact empty-state used inside a panel when a source is connected but empty. */
export function noneRecorded(title, reason, hint) {
  return emptyState({ title, reason, hint, compact: true });
}

/**
 * Distribution of rows over a state field (default: outcome), each state's
 * count split by origin. nullLabel adds a row for rows whose field is null.
 */
export function outcomeSplits(rows, { outcomes = TRIAL_OUTCOMES, href, field = "outcome", nullLabel } = {}) {
  const keys = nullLabel ? [...outcomes, null] : outcomes;
  return html`<div class="rsb-outs">${keys.map((o) => {
    const split = rows ? originSplit(rows.filter((t) => (o === null ? isNil(t[field]) : t[field] === o))) : null;
    const present = split && ORIGINS.some((k) => split[k] > 0);
    const name = html`<span class="rsb-outs__name">${o === null ? nullLabel : humanize(o)}</span>`;
    return html`<div class="${cx("rsb-outs__row", !present && "is-zero")}" data-state-row="${o ?? "NOT_REPORTED"}">
      <span class="${cx("rsb-outs__swatch", present && o !== null && toneClass(o))}"></span>
      ${href && o !== null ? html`<a href="${href(o)}">${name}</a>` : name}
      <span class="rsb-outs__n">${split ? splitVal(split) : val(null)}</span>
    </div>`;
  })}</div>`;
}
