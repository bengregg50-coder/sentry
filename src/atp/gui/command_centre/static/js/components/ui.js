// Core building blocks. Every value-rendering helper marks its node with
// data-v and adds .is-empty when the value is absent, so tests can assert
// that nothing is displayed without a source.

import { html, raw, cx } from "../core/html.js";
import { EMPTY, isNil, fmtMetric, fmtAge, humanize } from "../core/format.js";
import { toneOf, toneClass, severityTone } from "../core/tones.js";
import { sourceReason, sourceShort } from "../core/state.js";
import { icon } from "./icons.js";

/* ---------------- page header ---------------- */

export function pageHeader({ kicker, code, title, sub, right }) {
  return html`<header class="page-head">
    <div class="page-head__main">
      <div class="page-head__kicker">${code ? html`<span class="code">${code}</span><span class="code">//</span>` : ""}${kicker ?? ""}</div>
      <h1 class="page-head__title">${title}</h1>
      ${sub ? html`<p class="page-head__sub">${sub}</p>` : ""}
    </div>
    ${right ? html`<div class="page-head__right">${right}</div>` : ""}
  </header>`;
}

/* ---------------- panel ---------------- */

export function panel({ title, code, sub, actions, body, foot, cls, span, id, variant }) {
  const classes = cx("panel", variant && `panel--${variant}`, span && `span-${span}`, cls);
  return html`<section class="${classes}" ${id ? html`id="${id}"` : ""}>
    ${title || code || actions
      ? html`<header class="panel__head">
          ${code ? html`<span class="panel__code">${code}</span>` : ""}
          ${title ? html`<h2 class="panel__title">${title}</h2>` : ""}
          ${sub ? html`<span class="panel__sub">${sub}</span>` : ""}
          ${actions ? html`<div class="panel__actions">${actions}</div>` : ""}
        </header>`
      : ""}
    <div class="panel__body">${body}</div>
    ${foot ? html`<footer class="panel__foot">${foot}</footer>` : ""}
  </section>`;
}

/* ---------------- badges ---------------- */

export function badge(state, { label, size, ghost, title } = {}) {
  const text = label ?? humanize(state ?? "UNKNOWN");
  return html`<span class="${cx("badge", toneClass(state), size === "lg" && "badge--lg", ghost && "badge--ghost")}" data-state="${state ?? ""}" ${title ? html`title="${title}"` : ""}>${text}</span>`;
}

export function severityBadge(sev) {
  return html`<span class="badge tone-${severityTone(sev)}" data-state="${sev}">${sev}</span>`;
}

export function dot(state, { pulse = false } = {}) {
  const tone = toneOf(state);
  return html`<span class="${cx("dot", `tone-${tone}`, pulse && tone !== "muted" && "dot--pulse")}" data-state="${state ?? ""}"></span>`;
}

export function chip(text, { cls, title } = {}) {
  return html`<span class="${cx("chip", cls)}" ${title ? html`title="${title}"` : ""}>${text}</span>`;
}

const BASIS_SHORT = {
  IN_SAMPLE: "IS",
  OUT_OF_SAMPLE: "OOS",
  WALK_FORWARD: "WF",
  MONTE_CARLO: "MC",
  SIMULATION: "SIM",
  PAPER: "PAPER",
  LIVE: "LIVE",
};

export function basisChip(basis) {
  if (!basis) return "";
  return html`<span class="chip chip--basis" title="${"Basis: " + humanize(basis)}">${BASIS_SHORT[basis] ?? basis}</span>`;
}

export function originBadge(origin, { showOriginal = false } = {}) {
  if (!origin) return "";
  if (origin === "ORIGINAL") return showOriginal ? html`<span class="badge badge--ghost tone-muted" data-state="ORIGINAL">ORIGINAL</span>` : "";
  if (origin === "SYNTHETIC_FIXTURE") return html`<span class="badge tone-bad" data-state="SYNTHETIC_FIXTURE">SYNTHETIC FIXTURE</span>`;
  return badge(origin);
}

/* ---------------- values ---------------- */

/** Inline value: null -> faint em dash marked empty. */
export function val(v, { unit, cls } = {}) {
  if (isNil(v) || v === "") return html`<span class="${cx("v is-empty", cls)}" data-v>${EMPTY}</span>`;
  return html`<span class="${cx("v", cls)}" data-v>${v}${unit ? html`<span class="unit">${unit}</span>` : ""}</span>`;
}

/** Inline contract Metric with basis chip. */
export function metric(m, { showBasis = true, showComponent = true } = {}) {
  const f = fmtMetric(m);
  if (f.empty) return html`<span class="v is-empty" data-v>${EMPTY}</span>`;
  return html`<span class="v" data-v>${f.text}${f.suffix ? html`<span class="unit"> ${f.suffix}</span>` : ""}</span>${
    showBasis ? html` ${basisChip(f.basis)}` : ""
  }${showComponent && f.component ? html` <span class="chip chip--component">${f.component}</span>` : ""}${f.mult ? html` <span class="chip chip--mult">${f.mult}× COST</span>` : ""}`;
}

/** KPI tile. value null => empty, with emptyLabel explaining why. */
export function stat({ label, value, unit, hint, emptyLabel = "NO DATA", size, tone, title, basis }) {
  const empty = isNil(value) || value === "";
  return html`<div class="${cx("stat", size && `stat--${size}`)}" ${title ? html`title="${title}"` : ""}>
    <div class="stat__label">${label}</div>
    <div class="${cx("stat__value", empty && "is-empty", tone && `tone-${tone}`)}" data-v ${empty ? html`data-empty="1"` : ""}>
      ${empty ? EMPTY : value}${!empty && unit ? html`<span class="unit">${unit}</span>` : ""}${!empty && basis ? basisChip(basis) : ""}
    </div>
    <div class="stat__hint">${empty ? html`<span class="nodata">${emptyLabel}</span>` : hint ?? ""}</div>
  </div>`;
}

export function statRow(stats, { min } = {}) {
  return html`<div class="stat-row" ${min ? raw(`style="--min:${Number(min)}px"`) : ""}>${stats}</div>`;
}

/* ---------------- empty states ---------------- */

export function emptyState({ title = "No data", reason, hint, iconName = "empty", compact = false, inline = false, code }) {
  return html`<div class="${cx("empty", compact && "empty--compact", inline && "empty--inline")}" data-empty-state="${code ?? title}">
    ${icon(iconName, "empty__icon")}
    <div class="empty__title">${title}</div>
    ${reason ? html`<div class="empty__reason">${reason}</div>` : ""}
    ${hint ? html`<div class="empty__hint">${hint}</div>` : ""}
  </div>`;
}

/** Empty state explaining that a source is unavailable. */
export function sourceEmpty(src, { title, hint, compact = false, iconName } = {}) {
  return emptyState({
    title: title ?? sourceShort(src),
    reason: sourceReason(src),
    hint,
    compact,
    iconName: iconName ?? (src?.status === "INVALID" || src?.status === "UNREADABLE" ? "alert" : "empty"),
    code: `source-${src?.key ?? "unknown"}-${src?.status ?? "none"}`,
  });
}

/* ---------------- sources ---------------- */

export function sourceTag(src, { now } = {}) {
  if (!src) return html`<span class="src tone-muted">SRC <span class="src__state">NO SNAPSHOT</span></span>`;
  const state = src.status === "OK" ? "OK" : src.status;
  const tone = { OK: "info", MISSING: "muted", NOT_CONFIGURED: "muted", INVALID: "bad", UNREADABLE: "bad" }[state] ?? "muted";
  const origin = src.meta?.origin;
  const age = src.meta?.generated_at ? fmtAge(src.meta.generated_at, now) : null;
  return html`<span class="src tone-${tone}" title="${sourceReason(src) ?? src.path ?? src.file}" data-source="${src.key}" data-source-status="${state}">
    <span>SRC</span><span class="src__file">${src.file}</span><span class="src__state">${sourceShort(src)}</span>${
      origin && origin !== "ORIGINAL" ? html` ${originBadge(origin)}` : ""
    }${age ? html`<span>· ${age}</span>` : ""}
  </span>`;
}

/* ---------------- tables ---------------- */

/**
 * columns: [{key, label, render?(row) -> Safe|string, cls?, num?}]
 * rows: array | null (null => source unavailable, pass `empty`)
 */
export function table({ columns, rows, empty, dense = false, rowHref, rowCls, maxHeight, keepFrame = false }) {
  if (!rows || rows.length === 0) {
    const inner = empty ?? emptyState({ title: "None recorded", compact: true });
    if (!keepFrame) return inner;
    // Keep the column structure visible so an empty register still reads as a register.
    return html`<div class="table-wrap"><table class="${cx("table", dense && "table--dense")}">
      <thead><tr>${columns.map((c) => html`<th class="${cx(c.num && "num", c.cls)}">${c.label}</th>`)}</tr></thead>
      <tbody><tr><td colspan="${String(columns.length)}" style="padding:12px">${inner}</td></tr></tbody>
    </table></div>`;
  }
  return html`<div class="table-wrap" ${maxHeight ? raw(`style="max-height:${Number(maxHeight)}px"`) : ""}>
    <table class="${cx("table", dense && "table--dense")}">
      <thead><tr>${columns.map((c) => html`<th class="${cx(c.num && "num", c.cls)}">${c.label}</th>`)}</tr></thead>
      <tbody>
        ${rows.map((r) => {
          const href = rowHref ? rowHref(r) : null;
          return html`<tr ${href ? html`data-href="${href}"` : ""} class="${rowCls ? rowCls(r) : ""}">${columns.map((c) => {
            const v = c.render ? c.render(r) : r[c.key];
            return html`<td class="${cx(c.num && "num", c.cls)}">${isNil(v) || v === "" ? val(null) : v}</td>`;
          })}</tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

/* ---------------- key/value ---------------- */

export function kv(pairs, { cols = 2 } = {}) {
  return html`<div class="kv" style="--cols:${raw(String(Number(cols)))}">
    ${pairs.map(([k, v]) => html`<div class="kv__item"><div class="kv__k">${k}</div><div class="kv__v">${isNil(v) || v === "" ? val(null) : v}</div></div>`)}
  </div>`;
}

/* ---------------- tabs ---------------- */

export function tabs(items, active) {
  return html`<nav class="tabs" role="tablist">
    ${items.map(
      (t) => html`<a class="tab" role="tab" href="${t.href}" aria-selected="${t.key === active ? "true" : "false"}">${t.label}${
        isNil(t.count) ? "" : html`<span class="count">${t.count}</span>`
      }</a>`,
    )}
  </nav>`;
}

/* ---------------- findings / notices ---------------- */

export function findingsList(findings, { limit, empty, moreHref } = {}) {
  if (!findings || findings.length === 0) return empty ?? emptyState({ title: "No findings", compact: true, iconName: "shield" });
  const shown = limit ? findings.slice(0, limit) : findings;
  return html`<div class="findings">
    ${shown.map(
      (f) => html`<div class="finding tone-${severityTone(f.severity)}" data-finding="${f.code}">
        <span>${severityBadge(f.severity)}</span><span class="finding__code">${f.code}</span>
        <div class="finding__msg">${f.message}</div>
      </div>`,
    )}
    ${limit && findings.length > limit
      ? moreHref
        ? html`<a class="small" href="${moreHref}" style="display:inline-block;margin-top:6px">+${findings.length - limit} more →</a>`
        : html`<div class="small muted" style="margin-top:6px">+${findings.length - limit} more</div>`
      : ""}
  </div>`;
}

export function notice({ title, body, tone = "warn", iconName = "alert" }) {
  return html`<div class="notice tone-${tone}">${icon(iconName)}<div><div class="notice__title">${title}</div>${
    body ? html`<div class="notice__body">${body}</div>` : ""
  }</div></div>`;
}

export function integrityNotices(notices) {
  if (!notices || notices.length === 0) return "";
  return html`${notices.map((n) =>
    notice({
      title: n.title,
      tone: severityTone(n.severity),
      body: html`${n.detail ?? ""}${n.occurred_on ? html` <span class="mono muted">[${n.occurred_on}]</span>` : ""}${
        n.reference ? html` <span class="ref">${n.reference}</span>` : ""
      }`,
    }),
  )}`;
}

/* ---------------- controls ---------------- */

/** A control affordance that is disabled with explicit, server-computed blockers. */
export function control(action, iconName = "lock") {
  return html`<div class="control" data-control="${action.key}" data-enabled="${action.enabled ? "1" : "0"}">
    <div class="control__head">${icon(iconName)}<span>${action.label}</span>${badge(action.enabled ? "ENABLED" : "LOCKED", { label: action.enabled ? "ENABLED" : "LOCKED" })}</div>
    ${action.blockers?.length ? html`<ul class="control__blockers">${action.blockers.map((b) => html`<li>${b}</li>`)}</ul>` : ""}
  </div>`;
}

export function controlButton(action, iconName = "lock") {
  const reason = (action.blockers ?? []).join(" · ");
  return html`<button class="btn" type="button" disabled title="${reason}" data-control="${action.key}" data-enabled="${action.enabled ? "1" : "0"}">${icon(iconName)}${action.label}</button>`;
}

/* ---------------- meters ---------------- */

export function meter(used, limit, { state } = {}) {
  if (isNil(used) || isNil(limit) || !limit) return html`<div class="meter is-empty" data-v data-empty="1"></div>`;
  const pct = Math.max(0, Math.min(100, (used / limit) * 100));
  const tone = state ? toneOf(state === "OK" ? "OK" : state) : "info";
  return html`<div class="meter tone-${tone}" data-v><div class="meter__fill" style="width:${raw(pct.toFixed(1))}%"></div></div>`;
}

/* ---------------- misc ---------------- */

export function refLink(text, href) {
  if (isNil(text)) return val(null);
  return href ? html`<a class="ref" href="${href}">${text}</a>` : html`<span class="ref">${text}</span>`;
}

export function refList(refs, hrefFor) {
  if (!refs || refs.length === 0) return val(null);
  return html`<span class="cluster">${refs.map((r) => refLink(r, hrefFor ? hrefFor(r) : null))}</span>`;
}

export function legend(items) {
  return html`<div class="legend">${items.map(([label, tone]) => html`<span><i class="swatch tone-${tone}"></i>${label}</span>`)}</div>`;
}
