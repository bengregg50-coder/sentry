// Agent terminal — one deployment slot, every area of a trading terminal.
// Only producer-declared state is shown. A sleeping slot keeps the full
// terminal frame with each area stating why it is empty and what will appear.

import { html, raw, cx } from "../core/html.js";
import { fmtCount, fmtDateTime, fmtNum, humanize, isNil, fmtLimit } from "../core/format.js";
import { toneClass } from "../core/tones.js";
import { source, sourceReason, findMemory, findStrategy, handoffFor } from "../core/state.js";
import {
  pageHeader,
  panel,
  badge,
  severityBadge,
  dot,
  val,
  metric,
  chip,
  originBadge,
  sourceTag,
  emptyState,
  table,
  kv,
  meter,
} from "../components/ui.js";
import { steps } from "../components/flow.js";
import { chartHost } from "../components/chart.js";
import { icon } from "../components/icons.js";
import {
  RESEARCH_KINDS,
  parseSlot,
  agentLabel,
  slotView,
  absence,
  absenceShort,
  noStrategyLabel,
  memoryAbsent,
  slotCounts,
  countText,
  countVal,
  kindsTotal,
  originCount,
  windowOrigins,
  eventsEmptyTitle,
  headline,
  slotSwitcher,
  slotGlyph,
  statusMark,
  lockedButton,
  actionsByKey,
  loadEvents,
  eventsAvailable,
  eventsAbsence,
  eventLog,
  logEmpty,
  ageVal,
  subhead,
  goLink,
  memoryHref,
  strategyHref,
  registryBadge,
  unknownSlotPage,
  mountChartsSafe,
  pad2,
} from "./_agents-common.js";
import { qtyVal } from "./_ops-common.js";

/** A RiskLimit value with its unit and declared currency (fmtLimit); null is empty. */
function limitVal(v, l) {
  const f = fmtLimit(v, l);
  return f.empty ? val(null) : val(f.text, { unit: f.suffix ? ` ${f.suffix}` : "" });
}

const CONTROL_KEYS = ["ASSIGN_STRATEGY", "START_SIMULATION", "HALT_AGENT", "TRIP_KILL_SWITCH"];
const CONTROL_ICONS = { ASSIGN_STRATEGY: "assign", START_SIMULATION: "play", HALT_AGENT: "stop", TRIP_KILL_SWITCH: "power" };
const EVENT_WINDOW = 500;
const ACTIVITY_ROWS = 50;
const RESEARCH_ROWS = 12;

const HANDOFF_LABEL = {
  VALIDATION: "Validation",
  APPROVAL: "Approval",
  DEPLOYMENT_PACKAGE: "Package",
  AGENT_ASSIGNMENT: "Assignment",
  SIMULATION: "Simulation",
  LIVE: "Live",
};

/** Empty body for an area of the terminal, with the three kinds of absence kept apart. */
function areaEmpty(sv, { title, none, hint, iconName = "empty", code }) {
  const why = absence(sv);
  return emptyState({
    title: why ? title : none ?? "None recorded",
    reason: why ?? `${agentLabel(sv.n)} is reported (${humanize(sv.status)}) and declares none.`,
    hint,
    compact: true,
    iconName,
    code,
  });
}

/**
 * The slot's assignment mode (SIM / PAPER / LIVE) as declared by deployment.
 * Shown on the chart panels so a market or equity chart is never read as live
 * trading unless the assignment says LIVE.
 */
function modeBadge(sv) {
  const mode = sv.agent?.assignment?.mode ?? null;
  if (mode) return badge(mode, { label: `${humanize(mode)} MODE`, title: "Assignment mode declared by deployment" });
  return badge(null, { label: sv.reported ? "NO ASSIGNMENT" : "MODE UNKNOWN", title: absence(sv) ?? `${agentLabel(sv.n)} declares no strategy assignment.` });
}

/* ------------------------------------------------------------------ head */

function terminalHead(ctx, sv, res) {
  const a = sv.agent;
  const conns = a?.connections ?? [];
  const connected = conns.filter((c) => c.state === "CONNECTED").length;
  const ev = sv.slot?.events;
  const c = slotCounts(ctx, sv);
  // Events carry a record origin: split per origin when the loaded window holds every event of this slot.
  const split = c.exact && eventsAvailable(ctx, res) ? windowOrigins(res?.events, c.total) : null;
  const evInvalid = c.invalid;
  const meta = [
    ["MODE", a?.assignment ? badge(a.assignment.mode) : val(null)],
    ["MARKET", val(a?.market)],
    ["TIMEFRAME", val(a?.timeframe)],
    ["SIGNAL", a?.signal ? badge(a.signal.state) : val(null)],
    ["HEARTBEAT", ageVal(a?.last_heartbeat, ctx.now)],
    ["LINKS", sv.reported ? (conns.length ? val(`${connected}/${conns.length}`, { unit: " UP" }) : html`<span class="ag-none">NONE</span>`) : val(null)],
    ["EVENTS", split ? originCount(split) : c.exact ? html`${countVal(c, c.total)}<span class="unit"> ALL ORIGINS</span>` : countVal(c, c.total)],
    ["LAST EVENT", ev?.last_ts ? ageVal(ev.last_ts, ctx.now) : ev?.available && !evInvalid ? html`<span class="ag-none">NONE</span>` : val(null)],
  ];
  const actions = actionsByKey(ctx, CONTROL_KEYS);
  const blockers = [...new Set(actions.flatMap((x) => x.blockers ?? []))];
  return html`<section class="${cx("ag-head", toneClass(sv.status))}" data-agent-slot="${sv.n}" data-agent-status="${sv.status}">
    <div class="ag-head__top">
      ${slotGlyph(sv.n, sv.status)}
      <div class="ag-head__ident">
        <div class="ag-head__kicker"><span class="code">AGT-${pad2(sv.n)}</span><span class="code">//</span>TRADING FLOOR · AGENT TERMINAL</div>
        <div class="ag-head__row">
          <h1 class="ag-head__id">${agentLabel(sv.n)}</h1>
          ${statusMark(sv.status, { size: "lg" })}
          ${a?.codename ? html`<span class="ag-head__code">${a.codename}</span>` : ""}
        </div>
        <div class="ag-head__headline" data-headline>${headline(sv)}</div>
        <div class="ag-head__detail">
          <span><i>SPECIALISATION</i>${a?.specialisation ?? html`<span class="muted">${sv.reported ? "Not declared" : "Unknown"}</span>`}</span>
          <span><i>STATUS DETAIL</i>${sv.slot?.status_reason ?? html`<span class="muted">${sv.reported ? "None declared" : "—"}</span>`}</span>
        </div>
      </div>
      <div class="ag-head__right">
        ${slotSwitcher(ctx, sv.n)}
        <div class="ag-head__links">
          ${goLink(`#/agents/${sv.n}/activity`, "Thinking · activity")}
          ${goLink("#/agents", "Trading floor")}
        </div>
        <div class="ag-head__src">${sourceTag(sv.src, { now: ctx.now })}${sourceTag(res?.source ?? source(ctx, "agent_events"), { now: ctx.now })}</div>
      </div>
    </div>
    <dl class="ag-head__meta">${meta.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    <div class="ag-head__controls">
      <div class="ag-head__buttons">${actions.map((x) => lockedButton(x, CONTROL_ICONS[x.key]))}</div>
      <div class="ag-head__blockers">${icon("lock", "icon")}<span>LOCKED</span>${blockers.map((b) => html`<span class="ag-head__blocker">${b}</span>`)}</div>
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ areas */

function statusArea(ctx, sv) {
  const a = sv.agent;
  const conns = a?.connections ?? [];
  return html`
    ${kv([
      ["Status", statusMark(sv.status)],
      ["Reported", sv.connected ? (sv.reported ? html`<span class="mono text-2">YES</span>` : badge(null, { label: "NOT REPORTED" })) : null],
      ["Heartbeat", a?.last_heartbeat ? html`${ageVal(a.last_heartbeat, ctx.now)} <span class="muted small">${fmtDateTime(a.last_heartbeat)}</span>` : null],
      ["Codename", a?.codename ?? null],
    ])}
    <div class="ag-status-detail">${sv.slot?.status_reason ?? html`<span class="muted">${sv.reported ? "No status detail declared." : absence(sv)}</span>`}</div>
    ${subhead("Connections", sv.reported ? html`<span class="muted">${conns.length} declared</span>` : "")}
    ${conns.length
      ? html`<div class="ag-conns">${conns.map(
          (c) => html`<div class="ag-conn" data-connection="${c.name}">
            ${dot(c.state, { pulse: c.state === "CONNECTED" })}
            <span class="ag-conn__name">${c.name}</span>
            <span class="ag-conn__kind">${humanize(c.kind)}</span>
            ${badge(c.state)}
            <span class="ag-conn__hb">${c.last_heartbeat ? ageVal(c.last_heartbeat, ctx.now) : val(null)}</span>
            ${c.detail ? html`<span class="ag-conn__detail">${c.detail}</span>` : ""}
          </div>`,
        )}</div>`
      : areaEmpty(sv, { title: "Connections unknown", none: "No connections declared", hint: "Market data, broker, research bus and memory links appear here with their heartbeats.", code: "connections" })}
  `;
}

function strategyArea(ctx, sv) {
  const a = sv.agent;
  const asg = a?.assignment;
  const s = sv.strategy;
  if (!asg || !s) {
    return html`
      <div class="ag-nostrat" data-empty-state="no-active-strategy">
        <div class="ag-nostrat__title">${icon("sleep", "icon")}<span>${noStrategyLabel(sv)}</span></div>
        <div class="ag-nostrat__reason">${absence(sv) ?? `${agentLabel(sv.n)} declares no strategy assignment.`}</div>
        <div class="ag-nostrat__hint">When deployment assigns a strategy, its id, version, mode, approval reference and package id appear here, with the strategy's handoff state.</div>
      </div>
      ${subhead("Assignment gate")}
      ${steps(
        [
          { key: "VALIDATION", label: "Validated", detail: "Research" },
          { key: "APPROVAL", label: "Approved", detail: "Governance" },
          { key: "DEPLOYMENT_PACKAGE", label: "Packaged", detail: "Deployment" },
          { key: "AGENT_ASSIGNMENT", label: "Assigned", detail: "This slot", boundary: true },
        ],
        { cls: "ag-steps--compact" },
      )}`;
  }
  const strat = findStrategy(ctx, s.strategy_id);
  const ho = handoffFor(ctx, s.strategy_id);
  return html`
    <div class="ag-strat">
      <div class="ag-strat__id"><a class="ref" href="${strategyHref(s.strategy_id)}" data-strategy-link>${s.strategy_id}</a><span class="ag-strat__v">v${asg.version}</span>${registryBadge(ctx, s)}${originBadge(strat?.origin)}</div>
      <div class="ag-strat__name">${s.name ?? html`<span class="muted">Name not available from registry</span>`}</div>
    </div>
    ${kv(
      [
        ["Version", html`<span class="mono">v${asg.version}</span>${strat && strat.current_version !== asg.version ? html` <span class="muted small">registry current v${strat.current_version}</span>` : ""}`],
        ["Mode", badge(asg.mode)],
        ["Assigned", html`<span class="mono">${fmtDateTime(asg.assigned_at)}</span>`],
        ["Approval ref", asg.approval_ref ? html`<span class="ref">${asg.approval_ref}</span>` : null],
        ["Package id", asg.package_id ? html`<span class="ref">${asg.package_id}</span>` : null],
        ["Mechanism", strat?.mechanism ?? null],
      ],
      { cols: 2 },
    )}
    ${subhead("Handoff", ho ? html`<span class="muted">current version v${ho.version} · derived</span>` : "")}
    ${ho
      ? steps(
          ho.steps.map((x) => ({ key: x.step, label: HANDOFF_LABEL[x.step] ?? humanize(x.step), state: x.state })),
          { cls: "ag-steps--compact" },
        )
      : emptyState({ title: "Handoff not derived", reason: source(ctx, "strategies")?.status === "OK" ? `${s.strategy_id} is not in the strategy registry.` : sourceReason(source(ctx, "strategies")), compact: true })}`;
}

function signalArea(ctx, sv) {
  const sig = sv.agent?.signal;
  if (!sig) {
    return html`<div class="ag-signal is-empty">
      ${areaEmpty(sv, { title: "No signal state", none: "No signal state declared", hint: "LONG / SHORT / FLAT / NO SIGNAL with its timestamp and reasoning appears here.", code: "signal" })}
    </div>`;
  }
  return html`<div class="ag-signal">
    <div class="ag-signal__state" data-signal="${sig.state}">${badge(sig.state, { size: "lg", label: humanize(sig.state) })}</div>
    ${kv([
      ["As of", html`<span class="mono">${fmtDateTime(sig.as_of)}</span>`],
      ["Age", ageVal(sig.as_of, ctx.now)],
    ])}
    <div class="ag-signal__detail">${sig.detail ?? html`<span class="muted">No signal detail declared.</span>`}</div>
  </div>`;
}

function pnlArea(ctx, sv) {
  const p = sv.agent?.pnl;
  const dd = sv.agent?.drawdown ?? null;
  const cell = (k, v, hint) => html`<div class="ag-pnl__cell"><div class="ag-pnl__k">${k}</div><div class="ag-pnl__v">${v}</div><div class="ag-pnl__h">${hint}</div></div>`;
  return html`
    <div class="ag-pnl">
      ${cell("Realized", metric(p?.realized ?? null), "Closed trades")}
      ${cell("Unrealized", metric(p?.unrealized ?? null), "Open positions")}
      ${cell("Day", metric(p?.day ?? null), "Current session")}
      ${cell("Drawdown", metric(dd), "Declared by the agent")}
      ${cell("P&L mode", p ? badge(p.mode) : val(null), "Declared with the P&L")}
      ${cell("As of", p ? ageVal(p.as_of, ctx.now) : val(null), p ? fmtDateTime(p.as_of) : absenceShort(sv) ?? "Not declared")}
    </div>
    ${p ? "" : html`<div class="ag-pnl__foot"><span class="muted">${absence(sv) ?? `${agentLabel(sv.n)} declares no P&L.`}</span></div>`}
  `;
}

function riskArea(ctx, sv) {
  const limits = sv.agent?.risk_limits ?? [];
  if (!limits.length) {
    return areaEmpty(sv, { title: "Risk limits unknown", none: "No risk limits declared", hint: "Per-agent limits (contracts, daily loss, exposure) appear with usage meters and OK / WARN / BREACH state.", iconName: "risk", code: "risk" });
  }
  return html`<div class="ag-limits">${limits.map(
    (l) => html`<div class="ag-limit" data-limit="${l.key}">
      <div class="ag-limit__head"><span class="ag-limit__label">${l.label}</span>${badge(l.state)}</div>
      ${meter(l.used, l.limit, { state: l.state })}
      <div class="ag-limit__nums"><span>USED ${limitVal(l.used, l)}</span><span>LIMIT ${limitVal(l.limit, l)}</span></div>
    </div>`,
  )}</div>`;
}

function executionArea(ctx, sv) {
  const x = sv.agent?.execution;
  const num = (v, dp, unit) => (isNil(v) ? val(null) : val(fmtNum(v, dp), { unit }));
  const mean = x?.slippage_bps_mean;
  const model = x?.slippage_model_bps;
  const scale = !isNil(mean) && !isNil(model) ? Math.max(Math.abs(mean), Math.abs(model)) || 1 : null;
  const bar = (v, cls) =>
    isNil(v) || isNil(scale)
      ? html`<div class="ag-slip__bar is-empty" data-v data-empty="1"></div>`
      : html`<div class="ag-slip__bar ${cls}" data-v><i style="width:${raw(((Math.abs(v) / scale) * 100).toFixed(1))}%"></i></div>`;
  return html`
    <div class="ag-exec">
      <div class="ag-exec__cell"><div class="ag-exec__k">Latency p50</div><div class="ag-exec__v">${num(x?.latency_ms_p50, 1, " ms")}</div></div>
      <div class="ag-exec__cell"><div class="ag-exec__k">Latency p95</div><div class="ag-exec__v">${num(x?.latency_ms_p95, 1, " ms")}</div></div>
      <div class="ag-exec__cell"><div class="ag-exec__k">Fills</div><div class="ag-exec__v">${isNil(x?.fills) ? val(null) : val(fmtCount(x.fills))}</div></div>
      <div class="ag-exec__cell"><div class="ag-exec__k">Rejects</div><div class="ag-exec__v">${isNil(x?.rejects) ? val(null) : val(fmtCount(x.rejects))}</div></div>
    </div>
    ${subhead("Slippage · mean vs cost model", html`<span class="muted">basis points</span>`)}
    <div class="ag-slip">
      <span class="ag-slip__k">MEAN</span>${bar(mean, "is-mean")}<span class="ag-slip__v">${num(mean, 2, " bps")}</span>
      <span class="ag-slip__k">MODEL</span>${bar(model, "is-model")}<span class="ag-slip__v">${num(model, 2, " bps")}</span>
    </div>
    <div class="ag-exec__foot">${x ? html`AS OF <span class="mono text-2">${fmtDateTime(x.as_of)}</span>` : html`<span class="muted">${absence(sv) ?? `${agentLabel(sv.n)} declares no execution statistics.`}</span>`}</div>
  `;
}

function positionsArea(ctx, sv) {
  const rows = sv.agent?.positions ?? [];
  return table({
    dense: true,
    columns: [
      { key: "instrument", label: "Instrument", render: (r) => html`<span class="mono strong" data-position="${r.instrument}">${r.instrument}</span>` },
      { key: "side", label: "Side", render: (r) => badge(r.side) },
      { key: "quantity", label: "Qty", num: true, render: (r) => qtyVal(r.quantity) },
      { key: "avg_price", label: "Avg price", num: true, render: (r) => (isNil(r.avg_price) ? null : val(fmtNum(r.avg_price, 2))) },
      { key: "unrealized_pnl", label: "Unrealized", num: true, render: (r) => (r.unrealized_pnl ? metric(r.unrealized_pnl) : null) },
      { key: "mode", label: "Mode", render: (r) => chip(humanize(r.mode)) },
      { key: "as_of", label: "As of", render: (r) => ageVal(r.as_of, ctx.now) },
    ],
    rows,
    empty: areaEmpty(sv, { title: "Positions unknown", none: "No open positions", hint: "Open positions with side, size, average price and unrealized P&L appear here.", code: "positions" }),
  });
}

function ordersArea(ctx, sv) {
  const rows = sv.agent?.orders ?? [];
  return table({
    dense: true,
    columns: [
      { key: "order_id", label: "Order", render: (r) => html`<span class="ref">${r.order_id}</span>` },
      { key: "instrument", label: "Instr", cls: "mono" },
      { key: "side", label: "Side", render: (r) => html`<span class="mono strong">${r.side}</span>` },
      { key: "quantity", label: "Qty", num: true, render: (r) => qtyVal(r.quantity) },
      { key: "order_type", label: "Type", render: (r) => html`<span class="mono small">${humanize(r.order_type)}</span>${isNil(r.limit_price) ? "" : html` <span class="mono text-2">@ ${fmtNum(r.limit_price, 2)}</span>`}` },
      { key: "status", label: "Status", render: (r) => badge(r.status) },
      { key: "submitted_at", label: "Submitted", render: (r) => ageVal(r.submitted_at, ctx.now) },
    ],
    rows,
    empty: areaEmpty(sv, { title: "Orders unknown", none: "No working orders", hint: "Working, partial, filled, cancelled and rejected orders appear here. The Command Centre never enters orders.", code: "orders" }),
  });
}

function tradesArea(ctx, sv) {
  const rows = sv.agent?.recent_trades ?? [];
  return table({
    dense: true,
    columns: [
      { key: "executed_at", label: "Executed", render: (r) => html`<span class="mono">${fmtDateTime(r.executed_at)}</span>` },
      { key: "trade_id", label: "Trade", render: (r) => html`<span class="ref">${r.trade_id}</span>` },
      { key: "instrument", label: "Instr", cls: "mono" },
      { key: "side", label: "Side", render: (r) => html`<span class="mono strong">${r.side}</span>` },
      { key: "quantity", label: "Qty", num: true, render: (r) => qtyVal(r.quantity) },
      { key: "price", label: "Price", num: true, render: (r) => val(fmtNum(r.price, 2)) },
      { key: "slippage_bps", label: "Slip", num: true, render: (r) => (isNil(r.slippage_bps) ? null : val(fmtNum(r.slippage_bps, 1), { unit: " bps" })) },
      { key: "pnl", label: "P&L", num: true, render: (r) => (r.pnl ? metric(r.pnl) : null) },
      { key: "mode", label: "Mode", render: (r) => chip(humanize(r.mode)) },
    ],
    rows,
    empty: areaEmpty(sv, { title: "Trades unknown", none: "No trades recorded", hint: "Executions with price, slippage and P&L (with basis) appear here.", code: "trades" }),
  });
}

function memoryArea(ctx, sv) {
  const refs = sv.agent?.memory_refs ?? [];
  if (!refs.length) {
    return areaEmpty(sv, { title: "Memory links unknown", none: "No memory references", hint: "Memories this agent recalls and writes — lessons, failed mechanisms, observations — are linked here.", iconName: "memory", code: "memory" });
  }
  return html`<div class="ag-mems">${refs.map((id) => {
    const m = findMemory(ctx, id);
    return html`<a class="ag-mem" href="${memoryHref(id)}" data-memory-ref="${id}">
      <span class="ag-mem__id">${id}</span>
      <span class="ag-mem__title">${m ? m.title : memoryAbsent(ctx)}</span>
      <span class="ag-mem__meta">${m ? html`${chip(humanize(m.type))}${badge(m.validation_state)}${originBadge(m.origin)}` : ""}</span>
    </a>`;
  })}</div>`;
}

function alertsArea(ctx, sv) {
  const alerts = [...(sv.agent?.alerts ?? [])].sort((x, y) => (x.at < y.at ? 1 : -1));
  if (!alerts.length) {
    return areaEmpty(sv, { title: "Alerts unknown", none: "No alerts raised", hint: "Runtime alerts raised by this agent appear here with severity and reference.", iconName: "alert", code: "alerts" });
  }
  return html`<div class="ag-alerts">${alerts.map(
    (al) => html`<div class="ag-alert" data-alert="${al.alert_id}">
      ${severityBadge(al.severity)}
      <span class="ag-alert__msg">${al.message}</span>
      <span class="ag-alert__at" title="${fmtDateTime(al.at)}">${ageVal(al.at, ctx.now)}</span>
      ${al.ref ? html`<span class="ref">${al.ref}</span>` : ""}
    </div>`,
  )}</div>`;
}

/** Why AT-13 lists nothing: from exact whole-stream counts, never from the loaded window alone. */
function researchEmptyReason(ctx, n, res, counts, total) {
  if (!eventsAvailable(ctx, res) || !counts.avail || isNil(total)) return eventsAbsence(ctx, res, { slot: n });
  if (counts.invalid) {
    return `No valid line records a research-kind event for ${agentLabel(n)} in its latest ${fmtCount(EVENT_WINDOW)} events; ${fmtCount(counts.invalidLines)} line(s) of agent_events.jsonl were rejected by the contract and cannot be attributed.`;
  }
  if (total === 0) return `agent_events.jsonl is connected; ${agentLabel(n)} has recorded no research-kind events.`;
  return `${agentLabel(n)} has ${fmtCount(total)} research-kind event(s), none among its latest ${fmtCount(EVENT_WINDOW)} events — open the activity view to filter by kind.`;
}

/* ------------------------------------------------------------------ view */

export default {
  title(ctx) {
    const n = parseSlot(ctx.params.slot);
    return n ? `Agent ${pad2(n)}` : "Unknown slot";
  },
  async load(ctx) {
    const n = parseSlot(ctx.params.slot);
    if (!n) return { invalid: true };
    return { events: await loadEvents({ slot: n, limit: EVENT_WINDOW }) };
  },
  mount(root) {
    return mountChartsSafe(root);
  },
  render(ctx) {
    const n = parseSlot(ctx.params.slot);
    if (!n) return unknownSlotPage(ctx, ctx.params.slot, { pageHeader, panel, emptyState });
    const sv = slotView(ctx, n);
    const a = sv.agent;
    const res = ctx.extra?.events ?? null;
    const evOk = eventsAvailable(ctx, res);
    const all = res?.events ?? [];
    const recent = all.slice(0, ACTIVITY_ROWS);
    const research = all.filter((e) => RESEARCH_KINDS.includes(e.kind)).slice(0, RESEARCH_ROWS);
    // Research-kind total over the whole stream (derived), not the loaded window.
    const counts = slotCounts(ctx, sv);
    const researchTotal = kindsTotal(counts.byKind, RESEARCH_KINDS);
    const bars = a?.bars ?? [];
    const equity = a?.equity ?? [];
    const why = absence(sv);

    return html`<div class="ag-page ag-page--terminal">
      ${terminalHead(ctx, sv, res)}

      <div class="grid">
        ${panel({
          span: 8,
          code: "AT-01",
          title: "Market chart",
          sub: bars.length ? `${a.market ?? "Market not declared"} · ${a.timeframe ?? "timeframe not declared"} · ${bars.length} bars` : "Market · candles",
          actions: html`${a?.timeframe ? chip(a.timeframe) : ""}${a?.market ? chip(a.market) : ""}${modeBadge(sv)}`,
          body: chartHost({
            kind: "candles",
            data: bars,
            height: 330,
            emptyTitle: "NO MARKET DATA",
            emptyReason: why ?? `${agentLabel(n)} reports no bars. Candles appear when the agent runtime streams its market.`,
            label: `${agentLabel(n)} market candles`,
          }),
        })}
        ${panel({ span: 4, code: "AT-02", title: "Agent status", sub: "Status · heartbeat · connections", body: statusArea(ctx, sv) })}
      </div>

      <div class="grid">
        ${panel({ span: 5, code: "AT-03", title: "Strategy", sub: "Assignment from deployment", body: strategyArea(ctx, sv), cls: "ag-xl-6" })}
        ${panel({ span: 3, code: "AT-04", title: "Signal state", body: signalArea(ctx, sv), cls: "ag-xl-6" })}
        ${panel({ span: 4, code: "AT-05", title: "P&L", sub: "Realized · unrealized · day · drawdown", body: html`<div class="ag-pnl-wrap">${pnlArea(ctx, sv)}</div>`, cls: "ag-xl-12" })}
      </div>

      <div class="grid">
        ${panel({
          span: 7,
          code: "AT-06",
          title: "Equity & drawdown",
          sub: equity.length ? `${equity.length} points` : "Equity curve",
          actions: html`<span class="ag-dd"><span class="label">DRAWDOWN</span>${metric(a?.drawdown ?? null)}</span>${modeBadge(sv)}`,
          body: chartHost({
            kind: "area",
            data: equity,
            height: 230,
            emptyTitle: "NO EQUITY SERIES",
            emptyReason: why ?? `${agentLabel(n)} reports no equity series.`,
            label: `${agentLabel(n)} equity`,
          }),
        })}
        ${panel({ span: 5, code: "AT-07", title: "Risk limits", sub: "Declared per-agent limits", body: riskArea(ctx, sv) })}
      </div>

      <div class="grid">
        ${panel({ span: 6, code: "AT-08", title: "Current positions", body: positionsArea(ctx, sv) })}
        ${panel({ span: 6, code: "AT-09", title: "Orders", body: ordersArea(ctx, sv) })}
      </div>

      <div class="grid">
        ${panel({ span: 7, code: "AT-10", title: "Recent trades", body: tradesArea(ctx, sv) })}
        ${panel({ span: 5, code: "AT-11", title: "Execution", sub: "Latency · slippage · fills", body: executionArea(ctx, sv) })}
      </div>

      <div class="grid">
        ${panel({
          span: 7,
          code: "AT-12",
          title: "Agent activity",
          sub: evOk && recent.length ? `Latest ${recent.length} events, newest first` : "agent_events.jsonl",
          actions: goLink(`#/agents/${n}/activity`, "Thinking view"),
          body: eventLog(ctx, recent, {
            maxHeight: 620,
            prompt: recent.length ? `sentry://agents/${pad2(n)} — activity` : null,
            empty: logEmpty({
              title: eventsEmptyTitle(ctx, res),
              reason: eventsAbsence(ctx, res, { slot: n }),
              hint: "Observations, signal evaluations, no-trade calls, decisions, orders and fills will stream here.",
            }),
          }),
          cls: "ag-fillbody",
        })}
        <div class="span-5 stack">
          ${panel({
            code: "AT-13",
            title: "Research activity",
            sub: research.length && !isNil(countText(counts, researchTotal))
              ? `Latest ${fmtCount(research.length)} of ${countText(counts, researchTotal)} research-kind events`
              : "Hypotheses · tests · evaluations · learning · proposals",
            body: eventLog(ctx, research, {
              compact: true,
              maxHeight: 300,
              empty: logEmpty({
                title: eventsEmptyTitle(ctx, res, "NO RESEARCH ACTIVITY", "NO VALID RESEARCH EVENT LINE"),
                reason: researchEmptyReason(ctx, n, res, counts, researchTotal),
              }),
            }),
          })}
          ${panel({ code: "AT-14", title: "Memory", sub: "memory_refs → evidence-backed memories", body: memoryArea(ctx, sv) })}
          ${panel({ code: "AT-15", title: "Alerts", body: alertsArea(ctx, sv) })}
        </div>
      </div>
    </div>`;
  },
};
