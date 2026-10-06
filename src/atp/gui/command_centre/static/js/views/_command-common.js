// Helpers shared by the Command Centre (/) and System Map (/system) views.
// Display-only: they read the snapshot, count rows and choose labels. They
// never compute research verdicts, confidence, eligibility or gate outcomes.

import { html, cx } from "../core/html.js";
import { isNil, fmtCount, humanize } from "../core/format.js";
import { source, sourceShort } from "../core/state.js";
import { toneClass } from "../core/tones.js";
import { badge, dot, val } from "../components/ui.js";
import { icon } from "../components/icons.js";

/** Contract document keys in registry order (schemas.DOCUMENTS). */
export const DOC_KEYS = [
  "system",
  "research",
  "strategies",
  "agents",
  "memory",
  "governance",
  "datasets",
  "portfolio",
  "risk",
  "execution",
  "live",
  "insights",
];

/** Agent statuses that mean a slot is running a strategy (display grouping only). */
export const ACTIVE_AGENT = new Set(["SIMULATING", "PAPER", "LIVE"]);

/**
 * Source status -> display state. A connected source is CONNECTED (cyan), never
 * "OK"/green: being connected is not a passed check.
 */
const SRC_STATE = {
  OK: "CONNECTED",
  NOT_CONFIGURED: "NOT_CONNECTED",
  MISSING: "NOT_PRODUCED",
  INVALID: "INVALID",
  UNREADABLE: "UNREADABLE",
};

export function stateOfStatus(status) {
  if (isNil(status)) return "NO_SNAPSHOT";
  return SRC_STATE[status] ?? status;
}

export function srcState(src) {
  return src ? stateOfStatus(src.status) : "NO_SNAPSHOT";
}

export function isOk(src) {
  return src?.status === "OK";
}

/** Badge for a source, labelled with the shared short status text. */
export function srcBadge(src) {
  return badge(srcState(src), { label: sourceShort(src) });
}

const SHORT = {
  OK: "CONNECTED",
  NOT_CONFIGURED: "NOT CONNECTED",
  MISSING: "NOT PRODUCED",
  INVALID: "CONTRACT ERROR",
  UNREADABLE: "UNREADABLE",
};

/** One line: status dot, file name, short status. Accepts a source object or a key. */
export function srcLine(ctx, key) {
  const src = source(ctx, key);
  const file = src?.file ?? key;
  return html`<li class="cc-srcline" data-source="${key}" data-source-status="${src?.status ?? "NONE"}" title="${src?.path ?? file}">
    ${dot(srcState(src))}<span class="cc-srcline__file">${file}</span><span class="${cx("cc-srcline__state cc-tonetext", toneClass(srcState(src)))}">${sourceShort(src)}</span>
  </li>`;
}

/** Same, from a bare status string (derived.system[].sources values). */
export function statusLine(ctx, key, status) {
  const src = source(ctx, key);
  const file = src?.file ?? (key === "agent_events" ? "agent_events.jsonl" : `${key}.json`);
  return html`<span class="cc-srcchip" data-source="${key}" data-source-status="${status ?? "NONE"}" title="${file}: ${SHORT[status] ?? status ?? "NO SNAPSHOT"}">
    ${dot(stateOfStatus(status))}<span>${file}</span>
  </span>`;
}

/**
 * Display state of a derived.system entry. derive reports NOT_CONNECTED for a
 * subsystem with no usable source; when a state directory is configured and the
 * subsystem's documents are merely not produced, that is NOT_PRODUCED.
 */
export function subsystemState(s) {
  if (!s) return "NOT_CONNECTED";
  if (s.state === "NOT_CONNECTED" && Object.values(s.sources ?? {}).some((st) => st === "MISSING")) return "NOT_PRODUCED";
  return s.state;
}

/** One line on why a subsystem has no usable declaration, worded from its sources' statuses. */
export function subsystemReason(ctx, s) {
  const entries = Object.entries(s?.sources ?? {});
  const file = (k) => source(ctx, k)?.file ?? (k === "agent_events" ? "agent_events.jsonl" : `${k}.json`);
  const listed = (pred) => entries.filter(([, st]) => pred(st)).map(([k, st]) => `${file(k)} ${(SHORT[st] ?? st).toLowerCase()}`);
  switch (subsystemState(s)) {
    case "NOT_CONNECTED":
      return "No state directory configured";
    case "NOT_PRODUCED":
      return listed((st) => st !== "OK").join(" · ");
    case "SOURCE_ERROR":
      return listed((st) => st === "INVALID" || st === "UNREADABLE").join(" · ");
    case "REPORTING": {
      const sys = source(ctx, "system");
      return isOk(sys) ? "Sources reporting · state not declared in system.json" : `Sources reporting · system.json ${sourceShort(sys).toLowerCase()}`;
    }
    default:
      return "Status not declared";
  }
}

/**
 * What the cross-checks covered: derived.check_coverage lists every family and whether it ran.
 * "No findings" may only ever mean "none from the families that ran".
 */
export function checkSummary(ctx) {
  const cov = ctx.snap?.derived?.check_coverage ?? null;
  if (!Array.isArray(cov)) return { available: false, ran: 0, total: 0, skipped: [] };
  const ran = cov.filter((c) => c.ran);
  return { available: true, ran: ran.length, total: cov.length, skipped: cov.filter((c) => !c.ran), anyRan: ran.length > 0 };
}

/** Count rows of a list, or null when the list itself is absent. */
export function countWhere(list, pred) {
  if (!Array.isArray(list)) return null;
  return pred ? list.filter(pred).length : list.length;
}

/** fmtCount that keeps null as null (for stat/val). */
export function fc(n) {
  return isNil(n) ? null : fmtCount(n);
}

/* ------------------------------------------------------------ per-origin counts (never merged) */

/** Record origins in display order (schemas.Origin). */
export const ORIGINS = ["ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"];
export const ORIGIN_TAG = { ORIGINAL: "ORIG", RECONSTRUCTED: "RECON", SYNTHETIC_FIXTURE: "SYNTH" };

/** Tag tone for an origin, same semantics as originBadge(): reconstructed amber, synthetic red. */
export function originTone(o) {
  return toneClass(o === "SYNTHETIC_FIXTURE" ? "INVALID" : o);
}

/**
 * Count rows per record origin (optionally only rows matching `pred`).
 * null when the list itself is absent (source not connected); a connected,
 * empty list gives real zeros. Origins are counted separately, never summed.
 */
export function originSplit(rows, pred) {
  if (!Array.isArray(rows)) return null;
  const out = { ORIGINAL: 0, RECONSTRUCTED: 0, SYNTHETIC_FIXTURE: 0 };
  for (const r of rows) {
    if (pred && !pred(r)) continue;
    const o = r?.origin ?? "UNDECLARED";
    out[o] = (out[o] ?? 0) + 1;
  }
  return out;
}

/** A server-derived {origin: n} map as a split (absent origins are real zeros); null stays null. */
export function splitFrom(counts) {
  if (!counts) return null;
  return { ORIGINAL: 0, RECONSTRUCTED: 0, SYNTHETIC_FIXTURE: 0, ...counts };
}

/** Origins with at least one record, in display order (anything unexpected last). */
export function presentOrigins(split) {
  const rank = (o) => (ORIGINS.includes(o) ? ORIGINS.indexOf(o) : ORIGINS.length);
  return Object.keys(split)
    .filter((o) => split[o] > 0)
    .sort((a, b) => rank(a) - rank(b));
}

/** The ORIGINAL count of a split (null stays null), for places that can show only one number. */
export function originalOf(split) {
  return split ? split.ORIGINAL ?? 0 : null;
}

/** True when a split has records of any origin other than ORIGINAL. */
export function hasOtherOrigins(split) {
  return !!split && presentOrigins(split).some((o) => o !== "ORIGINAL");
}

/**
 * Render a per-origin count: one number per origin present, ORIGINAL untagged,
 * every other origin tagged (RECON amber, SYNTH red). A connected source with
 * no matching records renders a single real 0. null (not connected) -> null so
 * stat()/val() render their empty state.
 */
export function splitVal(split, { cls } = {}) {
  if (!split) return null;
  const parts = presentOrigins(split);
  if (!parts.length) {
    return html`<span class="${cx("cc-split", cls)}" data-origin-split><span class="cc-split__n" data-origin="ORIGINAL">${val(fmtCount(0))}</span></span>`;
  }
  return html`<span class="${cx("cc-split", cls)}" data-origin-split>${parts.map(
    (o) => html`<span class="cc-split__n" data-origin="${o}" title="${fmtCount(split[o])} ${humanize(o).toLowerCase()} record(s), counted separately">${val(fmtCount(split[o]))}${
      o === "ORIGINAL" ? "" : html`<span class="${cx("cc-split__tag", originTone(o))}">${ORIGIN_TAG[o] ?? o}</span>`
    }</span>`,
  )}</span>`;
}

/** Plain-text per-origin count, e.g. "7 original · 1 reconstructed" (never one merged total). */
export function splitText(split, noun = "") {
  if (!split) return "";
  const parts = presentOrigins(split).map((o) => `${fmtCount(split[o])} ${humanize(o).toLowerCase()}`);
  return (parts.length ? parts.join(" · ") : "0") + (noun ? ` ${noun}` : "");
}

/* ------------------------------------------------------------ agent event stream origins */

/** Most recent events fetched by the command views (enough to cover a typical stream whole). */
export const EVENT_WINDOW = 1000;

/**
 * Per-origin split of the valid events in the agent event stream, counted from a
 * fetched window ({source, events} from /api/cc/events). Only when the window holds
 * every valid event (of an OK or INVALID stream); otherwise null, because a split of
 * a partial window would be presented as the whole.
 */
export function eventOriginSplit(res) {
  const evs = res?.events;
  const src = res?.source;
  if (!Array.isArray(evs) || !["OK", "INVALID"].includes(src?.status) || isNil(src.valid_events)) return null;
  if (evs.length < src.valid_events) return null;
  return originSplit(evs);
}

/** Small navigation link used in panel actions. */
export function go(label, href) {
  return html`<a class="cc-go" href="${href}">${label}<span class="cc-go__arrow" aria-hidden="true">→</span></a>`;
}

/** Sub-section heading inside a panel. */
export function subhead(label, right) {
  return html`<div class="cc-subhead"><span class="cc-subhead__label">${label}</span>${right ? html`<span class="cc-subhead__right">${right}</span>` : ""}</div>`;
}

/** An inline "why empty" line used inside fully-structured panels. */
export function emptyLine(title, reason, iconName = "empty") {
  return html`<div class="cc-emptyline" data-empty-state="${title}">${icon(iconName)}<span class="cc-emptyline__t">${title}</span>${
    reason ? html`<span class="cc-emptyline__r">${reason}</span>` : ""
  }</div>`;
}
