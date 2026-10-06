// Command Centre — the SENTRY control room.
// Everything shown is declared by producers (documents / derived / sources) or
// read from /api/cc/events. Absent values render empty; a real 0 from a
// connected source is a fact and is shown as 0.

import { html, cx } from "../core/html.js";
import { fmtAge, fmtDate, fmtTime, fmtNum, humanize, pad2, isNil, EMPTY, fmtLimit } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort, sourceTitle } from "../core/state.js";
import { toneOf, toneClass } from "../core/tones.js";
import { fetchEvents } from "../core/api.js";
import {
  pageHeader,
  panel,
  badge,
  dot,
  chip,
  stat,
  statRow,
  val,
  metric,
  originBadge,
  emptyState,
  sourceTag,
  kv,
  findingsList,
  integrityNotices,
  control,
  controlButton,
  meter,
  refLink,
  legend,
} from "../components/ui.js";
import { pipelineDiagram, TERMINALS } from "../components/pipeline.js";
import { sparkline } from "../components/chart.js";
import { agentMini } from "../components/agent.js";
import { icon } from "../components/icons.js";
import { ccRing } from "./_command-ring.js";
import {
  ACTIVE_AGENT,
  DOC_KEYS,
  isOk,
  srcState,
  statusLine,
  countWhere,
  fc,
  go,
  subhead,
  emptyLine,
  originSplit,
  splitFrom,
  originalOf,
  hasOtherOrigins,
  originTone,
  splitVal,
  splitText,
  presentOrigins,
  ORIGIN_TAG,
  subsystemState,
  subsystemReason,
  checkSummary,
  EVENT_WINDOW,
  eventOriginSplit,
} from "./_command-common.js";

const ACTIVE_PROGRAMME = new Set(["RUNNING", "SPEC_FROZEN"]);
const SEVERITIES = ["CRITICAL", "WARNING", "INFO"];

/* ------------------------------------------------------------ system status */

const SUBSYSTEM_HREF = {
  research_engine: "#/research",
  trading_engine: "#/live",
  agent_network: "#/agents",
  data: "#/data",
  governance: "#/governance",
  memory: "#/memory",
};

function subsystemDetail(ctx, s) {
  const d = s.declared;
  // A declaration contradicted by its own documents: the contradiction is the detail.
  if (d && s.source_problem) {
    return html`<span class="${cx("cc-tonetext", toneClass(s.state))}" data-source-problem>${s.source_problem}</span>`;
  }
  if (d) return d.detail ?? html`<span class="muted">No detail declared</span>`;
  return html`<span class="muted">${subsystemReason(ctx, s)}</span>`;
}

function subsystemCell(ctx, s) {
  const d = s.declared;
  const state = subsystemState(s);
  const tone = toneOf(state);
  const detailTitle = d ? (s.source_problem ?? d.detail ?? "") : subsystemReason(ctx, s);
  return html`<a class="${cx("cc-sys", toneClass(state))}" href="${SUBSYSTEM_HREF[s.key] ?? "#/"}" data-subsystem="${s.key}" data-state="${state}">
    <div class="cc-sys__head">${dot(state, { pulse: tone === "info" })}<span class="cc-sys__label">${s.label}</span>${d?.version ? html`<span class="cc-sys__ver">v${d.version}</span>` : ""}</div>
    <div class="cc-sys__state">${badge(state)}<span class="cc-sys__hb" title="Declared heartbeat">HB ${val(d?.heartbeat_at ? fmtAge(d.heartbeat_at, ctx.now) : null)}</span></div>
    <div class="cc-sys__detail" title="${detailTitle}">${subsystemDetail(ctx, s)}</div>
    <div class="cc-sys__srcs">${Object.entries(s.sources ?? {}).map(([k, st]) => statusLine(ctx, k, st))}</div>
  </a>`;
}

function systemStatus(ctx) {
  const sys = derived(ctx, "system") ?? [];
  const sysSrc = source(ctx, "system");
  const declared = sys.filter((s) => s.declared).length;
  return panel({
    span: 12,
    code: "CMD-01",
    title: "System status",
    sub: isOk(sysSrc) ? `${declared} of ${sys.length} subsystems declared in system.json` : `system.json ${sourceShort(sysSrc).toLowerCase()} — states inferred from source availability only`,
    actions: html`${sourceTag(sysSrc, { now: ctx.now })}`,
    cls: "cc-panel-sys",
    body: html`<div class="cc-cq"><div class="cc-sys-grid">${sys.map((s) => subsystemCell(ctx, s))}</div></div>`,
  });
}

/* ------------------------------------------------------------ research status */

// Every record count below is split by record origin (ORIGINAL untagged,
// RECONSTRUCTED / SYNTHETIC tagged) — never one merged total. Status groupings
// mirror the stat hints; validation and eligibility come from derived state.
const CANDIDATE_STATUSES = new Set(["CANDIDATE", "IN_VALIDATION"]);
const DEPLOYED_STATUSES = new Set(["DEPLOYED_SIM", "DEPLOYED_LIVE", "SCALED"]);
const isHighConfidence = (m) => m.confidence === "HIGH" && m.validation_state === "VALIDATED";
const isUnresolved = (m) => m.validation_state === "UNVERIFIED" || m.validation_state === "PROVISIONAL" || m.status === "REVIEW";

/** Memory split for a derived class: the server's per-origin map when it provides one, else rows counted by the same declared fields. */
function memSplit(ms, mems, derivedKey, pred) {
  if (!ms.available) return null;
  return ms[derivedKey] ? splitFrom(ms[derivedKey]) : originSplit(mems, pred);
}

/** Small inline split for stat hints. */
function hintSplit(split) {
  return splitVal(split, { cls: "cc-split--sm" }) ?? val(null);
}

/** Strategy ids whose current version derive_handoff marks VALIDATION complete and not withdrawn. */
function validatedIds(ctx) {
  const hs = derived(ctx, "handoffs") ?? [];
  return new Set(hs.filter((h) => !h.withdrawn && h.steps?.find((s) => s.step === "VALIDATION")?.state === "COMPLETE").map((h) => h.strategy_id));
}

function heroValidated(ctx, rs, sSrc) {
  const available = !!rs.strategies_available;
  const strategies = available ? doc(ctx, "strategies")?.strategies ?? null : null;
  const ids = available ? validatedIds(ctx) : null;
  const split = strategies ? originSplit(strategies, (s) => ids.has(s.strategy_id)) : null;
  let note;
  if (!split) note = html`<b>${sourceShort(sSrc)}</b> Strategy registry unavailable — this is not a zero.`;
  else if (!Object.values(split).some((n) => n > 0)) note = html`<b>NONE VALIDATED</b> No-trade &gt; weak trade. No edge found &gt; fake edge found.`;
  else if (hasOtherOrigins(split)) note = html`<b>CURRENT VERSIONS · PER ORIGIN</b> Validation status VALIDATED, excluding retired and rejected. Origins counted separately.`;
  else note = html`<b>CURRENT VERSIONS</b> Validation status VALIDATED, excluding retired and rejected.`;
  return html`<a class="cc-hero-kpi" href="#/strategies/validated" data-kpi="validated" data-available="${split ? "1" : "0"}">
    <div class="cc-hero-kpi__label">${icon("validated")}Validated strategies</div>
    ${split
      ? html`<div class="cc-hero-kpi__value">${splitVal(split, { cls: "cc-split--hero" })}</div>`
      : html`<div class="cc-hero-kpi__value is-empty" data-v data-empty="1">${EMPTY}</div>`}
    <div class="cc-hero-kpi__note">${note}</div>
  </a>`;
}

/** Ledger-declared trial accounting: three separate figures, never summed by the UI. */
function trialAccounting(ctx, ta, rSrc) {
  const connected = !!ta?.available;
  const d = connected ? ta.declared ?? null : null;
  // Per-figure reason only when the block exists but omits a figure; otherwise the note says why.
  const fig = (key, label, v, tag, title) => html`<div class="cc-acct__fig" data-acct="${key}" title="${title}">
    <span class="cc-acct__k">${label}</span>
    <span class="cc-acct__v">${val(fc(v))}${isNil(v) ? (d ? html`<span class="cc-acct__why">NOT DECLARED</span>` : "") : tag}</span>
  </div>`;
  let note;
  if (!connected) note = html`<b>${sourceShort(rSrc)}</b> — the research ledger's declared trial counts appear here.`;
  else if (!d) note = "Trial accounting not declared — research.json carries no trial_accounting block.";
  else note = html`Ledger-declared · never summed here${d.as_of ? html` · ${fmtDate(d.as_of)}` : ""}`;
  return html`<a class="cc-acct" href="#/research" data-trial-accounting="${!connected ? srcState(rSrc) : d ? "DECLARED" : "NOT_DECLARED"}">
    <span class="cc-acct__head">${icon("history")}Trial accounting</span>
    ${fig("reconstructed_baseline", "Reconstructed baseline", d?.reconstructed_baseline, html`<span class="${cx("cc-split__tag", originTone("RECONSTRUCTED"))}">RECON</span>`, "Rebuilt after source loss — declared by the ledger")}
    ${fig("live_recorded", "Live-recorded", d?.live_recorded, "", "Recorded at the time by the live ledger")}
    ${fig("global_count", "Global (declared)", d?.global_count, "", "Global trial count as declared by the ledger — the multiple-testing basis")}
    <span class="cc-acct__note">${note}</span>
  </a>`;
}

function researchStatus(ctx) {
  const rs = derived(ctx, "research_summary") ?? {};
  const ta = derived(ctx, "trial_accounting");
  const research = doc(ctx, "research");
  const rSrc = source(ctx, "research");
  const sSrc = source(ctx, "strategies");
  const aSrc = source(ctx, "agents");
  const ms = derived(ctx, "memory_stats") ?? {};
  const controls = derived(ctx, "controls");
  const slots = derived(ctx, "agent_slots") ?? [];

  const progs = rs.research_available ? research?.programmes ?? null : null;
  const hyps = rs.research_available ? research?.hypotheses ?? null : null;
  const trials = rs.research_available ? research?.trials ?? null : null;
  const strategies = rs.strategies_available ? doc(ctx, "strategies")?.strategies ?? null : null;
  const memories = ms.available ? doc(ctx, "memory")?.memories ?? null : null;
  const eligibleIds = rs.strategies_available && controls?.deployment_eligible ? new Set(controls.deployment_eligible) : null;

  const agentsOk = isOk(aSrc);
  const reporting = agentsOk ? countWhere(slots, (s) => s.reported) : null;
  const activeAgents = agentsOk ? countWhere(slots, (s) => ACTIVE_AGENT.has(s.status)) : null;

  const rEmpty = sourceShort(rSrc);
  const sEmpty = sourceShort(sSrc);

  return panel({
    span: 12,
    code: "CMD-02",
    title: "Research status",
    sub: "Ledger- and registry-declared · counted per record origin, never merged or estimated",
    actions: go("RESEARCH OVERVIEW", "#/research"),
    cls: "cc-panel-kpi",
    body: html`<div class="cc-cq"><div class="cc-kpis">
      ${heroValidated(ctx, rs, sSrc)}
      <div class="cc-kpis__main">
      <div class="cc-kpis__grid" data-origin-counts>${statRow([
        stat({
          label: "Active programmes",
          value: splitVal(originSplit(progs, (p) => ACTIVE_PROGRAMME.has(p.status))),
          hint: html`${hintSplit(originSplit(progs, (p) => p.status === "RUNNING"))} running · ${hintSplit(originSplit(progs, (p) => p.status === "SPEC_FROZEN"))} spec frozen`,
          emptyLabel: rEmpty,
        }),
        stat({
          label: "Hypotheses",
          value: splitVal(originSplit(hyps)),
          hint: html`${hintSplit(originSplit(hyps, (h) => h.terminal === "REJECTED"))} rejected · ${hintSplit(originSplit(hyps, (h) => h.terminal === "BLOCKED_BY_DATA"))} blocked by data`,
          emptyLabel: rEmpty,
          title: "Hypotheses per record origin. Origins are counted separately and never merged.",
        }),
        stat({
          label: "Trial records",
          value: splitVal(originSplit(trials)),
          hint: html`${hintSplit(originSplit(trials, (t) => t.outcome === "RUNNING"))} running · individual records present`,
          emptyLabel: rEmpty,
          title: "Individual trial records present, per origin. The ledger's declared accounting is listed separately below.",
        }),
        stat({
          label: "Candidates",
          value: splitVal(originSplit(strategies, (s) => CANDIDATE_STATUSES.has(s.status))),
          hint: "Candidate or in validation",
          emptyLabel: sEmpty,
        }),
        stat({
          label: "Deployment-eligible",
          value: eligibleIds ? splitVal(originSplit(strategies, (s) => eligibleIds.has(s.strategy_id))) : null,
          hint: "Validated · approved · packaged",
          emptyLabel: sEmpty,
        }),
        stat({
          label: "Deployed",
          value: splitVal(originSplit(strategies, (s) => DEPLOYED_STATUSES.has(s.status))),
          hint: "Sim · live · scaled",
          emptyLabel: sEmpty,
        }),
        stat({
          label: "Agents active",
          value: fc(activeAgents),
          hint: html`of 5 slots · ${reporting} reporting`,
          emptyLabel: sourceShort(aSrc),
        }),
        stat({
          label: "Memories",
          value: splitVal(originSplit(memories)),
          hint: html`${hintSplit(memSplit(ms, memories, "high_confidence_by_origin", isHighConfidence))} high-confidence validated`,
          emptyLabel: sourceShort(source(ctx, "memory")),
        }),
      ])}</div>
      ${trialAccounting(ctx, ta, rSrc)}
      </div>
    </div></div>`,
  });
}

/* ------------------------------------------------------------ pipeline hero */

function pipelineHero(ctx) {
  const pipe = derived(ctx, "pipeline");
  const items = pipe?.available ? pipe.items : null;
  const rs = derived(ctx, "research_summary") ?? {};
  const controls = derived(ctx, "controls");
  const sSrc = source(ctx, "strategies");
  const eligible = rs.strategies_available ? controls?.deployment_eligible ?? [] : null;
  const recon = items ? countWhere(items, (i) => i.origin === "RECONSTRUCTED") : 0;
  const rSrc = source(ctx, "research");
  // Why there are no outcome counts, worded from each source's own status.
  const pipeSources = `Outcome counts unavailable — research.json ${sourceShort(rSrc).toLowerCase()}, strategies.json ${sourceShort(sSrc).toLowerCase()}.`;

  const outcome = (key, label, split, cls) =>
    html`<span class="${cx("cc-outcome", cls, !hasOtherOrigins(split) && !originalOf(split) && "is-zero")}" data-terminal="${key}"><i></i>${label}<b>${splitVal(split, { cls: "cc-split--sm" })}</b></span>`;
  const outcomes = items
    ? html`<div class="cc-outcomes">${TERMINALS.map((t) => outcome(t, humanize(t), originSplit(items, (i) => i.terminal === t), toneClass(t)))}${outcome(
        "ACTIVE",
        "Still active",
        originSplit(items, (i) => !i.terminal),
        "cc-outcome--active",
      )}</div>`
    : html`<span class="muted small" data-outcomes-unavailable>${pipeSources}</span>`;

  let gate;
  if (eligible === null) gate = html`<span class="muted">${sourceTitle(sSrc, "Strategy registry")}</span>`;
  else if (eligible.length === 0) gate = html`<span class="text-2">No strategy in strategies.json is validated, approved and packaged.</span>`;
  else gate = html`<span class="cluster">${eligible.map((id) => refLink(id, `#/strategy/${encodeURIComponent(id)}`))}</span>`;

  return panel({
    span: 12,
    variant: "hero",
    code: "CMD-03",
    title: "Research → deployment pipeline",
    sub: "Items reaching each stage, and where they stopped",
    actions: go("RESEARCH OVERVIEW", "#/research"),
    cls: "panel--accent cc-panel-pipe",
    body: html`
      ${pipelineDiagram(pipe)}
      <div class="cc-pipe-foot">
        <div class="cc-pipe-foot__row">
          <span class="cc-pipe-foot__k">Outcomes</span>
          ${outcomes}
        </div>
        <div class="cc-pipe-foot__row">
          <span class="cc-pipe-foot__k">Deployment gate</span>
          ${gate}
          <span class="cc-pipe-foot__rule">${icon("lock")}Rule · only validated, approved and packaged strategies may enter deployment</span>
        </div>
        <div class="cc-pipe-foot__row cc-pipe-foot__legend">
          ${legend([
            ["Reached", toneOf("ACTIVE")],
            ["Not reached", toneOf(null)],
            ["Rejected", toneOf("REJECTED")],
            ["Blocked / pending", toneOf("PENDING")],
          ])}
          <span class="muted small">${
            items
              ? html`Tracked once each — hypotheses: ${splitText(originSplit(items, (i) => i.kind === "HYPOTHESIS"))} / strategies: ${splitText(originSplit(items, (i) => i.kind === "STRATEGY"))}${
                  recon ? html` · <span class="${cx("cc-tonetext", toneClass("RECONSTRUCTED"))}" data-recon-items="${recon}">${recon} reconstructed item(s) included</span>` : ""
                }`
              : ""
          }</span>
        </div>
      </div>`,
  });
}

/* ------------------------------------------------------------ system loop */

function systemLoop(ctx) {
  const rs = derived(ctx, "research_summary") ?? {};
  const ms = derived(ctx, "memory_stats") ?? {};
  const slots = derived(ctx, "agent_slots") ?? [];
  const ev = source(ctx, "agent_events");
  const conn = (k) => isOk(source(ctx, k));
  // Record-bearing nodes are split by origin: the ring shows the ORIGINAL count
  // (labelled "orig"); every origin is listed beside it, never summed.
  const hyps = rs.research_available ? doc(ctx, "research")?.hypotheses ?? null : null;
  const mems = ms.available ? doc(ctx, "memory")?.memories ?? null : null;
  const strategies = rs.strategies_available ? doc(ctx, "strategies")?.strategies ?? null : null;
  const hypSplit = originSplit(hyps);
  const knowSplit = originSplit(mems);
  const stratSplit = originSplit(strategies);
  // Agent events carry a record origin too; split exactly when the fetched window holds the whole stream.
  const evSplit = isOk(ev) ? eventOriginSplit(ctx.extra?.events) : null;
  const obs = evSplit
    ? { value: originalOf(evSplit), split: evSplit, sub: "orig events" }
    : { value: isOk(ev) ? ev.valid_events : null, sub: isOk(ev) ? "events · all origins" : "agent events", lines: isOk(ev) };
  const nodes = [
    { key: "RESEARCH", label: "RESEARCH", src: "research", value: originalOf(hypSplit), split: hypSplit, sub: "orig hypotheses" },
    { key: "KNOWLEDGE", label: "KNOWLEDGE", src: "memory", value: originalOf(knowSplit), split: knowSplit, sub: "orig memories" },
    { key: "STRATEGIES", label: "STRATEGIES", src: "strategies", value: originalOf(stratSplit), split: stratSplit, sub: "orig in registry" },
    { key: "AGENTS", label: "AGENTS", src: "agents", value: conn("agents") ? countWhere(slots, (s) => ACTIVE_AGENT.has(s.status)) : null, sub: "active of 5" },
    { key: "OBSERVATIONS", label: "OBSERVATIONS", src: "agent_events", ...obs },
  ].map((n) => ({ ...n, connected: conn(n.src) }));
  const connected = nodes.filter((n) => n.connected).length;
  const otherOrigins = nodes.some((n) => hasOtherOrigins(n.split));
  const countCell = (n) => {
    if (n.split !== undefined) return splitVal(n.split, { cls: "cc-split--sm" }) ?? val(null);
    // A stream too long for the fetched window: its valid-line count, labelled as such (not an origin count).
    if (n.lines) return html`${val(fc(n.value))}<span class="cc-loop__unit" title="Valid lines in agent_events.jsonl, all origins — the stream exceeds the ${fc(EVENT_WINDOW)}-event window used to split it by origin">LINES</span>`;
    return val(fc(n.value));
  };

  return panel({
    span: 4,
    code: "CMD-10",
    title: "System loop",
    sub: `${connected} of ${nodes.length} nodes connected`,
    cls: "lg-span-6 cc-panel-loop",
    body: html`<div class="cc-cq"><div class="cc-loop">
      <div class="cc-loop__ring">${ccRing(nodes, { center: "SENTRY", centerSub: "EVIDENCE LOOP", width: 440, height: 330, r: 104, nodeR: 24, aria: "SENTRY system loop" })}</div>
      <div class="cc-loop__side">
        <ul class="cc-loop__legend">
          ${nodes.map((n) => {
            const src = source(ctx, n.src);
            return html`<li data-loop-node="${n.key}" data-connected="${n.connected ? "1" : "0"}">
              ${dot(srcState(src))}<span class="cc-loop__name">${n.label}</span>
              <span class="cc-loop__file" title="${src?.file ?? n.src}">${src?.file ?? n.src}</span>
              <span class="cc-loop__count">${countCell(n)}</span>
              <span class="${cx("cc-loop__state cc-tonetext", toneClass(srcState(src)))}">${sourceShort(src)}</span>
            </li>`;
          })}
        </ul>
        <div class="cc-loop__return">${icon("history")}<span>Observations flow back into <b>knowledge</b> → <b>better research</b>. Arcs animate only where both ends are connected; counts are declared, never estimated. Ring values for research, knowledge, strategies${evSplit ? " and observations" : ""} count ORIGINAL records${
          otherOrigins ? html`; <span data-loop-other-origins>other origins are listed above, never merged</span>` : ""
        }.</span></div>
      </div>
    </div></div>`,
  });
}

/* ------------------------------------------------------------ trading floor */

function eventFeed(ctx) {
  const evSrc = source(ctx, "agent_events");
  const res = ctx.extra?.events;
  if (!isOk(evSrc) && evSrc?.status !== "INVALID") {
    return emptyLine("Event stream " + sourceShort(evSrc).toLowerCase(), "Agent observations, decisions and no-trade evaluations stream here from agent_events.jsonl.");
  }
  if (ctx.extra?.error) return emptyLine("Event stream unavailable", ctx.extra.error, "alert");
  const events = res?.events ?? [];
  if (events.length === 0) {
    return isOk(evSrc)
      ? emptyLine("No agent events recorded", "agent_events.jsonl is connected and empty.")
      : emptyLine("No valid agent events", `agent_events.jsonl has ${fc(evSrc.invalid_lines ?? 0)} line(s) that do not conform to the event contract and none that do.`, "alert");
  }
  return html`<div class="cc-feed">${events.slice(0, 6).map(
    (e) => html`<a class="cc-feed__row" href="#/agents/${e.agent_slot}/activity" data-event="${e.event_id}">
      <span class="cc-feed__ts">${fmtTime(e.ts)}</span>
      <span class="cc-feed__slot">AGENT ${pad2(e.agent_slot)}</span>
      <span class="cc-feed__kind">${badge(e.kind, { label: humanize(e.kind) })}</span>
      <span class="cc-feed__msg">${e.summary}</span>
      <span class="cc-feed__mode">${chip(e.mode)}${originBadge(e.origin)}</span>
    </a>`,
  )}</div>`;
}

function tradingFloor(ctx) {
  const slots = derived(ctx, "agent_slots") ?? [];
  const aSrc = source(ctx, "agents");
  const evSrc = source(ctx, "agent_events");
  const controls = derived(ctx, "controls");
  const halt = controls?.actions?.find((a) => a.key === "HALT_AGENT");
  const reporting = countWhere(slots, (s) => s.reported);
  const active = countWhere(slots, (s) => ACTIVE_AGENT.has(s.status));
  const assigned = countWhere(slots, (s) => s.has_strategy);
  // Stream total per record origin when the fetched window covers it; otherwise valid lines, labelled as all origins.
  const evSplit = isOk(evSrc) || evSrc?.status === "INVALID" ? eventOriginSplit(ctx.extra?.events) : null;
  let evCount;
  if (evSplit) evCount = html`<span data-event-origins>${splitText(evSplit)} event(s)</span>`;
  else if (isOk(evSrc) || evSrc?.status === "INVALID") evCount = html`${fc(evSrc.valid_events)} valid line(s) · all origins`;
  else evCount = sourceShort(evSrc);
  return panel({
    span: 12,
    code: "CMD-04",
    title: "Trading floor",
    sub: isOk(aSrc)
      ? `${reporting} of 5 slots reporting · ${active} active · ${assigned} with an assigned strategy`
      : `Five agent slots · ${sourceReason(aSrc) ?? ""}`,
    actions: html`${halt ? controlButton(halt, "stop") : ""}${go("AGENT OVERVIEW", "#/agents")}`,
    cls: "cc-panel-floor",
    body: html`<div class="agent-grid cc-floor">${slots.map((s) => agentMini(s, { now: ctx.now }))}</div>
      <div class="cc-floor__feed">
        ${subhead(html`${icon("live")}Latest agent events`, html`${evCount}${
          evSrc?.invalid_lines ? html` · <span class="${cx("cc-tonetext", toneClass("WARNING"))}">${evSrc.invalid_lines} invalid line(s)</span>` : ""
        }`)}
        ${eventFeed(ctx)}
      </div>`,
  });
}

/* ------------------------------------------------------------ research focus */

/**
 * The current research family. Only ResearchFocus.family declares it; the families
 * declared on the focus programme / hypothesis records are listed beside it with
 * their record ids when they differ — never chosen between or promoted to "the" family.
 */
function focusFamily(f, research, rSrc) {
  let state;
  let value;
  if (!research) {
    state = srcState(rSrc);
    value = val(null);
  } else if (f?.family) {
    state = "DECLARED";
    value = html`<span class="cc-fam__v">${f.family}</span>`;
  } else {
    state = "NOT_DECLARED";
    value = html`<span class="cc-fam__none" title="${f ? "The focus block declares no family" : "research.json declares no focus"}">NOT DECLARED</span>`;
  }
  const linked = [];
  if (research && f) {
    const prog = f.programme_id ? research.programmes.find((p) => p.programme_id === f.programme_id) : null;
    const hyp = f.hypothesis_id ? research.hypotheses.find((h) => h.hypothesis_id === f.hypothesis_id) : null;
    if (prog?.family && prog.family !== f.family) linked.push(["PROGRAMME", prog.programme_id, prog.family]);
    if (hyp?.family && hyp.family !== f.family) linked.push(["HYPOTHESIS", hyp.hypothesis_id, hyp.family]);
  }
  return html`<div class="cc-fam" data-focus-family="${state}">
    <span class="cc-fam__k">Research family</span>
    <span class="cc-fam__body">${value}${linked.map(
      ([kind, id, fam]) =>
        html`<span class="cc-fam__link" data-family-of="${kind}" title="Family declared on ${kind.toLowerCase()} ${id}; shown as declared there, not taken as the focus family"><i>${kind} ${id}</i><b>${fam}</b></span>`,
    )}</span>
  </div>`;
}

function researchFocus(ctx) {
  const research = doc(ctx, "research");
  const rSrc = source(ctx, "research");
  const f = research?.focus ?? null;
  const progs = research ? research.programmes.filter((p) => ACTIVE_PROGRAMME.has(p.status)) : null;
  const hyps = research?.hypotheses ?? null;

  let focusBody;
  if (!research) {
    focusBody = html`${kv([
      ["Programme", null],
      ["Hypothesis", null],
    ])}${focusFamily(null, null, rSrc)}<div class="cc-focus__summary">${emptyLine(sourceTitle(rSrc, "Research focus"), "The research engine's current focus, family and next action appear here.")}</div>`;
  } else if (!f) {
    focusBody = html`${emptyLine("No current focus declared", "research.json is connected but carries no focus block.")}${focusFamily(null, research, rSrc)}`;
  } else {
    focusBody = html`${kv([
      ["Programme", f.programme_id ? html`<span class="ref">${f.programme_id}</span>` : null],
      ["Hypothesis", f.hypothesis_id ? refLink(f.hypothesis_id, `#/research/hypotheses?focus=${encodeURIComponent(f.hypothesis_id)}`) : null],
    ])}
      ${focusFamily(f, research, rSrc)}
      <p class="cc-focus__summary">${f.summary ?? html`<span class="muted">No summary declared</span>`}</p>
      <div class="cc-focus__next"><span class="cc-focus__nextk">NEXT ACTION</span><span>${f.next_action ?? val(null)}</span></div>`;
  }

  let progBody;
  if (!research) progBody = emptyLine(sourceTitle(rSrc, "Programmes"), "Programmes with status RUNNING or SPEC FROZEN are listed here.");
  else if (progs.length === 0)
    progBody = emptyLine("None running or frozen", `${research.programmes.length} programme(s) recorded; none is RUNNING or SPEC FROZEN.`);
  else
    progBody = html`<div class="cc-progs">${progs.map(
      (p) => html`<div class="cc-prog" data-programme="${p.programme_id}">
        <div class="cc-prog__top"><span class="ref">${p.programme_id}</span>${badge(p.status)}${p.universe_status ? chip(`UNIVERSE ${humanize(p.universe_status)}`, { title: "Universe status" }) : ""}${originBadge(p.origin)}</div>
        <div class="cc-prog__name" title="${p.name}">${p.name}${p.family ? html`<span class="muted"> · ${p.family}</span>` : ""}</div>
      </div>`,
    )}</div>`;

  let hypBody;
  if (!hyps) hypBody = emptyLine(sourceTitle(rSrc, "Hypotheses"), "Hypothesis outcomes — including every rejection — are counted here.");
  else if (hyps.length === 0) hypBody = emptyLine("No hypotheses recorded", "research.json is connected and lists no hypotheses.");
  else {
    const order = ["TESTING", "PREREGISTERED", "PROPOSED", "PENDING", "VALIDATED", "REJECTED", "BLOCKED_BY_DATA", "ABANDONED"];
    const present = order.filter((s) => hyps.some((h) => h.status === s));
    hypBody = html`<div class="cc-hypstat">${present.map(
      (s) => html`<span class="${cx("cc-hypstat__item", toneClass(s))}" data-hyp-status="${s}"><b>${splitVal(originSplit(hyps, (h) => h.status === s), { cls: "cc-split--chip" })}</b><span class="cc-hypstat__k">${humanize(s)}</span></span>`,
    )}</div>`;
  }

  return panel({
    span: 4,
    code: "CMD-05",
    title: "Research focus",
    sub: "Focus, family, programmes, outcomes",
    actions: go("HYPOTHESES", "#/research/hypotheses"),
    cls: "lg-span-12",
    body: html`<div class="cc-focus">${focusBody}</div>
      ${subhead("Active programmes", progs ? splitText(originSplit(progs), "running / frozen") : "")}
      ${progBody}
      ${subhead("Hypothesis outcomes", hyps ? `${splitText(originSplit(hyps))} · failures stay visible` : "")}
      ${hypBody}`,
  });
}

/* ------------------------------------------------------------ memory */

/**
 * Cumulative memories per day, one series per record origin (days grouped as
 * derive.memory_stats.growth groups them: the created_at date as written).
 * Origins are separate series on a shared day axis, never one merged line.
 */
function growthByOrigin(mems) {
  if (!Array.isArray(mems) || mems.length === 0) return null;
  const day = (m) => String(m.created_at ?? "").slice(0, 10);
  const days = [...new Set(mems.map(day))].sort();
  const split = originSplit(mems);
  const series = presentOrigins(split).map((o) => {
    const perDay = new Map();
    for (const m of mems) if ((m.origin ?? "UNDECLARED") === o) perDay.set(day(m), (perDay.get(day(m)) ?? 0) + 1);
    let n = 0;
    return { origin: o, total: split[o], values: days.map((d) => (n += perDay.get(d) ?? 0)) };
  });
  return { first: days[0], last: days[days.length - 1], series };
}

function growthRow(s, multi) {
  const tag = ORIGIN_TAG[s.origin] ?? s.origin;
  return html`<div class="cc-growth__row" data-growth-origin="${s.origin}" title="${fc(s.total)} ${humanize(s.origin).toLowerCase()} memories, cumulative by day">
    <span class="${cx("cc-split__tag", s.origin !== "ORIGINAL" && originTone(s.origin))}">${tag}</span>
    <div class="cc-growth__chart">${sparkline(s.values, { width: 320, height: multi ? 22 : 30 })}</div>
    <span class="cc-growth__n">${val(fc(s.total))}</span>
  </div>`;
}

function memoryPanel(ctx) {
  const ms = derived(ctx, "memory_stats") ?? {};
  const mSrc = source(ctx, "memory");
  const memDoc = doc(ctx, "memory");
  const byId = new Map((memDoc?.memories ?? []).map((m) => [m.memory_id, m]));
  const empty = sourceShort(mSrc);
  const mems = ms.available ? memDoc?.memories ?? null : null;
  const rejectedAssumption = (m) => m.type === "REJECTED_ASSUMPTION" || m.status === "REJECTED";

  let recent;
  if (!ms.available) recent = emptyLine(empty, "Recent evidence-backed findings, lessons and failed mechanisms appear here.");
  else if (ms.recent.length === 0) recent = emptyLine("No memories recorded", "memory.json is connected and empty.");
  else
    recent = html`<ul class="cc-mem">${ms.recent.slice(0, 4).map((id) => {
      const m = byId.get(id);
      return html`<li class="cc-mem__row" data-memory="${id}">
        <a class="cc-mem__title" href="#/memory/item/${encodeURIComponent(id)}" title="${m?.title ?? id}">${m?.title ?? id}</a>
        <span class="cc-mem__meta"><span class="ref">${id}</span>${m ? html`${chip(humanize(m.type))}${badge(m.confidence)}${badge(m.validation_state)}${originBadge(m.origin)}` : badge("UNRESOLVED")}</span>
      </li>`;
    })}</ul>`;

  const growth = ms.available ? growthByOrigin(mems) : null;
  return panel({
    span: 4,
    code: "CMD-06",
    title: "Memory",
    sub: "Evidence-backed knowledge, per origin",
    actions: go("MEMORY", "#/memory"),
    cls: "lg-span-6 cc-panel-mem",
    body: html`${statRow(
      [
        stat({ label: "Memories", value: splitVal(originSplit(mems)), emptyLabel: empty, hint: "All types · per origin" }),
        stat({ label: "High-confidence", value: splitVal(memSplit(ms, mems, "high_confidence_by_origin", isHighConfidence)), emptyLabel: empty, hint: "HIGH · validated" }),
        stat({ label: "Unresolved", value: splitVal(memSplit(ms, mems, "unresolved_by_origin", isUnresolved)), emptyLabel: empty, hint: "Pending review" }),
      ],
      { min: 96 },
    )}
      <div class="cc-growth" data-growth-series="${growth ? growth.series.length : 0}">
        <div class="cc-growth__head"><span class="label">Knowledge growth</span><span class="small muted">${
          growth
            ? html`cumulative per origin · ${fmtDate(growth.first)} → ${fmtDate(growth.last)}`
            : ms.available
              ? "No memories recorded"
              : empty
        }</span></div>
        ${growth
          ? growth.series.map((s) => growthRow(s, growth.series.length > 1))
          : html`<div class="cc-growth__chart">${sparkline(null, { width: 320, height: 30 })}</div>`}
      </div>
      ${subhead(
        "Recently recorded",
        mems
          ? html`${splitVal(originSplit(mems, (m) => m.validation_state === "CONTRADICTED"), { cls: "cc-split--sm" })} contradicted · ${splitVal(originSplit(mems, rejectedAssumption), {
              cls: "cc-split--sm",
            })} rejected assumptions`
          : "",
      )}
      ${recent}`,
  });
}

/* ------------------------------------------------------------ risk */

const LIMIT_GROUPS = [
  ["portfolio_limits", "Portfolio"],
  ["daily_limits", "Daily"],
  ["execution_limits", "Execution"],
];
function fmtLimitValue(v, l) {
  const f = fmtLimit(v, l);
  return f.empty ? null : `${f.text}${f.suffix ? ` ${f.suffix}` : ""}`;
}

function limitRow(l) {
  const used = fmtLimitValue(l.used, l);
  return html`<div class="cc-limit" data-limit="${l.key}" data-state="${l.state}">
    <span class="cc-limit__label" title="${l.label}">${l.label}</span>
    <span class="cc-limit__nums">${val(used)}<span class="muted"> / </span><span class="v" data-v>${fmtLimitValue(l.limit, l)}</span></span>
    ${badge(l.state)}
    <div class="cc-limit__meter">${meter(l.used, l.limit, { state: l.state })}</div>
  </div>`;
}

function riskPanel(ctx) {
  const risk = doc(ctx, "risk");
  const rSrc = source(ctx, "risk");
  const controls = derived(ctx, "controls");
  const kill = controls?.actions?.find((a) => a.key === "TRIP_KILL_SWITCH");
  const ks = risk?.kill_switch ?? null;
  const ksState = risk ? ks?.state ?? "NOT_REPORTED" : srcState(rSrc);
  const breaches = risk?.breaches ?? null;

  return panel({
    span: 4,
    code: "CMD-08",
    title: "Risk",
    sub: risk ? html`As of ${fmtAge(risk.as_of, ctx.now)}` : sourceReason(rSrc),
    actions: go("RISK", "#/risk"),
    cls: "lg-span-12 cc-panel-risk",
    body: html`<div class="${cx("cc-kill", toneClass(ksState))}" data-kill-switch="${ksState}">
        <div class="cc-kill__main">${icon("power")}<span class="cc-kill__k">Kill switch</span>${badge(ksState)}</div>
        <div class="cc-kill__detail">${risk ? ks?.detail ?? (ks ? "No detail declared" : "risk.json carries no kill switch block") : `${sourceTitle(rSrc, "risk.json")} — the kill-switch state is read from it.`}${
          ks?.tripped_at ? html` · tripped ${fmtAge(ks.tripped_at, ctx.now)}` : ""
        }</div>
        ${kill ? html`<div class="cc-kill__btn">${controlButton(kill, "power")}</div>` : ""}
      </div>
      <div class="cc-cq"><div class="cc-limits-wrap">${LIMIT_GROUPS.map(([key, label]) => {
        const list = risk ? risk[key] : null;
        return html`<div class="cc-limits" data-limit-group="${key}">
          ${subhead(`${label} limits`, list ? `${list.length} declared` : "")}
          ${list === null
            ? html`<div class="cc-limit cc-limit--empty"><span class="cc-limit__label muted">${sourceShort(rSrc)}</span><div class="cc-limit__meter">${meter(null, null)}</div></div>`
            : list.length === 0
              ? emptyLine("None declared", `risk.json declares no ${label.toLowerCase()} limits.`)
              : list.map(limitRow)}
        </div>`;
      })}</div></div>
      <div class="cc-breaches">${subhead(
        "Breaches",
        breaches === null ? sourceShort(rSrc) : breaches.length === 0 ? "None recorded" : html`${SEVERITIES.filter((s) => breaches.some((b) => b.severity === s)).map((s) => badge(s, { label: `${countWhere(breaches, (b) => b.severity === s)} ${s}` }))}`,
      )}</div>`,
  });
}

/* ------------------------------------------------------------ live */

function livePanel(ctx) {
  const live = doc(ctx, "live");
  const pf = doc(ctx, "portfolio");
  const lSrc = source(ctx, "live");
  const pSrc = source(ctx, "portfolio");
  const lEmpty = sourceShort(lSrc);
  const pnl = live?.pnl ?? null;

  const head = html`<div class="cc-live-head">
    <div class="cc-live-head__item"><span class="label">Engine</span>${badge(live ? live.engine_state : srcState(lSrc))}</div>
    <div class="cc-live-head__item"><span class="label">Trading mode</span>${live ? badge(live.trading_mode) : val(null)}</div>
    <div class="cc-live-head__item"><span class="label">Trading enabled</span>${live ? badge(live.trading_enabled ? "ENABLED" : "DISABLED", { label: live.trading_enabled ? "ENABLED" : "DISABLED" }) : val(null)}</div>
    <div class="cc-live-head__item"><span class="label">Heartbeat</span>${val(live?.heartbeat_at ? fmtAge(live.heartbeat_at, ctx.now) : null)}</div>
    ${live?.detail ? html`<div class="cc-live-head__detail">${live.detail}</div>` : ""}
  </div>`;

  const asOf = pnl ? html`as of ${fmtAge(pnl.as_of, ctx.now)}` : "";
  const pnlEmpty = live ? "NOT REPORTED" : lEmpty;
  const stats = statRow(
    [
      stat({ label: "Positions open", value: live ? fc(live.positions_open) : null, emptyLabel: pnlEmpty, hint: "Declared by live.json" }),
      stat({ label: "Orders working", value: live ? fc(live.orders_working) : null, emptyLabel: pnlEmpty, hint: "Declared by live.json" }),
      stat({ label: "P&L · day", value: pnl?.day ? metric(pnl.day) : null, emptyLabel: pnlEmpty, hint: asOf }),
      stat({ label: "P&L · realized", value: pnl?.realized ? metric(pnl.realized) : null, emptyLabel: pnlEmpty, hint: asOf }),
      stat({ label: "P&L · unrealized", value: pnl?.unrealized ? metric(pnl.unrealized) : null, emptyLabel: pnlEmpty, hint: asOf }),
    ],
    { min: 128 },
  );

  let conns;
  if (!live) conns = emptyLine(lEmpty, "Market-data and broker connections are listed here.");
  else if (live.connections.length === 0) conns = emptyLine("No connections declared", "live.json lists no market-data or broker connections.");
  else
    conns = html`<div class="mini-list">${live.connections.map(
      (c) => html`<div class="mini-list__row" data-connection="${c.name}">${dot(c.state, { pulse: toneOf(c.state) === "info" })}<span class="grow" title="${c.detail ?? c.name}">${c.name}</span>${chip(humanize(c.kind))}${badge(c.state)}</div>`,
    )}</div>`;

  let positions;
  if (!pf) positions = emptyLine(sourceShort(pSrc), "Open positions from portfolio.json are listed here.");
  else if (pf.positions.length === 0) positions = emptyLine("No open positions", `portfolio.json (${humanize(pf.mode)}) reports none.`);
  else
    positions = html`<div class="mini-list">${pf.positions.map(
      (p) => html`<div class="mini-list__row" data-position="${p.instrument}"><span class="ref">${p.instrument}</span>${badge(p.side)}<span class="v" data-v>${fmtNum(p.quantity, Number.isInteger(p.quantity) ? 0 : 2)}</span><span class="muted small">@</span>${val(isNil(p.avg_price) ? null : fmtNum(p.avg_price, 2))}<span class="grow"></span>${p.unrealized_pnl ? metric(p.unrealized_pnl) : val(null)}${p.mode !== pf.mode ? chip(humanize(p.mode)) : ""}</div>`,
    )}</div>`;

  const exec = doc(ctx, "execution");
  const eSrc = source(ctx, "execution");
  let orders;
  if (!exec) orders = emptyLine(sourceShort(eSrc), "Working orders from execution.json are listed here.");
  else if (exec.open_orders.length === 0) orders = emptyLine("No working orders", "execution.json reports no open orders.");
  else
    orders = html`<div class="mini-list">${exec.open_orders.slice(0, 4).map(
      (o) => html`<div class="mini-list__row" data-order="${o.order_id}"><span class="ref">${o.order_id}</span>${chip(o.side)}<span class="v" data-v>${fmtNum(o.quantity, Number.isInteger(o.quantity) ? 0 : 2)}</span><span class="muted small">${o.instrument}</span><span class="grow"></span>${chip(o.order_type)}${badge(o.status)}</div>`,
    )}${exec.open_orders.length > 4 ? html`<a class="small cc-more" href="#/execution">+${exec.open_orders.length - 4} more →</a>` : ""}</div>`;

  return panel({
    span: 8,
    code: "CMD-09",
    title: "Live",
    sub: live ? html`Live engine as of ${fmtAge(live.as_of, ctx.now)}` : sourceReason(lSrc),
    actions: html`${go("LIVE ENGINE", "#/live")}${go("PORTFOLIO", "#/portfolio")}`,
    cls: "lg-span-12 cc-panel-live",
    body: html`${head}${stats}
      <div class="cc-live-cols">
        <div>${subhead("Connections", live ? `${live.connections.length} declared` : "")}${conns}</div>
        <div>${subhead("Positions", pf ? html`${humanize(pf.mode)} · ${fmtAge(pf.as_of, ctx.now)}` : "")}${positions}</div>
        <div>${subhead("Working orders", exec ? html`${exec.open_orders.length} open` : "")}${orders}</div>
      </div>`,
  });
}

/* ------------------------------------------------------------ alerts */

function alertsPanel(ctx) {
  const findings = derived(ctx, "consistency") ?? [];
  const research = doc(ctx, "research");
  const rSrc = source(ctx, "research");
  const cov = checkSummary(ctx);
  // Severity counts are facts only about the check families that ran (derived.check_coverage).
  const counted = cov.available ? cov.anyRan : DOC_KEYS.some((k) => isOk(source(ctx, k))) || isOk(source(ctx, "agent_events"));
  const notices = research?.integrity_notices ?? null;
  const skipped = cov.skipped.length;
  let none;
  if (counted) {
    none = emptyLine(
      "No findings",
      cov.available
        ? `None from the ${cov.ran} of ${cov.total} check families that ran${skipped ? `; ${skipped} did not run (a source unavailable or a bound not declared)` : ""}.`
        : "None from the checks that ran.",
      "shield",
    );
  } else {
    none = emptyLine(
      ctx.snap?.provider?.location ? "No cross-checks ran" : "Not connected",
      ctx.snap?.provider?.location ? "No contract document is available, so nothing has been cross-checked." : "No SENTRY state directory is configured, so nothing has been cross-checked.",
    );
  }
  return panel({
    span: 4,
    code: "CMD-07",
    title: "Alerts",
    sub: counted && cov.available ? `Findings · ${cov.ran} of ${cov.total} check families ran` : "Consistency findings and integrity notices",
    actions: go("GOVERNANCE", "#/governance"),
    cls: "lg-span-6 cc-panel-alerts",
    body: html`<div class="cc-sev" data-checks-ran="${cov.available ? cov.ran : ""}">${SEVERITIES.map((s) => {
        const n = counted ? countWhere(findings, (f) => f.severity === s) : null;
        return html`<div class="cc-sev__item" data-severity="${s}">${dot(n ? s : null)}<span class="cc-sev__k">${s}</span>${val(isNil(n) ? null : String(n))}</div>`;
      })}</div>
      ${findingsList(findings, { limit: 4, empty: none })}
      ${subhead("Integrity notices", notices ? `${notices.length} declared` : sourceShort(rSrc))}
      ${notices === null
        ? emptyLine(sourceTitle(rSrc, "Integrity notices"), "Integrity notices declared by the research engine appear here.")
        : notices.length === 0
          ? emptyLine("No integrity notices declared", null, "shield")
          : html`${integrityNotices(notices.slice(0, 2))}${notices.length > 2 ? html`<a class="small cc-more" href="#/governance">+${notices.length - 2} more on Governance →</a>` : ""}`}`,
  });
}

/* ------------------------------------------------------------ command deck */

function commandDeck(ctx) {
  const controls = derived(ctx, "controls");
  return panel({
    span: 4,
    code: "CMD-11",
    title: "Command deck",
    sub: "Locked — blockers computed from state",
    cls: "lg-span-6 cc-panel-deck",
    body: controls
      ? html`<div class="cc-deck">${controls.actions.map((a) => control(a))}</div>`
      : emptyState({ title: "No snapshot", compact: true }),
  });
}

/* ------------------------------------------------------------ view */

export default {
  title: "Command Centre",
  async load(ctx) {
    const ev = ctx.snap?.events_source;
    if (!ev || (ev.status !== "OK" && ev.status !== "INVALID")) return { events: null };
    try {
      // The feed shows the latest six; the window lets the stream be counted per record origin.
      return { events: await fetchEvents({ limit: EVENT_WINDOW }) };
    } catch (err) {
      return { events: null, error: String(err?.message ?? err) };
    }
  },
  render(ctx) {
    const snap = ctx.snap;
    const okCount = DOC_KEYS.filter((k) => isOk(source(ctx, k))).length;
    return html`
      <div class="cc-home">
      ${pageHeader({
        kicker: "MISSION CONTROL",
        code: "CMD",
        title: "Command Centre",
        sub: "SENTRY control room. Research discovers and validates; governance approves; agents may run only approved strategies; memory records what is learned. Every value is producer-declared — empty means not reported, never zero.",
        right: html`<span class="cc-headchip" data-sources-ok="${okCount}">${icon("sources")}SOURCES <b>${okCount}/${DOC_KEYS.length}</b></span>
          <span class="cc-headchip">${icon("live")}EVENTS <b>${sourceShort(source(ctx, "agent_events"))}</b></span>
          <span class="cc-headchip">${icon("clock")}SNAPSHOT <b>${fmtTime(snap.generated_at)}Z</b></span>`,
      })}

      <div class="grid">${systemStatus(ctx)}</div>
      <div class="grid">${researchStatus(ctx)}</div>
      <div class="grid">${pipelineHero(ctx)}</div>
      <div class="grid">${tradingFloor(ctx)}</div>
      <div class="grid">${researchFocus(ctx)}${memoryPanel(ctx)}${alertsPanel(ctx)}</div>
      <div class="grid">${riskPanel(ctx)}${livePanel(ctx)}</div>
      <div class="grid">${systemLoop(ctx)}${commandDeck(ctx)}${doctrine()}</div>
      </div>
    `;
  },
};

function doctrine() {
  return panel({
    span: 4,
    code: "CMD-12",
    title: "Operating doctrine",
    sub: "Policy every displayed state is held to",
    cls: "lg-span-12",
    body: html`<div class="doctrine cc-doctrine">
      <div class="doctrine__item"><b>NO-TRADE &gt; WEAK TRADE</b><span>An empty trading floor is a valid outcome and is displayed as one.</span></div>
      <div class="doctrine__item"><b>NO EDGE &gt; FAKE EDGE</b><span>Failed research families stay visible; this view backfills and estimates nothing.</span></div>
      <div class="doctrine__item"><b>EVIDENCE BEFORE PROMOTION</b><span>Only validated, approved and packaged strategies may reach an agent; the cross-checks flag any that do not.</span></div>
      <div class="doctrine__item"><b>VERSIONS, NOT EDITS</b><span>Agents must never silently modify a live strategy; improvements become new versions.</span></div>
      <div class="doctrine__item"><b>ACCURACY &gt; POLISH</b><span>Absent values render as —; a reported zero renders as 0.</span></div>
    </div>`,
  });
}
