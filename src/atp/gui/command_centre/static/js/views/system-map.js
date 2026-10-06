// System Map — SENTRY's architecture with a live status overlay.
// Connection states come from snapshot sources; counts come from documents /
// derived. Architecture labels (node names, step names, role names, doctrine)
// are constants; every number is declared state or empty.

import { html, raw, cx } from "../core/html.js";
import { fmtAge, fmtTime, fmtNum, humanize, isNil, shortHash } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort, sourceTitle } from "../core/state.js";
import { toneClass } from "../core/tones.js";
import { fetchEvents } from "../core/api.js";
import { pageHeader, panel, badge, dot, chip, val, originBadge, sourceTag, table, refLink } from "../components/ui.js";
import { steps } from "../components/flow.js";
import { icon } from "../components/icons.js";
import { ccRing } from "./_command-ring.js";
import {
  DOC_KEYS,
  isOk,
  srcState,
  srcBadge,
  srcLine,
  countWhere,
  go,
  subhead,
  emptyLine,
  originSplit,
  originalOf,
  splitFrom,
  splitVal,
  splitText,
  hasOtherOrigins,
  originTone,
  subsystemState,
  subsystemReason,
  checkSummary,
  EVENT_WINDOW,
  eventOriginSplit,
} from "./_command-common.js";

const RESEARCH_SIDE = ["research", "strategies", "memory", "governance", "datasets", "insights"];
const TRADING_SIDE = ["agents", "agent_events", "portfolio", "risk", "execution", "live"];

/* ------------------------------------------------------------ SYS-01 architecture */

function sysEntry(ctx, key) {
  return (derived(ctx, "system") ?? []).find((s) => s.key === key) ?? null;
}

function archNode({ code, key, title, role, state, extra, lines, meta, metaTitle }) {
  return html`<div class="${cx("cc-node", toneClass(state))}" data-arch-node="${key}" data-state="${state}">
    <div class="cc-node__head"><span class="cc-node__code">${code}</span>${extra}</div>
    <div class="cc-node__title">${title}</div>
    <div class="cc-node__role">${role}</div>
    <ul class="cc-node__lines">${lines}</ul>
    ${meta ? html`<div class="${cx("cc-node__meta", metaTitle && "cc-node__meta--clamp")}" ${metaTitle ? html`title="${metaTitle}"` : ""}>${meta}</div>` : ""}
  </div>`;
}

/** Footer of the research-engine node: its system.json declaration, or why there is none. */
function declaredMeta(ctx, entry) {
  const d = entry?.declared;
  if (d) {
    // A contradicted declaration leads with the contradiction (which names the declared state).
    const parts = [entry.source_problem ?? `DECLARED ${humanize(d.state)}`];
    if (d.heartbeat_at) parts.push(`HB ${fmtAge(d.heartbeat_at, ctx.now)}`);
    if (!entry.source_problem && d.detail) parts.push(d.detail);
    const text = parts.join(" · ");
    return { meta: entry.source_problem ? html`<span class="${cx("cc-tonetext", toneClass(entry.state))}" data-source-problem>${text}</span>` : text, metaTitle: text };
  }
  const text = subsystemReason(ctx, entry);
  return { meta: html`<span class="muted">${text}</span>`, metaTitle: text };
}

function archLink({ key, label, sub, connected, locked = false }) {
  // Trusted constant SVG (no state strings inside).
  const line = connected
    ? `<line x1="2" y1="7" x2="86" y2="7" stroke="rgba(34,211,238,.25)" stroke-width="2"/><line class="flow-dash" x1="2" y1="7" x2="86" y2="7" stroke="var(--cyan-2)" stroke-width="1.5"/>`
    : `<line x1="2" y1="7" x2="86" y2="7" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 4"/>`;
  const head = `<path d="M84 3 L90 7 L84 11" fill="none" stroke="${connected ? "var(--cyan-2)" : "var(--faint)"}" stroke-width="1.2"/>`;
  return html`<div class="${cx("cc-link", connected && "is-on", locked && "is-locked")}" data-arch-link="${key}" data-connected="${connected ? "1" : "0"}">
    <div class="cc-link__label">${locked ? icon("lock") : ""}${label}</div>
    <svg class="cc-link__svg" viewBox="0 0 92 14" aria-hidden="true">${raw(line + head)}</svg>
    <div class="cc-link__sub">${sub}</div>
  </div>`;
}

function architecture(ctx) {
  const snap = ctx.snap;
  const research = sysEntry(ctx, "research_engine");
  const agentNet = sysEntry(ctx, "agent_network");
  const trading = sysEntry(ctx, "trading_engine");
  const okDocs = DOC_KEYS.filter((k) => isOk(source(ctx, k))).length;
  const badDocs = DOC_KEYS.filter((k) => ["INVALID", "UNREADABLE"].includes(source(ctx, k)?.status)).length;
  const evSrc = source(ctx, "agent_events");
  // Configured but nothing produced yet is NOT_PRODUCED, not "not connected".
  const stateState = !snap.provider.location ? "NOT_CONNECTED" : badDocs ? "SOURCE_ERROR" : okDocs ? "CONNECTED" : "NOT_PRODUCED";
  const researchOn = RESEARCH_SIDE.some((k) => isOk(source(ctx, k)));
  const tradingOn = TRADING_SIDE.some((k) => isOk(source(ctx, k)));
  const anyOn = okDocs > 0 || isOk(evSrc);
  const findings = derived(ctx, "consistency") ?? [];
  const cov = checkSummary(ctx);
  const readOnly = derived(ctx, "controls")?.read_only ?? snap.read_only;
  const rState = subsystemState(research);
  const anState = subsystemState(agentNet);
  const trState = subsystemState(trading);

  const n1 = archNode({
    code: "ARC-01",
    key: "research_engine",
    title: "Research engine",
    role: "Discovers, preregisters, tests and validates. Writes research, strategy, memory, governance, data and insight documents.",
    state: rState,
    extra: badge(rState),
    lines: RESEARCH_SIDE.map((k) => srcLine(ctx, k)),
    ...declaredMeta(ctx, research),
  });

  const n2 = archNode({
    code: "ARC-02",
    key: "state",
    title: "Shared SENTRY state / API",
    role: "Contract documents (schema v" + snap.contract_version + ") and the append-only agent event stream. Validated on read; unknown fields rejected.",
    state: stateState,
    extra: badge(stateState),
    lines: html`
      <li class="cc-node__kv"><span>PROVIDER</span><b>${snap.provider.kind}</b></li>
      <li class="cc-node__kv cc-node__kv--path"><span>LOCATION</span><b title="${snap.provider.location ?? ""}">${snap.provider.location ?? "not configured"}</b></li>
      <li class="cc-node__kv"><span>DOCUMENTS</span><b>${okDocs}/${DOC_KEYS.length} connected${badDocs ? html` · <span class="${cx("cc-tonetext", toneClass("INVALID"))}">${badDocs} with errors</span>` : ""}</b></li>
      <li class="cc-node__kv"><span>EVENT STREAM</span><b>${sourceShort(evSrc)}</b></li>
      <li class="cc-node__kv"><span>REVISION</span><b>${shortHash(snap.revision, 14)}</b></li>`,
    meta: html`${source(ctx, "system") ? html`system.json · ${sourceShort(source(ctx, "system"))}` : ""}`,
  });

  const n3 = archNode({
    code: "ARC-03",
    key: "command_centre",
    title: "Command Centre",
    role: "Renders declared state and cross-checks it. Never authors, estimates or backfills SENTRY state.",
    state: "CONNECTED",
    extra: badge("CONNECTED", { label: "API LINKED" }),
    lines: html`
      <li class="cc-node__kv"><span>APP</span><b>${snap.app_version}</b></li>
      <li class="cc-node__kv"><span>CONTRACT</span><b>v${snap.contract_version}</b></li>
      <li class="cc-node__kv"><span>SNAPSHOT</span><b>${fmtTime(snap.generated_at)}Z</b></li>
      <li class="cc-node__kv"><span>CROSS-CHECKS</span><b title="${cov.available ? `${cov.ran} of ${cov.total} check families ran` : ""}">${
        cov.available ? (cov.anyRan ? `${findings.length} finding(s) · ${cov.ran}/${cov.total} ran` : "none ran") : anyOn ? `${findings.length} finding(s)` : "none ran"
      }</b></li>
      <li class="cc-node__kv"><span>COMMAND CHANNEL</span><b>${readOnly ? "none (read-only)" : "declared"}</b></li>`,
    meta: html`<span class="cc-node__metaflex"><span>NO ORDER ENTRY</span>${readOnly ? badge("LOCKED", { label: "READ-ONLY" }) : ""}</span>`,
  });

  const n4 = archNode({
    code: "ARC-04",
    key: "agent_trading",
    title: "Agent / trading system",
    role: "Five agent slots that may run only approved, packaged strategies — SIM before PAPER before LIVE — and report observations, orders and fills.",
    state: anState,
    extra: badge(anState, { title: "Agent network" }),
    lines: TRADING_SIDE.map((k) => srcLine(ctx, k)),
    meta: html`<span class="cc-node__metaflex"><span>AGENT NETWORK</span>${badge(anState)}</span><span class="cc-node__metaflex"><span>TRADING ENGINE</span>${badge(trState)}</span>`,
  });

  return panel({
    span: 12,
    variant: "hero",
    code: "SYS-01",
    title: "Architecture",
    sub: "Research engine → shared state / API → Command Centre → agent / trading system · live connection overlay",
    actions: go("STATE SOURCES", "#/data/sources"),
    cls: "panel--accent",
    body: html`<div class="cc-cq"><div class="cc-arch">
      <div class="cc-arch__row">
        ${n1}
        ${archLink({ key: "research-state", label: "WRITES", sub: `${RESEARCH_SIDE.length} documents`, connected: researchOn })}
        ${n2}
        ${archLink({ key: "state-cc", label: "READS", sub: "GET /api/cc", connected: anyOn })}
        ${n3}
        ${archLink({ key: "cc-agents", label: "LOCKED", sub: "no command channel", connected: false, locked: true })}
        ${n4}
      </div>
      <div class="cc-arch__ret" data-arch-link="agents-state" data-connected="${tradingOn ? "1" : "0"}">
        <span class="cc-ret cc-ret--l"></span>
        <span class="cc-ret cc-ret--m"><span class="cc-ret__label" title="agents.json · agent_events.jsonl · portfolio.json · risk.json · execution.json · live.json">${icon("history")}RETURN · AGENT SYSTEM WRITES ${TRADING_SIDE.length} SOURCES → STATE</span></span>
        <span class="cc-ret cc-ret--r"></span>
      </div>
      <div class="cc-arch__retnote">Return path: the agent / trading system writes agents.json, agent_events.jsonl, portfolio, risk, execution and live documents into the shared state.</div>
    </div></div>`,
  });
}

/* ------------------------------------------------------------ SYS-02 handoff */

const HANDOFF = [
  ["RESEARCH_STRATEGY", "Research strategy", "Exists in the registry. Not tradable."],
  ["VALIDATION", "Validation", "Required checks pass; status VALIDATED."],
  ["APPROVAL", "Approval", "Governance decision APPROVED, with a scope."],
  ["DEPLOYMENT_PACKAGE", "Deployment package", "Spec, data, executor and cost-model identities frozen."],
  ["AGENT_ASSIGNMENT", "Agent assignment", "Package assigned to one of five agent slots."],
  ["SIMULATION", "Simulation", "Runs in SIM / PAPER before any capital."],
  ["LIVE", "Live", "Requires a LIVE-scope approval."],
];
const MATRIX_STEPS = ["VALIDATION", "APPROVAL", "DEPLOYMENT_PACKAGE", "AGENT_ASSIGNMENT", "SIMULATION", "LIVE"];

function stepOf(h, key) {
  return h.steps.find((s) => s.step === key) ?? null;
}

function handoff(ctx) {
  const sSrc = source(ctx, "strategies");
  const sa = isOk(sSrc);
  const strategies = doc(ctx, "strategies");
  const byId = new Map((strategies?.strategies ?? []).map((s) => [s.strategy_id, s]));
  // A handoff row carries its strategy's record origin; every count below is split by it.
  const hs = sa ? (derived(ctx, "handoffs") ?? []).map((h) => ({ ...h, origin: byId.get(h.strategy_id)?.origin })) : null;
  const eligible = sa ? derived(ctx, "controls")?.deployment_eligible ?? [] : null;
  const rs = derived(ctx, "research_summary") ?? {};
  const stepCount = (pred) => splitVal(originSplit(hs, pred), { cls: "cc-split--step" });

  const list = HANDOFF.map(([key, label]) => {
    if (!hs) return { key, label, count: null, detail: sourceShort(sSrc) };
    if (key === "RESEARCH_STRATEGY") return { key, label, count: stepCount(), detail: "current versions in registry" };
    // A step that cannot be verified for some strategy (agent runtime unavailable) has no countable total.
    const unverifiable = hs.filter((h) => ["UNKNOWN", "UNVERIFIED"].includes(stepOf(h, key)?.state));
    if (unverifiable.length) {
      return { key, label, count: null, state: "UNKNOWN", detail: stepOf(unverifiable[0], key)?.detail ?? "cannot be verified" };
    }
    const done = stepCount((h) => stepOf(h, key)?.state === "COMPLETE");
    const viol = originSplit(hs, (h) => stepOf(h, key)?.state === "VIOLATION");
    return Object.values(viol).some((n) => n > 0)
      ? { key, label, count: done, state: "VIOLATION", detail: `${splitText(viol)} declared out of order` }
      : { key, label, count: done, detail: "versions complete" };
  }).map((s) => ({ ...s, boundary: s.key === "AGENT_ASSIGNMENT" }));

  // registry status counts per record origin (derive: strategies_by_status_origin)
  const byStatusOrigin = rs.strategies_available ? rs.strategies_by_status_origin ?? null : null;
  const statusSplit = (st) => splitFrom(Object.fromEntries(Object.entries(byStatusOrigin).map(([o, m]) => [o, m?.[st] ?? 0])));
  const statusOrder = ["CANDIDATE", "IN_VALIDATION", "VALIDATED", "APPROVED", "DEPLOYED_SIM", "DEPLOYED_LIVE", "SCALED", "RETIRED", "REJECTED"];
  const statuses = byStatusOrigin ? [...new Set(Object.values(byStatusOrigin).flatMap((m) => Object.keys(m ?? {})))] : [];
  statuses.sort((a, b) => (statusOrder.indexOf(a) + 1 || 99) - (statusOrder.indexOf(b) + 1 || 99));
  const eligibleSplit = eligible ? originSplit(strategies?.strategies ?? [], (s) => eligible.includes(s.strategy_id)) : null;

  const matrix = !hs
    ? emptyLine(sourceTitle(sSrc, "Strategy registry"), "Each strategy's current version and the handoff step it has reached are listed here.")
    : hs.length === 0
      ? emptyLine("No strategies in the registry", "strategies.json is connected and lists no strategies.")
      : table({
          dense: true,
          rowHref: (h) => `#/strategy/${encodeURIComponent(h.strategy_id)}`,
          columns: [
            {
              key: "strategy_id",
              label: "Strategy",
              render: (h) => html`<span class="cc-mx-id">${refLink(h.strategy_id, `#/strategy/${encodeURIComponent(h.strategy_id)}`)}<span class="cc-mx-name">${byId.get(h.strategy_id)?.name ?? ""}</span>${originBadge(byId.get(h.strategy_id)?.origin)}</span>`,
            },
            { key: "version", label: "Ver", render: (h) => html`<span class="mono">v${h.version}</span>` },
            { key: "status", label: "Registry status", render: (h) => (byId.get(h.strategy_id) ? badge(byId.get(h.strategy_id).status) : null) },
            ...MATRIX_STEPS.map((k) => ({
              key: k,
              label: humanize(k),
              render: (h) => {
                const st = stepOf(h, k);
                return st ? html`<span title="${st.detail ?? ""}">${badge(st.state)}</span>` : null;
              },
            })),
            {
              key: "deployment_eligible",
              label: "Eligible",
              render: (h) => (h.deployment_eligible ? badge("COMPLETE", { label: "ELIGIBLE" }) : badge("NOT_REACHED", { label: "NOT ELIGIBLE" })),
            },
          ],
          rows: hs,
        });

  return panel({
    span: 12,
    code: "SYS-02",
    title: "Research → agent handoff",
    sub: "Current versions that have completed each step, per record origin",
    actions: go("STRATEGY LIBRARY", "#/strategies"),
    cls: "cc-panel-handoff",
    body: html`
      <div class="cc-rule" data-rule="handoff">${icon("lock")}<div><b>A strategy does not become tradable because it exists.</b> Only validated, approved, packaged strategies may enter deployment — and only via an agent assignment, simulation first. The counts below show where each strategy actually stands.</div></div>
      <div class="cc-handoff">
        ${steps(list)}
        <div class="cc-handoff__desc">${HANDOFF.map(([key, , desc]) => html`<div data-step-desc="${key}">${desc}</div>`)}</div>
      </div>
      <div class="cc-handoff__facts">
        <div class="cc-fact" data-fact="eligible">
          <span class="cc-fact__k">Deployment-eligible</span>
          <span class="cc-fact__v">${eligibleSplit ? splitVal(eligibleSplit) : val(null)}</span>
          <span class="cc-fact__d">${
            isNil(eligible)
              ? sourceReason(sSrc)
              : eligible.length
                ? html`<span class="cluster">${eligible.map((id) => refLink(id, `#/strategy/${encodeURIComponent(id)}`))}</span>`
                : "No strategy in strategies.json is validated, approved and packaged."
          }</span>
        </div>
        <div class="cc-fact" data-fact="by-status">
          <span class="cc-fact__k">Registry by status</span>
          <span class="cc-fact__d">${
            byStatusOrigin === null
              ? sourceShort(sSrc)
              : statuses.length === 0
                ? "No strategies recorded"
                : html`<span class="cluster">${statuses.map(
                    (s) => html`<span class="cc-statcount" data-status-count="${s}">${badge(s)}${splitVal(statusSplit(s), { cls: "cc-split--sm" })}</span>`,
                  )}</span>`
          }</span>
        </div>
      </div>
      ${subhead("Handoff matrix", hs ? `${splitText(originSplit(hs))} · current version` : "")}
      ${matrix}`,
  });
}

/* ------------------------------------------------------------ SYS-03 learning */

function learning(ctx) {
  const lr = derived(ctx, "learning");
  const evSrc = source(ctx, "agent_events");
  const sSrc = source(ctx, "strategies");
  const stages = lr?.stages ?? [];
  const toStep = (s) => ({ key: s.key, label: s.label, count: s.count, owner: s.owner, boundary: s.key === "RESEARCH_VALIDATION" });
  const agentList = stages.filter((s) => s.owner === "AGENT").map(toStep);
  const govList = stages.filter((s) => s.owner !== "AGENT").map(toStep);
  const agentN = agentList.length;
  const govN = govList.length;
  const pbs = lr?.proposals_by_state ?? null;
  const cumulative = lr?.gated_counts === "cumulative";
  // Agent-stage counts come from the whole event stream (derive), across record origins; say which origins those are.
  const evSplit = lr?.events_available ? eventOriginSplit(ctx.extra?.events) : null;
  const evNote = !lr?.events_available
    ? `agent_events.jsonl ${sourceShort(evSrc).toLowerCase()}`
    : evSplit
      ? hasOtherOrigins(evSplit)
        ? html`counts include <span class="${cx("cc-tonetext", originTone(evSplit.RECONSTRUCTED ? "RECONSTRUCTED" : "SYNTHETIC_FIXTURE"))}" data-learn-origins>${splitText(evSplit)}</span> events`
        : html`<span data-learn-origins>${splitText(evSplit)} events</span>`
      : "agent_events.jsonl connected · counts span all origins";

  return panel({
    span: 12,
    code: "SYS-03",
    title: "Agent learning flow",
    sub: cumulative
      ? "Agent stages count events by kind · gated stages count proposals cumulatively"
      : "Agent stages count events by kind · gated stages count proposals currently in each state",
    actions: go("AGENT MEMORIES", "#/memory/agents"),
    cls: "cc-panel-learn",
    body: html`<div class="cc-learn" style="--n:${Math.max(stages.length, 1)};--cols:${Math.max(agentN, govN, 1)};--afr:${Math.max(agentN, 1)}fr;--gfr:${Math.max(govN, 1)}fr" data-gated-counts="${lr?.gated_counts ?? ""}">
        <div class="cc-learn__lane cc-learn__lane--agent" style="--k:${Math.max(agentN, 1)}">
          <div class="cc-zone cc-zone--agent"><span>${icon("agent")}AGENT · RESEARCH MODE</span><b>Autonomous within declared limits</b><em>${evNote}</em></div>
          ${steps(agentList)}
        </div>
        <div class="cc-learn__lane cc-learn__lane--gov" style="--k:${Math.max(govN, 1)}">
          <div class="cc-zone cc-zone--gov"><span>${icon("governance")}RESEARCH · GOVERNANCE</span><b>Validation and approval required</b><em>${
            lr?.proposals_available ? (cumulative ? "cumulative · every proposal that reached the gate" : "proposals currently in each state") : `strategies.json ${sourceShort(sSrc).toLowerCase()}`
          }</em></div>
          ${steps(govList)}
        </div>
      </div>
      <div class="cc-principles">
        <div class="cc-principle" data-principle="autonomy"><b>01 · Research learning may be autonomous</b><span>Agents may observe, interpret, recall, hypothesise, test, evaluate and write memory — in research mode, within declared limits. Every step is an event in the stream.</span></div>
        <div class="cc-principle" data-principle="governed"><b>02 · Production changes require validation + governance</b><span>A proposal must cross the boundary into research validation and governance approval. It may only ever become a new, versioned strategy.</span></div>
        <div class="cc-principle" data-principle="no-silent-change"><b>03 · Agents must never silently modify a live strategy</b><span>Live versions are to stay immutable. Improvement is a new version with lineage back to its proposal and evidence.</span></div>
      </div>
      <div class="cc-proposals">
        <span class="cc-fact__k">Proposals by current state</span>
        ${pbs === null
          ? html`<span class="muted small">${sourceTitle(sSrc, "strategies.json")} — proposal counts are read from it.</span>`
          : Object.keys(pbs).length === 0
            ? html`<span class="text-2 small">No improvement proposals recorded.</span>`
            : html`<span class="cluster">${Object.entries(pbs).map(([k, n]) => html`<span class="cc-statcount">${badge(k)}<b>${n}</b></span>`)}</span>`}
      </div>`,
  });
}

/* ------------------------------------------------------------ SYS-04 self-improvement */

function selfImprovement(ctx) {
  const research = doc(ctx, "research");
  const memory = doc(ctx, "memory");
  const strategies = doc(ctx, "strategies");
  const ta = derived(ctx, "trial_accounting");
  const ms = derived(ctx, "memory_stats") ?? {};
  const conn = (k) => isOk(source(ctx, k));
  const byOrigin = ta?.available ? ta.records_by_origin : null;

  // Ring values are ORIGINAL records only; the ledger beside the ring lists every origin separately.
  const nodes = [
    { key: "RESEARCH", label: "RESEARCH", sub: "orig programmes", src: "research", value: originalOf(originSplit(research?.programmes ?? null)) },
    { key: "EVIDENCE", label: "EVIDENCE", sub: "original trial records", src: "research", value: byOrigin ? byOrigin.ORIGINAL : null },
    { key: "MEMORY", label: "MEMORY", sub: "orig memories", src: "memory", value: originalOf(originSplit(memory?.memories ?? null)) },
    { key: "BETTER_HYPOTHESES", label: "BETTER\nHYPOTHESES", sub: "not scored", src: "research", value: null },
    { key: "BETTER_EXPERIMENTS", label: "BETTER\nEXPERIMENTS", sub: "not scored", src: "research", value: null },
    { key: "BETTER_VALIDATION", label: "BETTER\nVALIDATION", sub: "not scored", src: "governance", value: null },
    { key: "BETTER_STRATEGIES", label: "BETTER\nSTRATEGIES", sub: "not scored", src: "strategies", value: null },
  ].map((n) => ({ ...n, connected: conn(n.src) }));

  // Every record count is per origin (never summed across origins). Hypothesis
  // rejections get one row per origin, like the trial records above them.
  const hyps = research?.hypotheses ?? null;
  const mems = ms.available ? memory?.memories ?? null : null;
  const rejected = originSplit(hyps, (h) => h.terminal === "REJECTED");
  const typeSplit = (t) => originSplit(mems, (m) => m.type === t);
  const rejectedAssumptions = originSplit(mems, (m) => m.type === "REJECTED_ASSUMPTION" || m.status === "REJECTED");
  const proposals = strategies?.proposals ?? null;
  const released = countWhere(proposals, (p) => p.state === "RELEASED_AS_VERSION");
  // A version carries no origin of its own: it is counted under its strategy's record origin.
  const versions = strategies ? originSplit(strategies.strategies.flatMap((s) => s.versions.map(() => ({ origin: s.origin })))) : null;

  const row = (k, v, d, srcKey) => html`<li class="cc-ledger__row" data-ledger="${k}">
    <span class="cc-ledger__k">${k}</span>
    <span class="cc-ledger__v">${val(isNil(v) ? null : fmtNum(v, 0))}</span>
    <span class="cc-ledger__d">${isNil(v) ? sourceShort(source(ctx, srcKey)) : d}</span>
  </li>`;
  const splitRow = (k, split, d, srcKey) => html`<li class="cc-ledger__row" data-ledger="${k}">
    <span class="cc-ledger__k">${k}</span>
    <span class="cc-ledger__v">${splitVal(split, { cls: "cc-split--sm" }) ?? val(null)}</span>
    <span class="cc-ledger__d">${split ? d : sourceShort(source(ctx, srcKey))}</span>
  </li>`;

  return panel({
    span: 7,
    code: "SYS-04",
    title: "Self-improvement loop",
    sub: "Improvement is accumulated, versioned evidence",
    cls: "lg-span-12 cc-panel-self",
    body: html`<div class="cc-cq"><div class="cc-self">
      <div class="cc-self__ring">${ccRing(nodes, { center: "SENTRY", centerSub: "ACCUMULATED EVIDENCE", width: 500, height: 420, r: 140, nodeR: 25, aria: "SENTRY self-improvement loop" })}</div>
      <div class="cc-self__side">
        <blockquote class="cc-quote">Self-improving means <b>accumulated evidence</b> — not AI changing itself until P&amp;L goes up.</blockquote>
        ${subhead("Accumulated evidence", "origins kept separate")}
        <ul class="cc-ledger">
          ${splitRow("Programmes", originSplit(research?.programmes ?? null), "Declared research programmes · per origin", "research")}
          ${row("Trial records · original", byOrigin ? byOrigin.ORIGINAL : null, "Recorded at the time by the ledger", "research")}
          ${row("Trial records · reconstructed", byOrigin ? byOrigin.RECONSTRUCTED : null, "Rebuilt after loss — kept separate", "research")}
          ${byOrigin?.SYNTHETIC_FIXTURE ? row("Trial records · synthetic", byOrigin.SYNTHETIC_FIXTURE, "Synthetic fixture — not SENTRY state", "research") : ""}
          ${row("Hypotheses rejected · original", originalOf(rejected), "Failures stay visible and counted", "research")}
          ${row("Hypotheses rejected · reconstructed", rejected ? rejected.RECONSTRUCTED : null, "Rebuilt after loss — kept separate", "research")}
          ${rejected?.SYNTHETIC_FIXTURE ? row("Hypotheses rejected · synthetic", rejected.SYNTHETIC_FIXTURE, "Synthetic fixture — not SENTRY state", "research") : ""}
          ${splitRow("Memories", originSplit(mems), "Evidence-backed records · per origin", "memory")}
          ${splitRow("Lessons", typeSplit("LESSON"), "Type LESSON", "memory")}
          ${splitRow("Failed mechanisms", typeSplit("FAILED_MECHANISM"), "Type FAILED_MECHANISM", "memory")}
          ${splitRow("Rejected assumptions", rejectedAssumptions, "Type or status rejected", "memory")}
          ${splitRow("Strategy versions", versions, "Every change is a new version · strategy origin", "strategies")}
          ${row("Proposals released as versions", released, "Through validation and governance · records carry no origin", "strategies")}
        </ul>
        <div class="small muted cc-self__note">The four "better" stages are not scored by the Command Centre. Progress is shown only by the evidence above and its lineage.</div>
      </div>
    </div></div>`,
  });
}

/* ------------------------------------------------------------ SYS-05 research cell */

const ROLES = [
  ["LEAD_RESEARCHER", "Lead researcher", "Sets programme direction; freezes specifications before data is examined."],
  ["QUANT_RESEARCHER", "Quant researcher", "Formulates mechanisms and preregistered hypotheses."],
  ["DATA_ANALYST", "Data analyst", "Verifies datasets, coverage, gaps and identity hashes."],
  ["CODER", "Coder", "Implements the frozen specification exactly; no discretionary changes."],
  ["BACKTESTER", "Backtester", "Runs trials under declared costs; every trial is counted."],
  ["ADVERSARIAL_REFEREE", "Adversarial referee", "Independently reproduces and attacks recorded results."],
  ["GOVERNANCE", "Governance", "Applies promotion gates; approves, rejects or revokes."],
];

function researchCell(ctx) {
  const research = doc(ctx, "research");
  const rSrc = source(ctx, "research");
  const byRole = new Map((research?.roles ?? []).map((r) => [r.role, r]));
  const reported = research ? research.roles.length : null;
  return panel({
    span: 5,
    code: "SYS-05",
    title: "Research cell",
    sub: research ? `${reported} of ${ROLES.length} roles reported` : sourceReason(rSrc),
    actions: go("RESEARCH", "#/research"),
    cls: "lg-span-12 cc-panel-cell",
    body: html`<div class="cc-roles">${ROLES.map(([key, label, desc], i) => {
        const r = byRole.get(key);
        const state = r ? r.state : research ? "NOT_REPORTED" : srcState(rSrc);
        return html`<div class="${cx("cc-role", toneClass(state))}" data-role="${key}" data-state="${state}">
          <span class="cc-role__n">${String(i + 1).padStart(2, "0")}</span>
          <div class="cc-role__main">
            <div class="cc-role__head"><span class="cc-role__label">${label}</span>${badge(state)}</div>
            <div class="cc-role__desc">${r?.detail ?? desc}</div>
          </div>
          <span class="cc-role__ts">${r?.last_activity_at ? fmtAge(r.last_activity_at, ctx.now) : ""}</span>
        </div>`;
      })}</div>
      <div class="cc-rule cc-rule--quiet" data-rule="cell">${icon("shield")}<div><b>A controlled cell, not a swarm.</b> Seven roles with declared limits; every action must be a counted trial or a recorded decision, and no loop may run without a frozen specification and a referee.</div></div>`,
  });
}

/* ------------------------------------------------------------ SYS-06 sources */

function contractSources(ctx) {
  const snap = ctx.snap;
  const rows = [...DOC_KEYS.map((k) => ({ key: k, src: source(ctx, k), events: false })), { key: "agent_events", src: source(ctx, "agent_events"), events: true }];
  const ok = rows.filter((r) => isOk(r.src)).length;
  return panel({
    span: 12,
    code: "SYS-06",
    title: "Contract sources",
    sub: `${DOC_KEYS.length} documents + event stream · ${ok} of ${rows.length} connected`,
    actions: go("STATE SOURCES", "#/data/sources"),
    body: table({
      dense: true,
      rowHref: () => "#/data/sources",
      columns: [
        { key: "key", label: "Source", render: (r) => html`<span class="cc-src-name">${dot(srcState(r.src))}<span>${r.src?.label ?? r.key}</span></span>` },
        { key: "file", label: "File", render: (r) => html`<span class="mono">${r.src?.file ?? r.key}</span>` },
        { key: "status", label: "Status", render: (r) => srcBadge(r.src) },
        { key: "origin", label: "Origin", render: (r) => (r.src?.meta?.origin ? (r.src.meta.origin === "ORIGINAL" ? chip("ORIGINAL") : originBadge(r.src.meta.origin)) : null) },
        { key: "producer", label: "Producer", render: (r) => (r.src?.meta?.producer ? html`<span class="mono">${r.src.meta.producer}</span>` : null) },
        { key: "generated", label: "Generated", render: (r) => (r.src?.meta?.generated_at ? html`<span class="mono">${fmtAge(r.src.meta.generated_at, ctx.now)}</span>` : null) },
        {
          key: "detail",
          label: "Detail",
          cls: "wrap",
          render: (r) =>
            r.events
              ? isOk(r.src) || r.src?.status === "INVALID"
                ? html`<span class="small">${r.src.valid_events} valid · ${r.src.invalid_lines} invalid line(s)</span>`
                : html`<span class="small muted">${sourceReason(r.src)}</span>`
              : isOk(r.src)
                ? html`<span class="small text-2">Validated against contract v${snap.contract_version}</span>`
                : html`<span class="small muted">${sourceReason(r.src)}</span>`,
        },
      ],
      rows,
    }),
  });
}

/* ------------------------------------------------------------ view */

export default {
  title: "System Map",
  async load(ctx) {
    // Only to say which record origins the learning-flow event counts span (SYS-03).
    const ev = ctx.snap?.events_source;
    if (!ev || ev.status !== "OK") return { events: null };
    try {
      return { events: await fetchEvents({ limit: EVENT_WINDOW }) };
    } catch (err) {
      return { events: null, error: String(err?.message ?? err) };
    }
  },
  render(ctx) {
    const snap = ctx.snap;
    const okCount = DOC_KEYS.filter((k) => isOk(source(ctx, k))).length;
    return html`<div class="cc-map">
      ${pageHeader({
        kicker: "ARCHITECTURE",
        code: "SYS",
        title: "System Map",
        sub: "How SENTRY is wired, with the live connection state of every contract source. Research produces evidence; governance gates it; an agent slot may only receive a validated, approved, packaged strategy — the handoff below shows where each one actually stands.",
        right: html`<span class="cc-headchip">${icon("file")}CONTRACT <b>v${snap.contract_version}</b></span>
          <span class="cc-headchip">${icon("data")}PROVIDER <b>${snap.provider.kind}</b></span>
          <span class="cc-headchip">${icon("sources")}SOURCES <b>${okCount}/${DOC_KEYS.length}</b></span>
          ${sourceTag(source(ctx, "system"), { now: ctx.now })}`,
      })}
      <div class="grid">${architecture(ctx)}</div>
      <div class="grid">${handoff(ctx)}</div>
      <div class="grid">${learning(ctx)}</div>
      <div class="grid">${selfImprovement(ctx)}${researchCell(ctx)}</div>
      <div class="grid">${contractSources(ctx)}</div>
    </div>`;
  },
};
