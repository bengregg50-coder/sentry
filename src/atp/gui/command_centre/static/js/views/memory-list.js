// Findings / Lessons — every memory rendered as a structured MEMORY card:
// hypothesis, evidence for and against, OOS / robustness / cost sensitivity,
// declared confidence and status. One module, ctx.props.kind = findings|lessons.
// Findings = every type except LESSON; lessons = LESSON.

import { html } from "../core/html.js";
import { humanize } from "../core/format.js";
import { sourceReason, sourceShort } from "../core/state.js";
import { pageHeader, panel, emptyState, sourceEmpty, tabs, stat, statRow } from "../components/ui.js";
import { icon } from "../components/icons.js";
import {
  FINDING_TYPES,
  VALIDATION_STATES,
  STATUSES,
  CONFIDENCE,
  memState,
  qhref,
  originCounts,
  splitVal,
  splitText,
  memoryCard,
  bars,
  sectionLabel,
  sourceTags,
  anatomy,
} from "./_memory-common.js";

const KINDS = {
  findings: {
    path: "/memory/findings",
    title: "Findings",
    code: "MEM-F",
    sub: "Everything SENTRY has observed, confirmed or ruled out — failed mechanisms, rejected assumptions, dangerous features and regime notes included. Each card carries its evidence, never a verdict on a strategy.",
    match: (m) => m.type !== "LESSON",
    noun: "findings",
  },
  lessons: {
    path: "/memory/lessons",
    title: "Lessons",
    code: "MEM-L",
    sub: "Process lessons SENTRY has recorded about how it researches — each backed by the evidence that taught it.",
    match: (m) => m.type === "LESSON",
    noun: "lessons",
  },
};

/** Chip / tab count: per record origin, never one merged figure. */
function facetCount(rows, pred) {
  return rows ? splitVal(originCounts(rows, pred), { cls: "mem-split--sm" }) : null;
}

function filterChips(label, key, values, rows, field, ctx, path) {
  const active = ctx.query[key] ?? null;
  return html`<div class="mem-chips" data-filter="${key}">
    <span class="mem-chips__label">${label}</span>
    <a class="mem-chip" href="${qhref(path, ctx.query, { [key]: null })}" aria-current="${active ? "false" : "true"}">ALL</a>
    ${values.map(
      (v) => html`<a class="mem-chip" href="${qhref(path, ctx.query, { [key]: v })}" aria-current="${active === v ? "true" : "false"}" data-value="${v}">${humanize(v)}${
        rows ? html`<span class="mem-chip__n">${facetCount(rows, (m) => m[field] === v)}</span>` : ""
      }</a>`,
    )}
  </div>`;
}

export default {
  title: (ctx) => KINDS[ctx.props.kind ?? "findings"]?.title ?? "Findings",
  render(ctx) {
    const kind = KINDS[ctx.props.kind] ? ctx.props.kind : "findings";
    const K = KINDS[kind];
    const { mems, src } = memState(ctx);
    const pool = mems ? mems.filter(K.match) : null;
    const q = ctx.query;
    const stateF = VALIDATION_STATES.includes(q.state) ? q.state : null;
    const typeF = kind === "findings" && FINDING_TYPES.includes(q.type) ? q.type : null;
    const statusF = STATUSES.includes(q.status) ? q.status : null;
    const shown = pool
      ? pool
          .filter((m) => (!stateF || m.validation_state === stateF) && (!typeF || m.type === typeF) && (!statusF || m.status === statusF))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      : null;

    // Tab counts respect the other active filters (type/status), not the state filter itself.
    const forTabs = pool ? pool.filter((m) => (!typeF || m.type === typeF) && (!statusF || m.status === statusF)) : null;
    const forType = pool ? pool.filter((m) => (!stateF || m.validation_state === stateF) && (!statusF || m.status === statusF)) : null;
    const forStatus = pool ? pool.filter((m) => (!stateF || m.validation_state === stateF) && (!typeF || m.type === typeF)) : null;

    const why = sourceShort(src);
    const filtered = !!(stateF || typeF || statusF);
    const split = (rows, pred) => (rows ? originCounts(rows, pred) : null);
    const contested = (m) => m.evidence.some((e) => e.stance === "CONTRADICTS");

    let body;
    if (!pool) {
      body = sourceEmpty(src, {
        title: `No ${K.noun} to show`,
        hint: `Each ${kind === "lessons" ? "lesson" : "finding"} appears here as a MEMORY card: hypothesis · evidence for and against (and how much is independent) · OOS · robustness · cost sensitivity · confidence · status — linked to its full record.`,
      });
    } else if (!pool.length) {
      body = emptyState({
        title: `0 ${K.noun} recorded`,
        reason: `memory.json is connected and holds ${splitText(originCounts(mems), mems.length === 1 ? "memory" : "memories")}, none of ${kind === "lessons" ? "type LESSON" : "a finding type"}.`,
        hint: "Recorded memories appear here as structured evidence cards.",
        code: `memory-${kind}-none`,
      });
    } else if (!shown.length) {
      body = emptyState({ title: "No match", reason: `No ${K.noun} match the active filters.`, hint: html`<a class="ref" href="#${K.path}">Clear filters</a>`, compact: true, code: "memory-filter-none" });
    } else {
      body = html`<div class="mem-cards">${shown.map((m) => memoryCard(m))}</div>`;
    }

    return html`
      ${pageHeader({ kicker: "MEMORY", code: K.code, title: K.title, sub: K.sub, right: sourceTags(ctx, ["memory"]) })}

      <div class="mem-filterbar">
        ${tabs(
          [
            { key: "ALL", label: `All ${K.noun}`, href: qhref(K.path, q, { state: null }), count: facetCount(forTabs) },
            ...VALIDATION_STATES.map((s) => ({ key: s, label: humanize(s), href: qhref(K.path, q, { state: s }), count: facetCount(forTabs, (m) => m.validation_state === s) })),
          ],
          stateF ?? "ALL",
        )}
        <div class="mem-filterbar__chips">
          ${kind === "findings" ? filterChips("Type", "type", FINDING_TYPES, forType, "type", ctx, K.path) : ""}
          ${filterChips("Status", "status", STATUSES, forStatus, "status", ctx, K.path)}
        </div>
      </div>

      <div class="grid">
        ${panel({
          span: 9,
          code: `${K.code}01`,
          title: K.title,
          sub: shown
            ? !pool.length
              ? "None recorded"
              : filtered
              ? `Showing ${splitText(split(shown))} of ${splitText(split(pool))} · filtered · newest first`
              : `${splitText(split(pool))} · all shown · newest first`
            : sourceReason(src),
          body,
          // Never stretched to the side column: a short list ends with its last card, not in blank panel.
          cls: "xl-span-12 mem-list-panel",
        })}
        <div class="span-3 xl-span-12 stack mem-side">
          ${panel({
            code: `${K.code}02`,
            title: "In view",
            sub: "Of the cards shown",
            body: html`
              ${statRow(
                [
                  stat({ label: "Shown", value: splitVal(split(shown), { cls: "mem-split--sm" }), hint: filtered ? "Filtered · per origin" : "All · per origin", emptyLabel: why, size: "sm" }),
                  stat({ label: "Contested", value: splitVal(split(shown, contested), { cls: "mem-split--sm" }), hint: "≥1 contradicting item", emptyLabel: why, size: "sm" }),
                ],
                { min: 110 },
              )}
              <div class="mem-gap">${sectionLabel("Declared confidence")}${bars(CONFIDENCE.map((c) => ({ key: c, split: split(shown, (m) => m.confidence === c) })))}</div>`,
          })}
          ${panel({ code: `${K.code}03`, title: "Card fields", sub: "From the contract", body: html`${anatomy({ compact: true })}<div class="mem-side-note">${icon("info")}<span>Confidence and validation are declared by the producer. The Command Centre never rates a memory.</span></div>` })}
        </div>
      </div>
    `;
  },
};
