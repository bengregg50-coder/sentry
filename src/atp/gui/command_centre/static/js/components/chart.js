// Chart host. Renders an honest empty frame unless real series data exists;
// with data, draws via the locally vendored lightweight-charts (v5 or v4 API).

import { html, raw } from "../core/html.js";

const registry = new Map();
let seq = 0;

/**
 * kind: "candles" (data: contract Bar[]) | "line" | "area" (data: contract SeriesPoint[])
 */
export function chartHost({ kind = "line", data, height = 220, emptyTitle = "No series data", emptyReason, label, axisY = "PRICE / VALUE", axisX = "TIME (UTC)" }) {
  const id = `chart-${++seq}`;
  const has = Array.isArray(data) && data.length > 0;
  if (has) registry.set(id, { kind, data });
  return html`<div class="chart" id="${id}" data-chart="${kind}" data-has-data="${has ? "1" : "0"}" style="--h:${raw(String(Number(height)))}px" ${label ? html`aria-label="${label}"` : ""}>
    ${has
      ? ""
      : html`<div class="chart__empty" data-empty-state="chart"><div class="flat"></div><div class="t">${emptyTitle}</div>${emptyReason ? html`<div class="r">${emptyReason}</div>` : ""}</div>
        <span class="chart__axis" style="left:8px;top:6px">${axisY}</span>
        <span class="chart__axis" style="right:8px;bottom:4px">${axisX}</span>`}
  </div>`;
}

/** A locale Intl accepts; some environments report tags like "en-US@posix" that Intl rejects. */
function chartLocale() {
  try {
    const lang = navigator.language;
    return Intl.NumberFormat.supportedLocalesOf([lang]).length && Intl.DateTimeFormat.supportedLocalesOf([lang]).length ? lang : "en-GB";
  } catch {
    return "en-GB";
  }
}

function toTime(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** Ascending, unique-time, finite points (the contract requires this; the chart is defensive anyway). */
export function cleanSeries(points) {
  const byTime = new Map();
  for (const p of points) {
    if (Number.isFinite(p.time) && Object.entries(p).every(([k, v]) => k === "time" || Number.isFinite(v))) byTime.set(p.time, p);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function emptyFrame(el, title, reason) {
  el.dataset.hasData = "0";
  el.innerHTML = String(
    html`<div class="chart__empty" data-empty-state="chart"><div class="flat"></div><div class="t">${title}</div>${reason ? html`<div class="r">${reason}</div>` : ""}</div>`,
  );
}

/** Instantiate charts under root. Returns a cleanup function. */
export function mountCharts(root) {
  const LW = window.LightweightCharts;
  const charts = [];
  root.querySelectorAll('.chart[data-has-data="1"]').forEach((el) => {
    const spec = registry.get(el.id);
    if (!spec || !LW) return;
    registry.delete(el.id);
    const data =
      spec.kind === "candles"
        ? cleanSeries(spec.data.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })))
        : cleanSeries(spec.data.map((p) => ({ time: toTime(p.t), value: p.v })));
    if (data.length === 0) {
      emptyFrame(el, "No plottable points", "The declared series has no finite, time-stamped values.");
      return;
    }
    let chart;
    try {
      chart = LW.createChart(el, {
        autoSize: true,
        localization: { locale: chartLocale() },
        layout: { background: { color: "transparent" }, textColor: "#64748B", fontFamily: getComputedStyle(document.body).getPropertyValue("--font-mono"), attributionLogo: false },
        grid: { vertLines: { color: "rgba(148,163,184,0.06)" }, horzLines: { color: "rgba(148,163,184,0.06)" } },
        rightPriceScale: { borderColor: "rgba(148,163,184,0.15)" },
        timeScale: { borderColor: "rgba(148,163,184,0.15)", timeVisible: true, rightOffset: 2 },
        crosshair: { mode: 0 },
      });
      let series;
      if (spec.kind === "candles") {
        const opts = { upColor: "#22D3EE", downColor: "#334155", borderUpColor: "#22D3EE", borderDownColor: "#64748B", wickUpColor: "#22D3EE", wickDownColor: "#64748B" };
        series = LW.CandlestickSeries ? chart.addSeries(LW.CandlestickSeries, opts) : chart.addCandlestickSeries(opts);
      } else {
        const opts = { lineColor: "#3B82F6", topColor: "rgba(59,130,246,0.25)", bottomColor: "rgba(59,130,246,0)", lineWidth: 2, color: "#3B82F6" };
        const type = spec.kind === "area" ? "AreaSeries" : "LineSeries";
        series = LW[type] ? chart.addSeries(LW[type], opts) : spec.kind === "area" ? chart.addAreaSeries(opts) : chart.addLineSeries(opts);
      }
      series.setData(data);
      // Pad both ends so the first and last time labels are not clipped at the frame edge.
      const pad = Math.max(1.5, data.length * 0.03);
      chart.timeScale().setVisibleLogicalRange({ from: -pad, to: data.length - 1 + pad });
      charts.push(chart);
    } catch (err) {
      try {
        chart?.remove();
      } catch {
        /* ignore */
      }
      emptyFrame(el, "Series could not be drawn", String(err?.message ?? err));
    }
  });
  return () => charts.forEach((c) => c.remove());
}

/**
 * Tiny inline sparkline from numbers; fewer than two finite values -> flatline marked empty.
 * null / non-finite points are gaps (the line breaks), never drawn as zero.
 */
export function sparkline(values, { width = 120, height = 28, tone = "info" } = {}) {
  const col = { info: "var(--cyan-2)", accent: "var(--blue-2)", muted: "var(--faint)", warn: "var(--warn)", bad: "var(--bad)", ok: "var(--ok)" }[tone];
  const finite = (values ?? []).filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
  if (!values || finite.length < 2) {
    return raw(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-v data-empty="1" aria-hidden="true"><line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="var(--ghost)" stroke-dasharray="2 3"/></svg>`);
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const segments = [];
  let cur = [];
  values.forEach((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) {
      if (cur.length) segments.push(cur);
      cur = [];
      return;
    }
    cur.push(`${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((Number(v) - min) / span) * (height - 4)).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur);
  const lines = segments.map((pts) => (pts.length === 1 ? `<circle cx="${pts[0].split(",")[0]}" cy="${pts[0].split(",")[1]}" r="1" fill="${col}"/>` : `<polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="1.3"/>`));
  return raw(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-v aria-hidden="true">${lines.join("")}</svg>`);
}
