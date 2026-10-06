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
import { doc, source, currentVersion, sourceShort, sourceTitle } from "../core/state.js";
import { val, badge, chip, metric, originBadge, emptyState, sourceEmpty } from "../components/ui.js";
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

/* ------------------------------------------------------------ unavailable source */
// Not connected ≠ not produced ≠ rejected by the contract ≠ unreadable. Every title,
// label and sub-line shown in place of a document's content is phrased from the
// source status. A document that is present but INVALID or UNREADABLE is a failure
// and takes the bad tone, never the muted styling of an absent source.

/** True when the source exists but was rejected by the contract or could not be read. */
export const srcBroken = (src) => src?.status === "INVALID" || src?.status === "UNREADABLE";

const offTone = (src) => (srcBroken(src) ? toneClass(src.status) : "");

/** Short label in place of a value: NOT CONNECTED / NOT PRODUCED / CONTRACT ERROR / UNREADABLE. */
export function offLabel(src) {
  return html`<span class="${cx("rsb-off", offTone(src))}" data-source-off="${src?.status ?? "NO_SNAPSHOT"}">${sourceShort(src)}</span>`;
}

/** "<file> <status>" for a panel sub-line, e.g. "research.json not produced" / "strategies.json contract error". */
export function srcPhrase(src) {
  return `${src?.file ?? "source"} ${sourceShort(src).toLowerCase()}`;
}

/** "<file> <STATUS>" for an inline caption: the file name as written, the status as offLabel(). */
export function srcLine(src) {
  return html`<span class="rsb-off__file">${src?.file ?? "source"}</span> ${offLabel(src)}`;
}

/** What each source document is, as the subject of an empty-state title. */
const SRC_NOUN = { research: "Research ledger", strategies: "Strategy registry", governance: "Governance record" };

/**
 * sourceEmpty() titled from the source status, with the document as the subject
 * ("Strategy registry rejected by the contract", "Research ledger not produced") —
 * never a panel noun that could read as a research verdict ("hypotheses rejected").
 * The hint says what the panel will show. Broken sources take the bad tone.
 */
export function srcEmpty(src, opts = {}) {
  const e = sourceEmpty(src, { ...opts, title: sourceTitle(src, SRC_NOUN[src?.key] ?? src?.label ?? "Source") });
  return srcBroken(src) ? html`<div class="${cx("rsb-src-bad", offTone(src))}" data-source-off="${src.status}">${e}</div>` : e;
}

/** State of a record slot (e.g. a check cell) whose source is unavailable. */
export function offState(src) {
  return { INVALID: "INVALID", UNREADABLE: "UNREADABLE", MISSING: "NOT_PRODUCED" }[src?.status] ?? "NOT_CONNECTED";
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

/**
 * Trials linked to a hypothesis, in ledger order: those whose hypothesis_id
 * names it, plus those whose trial_number the hypothesis declares in
 * trial_numbers (the same union the Hypotheses view uses). Declared numbers
 * with no trial record present are returned separately as `missing`.
 */
export function trialsOfHypothesis(rs, h) {
  const nums = new Set(h.trial_numbers ?? []);
  const trials = (rs?.trials ?? []).filter((t) => t.hypothesis_id === h.hypothesis_id || (!isNil(t.trial_number) && nums.has(t.trial_number))).sort(byTrialNumber);
  const present = new Set(trials.map((t) => t.trial_number).filter((n) => !isNil(n)));
  return { trials, missing: (h.trial_numbers ?? []).filter((n) => !present.has(n)) };
}

/**
 * Validation-check states reported by the given current versions for one
 * check, as [[state, n]] in contract order (only states that occur). Versions
 * that do not report the check are not counted. Display counting only.
 */
export function checkStateSplit(cv, key) {
  if (!cv) return null;
  const n = {};
  for (const { v } of cv) {
    const s = v.validation?.[key]?.state;
    if (s) n[s] = (n[s] ?? 0) + 1;
  }
  return [...CHECK_STATES, ...Object.keys(n).filter((s) => !CHECK_STATES.includes(s))].filter((s) => n[s] > 0).map((s) => [s, n[s]]);
}

/** Reported-state split as compact badges ("PASS 2 · FAIL 1"); "NONE REPORTED" when empty. */
export function checkSplitBadges(split, { none = "NONE REPORTED" } = {}) {
  if (!split) return val(null);
  if (!split.length) return html`<span class="rsb-faint" data-check-split="none">${none}</span>`;
  return html`<span class="rsb-cksplit">${split.map(
    ([s, n]) => html`<span class="rsb-cksplit__item" data-check-state="${s}" data-n="${String(n)}">${badge(s)}<b class="mono">${fmtCount(n)}</b></span>`,
  )}</span>`;
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

/** Record origins present among rows, in ORIGINS order (others after). */
function originsPresent(rows) {
  const seen = new Set((rows ?? []).map((r) => r.origin));
  return [...ORIGINS.filter((o) => seen.has(o)), ...[...seen].filter((o) => !ORIGINS.includes(o))];
}

/**
 * How many strategies' current versions report a check (in any state), per
 * strategy origin: "3/5", or "2/3 · 1/2 RECON" when origins are mixed — never
 * one merged figure. cv: [{s, v}] (null => source unavailable => null).
 */
export function reportedVal(cv, key) {
  if (!cv) return null;
  const origins = originsPresent(cv.map(({ s }) => s));
  if (!origins.length) return html`<span class="rsb-split"><span class="rsb-split__n"><span class="rsb-split__frac">${val("0")}<span class="rsb-split__of">/0</span></span></span></span>`;
  return html`<span class="rsb-split">${origins.map((o) => {
    const rows = cv.filter(({ s }) => s.origin === o);
    const reported = rows.filter(({ v }) => v.validation?.[key]?.state).length;
    const tag = o === "ORIGINAL" ? "" : html`<span class="rsb-split__tag ${toneClass(o)}">${ORIGIN_SHORT[o] ?? o}</span>`;
    return html`<span class="rsb-split__n" data-origin="${o}" title="${fmtCount(reported)} of ${fmtCount(rows.length)} ${humanize(o).toLowerCase()} strategies report this check, in any state — not a pass count"><span class="rsb-split__frac">${val(fmtCount(reported))}<span class="rsb-split__of">/${fmtCount(rows.length)}</span></span>${tag}</span>`;
  })}</span>`;
}

/**
 * Reported check states as badges. With strategies of one origin this is the
 * plain split; with mixed origins each origin gets its own line, tagged.
 */
export function checkSplitView(cv, key, { none = "NONE REPORTED" } = {}) {
  if (!cv) return val(null);
  const origins = originsPresent(cv.map(({ s }) => s));
  if (origins.length <= 1) return checkSplitBadges(checkStateSplit(cv, key), { none });
  return html`<span class="rsb-cksplit-o">${origins.map(
    (o) => html`<span class="rsb-cksplit-o__row" data-origin="${o}"><span class="rsb-split__tag ${toneClass(o)}">${ORIGIN_SHORT[o] ?? o}</span>${checkSplitBadges(
      checkStateSplit(cv.filter(({ s }) => s.origin === o), key),
      { none },
    )}</span>`,
  )}</span>`;
}

/* ------------------------------------------------------------ paging */
// Long registers materialise a window of rows; ?rows=<n>|all asks for more and
// ?from=<k> starts the window later. Paging never changes a displayed count:
// totals and per-origin counts always come from the full arrays, and the rows
// not shown (before and after the window) are reported per origin, never as one
// merged total.

export const PAGE_ROWS = 100;

/**
 * {shown, before, hidden, from, count} for a register.
 *  requested: the ?rows= value ("all" => every row from `from`)
 *  from:      the ?from= value (an explicit window start)
 *  include:   an index that must be in the window (a focused row). With no
 *             explicit ?rows= / ?from=, a row beyond the first page opens the
 *             step-aligned page that holds it rather than materialising every
 *             row before it.
 */
export function pageRows(rows, requested, { step = PAGE_ROWS, from: fromQ, include = -1 } = {}) {
  const n = Number.parseInt(requested, 10);
  const count = requested === "all" ? Infinity : Number.isFinite(n) && n > 0 ? n : step;
  const f = Number.parseInt(fromQ, 10);
  let from = Number.isFinite(f) && f > 0 ? f : 0;
  if (include >= 0 && isNil(fromQ) && (include < from || include >= from + count)) from = Math.floor(include / step) * step;
  if (!rows) return { shown: rows, before: [], hidden: [], from: 0, count };
  from = Math.min(from, Math.max(0, rows.length - 1));
  const end = Math.min(rows.length, from + count);
  return { shown: rows.slice(from, end), before: rows.slice(0, from), hidden: rows.slice(end), from, count };
}

/**
 * "ROWS 1–100 SHOWN · not shown: 1,628 original · 283 reconstructed trials later"
 * with links. hrefFor({rows, from}) builds the link (null drops a key). "Show all"
 * is offered only while the remainder is small enough to render without freezing
 * the page (views re-render on every state revision); otherwise a larger step.
 */
export function pager(page, hrefFor, { step = PAGE_ROWS, hint, noun = "records", key = "rows" } = {}) {
  const before = page.before?.length ?? 0;
  const rest = page.hidden.length;
  if (!before && !rest) return "";
  const shown = page.shown.length;
  const big = step * 5;
  const from = before ? String(page.from) : null;
  const more = (n) => html`<a class="btn" href="${hrefFor({ rows: String(shown + n), from })}" data-pager="more-${String(n)}">Show ${fmtCount(Math.min(n, rest))} more</a>`;
  const earlier = () => {
    const k = Math.min(step, before);
    const nf = page.from - k;
    return html`<a class="btn" href="${hrefFor({ rows: String(shown + k), from: nf > 0 ? String(nf) : "0" })}" data-pager="earlier-${String(k)}">Show ${fmtCount(k)} earlier</a>`;
  };
  const parts = [];
  if (before) parts.push(`${splitText(originSplit(page.before), noun)} earlier`);
  if (rest) parts.push(`${splitText(originSplit(page.hidden), noun)}${before ? " later" : ""}`);
  return html`<div class="rsb-pager" data-pager-for="${key}" data-rows-from="${String(page.from)}" data-rows-shown="${String(shown)}" data-rows-before="${String(before)}" data-rows-hidden="${String(rest)}">
    <span class="rsb-pager__k">ROWS ${fmtCount(page.from + 1)}–${fmtCount(page.from + shown)} SHOWN</span>
    <span class="rsb-pager__rest">not shown: ${parts.join(" · ")}${hint ? html` · ${hint}` : ""}</span>
    <span class="rsb-pager__go">
      ${before ? earlier() : ""}
      ${rest ? more(step) : ""}
      ${rest && !before ? (rest <= big - step ? html`<a class="btn" href="${hrefFor({ rows: "all", from: null })}" data-pager="all">Show all</a>` : more(big)) : ""}
    </span>
  </div>`;
}

/** Current query with one key replaced (null drops it), as a route href. */
export function withQuery(path, query, patch) {
  return qhref(path, { ...query, ...patch });
}

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
 * With connected=false the registry itself is unavailable: the cell names the
 * source status (NOT CONNECTED / NOT PRODUCED / CONTRACT ERROR / UNREADABLE).
 */
export function checkCell(check, key, { connected = true, src } = {}) {
  const def = CHECK_BY_KEY[key];
  const state = check?.state ?? (connected ? "NOT_REPORTED" : offState(src));
  const text = check || connected ? humanize(state) : sourceShort(src);
  const tip = `${def?.label ?? key}: ${text}${check?.detail ? " — " + check.detail : ""}${check?.checked_at ? " · checked " + fmtDateTime(check.checked_at) : ""}`;
  return html`<span class="${cx("rsb-cell", toneClass(check?.state), !check && "rsb-cell--nr")}" data-check="${key}" data-state="${state}" title="${tip}">${text}</span>`;
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
