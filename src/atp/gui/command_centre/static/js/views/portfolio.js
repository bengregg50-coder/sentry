// Portfolio — the aggregate book declared by the trading engine in portfolio.json.
// No portfolio exists until a validated, approved strategy is deployed to an
// agent. Not connected is not zero: every figure is either declared by the
// producer (with its basis) or shown as absent. Agent books (agents.json) are
// listed per agent and never summed into portfolio figures.

import { html } from "../core/html.js";
import { fmtDateTime, fmtCount, humanize } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort } from "../core/state.js";
import { pageHeader, panel, badge, statRow, sourceTag, table, val, metric, emptyState } from "../components/ui.js";
import { chartHost, sparkline } from "../components/chart.js";
import { SLOTS, slotName, mountChartsSafe, metricStat, plainStat, mcell, priceVal, qtyVal, timeVal, hbar, scaleOf, absent, provenance, doctrine, ghostHead } from "./_ops-common.js";

/* ---------------------------------------------------------------- PRT-01 book */

function book(ctx, pf, src) {
  const nc = sourceShort(src);
  const p = pf?.pnl ?? null;
  const pnlEmpty = pf ? "NOT REPORTED" : nc;
  return html`<div class="ops-book">
    <div class="ops-book__mode" data-portfolio-mode="${pf?.mode ?? "NOT_CONNECTED"}">
      <span class="label">Book mode</span>
      ${pf ? badge(pf.mode, { size: "lg" }) : badge("NOT_CONNECTED", { size: "lg", label: nc })}
      <span class="ops-book__asof">${
        pf
          ? html`<span>BOOK AS OF <span class="mono text-2">${fmtDateTime(pf.as_of)}</span></span>${p ? html`<span>P&amp;L AS OF <span class="mono text-2">${fmtDateTime(p.as_of)}</span></span>` : ""}`
          : html`<span class="muted">${sourceReason(src) ?? ""}</span>`
      }</span>
    </div>
    <div class="ops-book__stats">
      ${statRow(
        [
          metricStat("Realized P&L", p?.realized, { hint: "Closed trades", emptyLabel: pnlEmpty, attr: "realized" }),
          metricStat("Unrealized P&L", p?.unrealized, { hint: "Open positions", emptyLabel: pnlEmpty, attr: "unrealized" }),
          metricStat("Day P&L", p?.day, { hint: "Current session", emptyLabel: pnlEmpty, attr: "day" }),
          metricStat("Drawdown", pf?.drawdown, { hint: "Declared drawdown", emptyLabel: pnlEmpty, attr: "drawdown" }),
          plainStat("Open positions", pf ? fmtCount(pf.positions.length) : null, { hint: "portfolio.positions", emptyLabel: nc, attr: "positions" }),
          plainStat("Allocations", pf ? fmtCount(pf.allocations.length) : null, { hint: "portfolio.allocations", emptyLabel: nc, attr: "allocations" }),
        ],
        { min: 150 },
      )}
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- PRT-02 equity */

function equity(ctx, pf, src) {
  const pts = pf?.equity ?? [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  return html`${chartHost({
    kind: "area",
    data: pf?.equity,
    height: 290,
    label: "Portfolio equity",
    emptyTitle: pf ? "No equity series declared" : `Portfolio ${sourceShort(src)}`,
    emptyReason: pf
      ? "portfolio.json is connected but carries no equity points."
      : `${sourceReason(src) ?? ""} The curve is drawn from portfolio.equity once the trading engine produces it.`,
  })}
  <div class="ops-eq-foot">
    <span><span class="ops-k">FIRST</span>${first ? html`${timeVal(first.t)} ${val(String(first.v))}` : val(null)}</span>
    <span><span class="ops-k">LAST</span>${last ? html`${timeVal(last.t)} ${val(String(last.v))}` : val(null)}</span>
    <span><span class="ops-k">POINTS</span>${pf ? val(fmtCount(pts.length)) : val(null)}</span>
    <span><span class="ops-k">DRAWDOWN</span>${metric(pf?.drawdown ?? null)}</span>
  </div>`;
}

/* ---------------------------------------------------------------- PRT-03 exposures */

function exposures(ctx, pf) {
  const head = ghostHead(["Exposure", "Gross", "Net"], { cls: "ops-expo-grid" });
  if (!pf) return html`${head}${absent(ctx, "portfolio", { title: "Exposures not connected", hint: "Gross and net exposure per declared key appear here, each with its basis." })}`;
  if (!pf.exposures.length)
    return html`${head}${emptyState({ title: "No exposures declared", reason: "portfolio.json is connected and declares no exposures.", compact: true, code: "no-exposures" })}`;
  // Bars share a scale only within one unit; mixed units are never compared.
  const byUnit = new Map();
  for (const e of pf.exposures) for (const m of [e.gross, e.net]) if (m) byUnit.set(m.unit, [...(byUnit.get(m.unit) ?? []), m.value]);
  const scales = new Map([...byUnit].map(([u, vs]) => [u, scaleOf(vs)]));
  const bar = (m, kind) => {
    if (!m) return hbar(null, 0);
    const s = scales.get(m.unit);
    return hbar(m.value, s.maxAbs, { signed: s.signed, kind, label: `${m.value}` });
  };
  return html`${head}<div class="ops-expo">
    ${pf.exposures.map(
      (e) => html`<div class="ops-expo__row ops-expo-grid" data-exposure="${e.key}">
        <div class="ops-expo__name"><span class="strong">${e.label}</span><span class="ops-expo__key">${e.key}</span></div>
        <div class="ops-expo__cell">${mcell(e.gross)}${bar(e.gross, "b")}</div>
        <div class="ops-expo__cell">${mcell(e.net)}${bar(e.net, "a")}</div>
      </div>`,
    )}
  </div>
  <div class="ops-legend"><span><i class="ops-sw ops-sw--b"></i>GROSS</span><span><i class="ops-sw ops-sw--a"></i>NET · centre line = zero when any value is short</span><span>Bars share a scale only within one unit</span></div>`;
}

/* ---------------------------------------------------------------- PRT-04 allocations */

function allocations(ctx, pf) {
  const slots = derived(ctx, "agent_slots") ?? SLOTS.map((n) => ({ slot: n, status: null, reported: false, strategy: null }));
  const rows = [];
  for (const s of slots) {
    const allocs = pf ? pf.allocations.filter((a) => a.agent_slot === s.slot) : [];
    if (allocs.length) allocs.forEach((a) => rows.push({ s, a }));
    else rows.push({ s, a: null });
  }
  return table({
    dense: true,
    columns: [
      { key: "slot", label: "Slot", render: (r) => html`<a class="ops-slot-link" href="#/agents/${r.s.slot}">${slotName(r.s.slot)}</a>` },
      { key: "status", label: "Agent", render: (r) => badge(r.s.status ?? "NOT_REPORTED") },
      {
        key: "strategy",
        label: "Allocated strategy",
        render: (r) =>
          r.a
            ? html`<a class="ref" href="#/strategy/${encodeURIComponent(r.a.strategy_id)}" data-allocation="${r.a.strategy_id}">${r.a.strategy_id}</a> <span class="mono text-2">v${r.a.version}</span>`
            : pf
              ? html`<span class="ops-none">UNALLOCATED</span>`
              : null,
      },
      { key: "weight", label: "Weight", num: true, render: (r) => (r.a?.weight ? mcell(r.a.weight) : null) },
      { key: "capital", label: "Capital", num: true, render: (r) => (r.a?.capital ? mcell(r.a.capital) : null) },
      {
        key: "assigned",
        label: "Agent assignment · agents.json",
        render: (r) =>
          r.s.strategy
            ? html`<span class="ref">${r.s.strategy.strategy_id}</span> <span class="mono text-2">v${r.s.strategy.version}</span> ${badge(r.s.strategy.mode)}`
            : r.s.reported
              ? html`<span class="ops-none">NO ASSIGNMENT</span>`
              : null,
      },
    ],
    rows,
    rowCls: (r) => (r.a ? "" : "ops-row-dim"),
  });
}

/* ---------------------------------------------------------------- PRT-05 positions */

function positions(ctx, pf) {
  const columns = [
    { key: "instrument", label: "Instrument", cls: "strong" },
    { key: "side", label: "Side", render: (r) => badge(r.side) },
    { key: "quantity", label: "Qty", num: true, render: (r) => qtyVal(r.quantity) },
    { key: "avg_price", label: "Avg price", num: true, render: (r) => priceVal(r.avg_price) },
    { key: "unrealized_pnl", label: "Unrealized", num: true, render: (r) => (r.unrealized_pnl ? mcell(r.unrealized_pnl) : null) },
    { key: "mode", label: "Mode", render: (r) => badge(r.mode) },
    { key: "as_of", label: "As of", render: (r) => timeVal(r.as_of) },
  ];
  const head = ghostHead(columns.map((c) => c.label), { cls: "ops-ghost-head--7" });
  if (!pf) return html`${head}${absent(ctx, "portfolio", { title: "Positions not connected", hint: "Open positions with side, size, average price and unrealized P&L appear here." })}`;
  return table({
    dense: true,
    columns,
    rows: pf.positions,
    empty: html`${head}${emptyState({ title: "No open positions", reason: "portfolio.json is connected and declares a flat book.", compact: true, code: "no-positions" })}`,
  });
}

/* ---------------------------------------------------------------- PRT-06 agent books */

function agentBooks(ctx) {
  const slots = derived(ctx, "agent_slots") ?? SLOTS.map((n) => ({ slot: n, status: null, reported: false, agent: null }));
  return table({
    dense: true,
    columns: [
      { key: "slot", label: "Slot", render: (r) => html`<a class="ops-slot-link" href="#/agents/${r.slot}">${slotName(r.slot)}</a>` },
      { key: "status", label: "Status", render: (r) => badge(r.status ?? "NOT_REPORTED") },
      { key: "mode", label: "P&L mode", render: (r) => (r.agent?.pnl ? badge(r.agent.pnl.mode) : null) },
      { key: "realized", label: "Realized", num: true, render: (r) => mcell(r.agent?.pnl?.realized) },
      { key: "unrealized", label: "Unrealized", num: true, render: (r) => mcell(r.agent?.pnl?.unrealized) },
      { key: "day", label: "Day", num: true, render: (r) => mcell(r.agent?.pnl?.day) },
      { key: "dd", label: "Drawdown", num: true, render: (r) => mcell(r.agent?.drawdown) },
      { key: "pos", label: "Positions", num: true, render: (r) => (r.agent ? val(fmtCount(r.agent.positions.length)) : null) },
      { key: "eq", label: "Equity", render: (r) => sparkline(r.agent?.equity?.map((p) => p.v), { width: 90, height: 22 }) },
    ],
    rows: slots,
    rowCls: (r) => (r.agent ? "" : "ops-row-dim"),
  });
}

export default {
  title: "Portfolio",
  mount(root) {
    return mountChartsSafe(root);
  },
  render(ctx) {
    const pf = doc(ctx, "portfolio");
    const src = source(ctx, "portfolio");
    const agentsSrc = source(ctx, "agents");

    return html`<div class="ops-view">
      ${pageHeader({
        kicker: "OPERATIONS",
        code: "PRT",
        title: "Portfolio",
        sub: "The aggregate book across the five agent slots, exactly as the trading engine declares it in portfolio.json. No portfolio exists until a validated, approved strategy is deployed to an agent — and a source that is not connected is not a zero.",
        right: sourceTag(src, { now: ctx.now }),
      })}

      <div class="grid">
        ${panel({
          span: 12,
          code: "PRT-01",
          title: "Book",
          sub: pf ? "Declared by the trading engine · every figure carries its basis" : sourceReason(src),
          variant: "hero",
          body: book(ctx, pf, src),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 8,
          code: "PRT-02",
          title: "Equity curve",
          sub: pf ? `portfolio.equity · mode ${humanize(pf.mode)}` : "portfolio.equity",
          actions: pf ? badge(pf.mode) : "",
          body: equity(ctx, pf, src),
          cls: "lg-span-12",
        })}
        ${panel({
          span: 4,
          code: "PRT-03",
          title: "Exposures",
          sub: "Gross / net per key",
          body: exposures(ctx, pf),
          cls: "lg-span-12",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "PRT-04",
          title: "Allocations by agent slot",
          sub: "portfolio.json allocations beside each agent's own declared assignment (agents.json)",
          body: html`${allocations(ctx, pf)}${
            pf ? "" : html`<div class="ops-note">${sourceReason(src) ?? ""} Allocations — strategy, version, weight and capital — appear per slot once the trading engine produces portfolio.json.</div>`
          }`,
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 8,
          code: "PRT-05",
          title: "Positions",
          sub: pf ? `${fmtCount(pf.positions.length)} declared` : "portfolio.positions",
          body: positions(ctx, pf),
          cls: "lg-span-12",
        })}
        ${panel({
          span: 4,
          code: "PRT-06",
          title: "Book doctrine",
          sub: "How portfolio state is displayed",
          body: doctrine([
            ["NO DEPLOYMENT, NO PORTFOLIO", "A book exists only once a validated, approved, packaged strategy runs on an agent."],
            ["ABSENT IS NOT ZERO", "An unconnected source shows its reason; a declared zero is shown as a fact."],
            ["BASIS ON EVERY FIGURE", "SIM, PAPER and LIVE figures are labelled and never blended."],
            ["NO CROSS-SOURCE SUMS", "Agent books are listed beside the portfolio, never added into it."],
          ]),
          cls: "lg-span-12",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "PRT-07",
          title: "Agent books",
          sub: "Declared per agent in agents.json — listed beside, never summed into, the portfolio",
          actions: sourceTag(agentsSrc, { now: ctx.now }),
          body: agentBooks(ctx),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "PRT-08",
          title: "Provenance",
          sub: "Where these values come from",
          body: provenance(ctx, ["portfolio", "agents"]),
        })}
      </div>
    </div>`;
  },
};

