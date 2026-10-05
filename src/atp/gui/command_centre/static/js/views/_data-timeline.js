// Coverage timeline: one SVG bar per dataset on a shared UTC time axis built
// ONLY from declared dates (coverage_start / coverage_end / declared gaps).
// No date => no bar. A dataset with one declared end shows a single marker;
// coverage is never inferred, extended or interpolated. Declared gaps are cut
// into the bar. Reconstruction is shown as a hatch (tone from core/tones.js).

import { html, raw } from "../core/html.js";
import { fmtCount, isNil } from "../core/format.js";
import { toneClass } from "../core/tones.js";
import { badge, emptyState } from "../components/ui.js";
import { parseDay, dayText } from "./_data-common.js";

const DAY = 86400000;

/** Shared axis from every declared date. Returns null when nothing is dated. */
export function coverageAxis(datasets) {
  const ts = [];
  const push = (v) => {
    const t = parseDay(v);
    if (t !== null) ts.push(t);
  };
  for (const d of datasets ?? []) {
    push(d.coverage_start);
    push(d.coverage_end);
    for (const g of d.gaps ?? []) {
      push(g.start);
      push(g.end);
    }
  }
  if (!ts.length) return null;
  const y0 = new Date(Math.min(...ts)).getUTCFullYear();
  const y1 = new Date(Math.max(...ts) + DAY).getUTCFullYear() + 1;
  const t0 = Date.UTC(y0, 0, 1);
  const t1 = Date.UTC(y1, 0, 1);
  const years = y1 - y0;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => years / s <= 12) ?? 100;
  const pct = (t) => ((t - t0) / (t1 - t0)) * 100;
  const ticks = [];
  for (let y = y0; y <= y1; y++) ticks.push({ year: y, pct: pct(Date.UTC(y, 0, 1)), major: (y - y0) % step === 0 && y < y1 });
  return { t0, t1, y0, y1, ticks, pct };
}

const p = (n) => raw(n.toFixed(3));

function gridSvg(axis, body = "") {
  const lines = (axis?.ticks ?? [])
    .filter((t) => t.pct > 0 && t.pct < 100)
    .map((t) => `<line x1="${(t.pct * 10).toFixed(2)}" y1="0" x2="${(t.pct * 10).toFixed(2)}" y2="40" class="dat-tl__grid${t.major ? " is-major" : ""}" vector-effect="non-scaling-stroke"/>`)
    .join("");
  return raw(`<svg class="dat-tl__svg" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">${lines}${body}</svg>`);
}

function axisRow(axis) {
  return html`<div class="dat-tl__row dat-tl__row--axis" aria-hidden="true">
    <span class="dat-tl__h">Dataset</span>
    <span class="dat-tl__h">Integrity</span>
    <span class="dat-tl__track dat-tl__track--axis">
      ${axis
        ? axis.ticks.filter((t) => t.major).map((t) => html`<span class="dat-tl__year" style="left:${p(t.pct)}%">${String(t.year)}</span>`)
        : html`<span class="dat-tl__axis-none">AXIS DRAWN FROM DECLARED COVERAGE DATES ONLY</span>`}
    </span>
    <span class="dat-tl__h dat-tl__h--r">Sessions · gaps</span>
  </div>`;
}

function dateLabels(x0, x1, start, end) {
  const w = x1 - x0;
  if (w >= 26) {
    return html`<span class="dat-tl__d dat-tl__d--in" style="left:calc(${p(x0)}% + 6px)" data-v>${start}</span><span class="dat-tl__d dat-tl__d--in" style="right:calc(${p(100 - x1)}% + 6px)" data-v>${end}</span>`;
  }
  const text = `${start} → ${end}`;
  return x1 < 62
    ? html`<span class="dat-tl__d" style="left:calc(${p(x1)}% + 6px)" data-v>${text}</span>`
    : html`<span class="dat-tl__d" style="right:calc(${p(100 - x0)}% + 6px)" data-v>${text}</span>`;
}

function track(d, axis) {
  const s = parseDay(d.coverage_start);
  const e = parseDay(d.coverage_end);
  if (!axis || (s === null && e === null)) {
    return html`<span class="dat-tl__track">${gridSvg(axis)}<span class="dat-tl__undeclared">COVERAGE NOT DECLARED</span></span>`;
  }
  if (s === null || e === null) {
    const t = s ?? e;
    const x = axis.pct(t);
    const text = s !== null ? `START ${dayText(d.coverage_start)} · END NOT DECLARED` : `END ${dayText(d.coverage_end)} · START NOT DECLARED`;
    return html`<span class="dat-tl__track">${gridSvg(axis)}<span class="dat-tl__pin" style="left:${p(x)}%"></span><span class="dat-tl__d" style="${x < 60 ? raw(`left:calc(${x.toFixed(3)}% + 8px)`) : raw(`right:calc(${(100 - x).toFixed(3)}% + 8px)`)}" data-v>${text}</span></span>`;
  }
  const x0 = axis.pct(Math.min(s, e));
  const x1 = axis.pct(Math.max(s, e) + DAY);
  const bar = `<rect class="dat-tl__bar" x="${(x0 * 10).toFixed(2)}" y="11" width="${Math.max(0.5, (x1 - x0) * 10).toFixed(2)}" height="18" vector-effect="non-scaling-stroke"/>`;
  const gaps = (d.gaps ?? [])
    .map((g) => {
      const gs = parseDay(g.start);
      const ge = parseDay(g.end);
      if (gs === null || ge === null) return null;
      const a = axis.pct(Math.min(gs, ge));
      const b = axis.pct(Math.max(gs, ge) + DAY);
      const tip = `GAP ${dayText(g.start)} → ${dayText(g.end)}${g.reason ? " · " + g.reason : ""}`;
      return html`<span class="dat-tl__gap" style="left:${p(a)}%;width:max(3px, ${p(b - a)}%)" title="${tip}" data-gap="${dayText(g.start)}"></span>`;
    })
    .filter(Boolean);
  return html`<span class="dat-tl__track">
    ${gridSvg(axis, bar)}
    ${d.reconstructed === true ? html`<span class="dat-tl__recon ${toneClass("RECONSTRUCTED")}" style="left:${p(x0)}%;width:${p(x1 - x0)}%" title="Reconstructed dataset"></span>` : ""}
    ${gaps}
    ${dateLabels(x0, x1, dayText(d.coverage_start), dayText(d.coverage_end))}
  </span>`;
}

function row(d, axis) {
  const gapsN = (d.gaps ?? []).length;
  const sub = [d.dataset_id, d.bar_size, d.timezone].filter((x) => !isNil(x) && x !== "").join(" · ");
  return html`<div class="dat-tl__row" data-tl-dataset="${d.dataset_id}">
    <span class="dat-tl__label" title="${d.name ?? d.root}"><b>${d.root}</b><small>${sub}</small></span>
    <span class="dat-tl__integ">${badge(d.integrity)}</span>
    ${track(d, axis)}
    <span class="dat-tl__sum">
      <span>${isNil(d.session_count) ? html`<span class="v is-empty" data-v>—</span>` : html`<span class="v" data-v>${fmtCount(d.session_count)}</span>`}<i>SESS</i></span>
      <span><span class="v" data-v>${String(gapsN)}</span><i>${gapsN === 1 ? "GAP" : "GAPS"}</i>${d.reconstructed === true ? badge("RECONSTRUCTED", { label: "RECON" }) : ""}</span>
    </span>
  </div>`;
}

/**
 * @param datasets  DatasetsState.datasets, or null when the source is unavailable
 * @param empty     {title, reason, hint} for the honest empty frame
 */
export function coverageTimeline(datasets, empty) {
  const rows = datasets ?? [];
  const axis = coverageAxis(rows);
  if (!rows.length) {
    return html`<div class="dat-tl is-empty" data-timeline="empty">
      ${axisRow(null)}
      <div class="dat-tl__void">
        <div class="dat-tl__void-frame" aria-hidden="true"><span></span><span></span><span class="dat-tl__void-grid"></span><span></span></div>
        ${emptyState({ ...empty, compact: true, iconName: "data", code: "coverage-timeline" })}
      </div>
    </div>`;
  }
  return html`<div class="dat-tl" data-timeline="${axis ? "dated" : "undated"}">
    ${axisRow(axis)}
    ${rows.map((d) => row(d, axis))}
    ${rows.length > 6 && axis ? axisRow(axis) : ""}
  </div>`;
}
