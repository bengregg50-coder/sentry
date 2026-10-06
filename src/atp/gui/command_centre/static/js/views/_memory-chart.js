// Memory growth as a step chart in plain SVG. Cumulative counts change only
// on days a memory was created, so each line steps — it never interpolates
// between days — and a dot marks every real point.
//
// One cumulative series per record origin: ORIGINAL and RECONSTRUCTED (or
// SYNTHETIC) memories are never summed into one line. A single-origin store
// draws one line, identical to derived.memory_stats.growth.
//
// (The vendored chart library is not used here: with a day-level time axis it
// formats ticks through navigator.language and throws on locales such as
// "en-US@posix". See shared request on components/chart.js.)

import { html, raw, cx } from "../core/html.js";
import { fmtCount, humanize } from "../core/format.js";
import { toneClass } from "../core/tones.js";

const ORDER = ["ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"];
const TAG = { RECONSTRUCTED: "RECON", SYNTHETIC_FIXTURE: "SYNTH" };

/**
 * Per-origin cumulative series from memory.json rows, by the calendar date of
 * created_at as declared (the same day key derive_memory_stats() uses).
 * null rows (not connected) -> null; no rows -> [].
 */
export function growthSeries(mems) {
  if (!Array.isArray(mems)) return null;
  const by = new Map();
  for (const m of mems) {
    const day = String(m.created_at).slice(0, 10);
    if (!by.has(m.origin)) by.set(m.origin, new Map());
    const days = by.get(m.origin);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const rank = (o) => (ORDER.includes(o) ? ORDER.indexOf(o) : ORDER.length);
  return [...by.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((origin) => {
      let total = 0;
      const points = [...by.get(origin).keys()].sort().map((date) => {
        const added = by.get(origin).get(date);
        total += added;
        return { date, added, cumulative: total };
      });
      return { origin, points };
    });
}

function seriesTone(origin, single) {
  if (single || origin === "ORIGINAL") return null; // neutral blue line
  return toneClass(origin === "SYNTHETIC_FIXTURE" ? "INVALID" : origin);
}

/**
 * series: [{origin, points: [{date: "YYYY-MM-DD", added, cumulative}] (ascending)}] or null.
 */
export function growthChart(series, { height = 196, emptyTitle, emptyReason } = {}) {
  const live = (series ?? []).filter((s) => s.points.length);
  if (!live.length) {
    // Same frame vocabulary as components/chart.js (.chart / .chart__empty), with this chart's own axes.
    return html`<div class="chart mem-growth-empty" data-has-data="0" style="--h:${raw(String(Number(height)))}px">
      <div class="chart__empty" data-empty-state="chart"><div class="flat"></div><div class="t">${emptyTitle}</div>${emptyReason ? html`<div class="r">${emptyReason}</div>` : ""}</div>
      <span class="chart__axis" style="left:8px;top:6px">CUMULATIVE MEMORIES</span>
      <span class="chart__axis" style="right:8px;bottom:4px">CREATION DATE (UTC)</span>
    </div>`;
  }
  const single = live.length === 1;
  // Plot space: x 0..1000, y 0..100 (stretched to the frame; strokes do not scale).
  const days = [...new Set(live.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const tOf = (d) => Date.parse(`${d}T00:00:00Z`);
  const t0 = tOf(days[0]);
  const span = tOf(days[days.length - 1]) - t0;
  const max = Math.max(...live.flatMap((s) => s.points.map((p) => p.cumulative)));
  const x = (d) => (span > 0 ? ((tOf(d) - t0) / span) * 1000 : 500);
  const y = (v) => 100 - (max > 0 ? (v / max) * 92 : 0);
  const grid = [0, 25, 50, 75].map((g) => `<line x1="0" y1="${g + 8}" x2="1000" y2="${g + 8}" stroke="rgba(148,163,184,.07)" vector-effect="non-scaling-stroke"/>`).join("");
  const paths = live.map((s, si) => {
    const pts = s.points;
    let line = `M0 100 L${x(pts[0].date).toFixed(2)} 100 L${x(pts[0].date).toFixed(2)} ${y(pts[0].cumulative).toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      line += ` L${x(pts[i].date).toFixed(2)} ${y(pts[i - 1].cumulative).toFixed(2)} L${x(pts[i].date).toFixed(2)} ${y(pts[i].cumulative).toFixed(2)}`;
    }
    const tone = seriesTone(s.origin, single);
    const area = si === 0 ? `<path d="${line} L${x(pts[pts.length - 1].date).toFixed(2)} 100 Z" fill="url(#mem-growth-fill)"/>` : "";
    return (
      area +
      `<path class="${cx("mem-growth__line", tone)}" data-series="${s.origin}" d="${line}" fill="none" stroke-width="1.6" stroke-linejoin="round" ${tone ? 'stroke-dasharray="5 3"' : ""} vector-effect="non-scaling-stroke"/>`
    );
  });
  const svg =
    `<svg class="mem-growth__svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">` +
    `<defs><linearGradient id="mem-growth-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(59,130,246,.28)"/><stop offset="1" stop-color="rgba(59,130,246,0)"/></linearGradient></defs>` +
    grid +
    `<line x1="0" y1="100" x2="1000" y2="100" stroke="var(--line-2)" vector-effect="non-scaling-stroke"/>` +
    paths.join("") +
    `</svg>`;
  const label = (o) => (o === "ORIGINAL" ? "ORIGINAL" : TAG[o] ?? humanize(o));
  return html`<div class="mem-growth" data-growth-points="${days.length}" data-growth-series="${live.map((s) => s.origin).join(" ")}" data-v style="--h:${raw(String(Number(height)))}px" role="img" aria-label="Cumulative memories by creation date, one line per record origin">
    <span class="mem-growth__cap">CUMULATIVE MEMORIES · PER ORIGIN</span>
    <span class="mem-growth__legend">${live.map(
      (s) => html`<span class="${cx("mem-growth__key", seriesTone(s.origin, single))}" data-series-key="${s.origin}"><i class="${cx(!single && s.origin !== "ORIGINAL" && "is-dashed")}"></i>${label(s.origin)} <b>${fmtCount(s.points[s.points.length - 1].cumulative)}</b></span>`,
    )}</span>
    <div class="mem-growth__plot">
      ${raw(svg)}
      ${live.map((s) =>
        s.points.map(
          (p) =>
            html`<i class="${cx("mem-growth__dot", seriesTone(s.origin, single))}" data-series="${s.origin}" style="left:${raw((x(p.date) / 10).toFixed(2))}%;top:${raw(y(p.cumulative).toFixed(2))}%" title="${p.date} · ${humanize(s.origin).toLowerCase()} · +${p.added} · ${p.cumulative} cumulative"></i>`,
        ),
      )}
      <span class="mem-growth__y" style="top:${raw(y(max).toFixed(2))}%">${max}</span>
      <span class="mem-growth__y" style="top:100%">0</span>
    </div>
    <span class="mem-growth__x mem-growth__x--first">${days[0]}</span>
    ${days.length > 1 ? html`<span class="mem-growth__x mem-growth__x--last">${days[days.length - 1]}</span>` : ""}
  </div>`;
}
