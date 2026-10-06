// Shared helpers for the agents views (Trading Floor overview, agent terminal,
// agent activity). Everything rendered here comes from the snapshot
// (derived.agent_slots, documents) or from /api/cc/events. Architecture
// vocabulary (slot numbers, event kinds, learning-loop stages) is constant.

import { html, raw, cx } from "../core/html.js";
import { pad2, humanize, fmtTime, fmtDate, fmtDateTime, fmtAge, fmtCount, isNil } from "../core/format.js";
import { toneOf, toneClass } from "../core/tones.js";
import { doc, source, derived, sourceReason, sourceShort, sourceTitle, findMemory } from "../core/state.js";
import { fetchEvents } from "../core/api.js";
import { badge, dot, chip, val, originBadge, controlButton, refLink } from "../components/ui.js";
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

/**
 * Stages owned by research / governance, with the proposal states that have
 * reached each gate (derive.GATED_PROPOSAL_STAGES). Counts are cumulative by
 * state membership: a RELEASED_AS_VERSION proposal is counted at validation,
 * approval and release, so the stepper never reads as a release that skipped
 * governance. REJECTED proposals are counted separately.
 */
export const GATED_STAGES = [
  ["RESEARCH_VALIDATION", "Research validation", "RESEARCH", ["IN_RESEARCH", "VALIDATED", "APPROVED", "RELEASED_AS_VERSION"]],
  ["GOVERNANCE_APPROVAL", "Governance approval", "GOVERNANCE", ["APPROVED", "RELEASED_AS_VERSION"]],
  ["NEW_VERSION", "New strategy version", "GOVERNANCE", ["RELEASED_AS_VERSION"]],
];

const ACTIVE = new Set(["SIMULATING", "PAPER", "LIVE"]);

/** Statuses in which a slot runs a strategy (derive.ACTIVE_AGENT_STATUSES). */
export const ACTIVE_STATUSES = [...ACTIVE];

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
  else parts.push(noStrategyLabel(sv));
  return parts.join(" · ");
}

/**
 * True when agents.json exists but cannot be read (INVALID / UNREADABLE): the
 * slot's state is unknown, so nothing — not even "no strategy" — is asserted.
 */
export function sourceBroken(src) {
  return src?.status === "INVALID" || src?.status === "UNREADABLE";
}

/** What a slot without an assignment shows: NO STRATEGY REPORTED / STRATEGY UNKNOWN / NO ACTIVE STRATEGY. */
export function noStrategyLabel(sv) {
  if (sv.status === "NOT_REPORTED") return "NO STRATEGY REPORTED";
  if (!sv.connected && sourceBroken(sv.src)) return "STRATEGY UNKNOWN";
  return "NO ACTIVE STRATEGY";
}

/** One-line reason under noStrategyLabel(). */
export function noStrategyHint(sv) {
  if (sv.status === "NOT_REPORTED") return "The runtime reported no state for this slot";
  if (!sv.connected && sourceBroken(sv.src)) return `Assignment unreadable: ${sourceTitle(sv.src, "agents.json")}`;
  return "Awaiting a validated, approved and packaged strategy";
}

/** "memory.json not produced — title unavailable": why a referenced memory has no title. */
export function memoryAbsent(ctx) {
  const src = source(ctx, "memory");
  return src?.status === "OK" ? "Not found in memory store" : `${sourceTitle(src, "memory.json")} — title unavailable`;
}

/** Strategy status as the registry declares it; never inferred from the agent. */
export function registryBadge(ctx, s) {
  if (s?.status) return badge(s.status);
  const src = source(ctx, "strategies");
  if (src?.status === "OK") return badge(null, { label: "NOT IN REGISTRY" });
  // A rejected / unreadable registry is a source error (red), never a calm absence.
  return badge(sourceBroken(src) ? src.status : null, { label: `REGISTRY ${sourceShort(src)}`, title: sourceReason(src) ?? "" });
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
  if (src?.status === "INVALID") {
    // Rejected lines cannot be attributed to a slot or kind, so this is never "none recorded".
    const bad = `${fmtCount(src.invalid_lines ?? 0)} line(s) of agent_events.jsonl were rejected by the contract and cannot be attributed`;
    return slot ? `No valid line records ${what} for ${who}; ${bad}.` : `No valid line records ${what}; ${bad}.`;
  }
  return slot ? `agent_events.jsonl is connected; ${who} has recorded no ${what}.` : `agent_events.jsonl is connected; no ${what} have been recorded.`;
}

/** Title of an empty event log: the stream's state, never "no activity" unless the stream says so. */
export function eventsEmptyTitle(ctx, res, none = "NO ACTIVE AGENT ACTIVITY", invalid = "NO VALID EVENT LINE") {
  if (res && !res.ok) return "EVENT REQUEST FAILED";
  const src = res?.source ?? source(ctx, "agent_events");
  if (!eventsAvailable(ctx, res)) return sourceTitle(src, "Agent event stream").toUpperCase();
  if (src?.status === "INVALID") return invalid;
  return none;
}

/* ------------------------------------------------------------------ exact per-slot counts */

/**
 * Exact per-slot event counts over the whole stream, from derived.agent_slots[i].events
 * (by_kind / by_mode), never from a fetched window. When the stream is INVALID the
 * counts cover valid lines only: rejected lines cannot be attributed to a slot, so a
 * count is a lower bound ("≥n") and a zero is unknown, never a recorded 0.
 */
export function slotCounts(ctx, sv) {
  const ev = sv.slot?.events ?? null;
  const src = source(ctx, "agent_events");
  const avail = !!ev?.available && !isNil(ev.count);
  const invalid = avail && src?.status === "INVALID";
  return {
    avail,
    exact: avail && !invalid,
    invalid,
    invalidLines: src?.invalid_lines ?? 0,
    total: avail ? ev.count : null,
    byKind: avail ? ev.by_kind ?? null : null,
    byMode: avail ? ev.by_mode ?? null : null,
  };
}

/** A count from slotCounts(): exact text, a lower bound when the stream is INVALID, or null. */
export function countText(c, n) {
  if (!c.avail || isNil(n)) return null;
  if (c.exact) return fmtCount(n);
  return n > 0 ? `≥${fmtCount(n)}` : null;
}

/** countText() as a marked value; an INVALID-stream zero is empty with the reason in its title. */
export function countVal(c, n) {
  const t = countText(c, n);
  if (!isNil(t)) return html`<span class="v" data-v ${c.invalid ? html`title="Valid lines only; ${fmtCount(c.invalidLines)} rejected line(s) are not counted"` : ""}>${t}</span>`;
  if (c.invalid) return html`<span class="v is-empty" data-v data-empty="1" title="None among valid lines; ${fmtCount(c.invalidLines)} line(s) rejected by the contract cannot be attributed">—</span>`;
  return val(null);
}

/** Sum of by_kind over a list of kinds (0 when none). */
export function kindsTotal(byKind, kinds) {
  if (!byKind) return null;
  return kinds.reduce((t, k) => t + (byKind[k] ?? 0), 0);
}

/* ------------------------------------------------------------------ record origins (never merged) */

const ORIGIN_ORDER = ["ORIGINAL", "RECONSTRUCTED", "SYNTHETIC_FIXTURE"];
const ORIGIN_TAG = { ORIGINAL: "ORIG", RECONSTRUCTED: "RECON", SYNTHETIC_FIXTURE: "SYNTH" };

/** Count records per origin. null when the list itself is absent. */
export function countOrigins(rows) {
  if (!Array.isArray(rows)) return null;
  const out = {};
  for (const r of rows) {
    const o = r?.origin ?? "UNDECLARED";
    out[o] = (out[o] ?? 0) + 1;
  }
  return out;
}

/** [origin, n] pairs with n > 0, in display order. */
export function originParts(split) {
  const rank = (o) => (ORIGIN_ORDER.includes(o) ? ORIGIN_ORDER.indexOf(o) : ORIGIN_ORDER.length);
  return Object.entries(split ?? {})
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => rank(a) - rank(b));
}

function originTone(o) {
  return toneClass(o === "SYNTHETIC_FIXTURE" ? "INVALID" : o);
}

/**
 * A per-origin count: one number per origin, ORIGINAL untagged, every other
 * origin tagged (RECON amber, SYNTH red). Origins are never summed. An empty
 * split is a real 0; null stays empty.
 */
export function originCount(split) {
  if (!split) return val(null);
  const parts = originParts(split);
  if (!parts.length) return html`<span class="ag-split" data-origin-split>${val(fmtCount(0))}</span>`;
  return html`<span class="ag-split" data-origin-split>${parts.map(
    ([o, n]) => html`<span class="ag-split__n" data-origin="${o}" title="${fmtCount(n)} ${humanize(o).toLowerCase()} record(s), counted separately">${val(fmtCount(n))}${
      o === "ORIGINAL" ? "" : html`<span class="${cx("ag-split__tag", originTone(o))}">${ORIGIN_TAG[o] ?? o}</span>`
    }</span>`,
  )}</span>`;
}

/** "7 original · 1 reconstructed" (never one merged total). */
export function originText(split) {
  const parts = originParts(split);
  return parts.length ? parts.map(([o, n]) => `${fmtCount(n)} ${humanize(o).toLowerCase()}`).join(" · ") : "0";
}

/**
 * Per-origin split of a slot's (or the whole stream's) events, counted from a
 * fetched window — only when the window holds every one of them (total known and
 * loaded ≥ total). Otherwise null: a split of a partial window is not the whole.
 */
export function windowOrigins(events, total) {
  if (!Array.isArray(events) || isNil(total) || events.length < total) return null;
  return countOrigins(events);
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

/** Empty body for a log frame: headline, reason, blinking cursor. Pass eventsEmptyTitle() as title. */
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
