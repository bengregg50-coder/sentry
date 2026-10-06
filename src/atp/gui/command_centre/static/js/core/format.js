// Formatting. The cardinal rule: null/undefined is EMPTY, never zero.

export const EMPTY = "—";

export const isNil = (v) => v === null || v === undefined;

export function humanize(v) {
  if (isNil(v)) return EMPTY;
  return String(v).replace(/_/g, " ");
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function fmtCount(n) {
  if (isNil(n)) return EMPTY;
  return Number(n).toLocaleString("en-GB");
}

export function fmtNum(v, dp = 2) {
  if (isNil(v) || Number.isNaN(Number(v))) return EMPTY;
  return Number(v).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtSigned(v, dp = 2) {
  if (isNil(v)) return EMPTY;
  const s = fmtNum(Math.abs(v), dp);
  return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
}

const UNIT_DP = { ratio: 2, pct: 2, bps: 1, count: 0, currency: 2, contracts: 0, ms: 1, days: 0, years: 1 };
const UNIT_SUFFIX = { ratio: "", pct: "%", bps: "bps", count: "", currency: "", contracts: "ct", ms: "ms", days: "d", years: "y" };

/** Format a contract Metric -> {text, suffix, basis, component}. A missing or non-finite value is EMPTY. */
export function fmtMetric(m) {
  if (isNil(m) || isNil(m.value) || !Number.isFinite(Number(m.value))) return { text: EMPTY, suffix: "", basis: m?.basis ?? null, empty: true };
  const dp = UNIT_DP[m.unit] ?? 2;
  let text = fmtNum(m.value, dp);
  let suffix = UNIT_SUFFIX[m.unit] ?? "";
  if (m.unit === "currency") suffix = m.currency || "CCY";
  return { text, suffix, basis: m.basis, component: m.component, empty: false, mult: m.cost_multiplier };
}

/**
 * A contract RiskLimit's number with its unit — one formatter for every page.
 * Currency limits carry their ISO code when declared, else "CCY" with currencyDeclared=false.
 */
export function fmtLimit(value, limit) {
  if (isNil(value) || !Number.isFinite(Number(value))) return { text: EMPTY, suffix: "", empty: true };
  const unit = limit?.unit;
  const dp = UNIT_DP[unit] ?? 2;
  let suffix = UNIT_SUFFIX[unit] ?? "";
  if (unit === "currency") suffix = limit?.currency || "CCY";
  return { text: fmtNum(value, dp), suffix, empty: false, currencyDeclared: unit !== "currency" || !!limit?.currency };
}

export function fmtDate(iso) {
  if (isNil(iso)) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 10);
}

export function fmtDateTime(iso) {
  if (isNil(iso)) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

export function fmtTime(iso) {
  if (isNil(iso)) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(11, 19);
}

export function fmtAge(iso, now = Date.now()) {
  if (isNil(iso)) return EMPTY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return EMPTY;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtBytes(n) {
  if (isNil(n)) return EMPTY;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function shortHash(h, n = 10) {
  if (isNil(h)) return EMPTY;
  return String(h).length > n ? String(h).slice(0, n) + "…" : String(h);
}

export function agentName(slot) {
  return `AGENT ${pad2(slot)}`;
}
