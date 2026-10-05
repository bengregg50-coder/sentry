// Evaluation-window timeline for the Out-of-Sample view.
//
// Drawn only from real dates: programmes' declared evaluation_windows and the
// recorded windows of OOS / walk-forward trials. Nothing is drawn for a window
// without both a start and an end — those are listed, not plotted. Window roles
// are not states, so roles are distinguished with brand blue/cyan fills and
// patterns only; trial lines take their outcome tone from toneOf().

import { html, raw, esc } from "../core/html.js";
import { fmtDate, humanize, isNil } from "../core/format.js";
import { toneOf } from "../core/tones.js";

/** Contract window roles, in display order. Architecture labels. */
export const ROLES = [
  ["PRIMARY_EVIDENCE", "Primary evidence", "The period on which the hypothesis must first show its effect"],
  ["CONFIRMATION", "Confirmation", "A later, independent period that must agree with the primary evidence"],
  ["HOLDOUT", "Holdout", "Sealed data, opened once at the declared evaluation"],
  ["OUT_OF_SAMPLE", "Out-of-sample", "Never used for development, selection or tuning"],
  ["IMPLEMENTATION_VERIFICATION", "Implementation verification", "Confirms the implementation reproduces the frozen specification"],
];
const OTHER_ROLES = { DISCOVERY: "Discovery", IN_SAMPLE: "In-sample", OTHER: "Other" };
export const ROLE_LABEL = { ...Object.fromEntries(ROLES.map(([k, l]) => [k, l])), ...OTHER_ROLES };

const TONE_VAR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--cyan-2)", accent: "var(--blue-2)", muted: "var(--muted)" };

const DAY = 86400000;
const ms = (d) => {
  if (isNil(d) || d === "") return null; // new Date(null) is the epoch — never draw a missing date
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
};

function truncate(s, n) {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

/** Lanes that have at least one fully dated window or trial window. */
function drawable(lanes) {
  return lanes
    .map((l) => ({
      ...l,
      windows: l.windows.filter((w) => ms(w.start) !== null && ms(w.end) !== null),
      trials: l.trials.filter((t) => ms(t.window_start) !== null && ms(t.window_end) !== null),
    }))
    .filter((l) => l.windows.length || l.trials.length);
}

/**
 * lanes: [{key, title, status, sub, windows: Window[], trials: Trial[]}]
 * Returns null when there is nothing dated to draw. The SVG is first drawn
 * on a 1200-unit canvas; mountTimeline() redraws it at the container's real
 * pixel width so text stays at its true size on any screen.
 */
export function windowTimeline(lanes) {
  const svg = timelineSvg(lanes, 1200);
  if (!svg) return null;
  return html`<div class="diagram rsb-tl" style="--diagram-min:${raw(MIN_W + "px")}" data-timeline="1">${raw(svg)}</div>`;
}

const MIN_W = 920;

/** Redraw every timeline under root at its container width; returns a cleanup function. */
export function mountTimeline(root, lanes) {
  const host = root.querySelector('.rsb-tl[data-timeline="1"]');
  if (!host || !lanes || typeof ResizeObserver === "undefined") return () => {};
  let last = 0;
  let frame = 0;
  const draw = () => {
    frame = 0;
    const w = Math.max(MIN_W, Math.floor(host.clientWidth));
    if (!w || w === last) return;
    last = w;
    const svg = timelineSvg(lanes, w);
    if (svg) host.innerHTML = svg;
  };
  draw();
  const ro = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(draw);
  });
  ro.observe(host);
  return () => {
    ro.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}

function timelineSvg(lanes, W) {
  const drawn = drawable(lanes);
  if (!drawn.length) return null;

  const all = drawn.flatMap((l) => [...l.windows.flatMap((w) => [ms(w.start), ms(w.end)]), ...l.trials.flatMap((t) => [ms(t.window_start), ms(t.window_end)])]);
  const y0 = new Date(Math.min(...all)).getUTCFullYear();
  const y1 = new Date(Math.max(...all)).getUTCFullYear() + 1;
  const tmin = Date.UTC(y0, 0, 1);
  const tmax = Date.UTC(y1, 0, 1);
  const years = y1 - y0;
  const step = Math.max(1, Math.ceil(years / 12));

  const L = 262;
  const R = 18;
  const top = 30;
  const x = (t) => L + ((t - tmin) / (tmax - tmin)) * (W - L - R);

  const lane = drawn.map((l) => ({ l, h: Math.max(64, 40 + l.trials.length * 17 + 8) }));
  const H = top + lane.reduce((a, b) => a + b.h, 0) + 6;
  const p = [];

  p.push(
    `<defs><pattern id="rsb-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(34,211,238,.06)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(34,211,238,.55)" stroke-width="2"/></pattern></defs>`,
  );

  // year grid + axis
  for (let y = y0; y <= y1; y += step) {
    const gx = x(Date.UTC(y, 0, 1));
    p.push(`<line x1="${gx.toFixed(1)}" y1="${top - 6}" x2="${gx.toFixed(1)}" y2="${H - 4}" stroke="var(--line)" stroke-width="1"/>`);
    p.push(`<text x="${gx.toFixed(1)}" y="${top - 12}" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:9px" data-v>${y}</text>`);
  }
  p.push(`<line x1="${L}" y1="${top - 6}" x2="${W - R}" y2="${top - 6}" stroke="var(--line-3)" stroke-width="1"/>`);
  p.push(`<text x="12" y="${top - 12}" class="svg-label svg-label--muted" style="font-size:9px">PROGRAMME</text>`);

  let yy = top;
  for (const { l, h } of lane) {
    p.push(`<g data-lane="${esc(l.key)}">`);
    p.push(`<line x1="0" y1="${yy}" x2="${W}" y2="${yy}" stroke="var(--line-2)" stroke-width="1"/>`);
    // lane label
    p.push(`<text x="12" y="${yy + 17}" class="svg-label svg-label--strong" style="font-size:10.5px">${esc(l.key)}</text>`);
    if (l.status) p.push(`<text x="${(12 + l.key.length * 7.6 + 10).toFixed(1)}" y="${yy + 17}" class="svg-label" style="font-size:9px;fill:${TONE_VAR[toneOf(l.status)]}">${esc(humanize(l.status))}</text>`);
    if (l.title) p.push(`<text x="12" y="${yy + 32}" class="rsb-tl-name">${esc(truncate(l.title, 40))}</text>`);
    if (l.sub) p.push(`<text x="12" y="${yy + 47}" class="svg-label svg-label--muted" style="font-size:8.5px">${esc(l.sub)}</text>`);

    // declared windows
    const wy = yy + 8;
    if (!l.windows.length) {
      p.push(`<line x1="${L}" y1="${wy + 10}" x2="${W - R}" y2="${wy + 10}" stroke="var(--faint)" stroke-dasharray="2 5"/>`);
      p.push(`<text x="${L + 8}" y="${wy + 7}" class="svg-label svg-label--muted" style="font-size:8.5px">NO DATED EVALUATION WINDOWS DECLARED</text>`);
    }
    for (const w of l.windows) {
      const a = x(ms(w.start));
      const b = Math.max(a + 2, x(ms(w.end) + DAY));
      const role = w.role ?? "OTHER";
      const tip = `${w.label ?? ROLE_LABEL[role] ?? role} · ${ROLE_LABEL[role] ?? humanize(role)} · ${fmtDate(w.start)} → ${fmtDate(w.end)}`;
      p.push(
        `<rect class="rsb-tl-win rsb-tl-role--${esc(role)}" data-window-role="${esc(role)}"${role === "HOLDOUT" ? ' fill="url(#rsb-hatch)"' : ""} x="${a.toFixed(1)}" y="${wy}" width="${(b - a).toFixed(1)}" height="20" rx="2"><title>${esc(tip)}</title></rect>`,
      );
      const txt = (w.label ? `${ROLE_LABEL[role] ?? humanize(role)} · ${w.label}` : ROLE_LABEL[role] ?? humanize(role)).toUpperCase();
      const room = Math.floor((b - a - 12) / 6.3);
      if (room >= 6) p.push(`<text x="${(a + 6).toFixed(1)}" y="${wy + 13.5}" class="rsb-tl-wlabel">${esc(truncate(txt, room))}</text>`);
    }

    // trial windows
    l.trials.forEach((t, i) => {
      const ty = yy + 44 + i * 17;
      const a = x(ms(t.window_start));
      const b = Math.max(a + 2, x(ms(t.window_end) + DAY));
      const col = TONE_VAR[toneOf(t.outcome)];
      const tip = `${t.trial_id} · ${humanize(t.kind)} · ${t.outcome} · ${fmtDate(t.window_start)} → ${fmtDate(t.window_end)}`;
      p.push(`<g data-trial-window="${esc(t.trial_id)}"><title>${esc(tip)}</title>`);
      p.push(`<line x1="${a.toFixed(1)}" y1="${ty}" x2="${b.toFixed(1)}" y2="${ty}" stroke="${col}" stroke-width="2" stroke-opacity=".85"/>`);
      p.push(`<line x1="${a.toFixed(1)}" y1="${ty - 4}" x2="${a.toFixed(1)}" y2="${ty + 4}" stroke="${col}"/><line x1="${b.toFixed(1)}" y1="${ty - 4}" x2="${b.toFixed(1)}" y2="${ty + 4}" stroke="${col}"/>`);
      const label = `${t.trial_id} · ${humanize(t.kind)} · ${t.outcome}`;
      const lw = label.length * 6.1;
      const right = b + 8 + lw < W - R;
      const lx = right ? b + 8 : a - 8;
      if (right || a - 8 - lw > L) p.push(`<text x="${lx.toFixed(1)}" y="${ty + 3.5}" text-anchor="${right ? "start" : "end"}" class="svg-label" style="font-size:9px;fill:${col}">${esc(label)}</text>`);
      p.push(`</g>`);
    });
    p.push(`</g>`);
    yy += h;
  }

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evaluation windows and trial windows by programme" preserveAspectRatio="xMinYMin meet">${p.join("")}</svg>`;
}

/** Role legend with the same swatches as the timeline. */
export function roleLegend({ withTrials = true } = {}) {
  return html`<div class="rsb-tl-legend">
    ${ROLES.map(([k, l]) => html`<span title="${ROLES.find((r) => r[0] === k)[2]}"><i class="${"rsb-tl-sw rsb-tl-role--" + k}"></i>${l}</span>`)}
    ${withTrials ? html`<span><i class="rsb-tl-sw rsb-tl-sw--trial"></i>Trial window · coloured by outcome</span>` : ""}
  </div>`;
}

export function hasDates(w) {
  return !isNil(w.start) && !isNil(w.end);
}
