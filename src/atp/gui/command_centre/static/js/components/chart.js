// Chart host. Renders an honest empty frame unless real series data exists;
// with data, draws via the locally vendored lightweight-charts (v5 or v4 API).

import { html, raw } from "../core/html.js";

const registry = new Map();
let seq = 0;

/**
 * kind: "candles" (data: contract Bar[]) | "line" | "area" (data: contract SeriesPoint[])
 */
export function chartHost({ kind = "line", data, height = 220, emptyTitle = "No series data", emptyReason, label }) {
  const id = `chart-${++seq}`;
  const has = Array.isArray(data) && data.length > 0;
  if (has) registry.set(id, { kind, data });
  return html`<div class="chart" id="${id}" data-chart="${kind}" data-has-data="${has ? "1" : "0"}" style="--h:${raw(String(Number(height)))}px" ${label ? html`aria-label="${label}"` : ""}>
    ${has
      ? ""
      : html`<div class="chart__empty" data-empty-state="chart"><div class="flat"></div><div class="t">${emptyTitle}</div>${emptyReason ? html`<div class="r">${emptyReason}</div>` : ""}</div>
        <span class="chart__axis" style="left:8px;top:6px">PRICE / VALUE</span>
        <span class="chart__axis" style="right:8px;bottom:4px">TIME (UTC)</span>`}
  </div>`;
}

function toTime(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** Instantiate charts under root. Returns a cleanup function. */
export function mountCharts(root) {
  const LW = window.LightweightCharts;
  const charts = [];
  root.querySelectorAll('.chart[data-has-data="1"]').forEach((el) => {
    const spec = registry.get(el.id);
    if (!spec || !LW) return;
    const chart = LW.createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#64748B", fontFamily: getComputedStyle(document.body).getPropertyValue("--font-mono"), attributionLogo: false },
      grid: { vertLines: { color: "rgba(148,163,184,0.06)" }, horzLines: { color: "rgba(148,163,184,0.06)" } },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.15)" },
      timeScale: { borderColor: "rgba(148,163,184,0.15)", timeVisible: true },
      crosshair: { mode: 0 },
    });
    let series;
    if (spec.kind === "candles") {
      const opts = { upColor: "#22D3EE", downColor: "#334155", borderUpColor: "#22D3EE", borderDownColor: "#64748B", wickUpColor: "#22D3EE", wickDownColor: "#64748B" };
      series = LW.CandlestickSeries ? chart.addSeries(LW.CandlestickSeries, opts) : chart.addCandlestickSeries(opts);
      series.setData(spec.data.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    } else {
      const opts = { lineColor: "#3B82F6", topColor: "rgba(59,130,246,0.25)", bottomColor: "rgba(59,130,246,0)", lineWidth: 2, color: "#3B82F6" };
      const type = spec.kind === "area" ? "AreaSeries" : "LineSeries";
      series = LW[type] ? chart.addSeries(LW[type], opts) : spec.kind === "area" ? chart.addAreaSeries(opts) : chart.addLineSeries(opts);
      series.setData(spec.data.map((p) => ({ time: toTime(p.t), value: p.v })));
    }
    chart.timeScale().fitContent();
    charts.push(chart);
    registry.delete(el.id);
  });
  return () => charts.forEach((c) => c.remove());
}

/** Tiny inline sparkline from numbers; null/empty -> flatline marked empty. */
export function sparkline(values, { width = 120, height = 28, tone = "info" } = {}) {
  const col = { info: "var(--cyan-2)", accent: "var(--blue-2)", muted: "var(--faint)", warn: "var(--warn)", bad: "var(--bad)", ok: "var(--ok)" }[tone];
  if (!values || values.length < 2) {
    return raw(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-v data-empty="1" aria-hidden="true"><line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="var(--ghost)" stroke-dasharray="2 3"/></svg>`);
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  return raw(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-v aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.3"/></svg>`);
}
