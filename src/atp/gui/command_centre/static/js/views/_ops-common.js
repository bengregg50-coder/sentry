// Shared helpers for the operations views (Portfolio, Risk, Execution, Live
// Engine). Everything rendered here comes from the snapshot: the ops documents
// (portfolio.json / risk.json / execution.json / live.json), agents.json and
// derived.*. Nothing is estimated, summed across sources or defaulted.
//
// Conventions:
//  * source not connected  -> sourceEmpty / "NOT CONNECTED" (never zero)
//  * connected, nothing    -> "None recorded"-style empty state; a real 0 is a fact
//  * value not reported    -> val(null)

import { html, raw, cx } from "../core/html.js";
import { isNil, fmtNum, fmtCount, fmtDateTime, fmtAge, fmtMetric, humanize, pad2 } from "../core/format.js";
import { source, derived, sourceShort, sourceReason } from "../core/state.js";
import { toneClass } from "../core/tones.js";
import { badge, dot, chip, val, metric, basisChip, meter, emptyState, sourceEmpty, sourceTag } from "../components/ui.js";
import { icon } from "../components/icons.js";
import { mountCharts } from "../components/chart.js";

export const SLOTS = [1, 2, 3, 4, 5];

export const slotName = (n) => `AGENT ${pad2(n)}`;

/* ------------------------------------------------------------------ values */

/**
 * Metric KPI tile (stat layout). The value sits on one line and the basis /
 * component / cost-multiplier chips on a fixed second line, so tiles align
 * whether or not a value is present.
 */
export function metricStat(label, m, { hint, emptyLabel = "NOT REPORTED", attr } = {}) {
  const empty = isNil(m);
  const f = fmtMetric(m ?? null);
  return html`<div class="stat ops-mstat" ${attr ? html`data-ops-metric="${attr}"` : ""}>
    <div class="stat__label">${label}</div>
    <div class="${cx("stat__value", empty && "is-empty")}">${
      empty ? val(null) : html`<span class="v" data-v>${f.text}${f.suffix ? html`<span class="unit"> ${f.suffix}</span>` : ""}</span>`
    }</div>
    <div class="ops-mstat__chips">${empty ? "" : html`${basisChip(f.basis)}${f.component ? chip(f.component) : ""}${f.mult ? chip(`${f.mult}× COST`) : ""}`}</div>
    <div class="stat__hint">${empty ? html`<span class="nodata">${emptyLabel}</span>` : hint ?? ""}</div>
  </div>`;
}

/** Plain KPI tile with the same rhythm as metricStat (empty chip line). */
export function plainStat(label, value, { hint, emptyLabel = "NOT REPORTED", attr } = {}) {
  const empty = isNil(value) || value === "";
  return html`<div class="stat ops-mstat" ${attr ? html`data-ops-stat="${attr}"` : ""}>
    <div class="stat__label">${label}</div>
    <div class="${cx("stat__value", empty && "is-empty")}">${empty ? val(null) : val(value)}</div>
    <div class="ops-mstat__chips"></div>
    <div class="stat__hint">${empty ? html`<span class="nodata">${emptyLabel}</span>` : hint ?? ""}</div>
  </div>`;
}

/** Inline metric that never wraps its chips (table cells, exposure rows). */
export function mcell(m) {
  return html`<span class="ops-m">${metric(m ?? null)}</span>`;
}

const LIMIT_UNIT = { ratio: ["", 2], pct: ["%", 2], bps: ["bps", 1], count: ["", 0], currency: ["CCY", 2], contracts: ["ct", 0] };

/** A plain number with a RiskLimit unit (risk limits carry no Metric envelope). */
export function unitVal(v, unit) {
  if (isNil(v)) return val(null);
  const [suffix, dp] = LIMIT_UNIT[unit] ?? ["", 2];
  return val(fmtNum(v, dp), { unit: suffix ? ` ${suffix}` : "" });
}

/** Plain float with a fixed suffix (ms, bps). */
export function numVal(v, dp, suffix) {
  if (isNil(v)) return val(null);
  return val(fmtNum(v, dp), { unit: suffix ? ` ${suffix}` : "" });
}

export function countVal(v) {
  return isNil(v) ? val(null) : val(fmtCount(v));
}

export function priceVal(v) {
  if (isNil(v)) return val(null);
  return val(Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 6 }));
}

export function qtyVal(v) {
  if (isNil(v)) return val(null);
  return val(Number(v).toLocaleString("en-GB", { maximumFractionDigits: 4 }));
}

/** Timestamp with a live-updating relative age (main.js refreshes [data-age]). */
export function ageVal(iso, now) {
  if (isNil(iso)) return val(null);
  return html`<span class="v ops-age" data-v><span data-age="${iso}">${fmtAge(iso, now)}</span><span class="ops-age__abs">${fmtDateTime(iso)}</span></span>`;
}

export function timeVal(iso) {
  return isNil(iso) ? val(null) : html`<span class="v mono" data-v>${fmtDateTime(iso)}</span>`;
}

/* ------------------------------------------------------------------ bars */

/**
 * Horizontal bar on a shared scale. A purely visual restatement of a value the
 * row already prints; scale = largest |value| in the group. Signed groups draw
 * from a centre line so negative values extend left.
 */
export function hbar(v, maxAbs, { signed = false, kind = "a", label } = {}) {
  const cls = cx("ops-hbar", signed && "ops-hbar--signed", `ops-hbar--${kind === "b" ? "b" : "a"}`);
  if (isNil(v) || !maxAbs) return html`<div class="${cls} is-empty" data-v data-empty="1" aria-hidden="true"></div>`;
  const frac = Math.min(1, Math.abs(Number(v)) / maxAbs);
  const width = signed ? frac * 50 : frac * 100;
  const left = signed ? (v >= 0 ? 50 : 50 - width) : 0;
  return html`<div class="${cls}" data-v ${label ? html`aria-label="${label}"` : ""}><i style="left:${raw(left.toFixed(2))}%;width:${raw(Math.max(width, 0.6).toFixed(2))}%"></i></div>`;
}

export function scaleOf(values) {
  const nums = values.filter((x) => !isNil(x)).map(Number);
  if (!nums.length) return { maxAbs: 0, signed: false };
  return { maxAbs: Math.max(...nums.map(Math.abs)), signed: nums.some((x) => x < 0) };
}

/* ------------------------------------------------------------------ risk limits */

/** One declared risk limit: label, state, meter (used vs limit), numbers. */
export function limitRow(l, { compact = false } = {}) {
  return html`<div class="${cx("ops-limit", compact && "ops-limit--compact", toneClass(l.state))}" data-limit="${l.key}" data-state="${l.state}">
    <div class="ops-limit__head">
      <span class="ops-limit__label">${l.label}</span>
      <span class="ops-limit__key">${l.key}</span>
      ${badge(l.state)}
    </div>
    ${meter(l.used, l.limit, { state: l.state })}
    <div class="ops-limit__nums">
      <span><span class="ops-k">USED</span>${unitVal(l.used, l.unit)}</span>
      <span><span class="ops-k">LIMIT</span>${unitVal(l.limit, l.unit)}</span>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ connections */

export function connectionList(conns, { now, empty } = {}) {
  if (!conns || conns.length === 0) return empty ?? emptyState({ title: "No connections declared", compact: true, iconName: "link" });
  return html`<div class="ops-conns">
    ${conns.map(
      (c) => html`<div class="ops-conn" data-connection="${c.name}" data-state="${c.state}">
        ${dot(c.state, { pulse: c.state === "CONNECTED" })}
        <div class="ops-conn__main">
          <div class="ops-conn__name">${c.name}</div>
          ${c.detail ? html`<div class="ops-conn__detail">${c.detail}</div>` : ""}
        </div>
        <span class="ops-conn__kind">${humanize(c.kind)}</span>
        ${badge(c.state)}
        <span class="ops-conn__hb">${c.last_heartbeat ? html`<span data-age="${c.last_heartbeat}" title="${fmtDateTime(c.last_heartbeat)}">${fmtAge(c.last_heartbeat, now)}</span>` : html`<span class="faint">NO HEARTBEAT</span>`}</span>
      </div>`,
    )}
  </div>`;
}

/* ------------------------------------------------------------------ agent slots */

/** Slot head used in per-agent ops grids: id + derived status. */
export function slotHead(slot) {
  const status = slot?.status ?? "NOT_REPORTED";
  return html`<a class="ops-slot__head" href="#/agents/${slot.slot}">
    <span class="ops-slot__id">${slotName(slot.slot)}</span>${dot(status)}${badge(status)}
  </a>`;
}

/** Why an agent slot has nothing to show, from derived.agent_slots. Short: shown five times. */
export function slotAbsence(ctx, slot) {
  const agentsSrc = source(ctx, "agents");
  if (!derived(ctx, "agent_slots") || agentsSrc?.status !== "OK")
    return { title: `agents.json ${sourceShort(agentsSrc)}`, reason: "Appears once the agent runtime produces agents.json." };
  if (!slot.reported) return { title: "Slot not reported", reason: "agents.json does not report this slot." };
  return null;
}

/* ------------------------------------------------------------------ provenance */

/** Where the page's values come from: one card per contract document. */
export function provenance(ctx, keys) {
  return html`<div class="ops-prov">
    ${keys.map((k) => {
      const src = source(ctx, k);
      const m = src?.meta;
      return html`<div class="ops-prov__row" data-prov="${k}">
        <div class="ops-prov__tag">${sourceTag(src, { now: ctx.now })}</div>
        ${m
          ? html`<div class="ops-prov__meta">
              <span><span class="ops-k">PRODUCER</span><span class="mono text-2">${m.producer}</span></span>
              <span><span class="ops-k">GENERATED</span><span class="mono text-2">${fmtDateTime(m.generated_at)}</span></span>
              <span><span class="ops-k">ORIGIN</span><span class="mono text-2">${humanize(m.origin)}</span></span>
            </div>`
          : html`<div class="ops-prov__reason">${sourceReason(src) ?? ""}</div>`}
        ${m?.notes?.length ? html`<div class="ops-prov__notes">${m.notes.map((n) => html`<span>${n}</span>`)}</div>` : ""}
      </div>`;
    })}
  </div>`;
}

/**
 * Display state for a document that is not available: a broken source keeps
 * its own (red) status; anything else is NOT_CONNECTED. Label via sourceShort.
 */
export function absentState(src) {
  return src?.status === "INVALID" || src?.status === "UNREADABLE" ? src.status : "NOT_CONNECTED";
}

/** Compact "source unavailable" body for a panel. */
export function absent(ctx, key, opts = {}) {
  return sourceEmpty(source(ctx, key), { compact: true, ...opts });
}

/** Column header strip shown above an empty list so the structure stays visible. */
export function ghostHead(cols, { cls } = {}) {
  return html`<div class="${cx("ops-ghost-head", cls)}">${cols.map((c) => html`<span>${c}</span>`)}</div>`;
}

export function doctrine(items) {
  return html`<div class="ops-doctrine">${items.map(([b, s]) => html`<div class="ops-doctrine__item">${icon("shield")}<div><b>${b}</b><span>${s}</span></div></div>`)}</div>`;
}

/* ------------------------------------------------------------------ charts */

function browserLocaleInvalid() {
  try {
    new Intl.NumberFormat(navigator.language);
    return false;
  } catch {
    return true;
  }
}

/**
 * Mount this view's charts through the shared mountCharts(). lightweight-charts
 * formats its axes with navigator.language and throws when the browser reports a
 * tag Intl rejects (e.g. "en-US@posix" in some headless environments). Only in
 * that case createChart receives an explicit locale for this synchronous call.
 * Mounted charts leave the shared registry, so the shell's own mountCharts()
 * pass afterwards finds nothing left to mount. (Reported as a shared request.)
 */
export function mountChartsSafe(root) {
  const LW = window.LightweightCharts;
  if (!LW || !browserLocaleInvalid()) return mountCharts(root);
  const patched = Object.assign(Object.create(Object.getPrototypeOf(LW)), LW, {
    createChart: (el, opts = {}) => LW.createChart(el, { ...opts, localization: { ...(opts.localization ?? {}), locale: "en-GB" } }),
  });
  window.LightweightCharts = patched;
  try {
    return mountCharts(root);
  } finally {
    window.LightweightCharts = LW;
  }
}
