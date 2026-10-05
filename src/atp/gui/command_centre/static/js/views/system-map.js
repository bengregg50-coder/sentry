// System Map — SENTRY's architecture with a live status overlay.
// Connection states come from snapshot sources; counts come from documents /
// derived. Architecture labels (node names, step names, role names, doctrine)
// are constants; every number is declared state or empty.

import { html, raw, cx } from "../core/html.js";
import { fmtAge, fmtTime, fmtNum, humanize, isNil, shortHash } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort } from "../core/state.js";
import { toneClass } from "../core/tones.js";
import { pageHeader, panel, badge, dot, chip, val, originBadge, sourceTag, table, refLink } from "../components/ui.js";
import { steps } from "../components/flow.js";
import { icon } from "../components/icons.js";
import { ccRing } from "./_command-ring.js";
import { DOC_KEYS, isOk, srcState, srcBadge, srcLine, countWhere, go, subhead, emptyLine } from "./_command-common.js";

const RESEARCH_SIDE = ["research", "strategies", "memory", "governance", "datasets", "insights"];
const TRADING_SIDE = ["agents", "agent_events", "portfolio", "risk", "execution", "live"];

/* ------------------------------------------------------------ SYS-01 architecture */

function sysEntry(ctx, key) {
  return (derived(ctx, "system") ?? []).find((s) => s.key === key) ?? null;
}

function archNode({ code, key, title, role, state, extra, lines, meta }) {
  return html`<div class="${cx("cc-node", toneClass(state))}" data-arch-node="${key}" data-state="${state}">
    <div class="cc-node__head"><span class="cc-node__code">${code}</span>${extra}</div>
    <div class="cc-node__title">${title}</div>
    <div class="cc-node__role">${role}</div>
    <ul class="cc-node__lines">${lines}</ul>
    ${meta ? html`<div class="cc-node__meta">${meta}</div>` : ""}
  </div>`;
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
  const stateState = !snap.provider.location ? "NOT_CONNECTED" : badDocs ? "SOURCE_ERROR" : okDocs ? "CONNECTED" : "NOT_CONNECTED";
  const researchOn = RESEARCH_SIDE.some((k) => isOk(source(ctx, k)));
  const tradingOn = TRADING_SIDE.some((k) => isOk(source(ctx, k)));
  const anyOn = okDocs > 0 || isOk(evSrc);
  const findings = derived(ctx, "consistency") ?? [];
  const readOnly = derived(ctx, "controls")?.read_only ?? snap.read_only;

  const n1 = archNode({
    code: "ARC-01",
    key: "research_engine",
    title: "Research engine",
    role: "Discovers, preregisters, tests and validates. Writes research, strategy, memory, governance, data and insight documents.",
    state: research?.state ?? "NOT_CONNECTED",
    extra: badge(research?.state ?? "NOT_CONNECTED"),
    lines: RESEARCH_SIDE.map((k) => srcLine(ctx, k)),
    meta: research?.declared
      ? html`DECLARED ${humanize(research.declared.state)}${research.declared.heartbeat_at ? html` · HB ${fmtAge(research.declared.heartbeat_at, ctx.now)}` : ""}${research.declared.detail ? html` · ${research.declared.detail}` : ""}`
      : html`<span class="muted">No status declared in system.json</span>`,
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
      <li class="cc-node__kv"><span>LOCATION</span><b title="${snap.provider.location ?? ""}">${snap.provider.location ?? "not configured"}</b></li>
      <li class="cc-node__kv"><span>DOCUMENTS</span><b>${okDocs}/${DOC_KEYS.length} connected${badDocs ? html` · <span class="${cx("cc-tonetext", toneClass("INVALID"))}">${badDocs} invalid</span>` : ""}</b></li>
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
      <li class="cc-node__kv"><span>CROSS-CHECKS</span><b>${anyOn ? `${findings.length} finding(s)` : "nothing to check"}</b></li>
      <li class="cc-node__kv"><span>COMMAND CHANNEL</span><b>${readOnly ? "none (read-only)" : "declared"}</b></li>`,
    meta: html`<span class="cc-node__metaflex"><span>NO ORDER ENTRY</span>${readOnly ? badge("LOCKED", { label: "READ-ONLY" }) : ""}</span>`,
  });

  const n4 = archNode({
    code: "ARC-04",
    key: "agent_trading",
    title: "Agent / trading system",
    role: "Five agent slots run approved, packaged strategies — SIM before PAPER before LIVE — and report observations, orders and fills.",
    state: agentNet?.state ?? "NOT_CONNECTED",
    extra: badge(agentNet?.state ?? "NOT_CONNECTED", { title: "Agent network" }),
    lines: TRADING_SIDE.map((k) => srcLine(ctx, k)),
    meta: html`<span class="cc-node__metaflex"><span>AGENT NETWORK</span>${badge(agentNet?.state ?? "NOT_CONNECTED")}</span><span class="cc-node__metaflex"><span>TRADING ENGINE</span>${badge(trading?.state ?? "NOT_CONNECTED")}</span>`,
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
  const hs = sa ? derived(ctx, "handoffs") ?? [] : null;
  const eligible = sa ? derived(ctx, "controls")?.deployment_eligible ?? [] : null;
  const rs = derived(ctx, "research_summary") ?? {};

  const list = HANDOFF.map(([key, label]) => {
    if (!hs) return { key, label, count: null, detail: sourceShort(sSrc) };
    if (key === "RESEARCH_STRATEGY") return { key, label, count: hs.length, detail: "current versions in registry" };
    const done = countWhere(hs, (h) => stepOf(h, key)?.state === "COMPLETE");
    const viol = countWhere(hs, (h) => stepOf(h, key)?.state === "VIOLATION");
    return viol
      ? { key, label, count: done, state: "VIOLATION", detail: `${viol} declared out of order` }
      : { key, label, count: done, detail: `of ${hs.length} complete` };
  }).map((s) => ({ ...s, boundary: s.key === "AGENT_ASSIGNMENT" }));

  const byStatus = rs.strategies_by_status ?? null;
  const statusOrder = ["CANDIDATE", "IN_VALIDATION", "VALIDATED", "APPROVED", "DEPLOYED_SIM", "DEPLOYED_LIVE", "SCALED", "RETIRED", "REJECTED"];

  const matrix = !hs
    ? emptyLine(sourceShort(sSrc), "Each strategy's current version and the handoff step it has reached are listed here.")
    : hs.length === 0
      ? emptyLine("No strategies in the registry", "strategies.json is connected and lists none — nothing can enter deployment.")
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
    sub: "How a strategy reaches an agent — counts are current versions that have completed each step",
    actions: go("STRATEGY LIBRARY", "#/strategies"),
    cls: "cc-panel-handoff",
    body: html`
      <div class="cc-rule" data-rule="handoff">${icon("lock")}<div><b>A strategy does not become tradable because it exists.</b> Only validated, approved, packaged strategies enter deployment — and only via an agent assignment, simulation first.</div></div>
      <div class="cc-handoff">
        ${steps(list)}
        <div class="cc-handoff__desc">${HANDOFF.map(([key, , desc]) => html`<div data-step-desc="${key}">${desc}</div>`)}</div>
      </div>
      <div class="cc-handoff__facts">
        <div class="cc-fact" data-fact="eligible">
          <span class="cc-fact__k">Deployment-eligible</span>
          <span class="cc-fact__v">${val(isNil(eligible) ? null : String(eligible.length))}</span>
          <span class="cc-fact__d">${
            isNil(eligible)
              ? sourceReason(sSrc)
              : eligible.length
                ? html`<span class="cluster">${eligible.map((id) => refLink(id, `#/strategy/${encodeURIComponent(id)}`))}</span>`
                : "No strategy is validated, approved and packaged."
          }</span>
        </div>
        <div class="cc-fact" data-fact="by-status">
          <span class="cc-fact__k">Registry by status</span>
          <span class="cc-fact__d">${
            byStatus === null
              ? sourceShort(sSrc)
              : Object.keys(byStatus).length === 0
                ? "No strategies recorded"
                : html`<span class="cluster">${statusOrder
                    .filter((s) => byStatus[s])
                    .map((s) => html`<span class="cc-statcount">${badge(s)}<b>${byStatus[s]}</b></span>`)}</span>`
          }</span>
        </div>
      </div>
      ${subhead("Handoff matrix", hs ? `${hs.length} strateg${hs.length === 1 ? "y" : "ies"} · current version` : "")}
      ${matrix}`,
  });
}

/* ------------------------------------------------------------ SYS-03 learning */

function learning(ctx) {
  const lr = derived(ctx, "learning");
  const evSrc = source(ctx, "agent_events");
  const sSrc = source(ctx, "strategies");
  const stages = lr?.stages ?? [];
  const list = stages.map((s) => ({
    key: s.key,
    label: s.label,
    count: s.count,
    owner: s.owner,
    boundary: s.key === "RESEARCH_VALIDATION",
  }));
  const agentN = stages.filter((s) => s.owner === "AGENT").length;
  const govN = stages.length - agentN;
  const pbs = lr?.proposals_by_state ?? null;

  return panel({
    span: 12,
    code: "SYS-03",
    title: "Agent learning flow",
    sub: "Agent stages count agent events by kind · governed stages count improvement proposals by state",
    actions: go("AGENT MEMORIES", "#/memory/agents"),
    cls: "cc-panel-learn",
    body: html`<div class="cc-learn" style="--n:${Math.max(stages.length, 1)}">
        <div class="cc-learn__zones" style="grid-template-columns:minmax(0,${Math.max(agentN, 1)}fr) minmax(0,${Math.max(govN, 1)}fr)">
          <div class="cc-zone cc-zone--agent"><span>${icon("agent")}AGENT · RESEARCH MODE</span><b>Autonomous within declared limits</b><em>${lr?.events_available ? "agent_events.jsonl connected" : `agent_events.jsonl ${sourceShort(evSrc).toLowerCase()}`}</em></div>
          <div class="cc-zone cc-zone--gov"><span>${icon("governance")}RESEARCH · GOVERNANCE</span><b>Validation and approval required</b><em>${lr?.proposals_available ? "strategies.json connected" : `strategies.json ${sourceShort(sSrc).toLowerCase()}`}</em></div>
        </div>
        ${steps(list)}
      </div>
      <div class="cc-principles">
        <div class="cc-principle" data-principle="autonomy"><b>01 · Research learning may be autonomous</b><span>Agents may observe, interpret, recall, hypothesise, test, evaluate and write memory — in research mode, within declared limits. Every step is an event in the stream.</span></div>
        <div class="cc-principle" data-principle="governed"><b>02 · Production changes require validation + governance</b><span>A proposal crosses the boundary into research validation and governance approval. It can only ever become a new, versioned strategy.</span></div>
        <div class="cc-principle" data-principle="no-silent-change"><b>03 · Agents never silently modify a live strategy</b><span>Live versions are immutable. Improvement is a new version with lineage back to its proposal and evidence.</span></div>
      </div>
      <div class="cc-proposals">
        <span class="cc-fact__k">Proposals by state</span>
        ${pbs === null
          ? html`<span class="muted small">${sourceShort(sSrc)} — proposal counts appear when strategies.json is connected.</span>`
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

  const nodes = [
    { key: "RESEARCH", label: "RESEARCH", sub: "programmes", src: "research", value: research ? research.programmes.length : null },
    { key: "EVIDENCE", label: "EVIDENCE", sub: "original trial records", src: "research", value: byOrigin ? byOrigin.ORIGINAL : null },
    { key: "MEMORY", label: "MEMORY", sub: "memories", src: "memory", value: memory ? memory.memories.length : null },
    { key: "BETTER_HYPOTHESES", label: "BETTER\nHYPOTHESES", sub: "not scored", src: "research", value: null },
    { key: "BETTER_EXPERIMENTS", label: "BETTER\nEXPERIMENTS", sub: "not scored", src: "research", value: null },
    { key: "BETTER_VALIDATION", label: "BETTER\nVALIDATION", sub: "not scored", src: "governance", value: null },
    { key: "BETTER_STRATEGIES", label: "BETTER\nSTRATEGIES", sub: "not scored", src: "strategies", value: null },
  ].map((n) => ({ ...n, connected: conn(n.src) }));

  const rejected = research ? countWhere(research.hypotheses, (h) => h.terminal === "REJECTED") : null;
  const byType = ms.available ? ms.by_type : null;
  const typeCount = (t) => (byType ? countWhere(memory.memories, (m) => m.type === t) : null);
  const proposals = strategies?.proposals ?? null;
  const released = countWhere(proposals, (p) => p.state === "RELEASED_AS_VERSION");
  const versions = strategies ? strategies.strategies.reduce((acc, s) => acc + s.versions.length, 0) : null;

  const row = (k, v, d, srcKey) => html`<li class="cc-ledger__row" data-ledger="${k}">
    <span class="cc-ledger__k">${k}</span>
    <span class="cc-ledger__v">${val(isNil(v) ? null : fmtNum(v, 0))}</span>
    <span class="cc-ledger__d">${isNil(v) ? sourceShort(source(ctx, srcKey)) : d}</span>
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
          ${row("Trial records · original", byOrigin ? byOrigin.ORIGINAL : null, "Recorded at the time by the ledger", "research")}
          ${row("Trial records · reconstructed", byOrigin ? byOrigin.RECONSTRUCTED : null, "Rebuilt after loss — kept separate", "research")}
          ${row("Hypotheses rejected", rejected, "Failures stay visible and counted", "research")}
          ${row("Memories", ms.available ? ms.total : null, "Evidence-backed records", "memory")}
          ${row("Lessons", typeCount("LESSON"), "Type LESSON", "memory")}
          ${row("Failed mechanisms", typeCount("FAILED_MECHANISM"), "Type FAILED_MECHANISM", "memory")}
          ${row("Rejected assumptions", ms.available ? ms.rejected_assumptions : null, "Type or status rejected", "memory")}
          ${row("Strategy versions", versions, "Every change is a new version", "strategies")}
          ${row("Proposals released as versions", released, "Through validation and governance", "strategies")}
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
        const state = r ? r.state : research ? "NOT_REPORTED" : "NOT_CONNECTED";
        return html`<div class="${cx("cc-role", toneClass(state))}" data-role="${key}" data-state="${state}">
          <span class="cc-role__n">${String(i + 1).padStart(2, "0")}</span>
          <div class="cc-role__main">
            <div class="cc-role__head"><span class="cc-role__label">${label}</span>${badge(state)}</div>
            <div class="cc-role__desc">${r?.detail ?? desc}</div>
          </div>
          <span class="cc-role__ts">${r?.last_activity_at ? fmtAge(r.last_activity_at, ctx.now) : ""}</span>
        </div>`;
      })}</div>
      <div class="cc-rule cc-rule--quiet" data-rule="cell">${icon("shield")}<div><b>A controlled cell, not a swarm.</b> Seven declared roles with declared limits; every action is a counted trial or a recorded decision. No unbounded loop runs without a frozen specification and a referee.</div></div>`,
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
  render(ctx) {
    const snap = ctx.snap;
    const okCount = DOC_KEYS.filter((k) => isOk(source(ctx, k))).length;
    return html`<div class="cc-map">
      ${pageHeader({
        kicker: "ARCHITECTURE",
        code: "SYS",
        title: "System Map",
        sub: "How SENTRY is wired, with the live connection state of every contract source. Research produces evidence; governance gates it; agents only ever receive validated, approved, packaged strategies.",
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
