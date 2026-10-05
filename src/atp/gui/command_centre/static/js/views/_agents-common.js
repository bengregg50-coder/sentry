// Shared helpers for the agents views (Trading Floor overview, agent terminal,
// agent activity). Everything rendered here comes from the snapshot
// (derived.agent_slots, documents) or from /api/cc/events. Architecture
// vocabulary (slot numbers, event kinds, learning-loop stages) is constant.

import { html, raw, cx } from "../core/html.js";
import { pad2, humanize, fmtTime, fmtDate, fmtDateTime, fmtAge, isNil } from "../core/format.js";
import { toneOf, toneClass } from "../core/tones.js";
import { doc, source, derived, sourceReason, sourceShort, findMemory } from "../core/state.js";
import { fetchEvents } from "../core/api.js";
import { badge, dot, chip, originBadge, controlButton, refLink } from "../components/ui.js";
import { icon } from "../components/icons.js";
import { mountCharts } from "../components/chart.js";

export const SLOTS = [1, 2, 3, 4, 5];

/** Every AgentEventKind in the contract, grouped for display. */
export const KIND_GROUPS = [
  {
    key: "LOOP",
    label: "Learning loop",
    kinds: ["OBSERVATION", "INTERPRETATION", "MEMORY_RECALL", "HYPOTHESIS", "TEST", "EVALUATION", "LEARNING", "MEMORY_WRITE", "PROPOSAL"],
  },
  { key: "TRADING", label: "Trading", kinds: ["SIGNAL_EVALUATION", "NO_TRADE", "DECISION", "ORDER", "FILL"] },
  { key: "RESEARCH", label: "Research", kinds: ["RESEARCH_OBSERVATION"] },
  { key: "SYSTEM", label: "System", kinds: ["STATE_CHANGE", "ALERT", "ERROR"] },
];

export const EVENT_KINDS = KIND_GROUPS.flatMap((g) => g.kinds);

/** Event kinds that constitute research activity (as opposed to trading / system). */
export const RESEARCH_KINDS = ["HYPOTHESIS", "TEST", "EVALUATION", "LEARNING", "MEMORY_WRITE", "PROPOSAL", "RESEARCH_OBSERVATION"];

/** derive.LEARNING_LOOP: stage key, label, event kind. Agent-owned stages only. */
export const LOOP_STAGES = [
  ["OBSERVE", "Observe", "OBSERVATION"],
  ["INTERPRET", "Interpret", "INTERPRETATION"],
  ["RECALL", "Recall memory", "MEMORY_RECALL"],
  ["HYPOTHESIZE", "Form hypothesis", "HYPOTHESIS"],
  ["TEST", "Test", "TEST"],
  ["EVALUATE", "Evaluate", "EVALUATION"],
  ["LEARN", "Learn", "LEARNING"],
  ["WRITE_MEMORY", "Write memory", "MEMORY_WRITE"],
  ["PROPOSE", "Propose improvement", "PROPOSAL"],
];

/** Stages owned by research / governance, keyed to the proposal states derive.learning uses. */
export const GATED_STAGES = [
  ["RESEARCH_VALIDATION", "Research validation", "RESEARCH", ["IN_RESEARCH", "VALIDATED"]],
  ["GOVERNANCE_APPROVAL", "Governance approval", "GOVERNANCE", ["APPROVED"]],
  ["NEW_VERSION", "New strategy version", "GOVERNANCE", ["RELEASED_AS_VERSION"]],
];

const ACTIVE = new Set(["SIMULATING", "PAPER", "LIVE"]);

/* ------------------------------------------------------------------ slots */

/** Route param -> slot number 1..5, or null for anything else. */
export function parseSlot(param) {
  const s = String(param ?? "");
  return /^0?[1-5]$/.test(s) ? Number(s) : null;
}

export function agentLabel(n) {
  return `AGENT ${pad2(n)}`;
}

/** Display status of a derived slot. A slot the runtime omitted is NOT_REPORTED. */
export function statusOf(slot) {
  return slot?.status ?? "NOT_REPORTED";
}

export function isActive(status) {
  return ACTIVE.has(status);
}

/** Everything a view needs about one slot, with the three kinds of absence kept apart. */
export function slotView(ctx, n) {
  const src = source(ctx, "agents");
  const slot = derived(ctx, "agent_slots")?.find((s) => s.slot === n) ?? null;
  const connected = src?.status === "OK";
  return {
    n,
    src,
    slot,
    agent: slot?.agent ?? null,
    status: statusOf(slot),
    connected,
    reported: !!slot?.reported,
    strategy: slot?.strategy ?? null,
  };
}

/**
 * Why a slot has no value for something. null when the slot is reported
 * (the caller then says "none recorded" — that is a fact, not an absence).
 */
export function absence(sv) {
  if (!sv.connected) return sourceReason(sv.src) ?? "The agent runtime is not connected.";
  if (!sv.reported) return `The agent runtime is connected but did not report slot ${pad2(sv.n)}.`;
  return null;
}

/** Short absence label for compact places. */
export function absenceShort(sv) {
  if (!sv.connected) return `RUNTIME ${sourceShort(sv.src)}`;
  if (!sv.reported) return "SLOT NOT REPORTED";
  return null;
}

/** Headline for a terminal: AGENT 0N · STATUS · STRATEGY. */
export function headline(sv) {
  const parts = [agentLabel(sv.n), humanize(sv.status)];
  if (sv.strategy) parts.push(`${sv.strategy.strategy_id} v${sv.strategy.version}`);
  else if (sv.status === "NOT_REPORTED") parts.push("NO STRATEGY REPORTED");
  else parts.push("NO ACTIVE STRATEGY");
  return parts.join(" · ");
}

/** Strategy status as the registry declares it; never inferred from the agent. */
export function registryBadge(ctx, s) {
  if (s?.status) return badge(s.status);
  if (source(ctx, "strategies")?.status === "OK") return badge(null, { label: "NOT IN REGISTRY" });
  return badge(null, { label: "REGISTRY NOT CONNECTED" });
}

/** Slot switcher: five links with status dots taken from derived.agent_slots. */
export function slotSwitcher(ctx, current, { suffix = "" } = {}) {
  const slots = derived(ctx, "agent_slots") ?? [];
  return html`<nav class="ag-switch" aria-label="Agent slots">
    ${SLOTS.map((n) => {
      const s = slots.find((x) => x.slot === n);
      const st = statusOf(s);
      return html`<a class="${cx("ag-switch__slot", n === current && "is-current")}" href="#/agents/${n}${suffix}" title="${agentLabel(n)} · ${humanize(st)}" ${n === current ? raw('aria-current="page"') : ""}>${dot(st)}<span>${pad2(n)}</span></a>`;
    })}
  </nav>`;
}

/** Big slot glyph used in terminal heads and cards. */
export function slotGlyph(n, status, { size = "lg" } = {}) {
  return html`<div class="${cx("ag-glyph", `ag-glyph--${size}`, toneClass(status), isActive(status) && "is-active")}" data-slot-glyph="${n}">
    <span class="ag-glyph__k">SLOT</span><span class="ag-glyph__n">${pad2(n)}</span>
  </div>`;
}

/** Status badge plus dot; pulses only for active (SIM / PAPER / LIVE) slots. */
export function statusMark(status, { size } = {}) {
  return html`<span class="ag-status" data-agent-status="${status}">${dot(status, { pulse: isActive(status) })}${badge(status, { size })}</span>`;
}

/* ------------------------------------------------------------------ controls */

/**
 * controlButton() from ui.js with data-enabled set, so every [data-control]
 * on the page carries its server-computed enabled flag (see shared_requests).
 * The markup comes from controlButton (already escaped); only a constant
 * attribute is inserted.
 */
export function lockedButton(action, iconName = "lock") {
  const btn = String(controlButton(action, iconName));
  return raw(btn.replace("<button ", `<button data-enabled="${action.enabled ? "1" : "0"}" `));
}

export function actionsByKey(ctx, keys) {
  const actions = derived(ctx, "controls")?.actions ?? [];
  return keys.map((k) => actions.find((a) => a.key === k)).filter(Boolean);
}

/* ------------------------------------------------------------------ events */

/** Load events from the read-only API. Never throws: failures become state. */
export async function loadEvents(opts) {
  try {
    const res = await fetchEvents(opts);
    return { ok: true, source: res.source ?? null, events: Array.isArray(res.events) ? res.events : [] };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), source: null, events: [] };
  }
}

/** True when the event stream is readable (OK, or INVALID with some valid lines). */
export function eventsAvailable(ctx, res) {
  const st = res?.source?.status ?? source(ctx, "agent_events")?.status;
  return !!res?.ok && (st === "OK" || st === "INVALID");
}

/** Plain-language reason no events are listed. */
export function eventsAbsence(ctx, res, { slot, kind } = {}) {
  if (res && !res.ok) return `The event API request failed: ${res.error}`;
  const src = res?.source ?? source(ctx, "agent_events");
  if (!eventsAvailable(ctx, res)) return sourceReason(src) ?? "The agent event stream is not connected.";
  const who = slot ? agentLabel(slot) : "No agent";
  const what = kind ? `${humanize(kind)} events` : "events";
  return slot ? `agent_events.jsonl is connected; ${who} has recorded no ${what}.` : `agent_events.jsonl is connected; no ${what} have been recorded.`;
}

export function memoryHref(id) {
  return `#/memory/item/${encodeURIComponent(id)}`;
}

export function strategyHref(id) {
  return `#/strategy/${encodeURIComponent(id)}`;
}

function memRef(ctx, id) {
  const m = findMemory(ctx, id);
  return html`<a class="ref" href="${memoryHref(id)}" ${m ? html`title="${m.title}"` : ""}>${id}</a>`;
}

/** Reference chips for an event: memories, strategy/version, trials, order, proposal. */
export function eventRefs(ctx, e) {
  const r = e.refs ?? {};
  const parts = [];
  for (const id of r.memory_ids ?? []) parts.push(html`<span class="ag-ref"><i>MEM</i>${memRef(ctx, id)}</span>`);
  if (r.strategy_id) {
    parts.push(html`<span class="ag-ref"><i>STRAT</i>${refLink(isNil(r.version) ? r.strategy_id : `${r.strategy_id} v${r.version}`, strategyHref(r.strategy_id))}</span>`);
  }
  for (const id of r.trial_ids ?? []) parts.push(html`<span class="ag-ref"><i>TRIAL</i>${refLink(id, `#/research/history?focus=${encodeURIComponent(id)}`)}</span>`);
  if (r.order_id) parts.push(html`<span class="ag-ref"><i>ORDER</i>${refLink(r.order_id, null)}</span>`);
  if (r.proposal_id) {
    const p = doc(ctx, "strategies")?.proposals?.find((x) => x.proposal_id === r.proposal_id);
    const sid = p?.strategy_id ?? r.strategy_id;
    parts.push(html`<span class="ag-ref"><i>PROPOSAL</i>${refLink(r.proposal_id, sid ? strategyHref(sid) : null)}</span>`);
  }
  return parts;
}

/** Kind label: shared log style; a kind the tone table marks (e.g. ERROR) is shown as a badge. */
function kindLabel(kind) {
  return toneOf(kind) === "muted" ? html`<span class="ag-log__kind">${humanize(kind)}</span>` : html`<span class="ag-log__kind">${badge(kind)}</span>`;
}

/**
 * Terminal log of events (already newest-first from the API).
 * opts.showSlot  prefix each row with its agent slot
 * opts.compact   omit detail lines
 */
export function eventLog(ctx, events, { showSlot = false, compact = false, empty, maxHeight, prompt } = {}) {
  const rows = [];
  let day = null;
  for (const e of events) {
    const d = fmtDate(e.ts);
    if (d !== day) {
      day = d;
      rows.push(html`<div class="ag-log__day"><span>${d}</span></div>`);
    }
    const refs = eventRefs(ctx, e);
    rows.push(html`<div class="${cx("ag-log__row", showSlot && "ag-log__row--slot")}" data-event-id="${e.event_id}" data-kind="${e.kind}">
      <span class="ag-log__ts" title="${fmtDateTime(e.ts)}">[${fmtTime(e.ts)}]</span>
      ${showSlot ? html`<a class="ag-log__slot" href="#/agents/${e.agent_slot}/activity">A${pad2(e.agent_slot)}</a>` : ""}
      ${kindLabel(e.kind)}
      <div class="ag-log__body">
        <div class="ag-log__summary">${e.summary}</div>
        ${!compact && e.detail ? html`<div class="ag-log__detail">${e.detail}</div>` : ""}
        ${!compact && refs.length ? html`<div class="ag-log__refs"><span class="ag-log__arrow">↳</span>${refs}</div>` : ""}
      </div>
      <span class="ag-log__meta">${chip(humanize(e.mode))}${originBadge(e.origin)}</span>
    </div>`);
  }
  const style = maxHeight ? raw(`style="max-height:${Number(maxHeight)}px"`) : "";
  const cols = compact
    ? ""
    : html`<div class="${cx("ag-log__cols", showSlot && "ag-log__cols--slot")}"><span>TIME UTC</span>${showSlot ? html`<span>SLOT</span>` : ""}<span>KIND</span><span>EVENT · DETAIL · REFERENCES</span><span>MODE · ORIGIN</span></div>`;
  return html`<div class="${cx("log ag-log", compact && "ag-log--compact")}" ${style} data-event-count="${events.length}">
    ${prompt || cols ? html`<div class="ag-log__head">${prompt ? html`<div class="ag-log__prompt"><span class="ag-log__ps">${prompt}</span><span class="log__cursor"></span></div>` : ""}${cols}</div>` : ""}
    ${events.length ? rows : empty ?? ""}
  </div>`;
}

/** Empty body for a log frame: headline, reason, blinking cursor. */
export function logEmpty({ title = "NO ACTIVE AGENT ACTIVITY", reason, hint }) {
  return html`<div class="ag-log__empty" data-empty-state="no-agent-activity">
    <div class="ag-log__empty-title">${icon("agent", "icon")}<span>${title}</span><span class="log__cursor"></span></div>
    ${reason ? html`<div class="ag-log__empty-reason">${reason}</div>` : ""}
    ${hint ? html`<div class="ag-log__empty-hint">${hint}</div>` : ""}
  </div>`;
}

/** Thin, full-width price/series trace (preserveAspectRatio none). Empty -> dashed flatline. */
export function trace(values, { height = 48 } = {}) {
  const W = 300;
  const H = height;
  if (!values || values.length < 2) {
    return raw(
      `<svg class="ag-trace is-empty" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-v data-empty="1" aria-hidden="true"><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="var(--ghost)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/></svg>`,
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(2)},${(H - 3 - ((v - min) / span) * (H - 6)).toFixed(2)}`).join(" ");
  const area = `0,${H} ${pts} ${W},${H}`;
  return raw(
    `<svg class="ag-trace" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-v aria-hidden="true"><polygon points="${area}" fill="rgba(34,211,238,0.07)"/><polyline points="${pts}" fill="none" stroke="var(--cyan-2)" stroke-width="1.3" vector-effect="non-scaling-stroke"/></svg>`,
  );
}

/* ------------------------------------------------------------------ charts */

function invalidBrowserLocale() {
  try {
    new Intl.NumberFormat(navigator.language);
    return false;
  } catch {
    return true;
  }
}

/**
 * Mount this view's charts via the shared mountCharts(). lightweight-charts
 * defaults its locale to navigator.language; when the browser reports a tag
 * Intl rejects (e.g. "en-US@posix" in some headless environments) every
 * price-axis format throws. Only in that case, createChart is given an explicit
 * locale for the duration of this synchronous call (see shared_requests).
 * Charts mounted here are removed from the shared registry, so the shell's
 * own mountCharts() afterwards finds nothing left to mount.
 */
export function mountChartsSafe(root) {
  const LW = window.LightweightCharts;
  if (!LW || !invalidBrowserLocale()) return mountCharts(root);
  const patched = Object.assign(Object.create(Object.getPrototypeOf(LW)), LW, {
    createChart: (el, opts = {}) => LW.createChart(el, { ...opts, localization: { ...(opts.localization ?? {}), locale: "en-GB" } }),
  });
  window.LightweightCharts = patched;
  try {
    return mountCharts(root);
  } finally {
    window.LightweightCharts = LW;
  }
}

/** Age + absolute time, marked as a value. */
export function ageVal(iso, now) {
  if (isNil(iso)) return html`<span class="v is-empty" data-v>—</span>`;
  return html`<span class="v" data-v title="${fmtDateTime(iso)}">${fmtAge(iso, now)}</span>`;
}

/** Full-page state for a route slot that is not 1..5 (e.g. /agents/9, /agents/x). */
export function unknownSlotPage(ctx, param, { pageHeader, panel, emptyState }) {
  const slots = derived(ctx, "agent_slots") ?? [];
  return html`
    ${pageHeader({
      kicker: "TRADING FLOOR",
      code: "AGT",
      title: "Unknown agent slot",
      sub: "SENTRY has exactly five agent deployment slots, 01 to 05. The requested slot does not exist, so there is no agent state to show.",
    })}
    <div class="grid">
      ${panel({
        span: 12,
        code: "AGT-??",
        title: "Slot not found",
        body: html`<div class="ag-unknown" data-unknown-slot="${param}">
          ${emptyState({
            title: "Unknown agent slot",
            reason: html`“${param}” is not an agent slot. Valid slots are AGENT 01 to AGENT 05.`,
            hint: "Choose one of the five deployment slots below.",
            iconName: "agents",
            code: "unknown-slot",
          })}
          <div class="ag-unknown__slots">
            ${SLOTS.map((n) => {
              const st = statusOf(slots.find((x) => x.slot === n));
              return html`<a class="ag-unknown__slot ${toneClass(st)}" href="#/agents/${n}">${dot(st)}<b>${agentLabel(n)}</b><span class="ag-unknown__st">${humanize(st)}</span></a>`;
            })}
          </div>
        </div>`,
      })}
    </div>`;
}

/** Section sub-heading inside a panel body. */
export function subhead(label, right) {
  return html`<div class="ag-subhead"><span class="ag-subhead__label">${label}</span>${right ? html`<span class="ag-subhead__right">${right}</span>` : ""}</div>`;
}

/** Arrow link used in panel actions. */
export function goLink(href, label) {
  return html`<a class="ag-go" href="${href}">${label}<span class="ag-go__arrow">→</span></a>`;
}

export { humanize, pad2 };
