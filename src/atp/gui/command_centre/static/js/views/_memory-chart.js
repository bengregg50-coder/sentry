// Memory growth as a step chart in plain SVG. Cumulative counts change only
// on days a memory was created, so the line steps — it never interpolates
// between days — and a dot marks every real point. Only points present in
// derived.memory_stats.growth are drawn.
//
// (The vendored chart library is not used here: with a day-level time axis it
// formats ticks through navigator.language and throws on locales such as
// "en-US@posix". See shared request on components/chart.js.)

import { html, raw } from "../core/html.js";

/**
 * points: [{date: "YYYY-MM-DD", added, cumulative}] (ascending) or null.
 */
export function growthChart(points, { height = 196, emptyTitle, emptyReason } = {}) {
  if (!points || points.length === 0) {
    // Same frame vocabulary as components/chart.js (.chart / .chart__empty), with this chart's own axes.
    return html`<div class="chart mem-growth-empty" data-has-data="0" style="--h:${raw(String(Number(height)))}px">
      <div class="chart__empty" data-empty-state="chart"><div class="flat"></div><div class="t">${emptyTitle}</div>${emptyReason ? html`<div class="r">${emptyReason}</div>` : ""}</div>
      <span class="chart__axis" style="left:8px;top:6px">CUMULATIVE MEMORIES</span>
      <span class="chart__axis" style="right:8px;bottom:4px">CREATION DATE (UTC)</span>
    </div>`;
  }
  // Plot space: x 0..1000, y 0..100 (stretched to the frame; strokes do not scale).
  const t = points.map((p) => Date.parse(`${p.date}T00:00:00Z`));
  const t0 = t[0];
  const span = t[t.length - 1] - t0;
  const max = Math.max(...points.map((p) => p.cumulative));
  const x = (i) => (span > 0 ? ((t[i] - t0) / span) * 1000 : 500);
  const y = (v) => 100 - (max > 0 ? (v / max) * 92 : 0);
  let line = `M0 100 L${x(0).toFixed(2)} 100 L${x(0).toFixed(2)} ${y(points[0].cumulative).toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    line += ` L${x(i).toFixed(2)} ${y(points[i - 1].cumulative).toFixed(2)} L${x(i).toFixed(2)} ${y(points[i].cumulative).toFixed(2)}`;
  }
  const area = `${line} L${x(points.length - 1).toFixed(2)} 100 Z`;
  const grid = [0, 25, 50, 75].map((g) => `<line x1="0" y1="${g + 8}" x2="1000" y2="${g + 8}" stroke="rgba(148,163,184,.07)" vector-effect="non-scaling-stroke"/>`).join("");
  const svg =
    `<svg class="mem-growth__svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">` +
    `<defs><linearGradient id="mem-growth-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(59,130,246,.28)"/><stop offset="1" stop-color="rgba(59,130,246,0)"/></linearGradient></defs>` +
    grid +
    `<line x1="0" y1="100" x2="1000" y2="100" stroke="var(--line-2)" vector-effect="non-scaling-stroke"/>` +
    `<path d="${area}" fill="url(#mem-growth-fill)"/>` +
    `<path d="${line}" fill="none" stroke="var(--blue-2)" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
    `</svg>`;
  return html`<div class="mem-growth" data-growth-points="${points.length}" data-v style="--h:${raw(String(Number(height)))}px" role="img" aria-label="Cumulative memories by creation date">
    <span class="mem-growth__cap">CUMULATIVE MEMORIES · UTC DAYS</span>
    <div class="mem-growth__plot">
      ${raw(svg)}
      ${points.map(
        (p, i) => html`<i class="mem-growth__dot" style="left:${raw((x(i) / 10).toFixed(2))}%;top:${raw(y(p.cumulative).toFixed(2))}%" title="${p.date} · +${p.added} · ${p.cumulative} total"></i>`,
      )}
      <span class="mem-growth__y" style="top:${raw(y(max).toFixed(2))}%">${max}</span>
      <span class="mem-growth__y" style="top:100%">0</span>
    </div>
    <span class="mem-growth__x mem-growth__x--first">${points[0].date}</span>
    ${points.length > 1 ? html`<span class="mem-growth__x mem-growth__x--last">${points[points.length - 1].date}</span>` : ""}
  </div>`;
}
