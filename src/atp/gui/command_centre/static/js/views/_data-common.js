// Shared helpers for the data views (Datasets, State Sources, Insights).
// Everything rendered comes from the snapshot (documents / sources / derived).
// Nothing is estimated, defaulted or inferred:
//  * source not connected  -> sourceEmpty / NOT CONNECTED
//  * connected, nothing    -> "None declared"-style empty state (a real 0 is a fact)
//  * value not reported    -> val(null)

import { html, cx } from "../core/html.js";
import { isNil, humanize } from "../core/format.js";
import { doc } from "../core/state.js";
import { val } from "../components/ui.js";

/** Contract payload model per document key (architecture labels from schemas.py). */
export const PAYLOAD_MODEL = {
  system: "SystemState",
  research: "ResearchState",
  strategies: "StrategiesState",
  agents: "AgentsState",
  memory: "MemoryState",
  governance: "GovernanceDoc",
  datasets: "DatasetsState",
  portfolio: "PortfolioState",
  risk: "RiskState",
  execution: "ExecutionState",
  live: "LiveEngineState",
  insights: "InsightsState",
  agent_events: "AgentEvent · one per line",
};

/** Source statuses in display order (provider.SourceStatus). */
export const SOURCE_STATUSES = ["OK", "MISSING", "INVALID", "UNREADABLE", "NOT_CONFIGURED"];

/** Record origins (schemas.Origin). Counts of different origins are never merged. */
export const ORIGINS = ["ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"];

export const ORIGIN_LABEL = { ORIGINAL: "Original", RECONSTRUCTED: "Reconstructed", SYNTHETIC_FIXTURE: "Synthetic fixture" };

/** Local URL of a contract JSON Schema served by the read-only API. */
export function schemaHref(key) {
  return `/api/cc/contract/${key === "agent_events" ? "agent_event" : key}.schema.json`;
}

export function schemaFile(key) {
  return `${key === "agent_events" ? "agent_event" : key}.schema.json`;
}

/** "YYYY-MM-DD" (or ISO datetime) -> UTC epoch ms, or null. Never guesses. */
export function parseDay(s) {
  if (isNil(s)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Day string exactly as declared (date part only). */
export function dayText(s) {
  if (isNil(s)) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s));
  return m ? m[1] : String(s);
}

/** Count rows by a key function. Returns a Map in first-seen order. */
export function countBy(rows, fn) {
  const out = new Map();
  for (const r of rows ?? []) {
    const k = fn(r);
    out.set(k, out.has(k) ? out.get(k) + 1 : 1);
  }
  return out;
}

/** Number of rows matching a predicate (a connected source with no match yields a real 0). */
export function countWhere(rows, pred) {
  let n = 0;
  for (const r of rows ?? []) if (pred(r)) n++;
  return n;
}

/**
 * Resolve a reference id to an in-app link, but only when the id exists in
 * connected state. Unknown references are rendered as plain text, never guessed.
 */
export function refResolver(ctx) {
  const research = doc(ctx, "research");
  const mem = new Set((doc(ctx, "memory")?.memories ?? []).map((m) => m.memory_id));
  const strat = new Set((doc(ctx, "strategies")?.strategies ?? []).map((s) => s.strategy_id));
  const hyp = new Set((research?.hypotheses ?? []).map((h) => h.hypothesis_id));
  const trial = new Set((research?.trials ?? []).map((t) => t.trial_id));
  return (ref) => {
    if (isNil(ref)) return null;
    const id = String(ref);
    const base = id.split("@")[0];
    if (mem.has(id)) return `#/memory/item/${encodeURIComponent(id)}`;
    if (strat.has(base)) return `#/strategy/${encodeURIComponent(base)}`;
    if (hyp.has(id)) return `#/research/hypotheses?focus=${encodeURIComponent(id)}`;
    if (trial.has(id)) return `#/research/history?focus=${encodeURIComponent(id)}`;
    return null;
  };
}

/** Reference chips; links only to records that exist. */
export function refChips(refs, resolve, { empty } = {}) {
  if (!refs || refs.length === 0) return empty ?? val(null);
  return html`<span class="dat-refs">${refs.map((r) => {
    const href = resolve ? resolve(r) : null;
    return href ? html`<a class="ref" href="${href}">${r}</a>` : html`<span class="ref ref--plain">${r}</span>`;
  })}</span>`;
}

/** Small uppercase key label used inside panels. */
export function k(text, cls) {
  return html`<span class="${cx("dat-k", cls)}">${text}</span>`;
}

/** Faint uppercase "none" line for connected-but-empty lists. */
export function none(text) {
  return html`<span class="dat-none">${text}</span>`;
}

/** Shell-style code line. Text only (escaped). */
export function codeLine(cmd, note) {
  return html`<div class="dat-code"><code><span class="dat-code__p">$</span>${cmd}</code>${note ? html`<span class="dat-code__note">${note}</span>` : ""}</div>`;
}

export function label(v) {
  return humanize(v);
}

/**
 * Title for an unavailable source that names its real status — a MISSING or
 * INVALID document is never described as "not connected".
 */
export function offTitle(src, what) {
  switch (src?.status) {
    case "MISSING":
      return `${what} not produced`;
    case "INVALID":
      return `${what} rejected by the contract`;
    case "UNREADABLE":
      return `${what} unreadable`;
    default:
      return `${what} not connected`;
  }
}
