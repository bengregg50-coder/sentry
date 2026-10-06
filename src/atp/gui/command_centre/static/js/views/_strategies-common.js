// Strategies group — shared helpers for strategies-library.js and strategy-detail.js.
// Presentation only: filters, row counting, links and small renderers. Every
// value shown comes from the snapshot; nothing here decides research outcomes.

import { html, raw, cx } from "../core/html.js";
import { isNil, fmtCount, fmtDate, humanize, pad2 } from "../core/format.js";
import { toneClass } from "../core/tones.js";
import { val, metric, emptyState, originBadge } from "../components/ui.js";

/* ---------------------------------------------------------------- vocabulary (architecture labels) */

/** Strategy status lifecycle, in order. RETIRED / REJECTED are terminals. */
export const LIFECYCLE = ["CANDIDATE", "IN_VALIDATION", "VALIDATED", "APPROVED", "DEPLOYED_SIM", "DEPLOYED_LIVE", "SCALED"];
export const TERMINALS = ["REJECTED", "RETIRED"];
export const STATUS_LABEL = {
  CANDIDATE: "CANDIDATE",
  IN_VALIDATION: "IN VALIDATION",
  VALIDATED: "VALIDATED",
  APPROVED: "APPROVED",
  DEPLOYED_SIM: "DEPLOYED SIM",
  DEPLOYED_LIVE: "DEPLOYED LIVE",
  SCALED: "SCALED",
  REJECTED: "REJECTED",
  RETIRED: "RETIRED",
};

export const ORIGINS = ["ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"];
export const ORIGIN_SHORT = { ORIGINAL: "ORIG", RECONSTRUCTED: "RECON", SYNTHETIC_FIXTURE: "SYNTH" };

const DEPLOYED = ["DEPLOYED_SIM", "DEPLOYED_LIVE", "SCALED"];
export const ENDED = ["RETIRED", "REJECTED"];

/**
 * Library filters. Definitions are presentation filters over declared status;
 * they mirror derive.research_summary exactly so tab counts and rows agree.
 */
export const FILTERS = {
  all: {
    key: "all",
    path: "/strategies",
    tab: "All",
    title: "Strategy Library",
    summaryKey: "strategies_total",
    definition: "Every registered strategy, including REJECTED and RETIRED — failures stay on the record.",
    sub: "Every strategy SENTRY has registered — candidates, validated, deployed, retired and rejected — with its current immutable version, validation status and evidence-basis headline figures.",
    test: () => true,
  },
  candidates: {
    key: "candidates",
    path: "/strategies/candidates",
    tab: "Candidates",
    title: "Candidate Strategies",
    summaryKey: "candidates",
    definition: "Status CANDIDATE or IN VALIDATION.",
    sub: "Strategies the research engine has registered but not yet validated. A candidate has earned nothing: it is a hypothesis with a specification.",
    test: (s) => s.status === "CANDIDATE" || s.status === "IN_VALIDATION",
  },
  validated: {
    key: "validated",
    path: "/strategies/validated",
    tab: "Validated",
    title: "Validated Strategies",
    summaryKey: "validated",
    definition: "Current version's validation status is VALIDATED, and the strategy is not RETIRED or REJECTED.",
    sub: "Strategies whose current version the research engine has declared VALIDATED. Only these can proceed to governance approval and an agent.",
    test: (s, v) => v?.validation_status === "VALIDATED" && !ENDED.includes(s.status),
  },
  deployed: {
    key: "deployed",
    path: "/strategies/deployed",
    tab: "Deployed",
    title: "Deployed Strategies",
    summaryKey: "deployed",
    definition: "Status DEPLOYED SIM, DEPLOYED LIVE or SCALED.",
    sub: "Strategies the registry declares deployed. Whether an agent is actually running one is reported by the agent runtime, not by this list. Policy: simulation first; live only with a LIVE-scope governance approval.",
    test: (s) => DEPLOYED.includes(s.status),
  },
  retired: {
    key: "retired",
    path: "/strategies/retired",
    tab: "Retired",
    title: "Retired Strategies",
    summaryKey: "retired",
    definition: "Status RETIRED — previously deployed, then withdrawn.",
    sub: "Strategies withdrawn from deployment. They remain on the record with every version, check and decision intact.",
    test: (s) => s.status === "RETIRED",
  },
};
export const FILTER_ORDER = ["all", "candidates", "validated", "deployed", "retired"];

/* ---------------------------------------------------------------- validation checks (contract keys) */

export const CHECK_GROUPS = [
  {
    key: "oos",
    label: "Out-of-sample evidence",
    checks: [
      ["out_of_sample", "Out-of-sample", "Holds on data never used to build or select it"],
      ["walk_forward", "Walk-forward", "Holds when re-fitted and tested forward in time"],
      ["monte_carlo", "Monte Carlo", "Survives resampling of trade sequence and returns"],
    ],
  },
  {
    key: "robust",
    label: "Robustness",
    checks: [
      ["robustness", "Robustness", "Survives perturbation of data and specification"],
      ["parameter_stability", "Parameter stability", "A plateau, not a knife-edge optimum"],
      ["regime_analysis", "Regime analysis", "Behaviour across market regimes is understood"],
    ],
  },
  {
    key: "econ",
    label: "Economics & costs",
    checks: [
      ["economic_rationale", "Economic rationale", "A causal reason the effect should exist"],
      ["positive_expectancy", "Positive expectancy", "Expectancy above zero after every cost"],
      ["realistic_costs", "Realistic costs", "Commission, spread and slippage modelled realistically"],
      ["cost_sensitivity", "Cost sensitivity", "Survives stressed (multiplied) costs"],
    ],
  },
  {
    key: "stats",
    label: "Execution & statistics",
    checks: [
      ["execution_realism", "Execution realism", "Fills, latency and capacity that can be achieved"],
      ["multiple_testing", "Multiple testing", "Significance corrected for every trial in the family"],
      ["sample_size", "Sample size", "Enough independent observations to support the claim"],
    ],
  },
];
export const CHECK_KEYS = CHECK_GROUPS.flatMap((g) => g.checks.map((c) => c[0]));

/* ---------------------------------------------------------------- links */

export function qhref(path, query) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (!isNil(v) && v !== "") q.set(k, String(v));
  const qs = q.toString();
  return `#${path}${qs ? "?" + qs : ""}`;
}
export const strategyHref = (id, v) => qhref(`/strategy/${encodeURIComponent(id)}`, { v });
export const agentHref = (slot) => `#/agents/${encodeURIComponent(slot)}`;
export const memoryHref = (id) => `#/memory/item/${encodeURIComponent(id)}`;
export const hypHref = (id) => `#/research/hypotheses?focus=${encodeURIComponent(id)}`;
export const trialHref = (id) => `#/research/history?focus=${encodeURIComponent(id)}`;
export const programmeHref = (id) => `#/research/history?programme=${encodeURIComponent(id)}`;

/** "FX-S003@1" -> {id, version}. Version is null when the ref carries none. */
export function parseVersionRef(ref) {
  const [id, v] = String(ref).split("@");
  return { id, version: v && /^\d+$/.test(v) ? Number(v) : null };
}

/**
 * Link for a lineage reference. Proposals resolve to the owning strategy's
 * page (where the proposal row is highlighted); documents and literature are
 * plain references.
 */
export function lineageHref(l, proposals) {
  switch (l.kind) {
    case "HYPOTHESIS":
      return hypHref(l.ref);
    case "TRIAL":
      return trialHref(l.ref);
    case "MEMORY":
      return memoryHref(l.ref);
    case "PROGRAMME":
      return programmeHref(l.ref);
    case "STRATEGY_VERSION": {
      const { id, version } = parseVersionRef(l.ref);
      return strategyHref(id, version);
    }
    case "PROPOSAL": {
      const p = proposals?.find((x) => x.proposal_id === l.ref);
      return p ? qhref(`/strategy/${encodeURIComponent(p.strategy_id)}`, { proposal: p.proposal_id }) : null;
    }
    default:
      return null;
  }
}

export function refLink(text, href) {
  if (isNil(text) || text === "") return val(null);
  return href ? html`<a class="ref" href="${href}">${text}</a>` : html`<span class="ref st-ref--plain">${text}</span>`;
}

/** Agent slot link. `title` carries a raw producer reference (e.g. "agent:02") without repeating it on screen. */
export function agentLink(slot, { title } = {}) {
  if (isNil(slot)) return val(null);
  return html`<a class="ref" href="${agentHref(slot)}" ${title ? html`title="${title}"` : ""}>AGENT ${pad2(slot)}</a>`;
}

/* ---------------------------------------------------------------- row counting, never merged across origin */

/** Count rows per record origin. null rows => null (source not connected). */
export function originSplit(rows) {
  if (!rows) return null;
  const out = { ORIGINAL: 0, RECONSTRUCTED: 0, SYNTHETIC_FIXTURE: 0 };
  for (const r of rows) {
    const o = r?.origin;
    out[o] = o in out ? out[o] + 1 : 1; // row counter, one per record
  }
  return out;
}

/** Origins with at least one record, in canonical order. */
export function splitParts(split) {
  if (!split) return [];
  const present = Object.keys(split).filter((o) => split[o] > 0);
  return present.length ? present.sort((a, b) => ORIGINS.indexOf(a) - ORIGINS.indexOf(b)) : [];
}

/**
 * Render an origin split: one number per origin present, each tagged unless
 * ORIGINAL. All-zero renders a single real "0" (connected, none recorded).
 */
export function splitVal(split, { cls } = {}) {
  if (!split) return val(null, { cls });
  const parts = splitParts(split);
  if (!parts.length) return html`<span class="${cx("st-split", cls)}">${val(fmtCount(0))}</span>`;
  return html`<span class="${cx("st-split", cls)}">${parts.map(
    (o) => html`<span class="st-split__n" title="${fmtCount(split[o])} ${humanize(o).toLowerCase()} record(s), counted separately">${val(fmtCount(split[o]))}${
      o === "ORIGINAL" ? "" : html`<span class="st-split__tag ${originTone(o)}">${ORIGIN_SHORT[o] ?? o}</span>`
    }</span>`,
  )}</span>`;
}

/** Tone class for an origin tag — same semantics as originBadge(): synthetic is flagged red, reconstructed amber. */
export function originTone(o) {
  return toneClass(o === "SYNTHETIC_FIXTURE" ? "INVALID" : o);
}

/** Plain-text split for SVG labels: [{n, tag}] */
export function splitList(split) {
  const parts = splitParts(split);
  if (!split) return null;
  if (!parts.length) return [{ n: 0, tag: null, origin: null }];
  return parts.map((o) => ({ n: split[o], tag: o === "ORIGINAL" ? null : ORIGIN_SHORT[o] ?? o, origin: o }));
}

/**
 * Origin field: the shared originBadge() for non-ORIGINAL records (same label as the
 * page-head source tag, e.g. SYNTHETIC FIXTURE), a plain mono label for ORIGINAL
 * (never an empty dash).
 */
export function originCell(origin) {
  if (isNil(origin)) return val(null);
  if (origin === "ORIGINAL") return html`<span class="st-origin-plain">ORIGINAL</span>`;
  return originBadge(origin);
}

/* ---------------------------------------------------------------- metric rendering */

export function windowText(m) {
  if (!m) return "";
  if (m.window_start || m.window_end) return `${m.window_start ? fmtDate(m.window_start) : "…"} → ${m.window_end ? fmtDate(m.window_end) : "…"}`;
  return "";
}

/** Metric tile: label, contract Metric via metric() (basis chip always shown), window / source. */
export function metricTile(label, m, { key, hint, emptyHint = "NOT REPORTED" } = {}) {
  const w = windowText(m);
  return html`<div class="st-mt" data-metric="${key ?? ""}" data-basis="${m?.basis ?? ""}">
    <div class="st-mt__k">${label}</div>
    <div class="st-mt__v">${metric(m)}</div>
    <div class="st-mt__h">${
      m
        ? html`${w ? html`<span class="mono">${w}</span>` : hint ?? ""}${m.source_ref ? html` <span class="ref st-ref--plain">${m.source_ref}</span>` : ""}`
        : html`<span class="st-nodata">${emptyHint}</span>`
    }</div>
  </div>`;
}

/* ---------------------------------------------------------------- table that keeps its structure when empty */

/**
 * columns: [{label, render(row) -> Safe|string|null, cls?, num?, title?}]
 * rows: array | null. When empty, the header row stays and `empty` fills the body,
 * so the reader sees exactly which fields will appear.
 */
export function regTable({ columns, rows, empty, rowHref, rowAttrs, rowCls, cls, maxHeight }) {
  const has = Array.isArray(rows) && rows.length > 0;
  return html`<div class="${cx("table-wrap st-tw", cls)}" ${maxHeight ? raw(`style="max-height:${Number(maxHeight)}px"`) : ""}>
    <table class="table table--dense st-table ${has ? "" : "is-empty"}">
      <thead><tr>${columns.map((c) => html`<th class="${cx(c.num && "num", c.hcls)}" ${c.title ? html`title="${c.title}"` : ""}>${c.label}</th>`)}</tr></thead>
      <tbody>
        ${has
          ? rows.map((r) => {
              const href = rowHref ? rowHref(r) : null;
              return html`<tr ${href ? html`data-href="${href}"` : ""} class="${rowCls ? rowCls(r) : ""}" ${rowAttrs ? rowAttrs(r) : ""}>${columns.map((c) => {
                const v = c.render(r);
                return html`<td class="${cx(c.num && "num", c.cls)}">${isNil(v) || v === "" ? val(null) : v}</td>`;
              })}</tr>`;
            })
          : html`<tr class="st-table__empty"><td colspan="${String(columns.length)}">${empty ?? emptyState({ title: "None recorded", compact: true })}</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

/**
 * Mark every .st-tw scroller that overflows horizontally with data-overflow="left|right|left right",
 * which v-strategies.css turns into a faded edge, so off-screen columns are never hidden silently.
 * Returns the cleanup for the view's mount().
 */
export function mountOverflowEdges(root) {
  const wraps = [...root.querySelectorAll(".st-tw")];
  if (!wraps.length) return null;
  const update = (el) => {
    const max = el.scrollWidth - el.clientWidth;
    const parts = [];
    if (max > 1 && el.scrollLeft > 1) parts.push("left");
    if (max > 1 && max - el.scrollLeft > 1) parts.push("right");
    if (parts.length) el.dataset.overflow = parts.join(" ");
    else delete el.dataset.overflow;
  };
  const onScroll = (e) => update(e.currentTarget);
  const all = () => wraps.forEach(update);
  wraps.forEach((el) => el.addEventListener("scroll", onScroll, { passive: true }));
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(all) : null;
  wraps.forEach((el) => {
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
  });
  all();
  return () => {
    ro?.disconnect();
    wraps.forEach((el) => el.removeEventListener("scroll", onScroll));
  };
}

/* ---------------------------------------------------------------- misc */

export function label(text, extra) {
  return html`<div class="st-label">${text}${extra ? html`<span class="st-label__extra">${extra}</span>` : ""}</div>`;
}

export function byStrategyId(a, b) {
  return String(a.s.strategy_id).localeCompare(String(b.s.strategy_id), "en", { numeric: true });
}

export function plural(n, one, many) {
  return n === 1 ? one : many;
}
