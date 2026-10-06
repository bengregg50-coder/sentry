// Memory Overview — what SENTRY has learned, how it is distributed, how it
// grows, and how memory closes the self-improvement loop. Totals come from
// derived.memory_stats; distributions are display counts of memory.json rows.
// Nothing here rates a memory: confidence and validation are declared.

import { html } from "../core/html.js";
import { isNil, fmtCount, fmtDate, humanize } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort, findingsFor, currentVersion } from "../core/state.js";
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
  countBy,
  tally,
  flattenEvidence,
  originSplit,
  sectionLabel,
  sourceTags,
  bars,
  typeBadge,
  untraceableBadge,
  anatomy,
} from "./_memory-common.js";
import { memLoop } from "./_memory-loop.js";
import { growthChart } from "./_memory-chart.js";

function distribution(stats, field, keys) {
  const avail = !!stats?.available;
  return keys.map((k) => ({ key: k, n: avail ? tally(stats[field], k) : null }));
}

/* ------------------------------------------------------------ MEM-01 store totals */

function storeTotals(ctx, st) {
  const { stats, src, mems } = st;
  const avail = !!stats?.available;
  const s = (k) => (avail ? fmtCount(stats[k]) : null);
  const why = sourceShort(src);
  const evRows = flattenEvidence(mems);
  const untraceable = mems ? mems.filter((m) => m.evidence.length === 0) : null;
  return html`
    ${statRow(
      [
        stat({ label: "Total memories", value: s("total"), hint: "All records in memory.json", emptyLabel: why, size: "lg" }),
        stat({ label: "High confidence", value: s("high_confidence_findings"), hint: "HIGH · VALIDATED", emptyLabel: why, size: "lg", title: "Memories declared HIGH confidence and VALIDATED" }),
        stat({ label: "Unresolved", value: s("unresolved"), hint: "Unverified or in review", emptyLabel: why, size: "lg", title: "Validation state UNVERIFIED or PROVISIONAL, or status REVIEW" }),
        stat({ label: "Rejected assumptions", value: s("rejected_assumptions"), hint: "Type or status rejected", emptyLabel: why, size: "lg", title: "Type REJECTED_ASSUMPTION or status REJECTED" }),
        stat({ label: "Contradicted", value: s("contradicted"), hint: "Declared CONTRADICTED", emptyLabel: why, size: "lg", title: "Validation state CONTRADICTED" }),
      ],
      { min: 150 },
    )}
    <div class="mem-totals-foot">
      <div class="mem-totals-foot__item"><span class="mem-k">BY ORIGIN</span>${originSplit(mems)}</div>
      <div class="mem-totals-foot__item"><span class="mem-k">EVIDENCE ITEMS</span>${val(evRows ? fmtCount(evRows.length) : null)}</div>
      <div class="mem-totals-foot__item"><span class="mem-k">UNTRACEABLE</span>${
        untraceable ? html`${val(fmtCount(untraceable.length))}${untraceable.length ? html` <a class="mem-more" href="#/memory/evidence">REVIEW ${icon("expand")}</a>` : ""}` : val(null)
      }</div>
      <div class="mem-totals-foot__note">Totals are declared by derive.memory_stats. Origins are counted separately and never merged.</div>
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

function composition(st) {
  const { stats, src } = st;
  const col = (title, field, keys, opts) => html`<div class="mem-comp__col">${sectionLabel(title)}${bars(distribution(stats, field, keys), opts)}</div>`;
  return html`<div class="mem-comp">
    <div class="mem-comp__group">${col("By type", "by_type", MEMORY_TYPES, { neutral: true })}</div>
    <div class="mem-comp__group">${col("By validation state", "by_validation_state", VALIDATION_STATES)}${col("By status", "by_status", STATUSES)}</div>
    <div class="mem-comp__group">${col("By confidence", "by_confidence", CONFIDENCE)}${col("By origin", "by_origin", ORIGINS)}
      ${stats?.available ? "" : html`<div class="mem-comp__why">${icon("info")}<span>${sourceReason(src)} Each distribution appears here once memories are recorded.</span></div>`}
    </div>
  </div>`;
}

/* ------------------------------------------------------------ MEM-04 recent learning */

function recent(st) {
  const { stats, mems, src } = st;
  if (!stats?.available || !mems) {
    return sourceEmpty(src, { title: "No memories to show", hint: "The ten most recently created memories appear here, newest first, each linked to its evidence." });
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
  const { stats, src } = st;
  const g = stats?.available ? stats.growth ?? [] : null;
  const first = g && g.length ? g[0].date : null;
  const last = g && g.length ? g[g.length - 1].date : null;
  return html`
    ${growthChart(g, {
      height: 196,
      emptyTitle: g ? "No memories recorded yet" : "Memory growth not connected",
      emptyReason: g ? "The cumulative count is drawn from real creation dates only." : sourceReason(src),
    })}
    <div class="mem-growth-kv">
      <div><span class="mem-k">FIRST RECORD</span>${val(first)}</div>
      <div><span class="mem-k">LATEST ADDITION</span>${val(last)}</div>
      <div><span class="mem-k">DAYS WITH ADDITIONS</span>${val(g ? fmtCount(g.length) : null)}</div>
    </div>`;
}

/* ------------------------------------------------------------ MEM-06 shared learning flow */

function sharedFlow(ctx, st) {
  const { mems } = st;
  const learning = derived(ctx, "learning");
  const stageCount = (k) => {
    if (!learning?.events_available) return null;
    const s = learning.stages.find((x) => x.key === k);
    return s ? s.count : null;
  };
  const evRows = flattenEvidence(mems);
  const stance = evRows ? countBy(evRows, (e) => e.stance) : null;
  const sup = stance ? tally(stance, "SUPPORTS") : null;
  const con = stance ? tally(stance, "CONTRADICTS") : null;
  const state = (n, connected) => (!connected ? "NOT_CONNECTED" : n > 0 ? "REPORTING" : "NONE_RECORDED");
  const agentMems = mems ? mems.filter((m) => m.source.actor === "AGENT") : null;
  const reviewed = mems ? mems.filter((m) => !isNil(m.last_reviewed)) : null;
  const writes = stageCount("WRITE_MEMORY");
  const recalls = stageCount("RECALL");
  const list = [
    { key: "DISCOVER", label: "Agent discovers", count: agentMems ? agentMems.length : null, state: state(agentMems?.length, !!mems), detail: "agent-sourced memories", owner: "AGENT" },
    { key: "STORE", label: "Stores evidence-backed memory", count: writes, state: state(writes, !isNil(writes)), detail: "memory-write events", owner: "AGENT → MEMORY" },
    { key: "RETRIEVE", label: "Another agent retrieves", count: recalls, state: state(recalls, !isNil(recalls)), detail: "recall events · all agents", owner: "MEMORY → AGENT" },
    { key: "TEST", label: "Tests applicability", count: null, state: "NOT_REPORTED", detail: "no contract field yet", owner: "AGENT · RESEARCH" },
    {
      key: "VERDICT",
      label: "Confirms or contradicts",
      count: stance ? `${fmtCount(sup)} / ${fmtCount(con)}` : null,
      state: state(stance ? sup + con : null, !!stance),
      detail: "supporting / contradicting items",
      owner: "EVIDENCE",
    },
    { key: "UPDATE", label: "Updates shared knowledge", count: reviewed ? reviewed.length : null, state: state(reviewed?.length, !!mems), detail: "memories with a recorded review", owner: "MEMORY" },
  ];
  return html`${steps(list, { cls: "mem-flow" })}
    <div class="mem-flow-note">${icon("info")}<span>Counts are shown only where the contract records them. Cross-agent recall — agent X retrieving what agent Y wrote — is resolved per event on <a class="ref" href="#/memory/agents">Agent Memories</a>.</span></div>`;
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

function integrity(ctx, st) {
  const { mems, src } = st;
  if (!mems) return sourceEmpty(src, { compact: true, title: "Integrity checks need memory.json", hint: "Cross-checks of memory state (unsupported confidence, contradicted validations, unresolved references) appear here." });
  const findings = findingsFor(ctx, "memory");
  const untraceable = mems.filter((m) => m.evidence.length === 0);
  return html`<div class="mem-integrity">
    <div class="mem-integrity__col">
      ${sectionLabel("Consistency findings", "section · memory")}
      ${findingsList(findings, { empty: emptyState({ title: "No findings", reason: "Connected memory state is internally consistent.", compact: true, iconName: "shield" }) })}
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
          ${panel({ code: "MEM-01", title: "Memory store", sub: st.mems ? "Declared totals" : sourceReason(st.src), body: storeTotals(ctx, st) })}
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
