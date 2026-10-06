// Live Engine — trading state, safety interlocks and the deployment path to live.
// The trading state is shown only as live.json declares it: with no live.json the
// indicator reads NOT CONNECTED and never claims trading is off. This Command
// Centre has no order-routing capability: its API is GET-only by construction.

import { html } from "../core/html.js";
import { fmtDateTime, fmtCount, humanize, isNil } from "../core/format.js";
import { toneClass } from "../core/tones.js";
import { doc, source, derived, sourceReason, sourceShort, findingsFor, currentVersion } from "../core/state.js";
import { pageHeader, panel, badge, dot, stat, statRow, sourceTag, table, val, emptyState, findingsList, control, originBadge } from "../components/ui.js";
import { steps } from "../components/flow.js";
import { icon } from "../components/icons.js";
import { slotName, absentState, metricStat, ageVal, connectionList, absent, provenance, ghostHead } from "./_ops-common.js";

const LADDER = [
  ["SIM", "Simulation", "Simulated fills against live data"],
  ["PAPER", "Paper", "Broker paper account · no capital"],
  ["LIVE", "Live", "Real capital · LIVE-scope approval"],
];

// [step key (derived.handoffs), flow label, matrix column, description, owner, governance boundary before]
const PATH = [
  ["VALIDATION", "Validation", "Validation", "Research engine validation status VALIDATED", "RESEARCH", false],
  // The APPROVAL step completes on a governance approval of ANY scope (derive_handoff); its count is
  // therefore never labelled LIVE scope. The LIVE-scope subset is shown separately (h.live_scope).
  ["APPROVAL", "Approval", "Approval", "Governance decision, any scope", "GOVERNANCE", true],
  ["DEPLOYMENT_PACKAGE", "Deployment package", "Package", "Frozen spec, data, executor and cost model", "GOVERNANCE", false],
  ["AGENT_ASSIGNMENT", "Agent assignment", "Assignment", "Package assigned to one of five slots", "DEPLOYMENT", false],
  ["SIMULATION", "Simulation", "Simulation", "Agent runs the version in SIM or PAPER", "AGENT", false],
  ["LIVE", "Live", "Live", "Live engine trades the version with capital", "LIVE ENGINE", true],
];

const LIVE_SCOPES = ["LIVE_SMALL", "LIVE"];

/* ---------------------------------------------------------------- LIV-01 trading state */

/** Headline: live trading is ENABLED only when live.json declares trading enabled in LIVE mode. */
function liveHeadline(live, src) {
  if (!live) return absentState(src);
  return live.trading_enabled && live.trading_mode === "LIVE" ? "ENABLED" : "DISABLED";
}

function tradingState(ctx, live, src) {
  const head = liveHeadline(live, src);
  const headLabel = live ? head : sourceShort(src);
  const sys = (derived(ctx, "system") ?? []).find((s) => s.key === "trading_engine");
  const nc = sourceShort(src);
  const sub = live
    ? html`Declared by live.json · <span class="mono">trading_enabled</span> ${String(live.trading_enabled)} · <span class="mono">trading_mode</span> ${live.trading_mode}${
        live.trading_enabled && live.trading_mode !== "LIVE" ? html` — order flow is enabled in ${humanize(live.trading_mode)} mode only; no live orders` : ""
      }`
    : html`${sourceReason(src) ?? ""} The trading state is displayed only from live.json — without it nothing is claimed.`;
  return html`<div class="ops-live">
    <div class="ops-live__flag ${toneClass(head === "ENABLED" ? "LIVE" : head)}" data-live-trading="${head}">
      <div class="ops-live__emblem">${icon(live ? "live" : src?.status === "INVALID" || src?.status === "UNREADABLE" ? "alert" : "empty")}</div>
      <div class="ops-live__text">
        <span class="ops-live__k">LIVE TRADING</span>
        <span class="ops-live__v">${humanize(headLabel)}</span>
        <span class="ops-live__sub">${sub}</span>
      </div>
    </div>
    <div class="ops-live__cells">
      ${statRow(
        [
          html`<div class="stat"><div class="stat__label">Trading mode</div><div class="stat__value ${live ? "" : "is-empty"}" data-v ${live ? "" : html`data-empty="1"`} data-trading-mode="${live?.trading_mode ?? ""}">${live ? badge(live.trading_mode, { size: "lg" }) : "—"}</div><div class="stat__hint">${live ? "Declared by live.json" : html`<span class="nodata">${nc}</span>`}</div></div>`,
          html`<div class="stat"><div class="stat__label">Trading enabled</div><div class="stat__value ${live ? "" : "is-empty"}" data-v ${live ? "" : html`data-empty="1"`} data-trading-enabled="${live ? String(live.trading_enabled) : ""}">${live ? badge(live.trading_enabled ? "ENABLED" : "DISABLED", { size: "lg" }) : "—"}</div><div class="stat__hint">${live ? html`<span class="mono">trading_enabled: ${String(live.trading_enabled)}</span>` : html`<span class="nodata">${nc}</span>`}</div></div>`,
          html`<div class="stat"><div class="stat__label">Engine state</div><div class="stat__value ${live ? "" : "is-empty"}" data-v ${live ? "" : html`data-empty="1"`} data-engine-state="${live?.engine_state ?? ""}">${live ? badge(live.engine_state, { size: "lg" }) : "—"}</div><div class="stat__hint">${live ? live.detail ?? "Declared by live.json" : html`<span class="nodata">${nc}</span>`}</div></div>`,
          html`<div class="stat"><div class="stat__label">Trading subsystem</div><div class="stat__value">${badge(sys?.state ?? "NOT_CONNECTED", { size: "lg" })}</div><div class="stat__hint">${sys?.declared?.detail ?? (sys?.declared ? "Declared in system.json" : "Derived from source status")}</div></div>`,
        ],
        { min: 170 },
      )}
      ${statRow(
        [
          html`<div class="stat stat--sm"><div class="stat__label">Heartbeat</div><div class="stat__value">${ageVal(live?.heartbeat_at ?? null, ctx.now)}</div><div class="stat__hint">${live ? (live.heartbeat_at ? "Engine heartbeat" : html`<span class="nodata">NOT REPORTED</span>`) : html`<span class="nodata">${nc}</span>`}</div></div>`,
          stat({ label: "Positions open", value: isNil(live?.positions_open) ? null : fmtCount(live.positions_open), hint: "Declared count", emptyLabel: live ? "NOT REPORTED" : nc, size: "sm" }),
          stat({ label: "Orders working", value: isNil(live?.orders_working) ? null : fmtCount(live.orders_working), hint: "Declared count", emptyLabel: live ? "NOT REPORTED" : nc, size: "sm" }),
          stat({ label: "As of", value: live ? fmtDateTime(live.as_of) : null, hint: "live.json as_of", emptyLabel: nc, size: "sm" }),
        ],
        { min: 150 },
      )}
    </div>
    <div class="ops-ladder" aria-label="Trading mode escalation">
      <span class="label">Mode escalation</span>
      ${LADDER.map(([m, label, desc], i) => {
        const cur = live?.trading_mode === m;
        return html`${i ? html`<span class="ops-ladder__arrow ${cur ? "is-on" : ""}">${icon("expand")}</span>` : ""}<div class="ops-ladder__rung ${cur ? `is-current ${toneClass(m)}` : ""}" data-rung="${m}" ${cur ? html`data-current="1"` : ""}>
          <span class="ops-ladder__mode">${m}</span><span class="ops-ladder__label">${label}</span><span class="ops-ladder__desc">${desc}</span>
        </div>`;
      })}
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- LIV-02 interlocks */

function tile(key, label, state, stateLabel, desc, meta) {
  return html`<div class="ops-lock ${toneClass(state)}" data-interlock="${key}" data-state="${state ?? ""}">
    <div class="split"><span class="ops-lock__label">${label}</span>${badge(state, { label: stateLabel })}</div>
    <div class="ops-lock__desc">${desc}</div>
    <div class="ops-lock__meta">${meta}</div>
  </div>`;
}

function interlocks(ctx) {
  const snap = ctx.snap;
  const gov = doc(ctx, "governance");
  const govSrc = source(ctx, "governance");
  const sep = gov?.checks?.find((c) => c.key === "research_live_separation") ?? null;
  const sepState = sep?.state ?? (gov ? "NOT_REPORTED" : "NOT_CONNECTED");

  const risk = doc(ctx, "risk");
  const riskSrc = source(ctx, "risk");
  const ks = risk?.kill_switch ?? null;
  const ksState = risk ? ks?.state ?? "NOT_REPORTED" : "NOT_CONNECTED";

  const strategies = doc(ctx, "strategies");
  const stratSrc = source(ctx, "strategies");
  const liveApproved = strategies
    ? strategies.strategies.filter((s) => {
        const v = currentVersion(s);
        return v?.approval?.decision === "APPROVED" && LIVE_SCOPES.includes(v.approval.scope);
      })
    : null;

  const agentsSrc = source(ctx, "agents");
  const slots = derived(ctx, "agent_slots") ?? [];
  const liveAgents = agentsSrc?.status === "OK" ? slots.filter((s) => s.strategy?.mode === "LIVE") : null;

  // Section "live" findings can come from execution.json heartbeats too, so a finding is shown
  // even when live.json itself is not connected; "NO FINDINGS" only with live.json connected.
  const findings = findingsFor(ctx, "live");
  const liveSrc = source(ctx, "live");
  const liveOk = liveSrc?.status === "OK";
  const findState = findings.length ? findings[0].severity : liveOk ? null : "NOT_CONNECTED";
  const findLabel = !findings.length && liveOk ? "NO FINDINGS" : undefined;

  return html`<div class="ops-locks">
    ${tile(
      "order_routing",
      "Order routing",
      "LOCKED",
      "NONE",
      html`<b class="ops-fact">This Command Centre has no order-routing capability.</b>`,
      html`API IS GET-ONLY · <span class="mono">read_only: ${snap ? String(snap.read_only) : "—"}</span>`,
    )}
    ${tile(
      "research_live_separation",
      "Research / live separation",
      sepState,
      undefined,
      sep?.detail ?? "Research code paths cannot reach execution",
      gov ? (sep ? html`governance.json${sep.checked_at ? html` · CHECKED ${fmtDateTime(sep.checked_at)}` : ""}` : "NOT REPORTED BY GOVERNANCE") : sourceShort(govSrc),
    )}
    ${tile(
      "kill_switch",
      "Kill switch",
      ksState,
      undefined,
      ks?.detail ?? (risk ? "risk.json declares no kill switch" : "Declared by the risk engine in risk.json"),
      risk ? html`risk.json${ks?.tripped_at ? html` · TRIPPED ${fmtDateTime(ks.tripped_at)}` : ""}` : sourceShort(riskSrc),
    )}
    ${tile(
      "live_scope_approvals",
      "LIVE-scope approvals",
      liveApproved === null ? "NOT_CONNECTED" : liveApproved.length ? "APPROVED" : null,
      liveApproved === null ? undefined : liveApproved.length ? "ON RECORD" : "NONE ON RECORD",
      liveApproved?.length
        ? html`<span class="cluster">${liveApproved.map((s) => html`<a class="ref" href="#/strategy/${encodeURIComponent(s.strategy_id)}">${s.strategy_id} v${s.current_version}</a> ${badge(currentVersion(s).approval.scope)} ${originBadge(s.origin)}`)}</span>`
        : "Current-version approvals with scope LIVE or LIVE SMALL",
      strategies ? "strategies.json" : sourceShort(stratSrc),
    )}
    ${tile(
      "live_agents",
      "Agents in LIVE mode",
      liveAgents === null ? "NOT_CONNECTED" : liveAgents.length ? "LIVE" : null,
      liveAgents === null ? undefined : liveAgents.length ? "LIVE" : "NONE",
      liveAgents?.length
        ? html`<span class="cluster">${liveAgents.map((s) => html`<a class="ops-slot-link" href="#/agents/${s.slot}">${slotName(s.slot)}</a>`)}</span>`
        : "Agent assignments declared in LIVE mode",
      liveAgents === null ? sourceShort(agentsSrc) : "agents.json",
    )}
    ${tile(
      "live_findings",
      "Live cross-checks",
      findState,
      findLabel,
      findings.length
        ? html`<b class="ops-fact">${fmtCount(findings.length)} ${findings.length === 1 ? "finding" : "findings"}</b> on declared live state — listed below`
        : liveOk
          ? "None from the Command Centre checks on declared live state"
          : "Consistency checks need live.json — nothing to cross-check yet",
      findings.length || liveOk ? "derived.consistency · section live" : sourceShort(liveSrc),
    )}
  </div>
  ${findings.length ? html`<div class="ops-gap" data-live-findings>${findingsList(findings)}</div>` : ""}`;
}

/* ---------------------------------------------------------------- LIV-04 deployment path */

function deploymentPath(ctx) {
  const stratSrc = source(ctx, "strategies");
  const connected = stratSrc?.status === "OK";
  const handoffs = derived(ctx, "handoffs") ?? [];
  const strategies = doc(ctx, "strategies");
  const completed = (key) => handoffs.filter((h) => h.steps.find((s) => s.step === key)?.state === "COMPLETE");
  const count = (key) => (connected ? completed(key).length : null);
  // Of the completed approvals, those whose scope the server flags as LIVE-capable (derived live_scope).
  const liveScope = connected ? completed("APPROVAL").filter((h) => h.live_scope === true).length : null;
  const detailFor = (key, detail) =>
    key === "APPROVAL"
      ? html`${detail}<span class="ops-path-scope" data-live-scope-approvals="${isNil(liveScope) ? "" : liveScope}">of which <span class="ops-path-scope__n">LIVE scope ${val(liveScope)}</span></span>`
      : detail;
  const flow = steps(
    PATH.map(([key, label, , detail, owner, boundary]) => ({ key, label, detail: detailFor(key, detail), owner, boundary, count: count(key) })),
    { cls: "ops-path" },
  );
  const cell = (h, key) => {
    const s = h.steps.find((x) => x.step === key);
    if (!s) return null;
    return html`<span class="ops-pm" data-step-state="${s.state}" title="${s.detail ?? ""}">${dot(s.state)}<span class="ops-pm__state">${humanize(s.state)}</span><span class="ops-pm__detail">${s.detail ?? ""}</span></span>`;
  };
  let matrix;
  if (!connected) {
    matrix = html`${ghostHead(["Strategy", "Approval scope", ...PATH.map((p) => p[2])])}${absent(ctx, "strategies", {
      title: "Strategy registry not connected",
      hint: "Each strategy's current version appears here with its position on the path to live, computed by the server from declared validation, approval, package and assignment.",
    })}`;
  } else {
    matrix = table({
      dense: true,
      columns: [
        {
          key: "strategy_id",
          label: "Strategy",
          render: (h) => {
            const st = strategies?.strategies?.find((s) => s.strategy_id === h.strategy_id);
            return html`<a class="ref" href="#/strategy/${encodeURIComponent(h.strategy_id)}" data-path-strategy="${h.strategy_id}">${h.strategy_id}</a> <span class="mono text-2">v${h.version}</span>${
              st?.origin && st.origin !== "ORIGINAL" ? html`<div class="ops-origin">${originBadge(st.origin)}</div>` : ""
            }`;
          },
        },
        {
          key: "scope",
          label: "Approval scope",
          render: (h) => {
            const v = currentVersion(strategies?.strategies?.find((s) => s.strategy_id === h.strategy_id));
            return v?.approval ? html`${badge(v.approval.decision)} <span class="mono small text-2">${humanize(v.approval.scope)}</span>` : null;
          },
        },
        ...PATH.map(([key, , col]) => ({ key, label: col, render: (h) => cell(h, key) })),
      ],
      rows: handoffs,
      maxHeight: 360,
      empty: emptyState({ title: "No strategies registered", reason: "strategies.json is connected and lists no strategies, so nothing is on the path to live.", compact: true, code: "no-path" }),
    });
  }
  return html`${flow}<div class="ops-path-note">${connected ? "Counts: strategies whose current version has completed each step (derived.handoffs). Approval counts a governance approval of any scope." : "Counts appear once strategies.json is connected."} Live requires every earlier step plus a LIVE-scope approval (LIVE or LIVE SMALL).</div><div class="divider"></div>${matrix}`;
}

/* ---------------------------------------------------------------- LIV-06 P&L */

function enginePnl(ctx, live, src) {
  const p = live?.pnl ?? null;
  const why = live ? "NOT REPORTED" : sourceShort(src);
  return html`${statRow(
    [
      metricStat("Realized", p?.realized, { hint: "Declared by live.json", emptyLabel: why }),
      metricStat("Unrealized", p?.unrealized, { hint: "Declared by live.json", emptyLabel: why }),
      metricStat("Day", p?.day, { hint: "Declared by live.json", emptyLabel: why }),
    ],
    { min: 130 },
  )}
  <div class="ops-eq-foot">
    <span><span class="ops-k">P&amp;L MODE</span>${p ? badge(p.mode) : val(null)}</span>
    <span><span class="ops-k">AS OF</span>${p ? html`<span class="v mono" data-v>${fmtDateTime(p.as_of)}</span>` : val(null)}</span>
  </div>
  <div class="ops-note">${p ? "Figures carry their basis; SIM and PAPER results are never presented as live." : live ? "live.json declares no P&L block." : "Engine P&L appears here once live.json is produced."}</div>`;
}

export default {
  title: "Live Engine",
  render(ctx) {
    const live = doc(ctx, "live");
    const src = source(ctx, "live");
    const actions = derived(ctx, "controls")?.actions ?? [];
    const pick = (k) => actions.find((a) => a.key === k);
    const locked = ["ENABLE_LIVE", "TRIP_KILL_SWITCH", "HALT_AGENT"].map(pick).filter(Boolean);

    return html`<div class="ops-view">
      ${pageHeader({
        kicker: "OPERATIONS",
        code: "LIV",
        title: "Live Engine",
        sub: "Trading state, safety interlocks and the governed path from validation to live capital. The trading state is shown only as live.json declares it. This Command Centre observes; it cannot route an order.",
        right: sourceTag(src, { now: ctx.now }),
      })}

      <div class="grid">
        ${panel({
          span: 12,
          code: "LIV-01",
          title: "Trading state",
          sub: live ? "Declared by the live engine" : sourceReason(src),
          variant: "hero",
          body: tradingState(ctx, live, src),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 8,
          code: "LIV-02",
          title: "Safety interlocks",
          sub: "Declared state from governance, risk, strategies and agents · Command Centre cross-checks",
          body: interlocks(ctx),
          cls: "lg-span-12 ops-locks-panel",
        })}
        ${panel({
          span: 4,
          code: "LIV-03",
          title: "Live controls",
          sub: "Locked — blockers computed by the server",
          variant: "accent",
          body: locked.length
            ? html`<div class="stack">${locked.map((a) => control(a, a.key === "TRIP_KILL_SWITCH" ? "power" : a.key === "HALT_AGENT" ? "stop" : "lock"))}</div>`
            : emptyState({ title: "No snapshot", compact: true }),
          foot: html`${icon("lock")} The API exposes GET endpoints only. No control on this page can send a command.`,
          cls: "lg-span-12",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "LIV-04",
          title: "Deployment path to live",
          sub: "Validation → approval → package → assignment → simulation → live",
          actions: sourceTag(source(ctx, "strategies"), { now: ctx.now }),
          body: deploymentPath(ctx),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 6,
          code: "LIV-05",
          title: "Engine connections",
          sub: live ? `${fmtCount(live.connections.length)} declared · heartbeat` : "Broker · market data · heartbeat",
          body: live
            ? html`<div class="ops-hb"><span class="ops-k">ENGINE HEARTBEAT</span>${ageVal(live.heartbeat_at, ctx.now)}</div>${connectionList(live.connections, {
                now: ctx.now,
                empty: emptyState({ title: "No connections declared", reason: "live.json is connected and declares no connections.", compact: true, iconName: "link", code: "no-live-connections" }),
              })}`
            : html`${ghostHead(["Connection", "Kind", "State", "Heartbeat"], { cls: "ops-ghost-head--4" })}${absent(ctx, "live", { title: "Connections not connected", hint: "Broker and market-data links of the live engine appear here with their last heartbeat." })}`,
          cls: "lg-span-12",
        })}
        ${panel({
          span: 6,
          code: "LIV-06",
          title: "Engine P&L",
          sub: "live.pnl",
          body: enginePnl(ctx, live, src),
          cls: "lg-span-12",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "LIV-07",
          title: "Provenance",
          sub: "Where these values come from",
          body: provenance(ctx, ["live", "governance", "risk", "strategies", "agents"]),
        })}
      </div>
    </div>`;
  },
};

