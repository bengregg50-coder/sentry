// Memory Overview — what SENTRY has learned, how it is distributed, how it
// grows, and how memory closes the self-improvement loop. Every record count
// is shown per record origin (ORIGINAL untagged, RECON / SYNTH tagged), never
// as one merged figure: derive's own per-origin maps are used where
// derived.memory_stats has them, otherwise memory.json rows are counted by the
// same declared fields. Nothing here rates a memory: confidence and validation
// are declared.

import { html } from "../core/html.js";
import { isNil, fmtCount, fmtDate, humanize } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort, sourceTitle, findingsFor, currentVersion } from "../core/state.js";
import { pageHeader, panel, badge, stat, statRow, val, originBadge, emptyState, sourceEmpty, findingsList } from "../components/ui.js";
import { steps } from "../components/flow.js";
import { icon } from "../components/icons.js";
import {
  MEMORY_TYPES,
  CONFIDENCE,
  VALIDATION_STATES,
  STATUSES,
  ORIGINS,
  memState,
  memoryIndex,
  memHref,
  tally,
  flattenEvidence,
  originSplit,
  originCounts,
  splitVal,
  splitSize,
  sectionLabel,
  sourceTags,
  bars,
  typeBadge,
  untraceableBadge,
  anatomy,
  memoryChecksRan,
  loadMemoryEvents,
  memEvents,
} from "./_memory-common.js";
import { memLoop } from "./_memory-loop.js";
import { growthChart, growthSeries } from "./_memory-chart.js";

/* ------------------------------------------------------------ MEM-01 store totals */

// The same definitions as derive_memory_stats(): display counting of declared fields only.
const isHigh = (m) => m.confidence === "HIGH" && m.validation_state === "VALIDATED";
const isUnresolved = (m) => m.validation_state === "UNVERIFIED" || m.validation_state === "PROVISIONAL" || m.status === "REVIEW";
const isRejectedAssumption = (m) => m.type === "REJECTED_ASSUMPTION" || m.status === "REJECTED";
const isContradicted = (m) => m.validation_state === "CONTRADICTED";

/**
 * Per-origin split of one memory_stats class: derive's own by-origin map when
 * the snapshot has one, else memory.json rows counted by the same declared
 * fields. null when memory.json is not available.
 */
function statSplit(st, derivedKey, pred) {
  if (!st.stats?.available || !st.mems) return null;
  const m = st.stats[derivedKey];
  return m ? { ...m } : originCounts(st.mems, pred);
}

function storeTotals(ctx, st) {
  const { src, mems } = st;
  const why = sourceShort(src);
  const evRows = flattenEvidence(mems);
  const untraceable = mems ? mems.filter((m) => m.evidence.length === 0) : null;
  const tile = (label, split, hint, title) =>
    stat({ label, value: splitVal(split, { cls: "mem-split--lg" }), hint, emptyLabel: why, size: "lg", title });
  return html`
    ${statRow(
      [
        tile("Total memories", statSplit(st, "by_origin", null), "All records · per origin", "Every memory in memory.json, counted per record origin"),
        tile("High confidence", statSplit(st, "high_confidence_by_origin", isHigh), "HIGH · VALIDATED", "Memories declared HIGH confidence and VALIDATED"),
        tile("Unresolved", statSplit(st, "unresolved_by_origin", isUnresolved), "Unverified or in review", "Validation state UNVERIFIED or PROVISIONAL, or status REVIEW"),
        tile("Rejected assumptions", statSplit(st, "rejected_assumptions_by_origin", isRejectedAssumption), "Type or status rejected", "Type REJECTED_ASSUMPTION or status REJECTED"),
        tile("Contradicted", statSplit(st, "contradicted_by_origin", isContradicted), "Declared CONTRADICTED", "Validation state CONTRADICTED"),
      ],
      { min: 150 },
    )}
    <div class="mem-totals-foot">
      <div class="mem-totals-foot__item" data-total="evidence"><span class="mem-k">EVIDENCE ITEMS</span>${splitVal(originCounts(evRows, null, (e) => e.memory.origin), { cls: "mem-split--sm" }) ?? val(null)}</div>
      <div class="mem-totals-foot__item" data-total="untraceable"><span class="mem-k">UNTRACEABLE</span>${
        untraceable
          ? html`${splitVal(originCounts(untraceable), { cls: "mem-split--sm" })}${untraceable.length ? html` <a class="mem-more" href="#/memory/evidence">REVIEW ${icon("expand")}</a>` : ""}`
          : val(null)
      }</div>
      <div class="mem-totals-foot__note">Counted per record origin — ORIGINAL untagged, other origins tagged — never merged. Definitions match derive.memory_stats; evidence items take the origin of their memory.</div>
    </div>`;
}

/* ------------------------------------------------------------ MEM-03 self-improvement loop */

// Strategy statuses excluded from the validated count — the same definition as
// derive_research_summary().validated, so this figure matches the home hero
// and /strategies/validated. Display counting of declared fields only.
const NOT_CURRENT = ["RETIRED", "REJECTED"];

// The ring shows which stages have a connected source. Only the first three
// stages carry a record count. The four "better" stages are not scored by the
// Command Centre (as on the System Map): nothing in state records that a
// hypothesis, trial or strategy was improved by memory.
function loopStages(ctx, st) {
  const rs = doc(ctx, "research");
  const ok = (k) => source(ctx, k)?.status === "OK";
  const evRows = flattenEvidence(st.mems);
  return [
    { key: "RESEARCH", label: "RESEARCH", src: "research", connected: ok("research"), scored: true, records: rs?.programmes ?? null, what: "programmes" },
    { key: "EVIDENCE", label: "EVIDENCE", src: "memory", connected: ok("memory"), scored: true, records: evRows, origin: (e) => e.memory.origin, what: "evidence items" },
    { key: "MEMORY", label: "MEMORY", src: "memory", connected: ok("memory"), scored: true, records: st.mems, what: "memories" },
    { key: "HYPOTHESES", top: "BETTER", label: "HYPOTHESES", src: "research", connected: ok("research"), scored: false },
    { key: "EXPERIMENTS", top: "BETTER", label: "EXPERIMENTS", src: "research", connected: ok("research"), scored: false },
    { key: "VALIDATION", top: "BETTER", label: "VALIDATION", src: "strategies", connected: ok("strategies"), scored: false },
    { key: "STRATEGIES", top: "BETTER", label: "STRATEGIES", src: "strategies", connected: ok("strategies"), scored: false },
  ];
}

/** Plain record counts behind the loop — what is on file, never "better". */
function loopRecords(ctx) {
  const rs = doc(ctx, "research");
  const sg = doc(ctx, "strategies");
  const validated = sg
    ? sg.strategies.filter((s) => currentVersion(s)?.validation_status === "VALIDATED" && !NOT_CURRENT.includes(s.status))
    : null;
  return [
    { key: "HYPOTHESES", label: "Hypotheses on record", src: "research", records: rs?.hypotheses ?? null, what: "all statuses" },
    { key: "TRIALS", label: "Trial records", src: "research", records: rs?.trials ?? null, what: "all outcomes" },
    { key: "VALIDATED", label: "Validated strategies", src: "strategies", records: validated, what: "current version VALIDATED · excl. retired, rejected" },
    { key: "STRATEGIES", label: "Registered strategies", src: "strategies", records: sg?.strategies ?? null, what: "all statuses" },
  ];
}

function loopPanel(ctx, st) {
  const stages = loopStages(ctx, st);
  const linked = stages.filter((s) => s.connected).length;
  const counted = stages.filter((s) => s.scored);
  const better = stages.filter((s) => !s.scored);
  const recCell = (r) => (r.records ? originSplit(r.records, r.origin) : html`<span class="mem-nr">${sourceShort(source(ctx, r.src))}</span>`);
  const fileOf = (k) => source(ctx, k)?.file ?? k;
  return panel({
    code: "MEM-03",
    title: "Self-improvement loop",
    sub: linked ? `${linked} of ${stages.length} stages connected` : "No stage connected",
    cls: "mem-loop-panel",
    body: html`
      ${memLoop(stages)}
      <div class="mem-loop-caption">RESEARCH → EVIDENCE → MEMORY → BETTER HYPOTHESES → BETTER EXPERIMENTS → BETTER VALIDATION → BETTER STRATEGIES</div>
      <div class="mem-loop-side">
        <div class="mem-stage-list">
          ${counted.map(
            (s) => html`<div class="mem-stage" data-stage="${s.key}" data-connected="${s.connected ? "1" : "0"}">
              <span class="mem-stage__n">${String(stages.indexOf(s) + 1).padStart(2, "0")}</span>
              <span class="mem-stage__main">
                <span class="mem-stage__name">${s.label}</span>
                <span class="mem-stage__sub">${fileOf(s.src)} · ${s.what}</span>
              </span>
              <span class="mem-stage__rec">${recCell(s)}</span>
            </div>`,
          )}
          <div class="mem-stage mem-stage--better" data-stage="BETTER" data-scored="0">
            <span class="mem-stage__n">${String(stages.indexOf(better[0]) + 1).padStart(2, "0")}–${String(stages.length).padStart(2, "0")}</span>
            <span class="mem-stage__main">
              <span class="mem-stage__name">BETTER ${better.map((s) => s.label).join(" · ")}</span>
              <span class="mem-stage__sub">Not scored by the Command Centre — no state records that memory improved them</span>
            </span>
            <span class="mem-stage__rec"><span class="mem-nr" data-not-scored>NOT SCORED</span></span>
          </div>
        </div>
        ${sectionLabel("Records on file", "per origin · not a measure of improvement")}
        <div class="mem-stage-list mem-stage-list--records">
          ${loopRecords(ctx).map(
            (r) => html`<div class="mem-stage mem-stage--record" data-record="${r.key}" data-connected="${source(ctx, r.src)?.status === "OK" ? "1" : "0"}">
              <span class="mem-stage__main">
                <span class="mem-stage__name">${r.label}</span>
                <span class="mem-stage__sub">${fileOf(r.src)} · ${r.what}</span>
              </span>
              <span class="mem-stage__rec">${recCell(r)}</span>
            </div>`,
          )}
        </div>
      </div>`,
  });
}

/* ------------------------------------------------------------ MEM-02 composition */

// Each distribution counts memory.json rows by a declared field, per record
// origin (a bar's number is split whenever a record is not ORIGINAL).
const FIELD = { by_type: "type", by_validation_state: "validation_state", by_status: "status", by_confidence: "confidence" };

function composition(st) {
  const { stats, src, mems } = st;
  const rows = (field, keys) => keys.map((k) => ({ key: k, split: mems ? originCounts(mems, (m) => m[FIELD[field]] === k) : null }));
  const originRows = ORIGINS.map((k) => ({ key: k, n: stats?.available ? tally(stats.by_origin, k) : null }));
  const col = (title, body) => html`<div class="mem-comp__col">${sectionLabel(title)}${body}</div>`;
  return html`<div class="mem-comp">
    <div class="mem-comp__group">${col("By type", bars(rows("by_type", MEMORY_TYPES), { neutral: true }))}</div>
    <div class="mem-comp__group">${col("By validation state", bars(rows("by_validation_state", VALIDATION_STATES)))}${col("By status", bars(rows("by_status", STATUSES)))}</div>
    <div class="mem-comp__group">${col("By confidence", bars(rows("by_confidence", CONFIDENCE)))}${col("By origin", bars(originRows))}
      ${stats?.available ? "" : html`<div class="mem-comp__why">${icon("info")}<span>${sourceReason(src)} Each distribution appears here once memories are recorded.</span></div>`}
    </div>
  </div>`;
}

/* ------------------------------------------------------------ MEM-04 recent learning */

function recent(st) {
  const { stats, mems, src } = st;
  if (!stats?.available || !mems) {
    return sourceEmpty(src, { title: sourceTitle(src, "Memory store"), hint: "The ten most recently created memories appear here, newest first, each linked to its evidence." });
  }
  const idx = memoryIndex(mems);
  const rows = (stats.recent ?? []).map((id) => idx.get(id)).filter(Boolean);
  if (!rows.length) return emptyState({ title: "None recorded", reason: "memory.json is connected and holds no memories yet.", hint: "Newly recorded memories appear here, newest first.", compact: true, code: "memory-recent-none" });
  return html`<ol class="mem-recent">
    ${rows.map(
      (m) => html`<li class="mem-recent__row" data-memory-id="${m.memory_id}">
        <span class="mem-recent__date"><span class="v" data-v>${fmtDate(m.created_at)}</span></span>
        <a class="ref mem-recent__id" href="${memHref(m.memory_id)}">${m.memory_id}</a>
        <span class="mem-recent__main">
          <a class="mem-recent__title" href="${memHref(m.memory_id)}">${m.title}</a>
          <span class="mem-recent__meta">${typeBadge(m.type)}<span class="muted">${humanize(m.source.actor)}</span></span>
        </span>
        <span class="mem-recent__flags">${originBadge(m.origin)}${badge(m.confidence, { ghost: true })}${badge(m.validation_state)}</span>
      </li>`,
    )}
  </ol>`;
}

/* ------------------------------------------------------------ MEM-05 growth */

function growth(st) {
  const { src, mems } = st;
  const series = growthSeries(mems);
  const days = series ? [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort() : null;
  return html`
    ${growthChart(series, {
      height: 196,
      emptyTitle: series ? "No memories recorded yet" : sourceTitle(src, "Memory growth"),
      emptyReason: series ? "Each origin's cumulative count is drawn from real creation dates only." : sourceReason(src),
    })}
    <div class="mem-growth-kv">
      <div><span class="mem-k">FIRST RECORD</span>${val(days && days.length ? days[0] : null)}</div>
      <div><span class="mem-k">LATEST ADDITION</span>${val(days && days.length ? days[days.length - 1] : null)}</div>
      <div><span class="mem-k">DAYS WITH ADDITIONS</span>${val(days ? fmtCount(days.length) : null)}</div>
    </div>`;
}

/* ------------------------------------------------------------ MEM-06 shared learning flow */

/** Step state for a count: never "none recorded" when its source is unavailable. */
function flowState(split, src, ok) {
  if (!ok) return src ? { NOT_CONFIGURED: "NOT_CONNECTED", MISSING: "NOT_PRODUCED", INVALID: "INVALID", UNREADABLE: "UNREADABLE" }[src.status] ?? src.status : "UNAVAILABLE";
  return splitSize(split) > 0 ? "REPORTING" : "NONE_RECORDED";
}

function sharedFlow(ctx, st) {
  const { mems, src } = st;
  const ev = memEvents(ctx, ctx.extra);
  const evRows = flattenEvidence(mems);
  const kindSplit = (kind) => (ev.ok ? originCounts(ev.events, (e) => e.kind === kind) : null);
  const memOk = !!mems;
  const step = (key, label, split, ok, stateSrc, detail, owner) => ({
    key,
    label,
    count: ok ? splitVal(split, { cls: "mem-split--step" }) : null,
    state: flowState(split, stateSrc, ok),
    detail,
    owner,
  });
  const sup = memOk ? originCounts(evRows, (e) => e.stance === "SUPPORTS", (e) => e.memory.origin) : null;
  const con = memOk ? originCounts(evRows, (e) => e.stance === "CONTRADICTS", (e) => e.memory.origin) : null;
  const evScope = ev.ok && !ev.complete ? " · latest fetched" : "";
  const list = [
    step("DISCOVER", "Agent discovers", memOk ? originCounts(mems, (m) => m.source.actor === "AGENT") : null, memOk, src, "agent-sourced memories", "AGENT"),
    step("STORE", "Stores evidence-backed memory", kindSplit("MEMORY_WRITE"), ev.ok, ev.src, `memory-write events${evScope}`, "AGENT → MEMORY"),
    step("RETRIEVE", "Another agent retrieves", kindSplit("MEMORY_RECALL"), ev.ok, ev.src, `recall events · all agents${evScope}`, "MEMORY → AGENT"),
    step("TEST", "Tests applicability", kindSplit("APPLICABILITY_TEST"), ev.ok, ev.src, `applicability-test events${evScope}`, "AGENT · RESEARCH"),
    {
      key: "VERDICT",
      label: "Confirms or contradicts",
      count: memOk ? html`<span class="mem-verdict-n"><span data-verdict="supports">${splitVal(sup, { cls: "mem-split--step" })}</span><span class="mem-verdict-n__sep">/</span><span data-verdict="contradicts">${splitVal(con, { cls: "mem-split--step" })}</span></span>` : null,
      state: memOk ? (splitSize(sup) + splitSize(con) > 0 ? "REPORTING" : "NONE_RECORDED") : flowState(null, src, false),
      detail: "supporting / contradicting items",
      owner: "EVIDENCE",
    },
    step("UPDATE", "Updates shared knowledge", memOk ? originCounts(mems, (m) => !isNil(m.last_reviewed)) : null, memOk, src, "memories with a recorded review", "MEMORY"),
  ];
  return html`${steps(list, { cls: "mem-flow" })}
    <div class="mem-flow-note">${icon("info")}<span>Counts are per record origin and shown only where the contract records them${
      ev.ok && !ev.complete ? html` — event counts cover the latest events fetched, not the whole stream` : ""
    }. Cross-agent recall — agent X retrieving what agent Y wrote — is resolved per event on <a class="ref" href="#/memory/agents">Agent Memories</a>.</span></div>`;
}

/* ------------------------------------------------------------ MEM-07 philosophy */

function philosophy() {
  return html`<div class="mem-philo">
    <blockquote class="mem-philo__quote">A memory never says <q>this strategy works</q>. It carries structured evidence — and its own uncertainty.</blockquote>
    ${anatomy({ cols: 2 })}
    <div class="mem-philo__foot">Failures are retained: a failed mechanism or a rejected assumption is knowledge SENTRY must not relearn.</div>
  </div>`;
}

/* ------------------------------------------------------------ MEM-08 integrity */

/**
 * "No findings" only ever means none from the checks that ran
 * (derived.check_coverage) — never "memory state is consistent".
 */
function noFindings(ctx) {
  const cov = memoryChecksRan(ctx);
  if (!cov.ran) {
    return emptyState({ title: "Cross-checks not run", reason: cov.note ?? "derive did not run the memory cross-checks for this snapshot.", compact: true, code: "memory-checks-not-run" });
  }
  const strat = source(ctx, "strategies");
  return emptyState({
    title: "No findings",
    reason: `None from the memory cross-checks that ran: HIGH or VALIDATED without supporting evidence, VALIDATED with contradicting evidence, unresolved memory references${
      strat?.status === "OK" ? ", unresolved strategy references" : `. Strategy references were not checked — ${sourceTitle(strat, "strategies.json")}`
    }.`,
    compact: true,
    iconName: "shield",
    code: "memory-no-findings",
  });
}

function integrity(ctx, st) {
  const { mems, src } = st;
  if (!mems) return sourceEmpty(src, { compact: true, title: "Integrity checks need memory.json", hint: "Cross-checks of memory state (unsupported confidence, contradicted validations, unresolved references) appear here." });
  const findings = findingsFor(ctx, "memory");
  const untraceable = mems.filter((m) => m.evidence.length === 0);
  return html`<div class="mem-integrity">
    <div class="mem-integrity__col">
      ${sectionLabel("Consistency findings", "section · memory")}
      ${findingsList(findings, { empty: noFindings(ctx) })}
    </div>
    <div class="mem-integrity__col">
      ${sectionLabel("Untraceable memories", "no evidence attached")}
      ${untraceable.length
        ? html`<ul class="mem-untrace">${untraceable.map(
            (m) => html`<li><a class="ref" href="${memHref(m.memory_id)}">${m.memory_id}</a><span class="mem-untrace__title">${m.title}</span>${untraceableBadge()}</li>`,
          )}</ul>`
        : mems.length
          ? emptyState({ title: "All traceable", reason: "Every memory carries at least one evidence item.", compact: true, iconName: "evidence", code: "memory-all-traceable" })
          : emptyState({ title: "No memories recorded", reason: "memory.json is connected and holds no memories, so there is nothing to trace.", compact: true, code: "memory-trace-none" })}
    </div>
  </div>`;
}

export default {
  title: "Memory Overview",
  load: loadMemoryEvents,
  render(ctx) {
    const st = memState(ctx);
    return html`
      ${pageHeader({
        kicker: "MEMORY",
        code: "MEM",
        title: "Memory Overview",
        sub: "What SENTRY has learned and the evidence behind it. Failed mechanisms and rejected assumptions stay on the record — they are what stops SENTRY relearning them.",
        right: sourceTags(ctx, ["memory", "agent_events"]),
      })}

      <div class="grid">
        <div class="span-8 xl-span-12 stack">
          ${panel({ code: "MEM-01", title: "Memory store", sub: st.mems ? "Per record origin · never merged" : sourceReason(st.src), body: storeTotals(ctx, st) })}
          ${panel({ code: "MEM-02", title: "Composition", sub: "Distribution of recorded memories", body: composition(st), cls: "mem-grow" })}
        </div>
        <div class="span-4 xl-span-12 mem-loop-col">${loopPanel(ctx, st)}</div>
      </div>

      <div class="grid">
        ${panel({ span: 7, code: "MEM-04", title: "Recent learning", sub: "Newest memories first", body: recent(st), cls: "lg-span-12", actions: html`<a class="mem-more" href="#/memory/findings">ALL FINDINGS ${icon("expand")}</a>` })}
        ${panel({ span: 5, code: "MEM-05", title: "Memory growth", sub: "Cumulative · real creation dates only", body: growth(st), cls: "lg-span-12" })}
      </div>

      <div class="grid">
        ${panel({ span: 12, code: "MEM-06", title: "Shared learning", sub: "How one agent's evidence becomes every agent's knowledge", body: sharedFlow(ctx, st) })}
      </div>

      <div class="grid">
        ${panel({ span: 7, code: "MEM-07", title: "What a memory is", sub: "Contract fields — not values", body: philosophy(), cls: "lg-span-12" })}
        ${panel({ span: 5, code: "MEM-08", title: "Memory integrity", sub: "Traceability and cross-checks", body: integrity(ctx, st), cls: "lg-span-12" })}
      </div>
    `;
  },
};
