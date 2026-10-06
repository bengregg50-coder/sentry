// Execution — broker/feed connections, open orders, fills and execution quality
// from execution.json, plus each agent's declared execution block. Slippage is
// set beside the cost model's assumption from declared numbers only; nothing
// is computed, smoothed or estimated here.

import { html } from "../core/html.js";
import { fmtDateTime, fmtCount, fmtNum, humanize, isNil } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort, sourceTitle } from "../core/state.js";
import { pageHeader, panel, badge, stat, statRow, sourceTag, table, val, emptyState } from "../components/ui.js";
import {
  SLOTS,
  slotName,
  numVal,
  qtyVal,
  priceVal,
  timeVal,
  hbar,
  scaleOf,
  connectionList,
  absent,
  provenance,
  ghostHead,
  slotAbsence,
  slotBadge,
  untilAvailable,
  mcell,
  limitRow,
} from "./_ops-common.js";

/* ---------------------------------------------------------------- EXE-01 quality */

function quality(ctx, ex, src) {
  const st = ex?.stats ?? null;
  const why = ex ? "NOT REPORTED" : sourceShort(src);
  const n = (v, dp) => (isNil(v) ? null : fmtNum(v, dp));
  const lat = scaleOf([st?.latency_ms_p50, st?.latency_ms_p95]);
  return html`${statRow(
      [
        stat({ label: "Latency p50", value: n(st?.latency_ms_p50, 1), unit: "ms", hint: "Order round trip", emptyLabel: why }),
        stat({ label: "Latency p95", value: n(st?.latency_ms_p95, 1), unit: "ms", hint: "Order round trip", emptyLabel: why }),
        stat({ label: "Slippage mean", value: n(st?.slippage_bps_mean, 2), unit: "bps", hint: "Realised", emptyLabel: why }),
        stat({ label: "Slippage model", value: n(st?.slippage_model_bps, 2), unit: "bps", hint: "Cost model", emptyLabel: why }),
        stat({ label: "Fills", value: isNil(st?.fills) ? null : fmtCount(st.fills), hint: "Declared count", emptyLabel: why }),
        stat({ label: "Rejects", value: isNil(st?.rejects) ? null : fmtCount(st.rejects), hint: "Declared count", emptyLabel: why }),
      ],
      { min: 130 },
    )}
    <div class="ops-lat">
      <div class="ops-lat__row"><span class="ops-k">P50</span>${hbar(st?.latency_ms_p50, lat.maxAbs, { kind: "a" })}${numVal(st?.latency_ms_p50, 1, "ms")}</div>
      <div class="ops-lat__row"><span class="ops-k">P95</span>${hbar(st?.latency_ms_p95, lat.maxAbs, { kind: "b" })}${numVal(st?.latency_ms_p95, 1, "ms")}</div>
      <div class="ops-lat__foot">${st ? html`STATS AS OF <span class="mono text-2">${fmtDateTime(st.as_of)}</span> · bars share one scale` : ex ? "execution.json is connected but declares no stats block." : sourceReason(src)}</div>
    </div>
    <div class="ops-strip-head"><span class="label">Execution limits · risk.json</span>${sourceTag(source(ctx, "risk"), { now: ctx.now })}</div>
    ${execLimits(ctx)}`;
}

/** Execution-limit declarations from risk.json, shown beside the stats they bound. */
function execLimits(ctx) {
  const risk = doc(ctx, "risk");
  if (!risk) return absent(ctx, "risk", { what: "Execution limits", hint: "Declared limits on order flow and fill quality appear here with used vs limit." });
  if (!risk.execution_limits.length)
    return emptyState({ title: "No execution limits declared", reason: "risk.json is connected and declares no execution limits. None are assumed.", compact: true, code: "no-exec-limits" });
  return html`<div class="ops-limits ops-limits--grid">${risk.execution_limits.map((l) => limitRow(l, { compact: true }))}</div>`;
}

/* ---------------------------------------------------------------- EXE-02 slippage vs model */

function slipPair(mean, model) {
  const sc = scaleOf([mean, model]);
  return html`<div class="ops-slip">
    <div class="ops-slip__row" data-slip="realised"><span class="ops-k">REALISED MEAN</span>${hbar(mean, sc.maxAbs, { signed: sc.signed, kind: "a" })}${numVal(mean, 2, "bps")}</div>
    <div class="ops-slip__row" data-slip="model"><span class="ops-k">COST MODEL</span>${hbar(model, sc.maxAbs, { signed: sc.signed, kind: "b" })}${numVal(model, 2, "bps")}</div>
  </div>`;
}

function slippage(ctx, ex, src) {
  const st = ex?.stats ?? null;
  const slots = derived(ctx, "agent_slots") ?? [];
  const agentRows = slots.filter((s) => s.agent?.execution);
  return html`<div class="ops-slip-block">
      <div class="ops-slip-block__head"><span class="label label--accent">Book · execution.json</span></div>
      ${slipPair(st?.slippage_bps_mean, st?.slippage_model_bps)}
      ${st ? "" : html`<div class="ops-note">${ex ? "No execution stats declared." : `${sourceReason(src) ?? ""} Realised slippage is set against the cost model ${untilAvailable(src, "the execution layer")}.`}</div>`}
    </div>
    <div class="ops-slip-block">
      <div class="ops-slip-block__head"><span class="label label--accent">Per agent · agents.json</span></div>
      ${agentRows.length
        ? agentRows.map((s) => html`<div class="ops-slip-agent" data-slip-agent="${s.slot}"><a class="ops-slot-link" href="#/agents/${s.slot}">${slotName(s.slot)}</a>${slipPair(s.agent.execution.slippage_bps_mean, s.agent.execution.slippage_model_bps)}</div>`)
        : emptyState({
            title: source(ctx, "agents")?.status === "OK" ? "No agent execution blocks" : sourceTitle(source(ctx, "agents"), "Agent execution blocks"),
            reason: source(ctx, "agents")?.status === "OK" ? "No agent declares execution statistics." : sourceReason(source(ctx, "agents")),
            compact: true,
            code: "no-agent-exec",
          })}
    </div>
    <div class="ops-legend"><span><i class="ops-sw ops-sw--a"></i>REALISED</span><span><i class="ops-sw ops-sw--b"></i>MODEL</span><span>Each pair on its own common scale · no difference computed</span></div>`;
}

/* ---------------------------------------------------------------- EXE-04 open orders */

const ORDER_COLS = [
  { key: "order_id", label: "Order", cls: "mono" },
  { key: "agent_slot", label: "Agent", render: (r) => (r.agent_slot ? html`<a class="ops-slot-link" href="#/agents/${r.agent_slot}">${slotName(r.agent_slot)}</a>` : null) },
  { key: "instrument", label: "Instrument", cls: "strong" },
  { key: "side", label: "Side", render: (r) => html`<span class="ops-side" data-side="${r.side}">${r.side}</span>` },
  { key: "quantity", label: "Qty", num: true, render: (r) => qtyVal(r.quantity) },
  { key: "order_type", label: "Type", render: (r) => html`<span class="mono small">${humanize(r.order_type)}</span>` },
  { key: "limit_price", label: "Limit", num: true, render: (r) => priceVal(r.limit_price) },
  { key: "status", label: "Status", render: (r) => badge(r.status) },
  { key: "mode", label: "Mode", render: (r) => badge(r.mode) },
  { key: "submitted_at", label: "Submitted", render: (r) => timeVal(r.submitted_at) },
];

function orders(ctx, ex) {
  const head = ghostHead(ORDER_COLS.map((c) => c.label), { cls: "ops-ghost-head--10" });
  if (!ex) return html`${head}${absent(ctx, "execution", { what: "Open orders", hint: "Working and partially filled orders appear here with agent, type, limit and mode." })}`;
  return table({
    dense: true,
    columns: ORDER_COLS,
    rows: ex.open_orders,
    maxHeight: 300,
    empty: html`${head}${emptyState({ title: "No open orders", reason: "execution.json is connected and declares no open orders.", compact: true, code: "no-orders" })}`,
  });
}

/* ---------------------------------------------------------------- EXE-05 fills */

const FILL_COLS = [
  { key: "executed_at", label: "Executed", render: (r) => timeVal(r.executed_at) },
  { key: "trade_id", label: "Fill", render: (r) => html`<span class="mono" data-fill="${r.trade_id}">${r.trade_id}</span>` },
  { key: "agent_slot", label: "Agent", render: (r) => (r.agent_slot ? html`<a class="ops-slot-link" href="#/agents/${r.agent_slot}">${slotName(r.agent_slot)}</a>` : null) },
  { key: "instrument", label: "Instrument", cls: "strong" },
  { key: "side", label: "Side", render: (r) => html`<span class="ops-side" data-side="${r.side}">${r.side}</span>` },
  { key: "quantity", label: "Qty", num: true, render: (r) => qtyVal(r.quantity) },
  { key: "price", label: "Price", num: true, render: (r) => priceVal(r.price) },
  { key: "slippage_bps", label: "Slippage", num: true, render: (r) => numVal(r.slippage_bps, 2, "bps") },
  { key: "mode", label: "Mode", render: (r) => badge(r.mode) },
  { key: "pnl", label: "P&L", num: true, render: (r) => mcell(r.pnl) },
];

function fills(ctx, ex) {
  const head = ghostHead(FILL_COLS.map((c) => c.label), { cls: "ops-ghost-head--10" });
  if (!ex) return html`${head}${absent(ctx, "execution", { what: "Fills", hint: "Every fill appears with price, slippage in bps and its mode (SIM / PAPER / LIVE)." })}`;
  const rows = [...ex.fills].sort((a, b) => (a.executed_at < b.executed_at ? 1 : -1));
  return table({
    dense: true,
    columns: FILL_COLS,
    rows,
    maxHeight: 380,
    empty: html`${head}${emptyState({ title: "No fills recorded", reason: "execution.json is connected and records no fills.", compact: true, code: "no-fills" })}`,
  });
}

/* ---------------------------------------------------------------- EXE-06 per agent */

function perAgent(ctx) {
  const slots = derived(ctx, "agent_slots") ?? SLOTS.map((n) => ({ slot: n, status: null, reported: false, agent: null }));
  return table({
    dense: true,
    columns: [
      { key: "slot", label: "Slot", render: (r) => html`<a class="ops-slot-link" href="#/agents/${r.slot}">${slotName(r.slot)}</a>` },
      { key: "status", label: "Status", render: (r) => slotBadge(ctx, r) },
      { key: "p50", label: "Latency p50", num: true, render: (r) => numVal(r.agent?.execution?.latency_ms_p50, 1, "ms") },
      { key: "p95", label: "Latency p95", num: true, render: (r) => numVal(r.agent?.execution?.latency_ms_p95, 1, "ms") },
      { key: "slip", label: "Slippage mean", num: true, render: (r) => numVal(r.agent?.execution?.slippage_bps_mean, 2, "bps") },
      { key: "model", label: "Model", num: true, render: (r) => numVal(r.agent?.execution?.slippage_model_bps, 2, "bps") },
      { key: "fills", label: "Fills", num: true, render: (r) => (isNil(r.agent?.execution?.fills) ? null : val(fmtCount(r.agent.execution.fills))) },
      { key: "rejects", label: "Rejects", num: true, render: (r) => (isNil(r.agent?.execution?.rejects) ? null : val(fmtCount(r.agent.execution.rejects))) },
      { key: "as_of", label: "As of", render: (r) => (r.agent?.execution ? timeVal(r.agent.execution.as_of) : null) },
      {
        key: "why",
        label: "Note",
        cls: "ops-why",
        render: (r) => {
          if (r.agent?.execution) return html`<span class="muted small">Declared by agent</span>`;
          const why = slotAbsence(ctx, r);
          return html`<span class="muted small">${why ? why.title : "No execution block declared"}</span>`;
        },
      },
    ],
    rows: slots,
    rowCls: (r) => (r.agent?.execution ? "" : "ops-row-dim"),
  });
}

export default {
  title: "Execution",
  render(ctx) {
    const ex = doc(ctx, "execution");
    const src = source(ctx, "execution");

    return html`<div class="ops-view">
      ${pageHeader({
        kicker: "OPERATIONS",
        code: "EXE",
        title: "Execution",
        sub: "Connections, order flow, fills and execution quality as declared by the execution layer in execution.json, with every fill labelled by mode. Realised slippage is shown beside the cost model's assumption — never blended or estimated.",
        right: sourceTag(src, { now: ctx.now }),
      })}

      <div class="grid">
        ${panel({
          span: 8,
          code: "EXE-01",
          title: "Execution quality",
          sub: ex?.stats ? "execution.stats" : ex ? "No stats declared" : sourceReason(src),
          body: quality(ctx, ex, src),
          cls: "lg-span-12",
        })}
        ${panel({
          span: 4,
          code: "EXE-02",
          title: "Slippage vs model",
          sub: "Declared values",
          variant: "accent",
          body: slippage(ctx, ex, src),
          cls: "lg-span-12",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 4,
          code: "EXE-03",
          title: "Connections",
          sub: ex ? `${fmtCount(ex.connections.length)} declared` : "Broker · market data",
          body: ex
            ? connectionList(ex.connections, {
                now: ctx.now,
                empty: emptyState({ title: "No connections declared", reason: "execution.json is connected and declares no broker or feed connections.", compact: true, iconName: "link", code: "no-connections" }),
              })
            : html`${ghostHead(["Connection", "Kind", "State", "Heartbeat"], { cls: "ops-ghost-head--4" })}${absent(ctx, "execution", { what: "Connections", hint: "Broker and market-data links appear here with state and last heartbeat." })}`,
          cls: "lg-span-12",
        })}
        ${panel({
          span: 8,
          code: "EXE-04",
          title: "Open orders",
          sub: ex ? `${fmtCount(ex.open_orders.length)} open` : "execution.open_orders",
          body: orders(ctx, ex),
          cls: "lg-span-12",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "EXE-05",
          title: "Fills",
          sub: ex ? `${fmtCount(ex.fills.length)} recorded · newest first` : "execution.fills",
          body: fills(ctx, ex),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "EXE-06",
          title: "Per-agent execution",
          sub: "Declared by each agent in agents.json",
          actions: sourceTag(source(ctx, "agents"), { now: ctx.now }),
          body: perAgent(ctx),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "EXE-07",
          title: "Provenance",
          sub: "Where these values come from",
          body: provenance(ctx, ["execution", "risk", "agents"]),
        })}
      </div>
    </div>`;
  },
};
