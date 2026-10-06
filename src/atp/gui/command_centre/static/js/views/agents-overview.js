// Trading Floor — the five agent deployment slots.
// Slots are future deployment targets, not traders: a slot shows only what the
// agent runtime reports. With no runtime every slot sleeps with no strategy,
// and nothing — position, P&L, heartbeat — is displayed.

import { html, raw, esc, cx } from "../core/html.js";
import { fmtCount, fmtDateTime, humanize, isNil, EMPTY } from "../core/format.js";
import { toneClass } from "../core/tones.js";
import { doc, source, derived, sourceReason, sourceShort, findMemory, findStrategy, findingsFor } from "../core/state.js";
import {
  pageHeader,
  panel,
  badge,
  dot,
  val,
  metric,
  sourceTag,
  sourceEmpty,
  emptyState,
  findingsList,
  control,
  table,
} from "../components/ui.js";
import { steps } from "../components/flow.js";
import { icon } from "../components/icons.js";
import {
  SLOTS,
  agentLabel,
  statusOf,
  isActive,
  slotView,
  absenceShort,
  statusMark,
  loadEvents,
  eventLog,
  logEmpty,
  eventsAbsence,
  trace,
  ageVal,
  subhead,
  goLink,
  memoryHref,
  strategyHref,
  registryBadge,
  pad2,
} from "./_agents-common.js";

const BOARD_STATUSES = ["SLEEPING", "STANDBY", "SIMULATING", "PAPER", "LIVE", "PAUSED", "HALTED", "ERROR", "NOT_REPORTED"];

/* ------------------------------------------------------------------ fleet status */

function fleetBoard(ctx) {
  const slots = derived(ctx, "agent_slots") ?? [];
  const src = source(ctx, "agents");
  const connected = src?.status === "OK";
  return html`<div class="ag-board" data-connected="${connected ? "1" : "0"}">
    ${BOARD_STATUSES.map((st) => {
      const members = connected ? slots.filter((s) => statusOf(s) === st) : null;
      const n = members ? members.length : null;
      return html`<div class="${cx("ag-board__col", n && "is-populated")}" data-board-status="${st}">
        <div class="ag-board__label">${n ? dot(st, { pulse: isActive(st) }) : dot(null)}<span>${humanize(st)}</span></div>
        <div class="${cx("ag-board__count v", isNil(n) && "is-empty")}" data-v ${isNil(n) ? raw('data-empty="1"') : ""}>${isNil(n) ? EMPTY : n}</div>
        <div class="ag-board__slots">
          ${members && members.length
            ? members.map((s) => html`<a class="ag-board__slot ${toneClass(st)}" href="#/agents/${s.slot}">${pad2(s.slot)}</a>`)
            : html`<span class="ag-board__none">${connected ? "NONE" : "·"}</span>`}
        </div>
      </div>`;
    })}
  </div>`;
}

function fleetSide(ctx) {
  const slots = derived(ctx, "agent_slots") ?? [];
  const agentsOk = source(ctx, "agents")?.status === "OK";
  const evSrc = source(ctx, "agent_events");
  const evOk = evSrc?.status === "OK" || evSrc?.status === "INVALID";
  const reporting = agentsOk ? slots.filter((s) => s.reported).length : null;
  const assigned = agentsOk ? slots.filter((s) => s.has_strategy).length : null;
  const lastTs = evOk ? slots.map((s) => s.events?.last_ts).filter(Boolean).sort().pop() ?? null : null;
  const cell = (label, value, hint, emptyLabel) =>
    html`<div class="ag-fleet__cell">
      <div class="ag-fleet__k">${label}</div>
      <div class="${cx("ag-fleet__v v", isNil(value) && "is-empty")}" data-v ${isNil(value) ? raw('data-empty="1"') : ""}>${isNil(value) ? EMPTY : value}</div>
      <div class="ag-fleet__h">${isNil(value) ? html`<span class="nodata">${emptyLabel}</span>` : hint}</div>
    </div>`;
  return html`<div class="ag-fleet">
    ${cell("Slots reporting", isNil(reporting) ? null : `${reporting}/${SLOTS.length}`, "Declared by agents.json", `RUNTIME ${sourceShort(source(ctx, "agents"))}`)}
    ${cell("Strategies assigned", assigned, "Slots holding an assignment", `RUNTIME ${sourceShort(source(ctx, "agents"))}`)}
    ${cell("Events recorded", evOk ? fmtCount(evSrc.valid_events) : null, evSrc?.invalid_lines ? `${evSrc.invalid_lines} invalid line(s)` : "agent_events.jsonl", `STREAM ${sourceShort(evSrc)}`)}
    ${cell("Last event", lastTs ? ageVal(lastTs, ctx.now) : evOk ? "NONE" : null, lastTs ? fmtDateTime(lastTs) : "No event recorded", `STREAM ${sourceShort(evSrc)}`)}
  </div>`;
}

/* ------------------------------------------------------------------ slot cards */

function kvCell(k, v, cls) {
  return html`<div class="${cx("ag-card__kv", cls)}"><dt>${k}</dt><dd>${v}</dd></div>`;
}

function positionSummary(sv) {
  const pos = sv.agent?.positions ?? [];
  if (!sv.reported) return val(null);
  if (!pos.length) return html`<span class="ag-none">NONE</span>`;
  const p = pos[0];
  return html`<span class="v" data-v>${p.instrument} ${p.side} ${p.quantity}</span>${pos.length > 1 ? html` <span class="muted small">+${pos.length - 1}</span>` : ""}`;
}

function slotCard(ctx, n) {
  const sv = slotView(ctx, n);
  const a = sv.agent;
  const s = sv.strategy;
  const st = sv.status;
  const sleeping = !sv.reported || st === "SLEEPING";
  const ev = sv.slot?.events;
  const bars = a?.bars ?? [];
  const reason = sv.slot?.status_reason ?? (sv.reported ? null : "Not reported");
  return html`<article class="${cx("ag-card", toneClass(st), sleeping && "is-sleeping", isActive(st) && "is-active")}" data-agent-slot="${n}" data-agent-status="${st}">
    <span class="ag-card__wm" aria-hidden="true">${pad2(n)}</span>
    <header class="ag-card__head">
      <a class="ag-card__id" href="#/agents/${n}">${agentLabel(n)}</a>
      ${statusMark(st)}
    </header>
    <div class="ag-card__ident">
      <span class="${cx("ag-card__code", !a?.codename && "is-empty")}">${a?.codename ?? "NO CODENAME"}</span>
      <span class="ag-card__spec">${a?.specialisation ?? (sv.reported ? "Specialisation not declared" : "Specialisation unknown")}</span>
    </div>

    <div class="ag-card__strategy">
      <div class="ag-card__label">STRATEGY ASSIGNMENT</div>
      ${s
        ? html`<div class="ag-card__strat">
            <a class="ref" href="${strategyHref(s.strategy_id)}">${s.strategy_id}</a><span class="mono text-2">v${s.version}</span>
            ${registryBadge(ctx, s)}
          </div>
          <div class="ag-card__strat-name">${s.name ?? "Name not in registry"}</div>`
        : html`<div class="ag-card__nostrat">${icon(sleeping ? "sleep" : "empty")}<span>${st === "NOT_REPORTED" ? "NO STRATEGY REPORTED" : "NO ACTIVE STRATEGY"}</span></div>
          <div class="ag-card__hint">${st === "NOT_REPORTED" ? "The runtime reported no state for this slot" : "Awaiting a validated, approved and packaged strategy"}</div>`}
    </div>

    <div class="ag-card__screen">
      <div class="ag-card__screen-head"><span>MARKET TRACE</span><span>${bars.length ? html`<span class="v" data-v>${bars.length}</span> BARS` : "NO BARS"}</span></div>
      ${trace(bars.map((b) => b.c), { height: 46 })}
      ${bars.length ? "" : html`<span class="ag-card__screen-empty">${st === "NOT_REPORTED" ? "NOT REPORTED" : st === "SLEEPING" ? "SLEEPING" : "NO MARKET DATA"}</span>`}
    </div>

    <dl class="ag-card__grid">
      ${kvCell("MODE", a?.assignment ? val(humanize(a.assignment.mode)) : val(null))}
      ${kvCell("MARKET", val(a?.market))}
      ${kvCell("TIMEFRAME", val(a?.timeframe))}
      ${kvCell("SIGNAL", a?.signal ? badge(a.signal.state) : val(null))}
      ${kvCell("POSITION", positionSummary(sv))}
      ${kvCell("P&L · DAY", a?.pnl?.day ? metric(a.pnl.day) : val(null), "ag-card__kv--wide")}
      ${kvCell("HEARTBEAT", ageVal(a?.last_heartbeat, ctx.now))}
      ${kvCell("LAST EVENT", ev?.last_ts ? ageVal(ev.last_ts, ctx.now) : ev?.available ? html`<span class="ag-none">NONE</span>` : val(null))}
      ${kvCell("EVENTS", ev?.available ? val(fmtCount(ev.count)) : val(null))}
    </dl>

    <footer class="ag-card__foot">
      <div class="ag-card__reason" title="${reason ?? ""}">${reason ?? html`<span class="muted">${absenceShort(sv) ?? "No status detail declared"}</span>`}</div>
      <div class="ag-card__links">
        <a class="ag-card__link" href="#/agents/${n}">${icon("agent", "icon")}TERMINAL</a>
        <a class="ag-card__link" href="#/agents/${n}/activity">${icon("flow", "icon")}ACTIVITY</a>
      </div>
    </footer>
  </article>`;
}

/* ------------------------------------------------------------------ deployment rule */

const RULE_STEPS = [
  { key: "VALIDATED", label: "Research validation", detail: "Validation status VALIDATED", owner: "RESEARCH" },
  { key: "APPROVED", label: "Governance approval", detail: "Recorded APPROVED decision", owner: "GOVERNANCE" },
  { key: "PACKAGED", label: "Deployment package", detail: "Spec, data, cost & risk identities bound", owner: "DEPLOYMENT" },
  { key: "ASSIGNED", label: "Agent assignment", detail: "One slot, one strategy version", owner: "AGENT SLOT", boundary: true },
];

function eligibleTable(ctx) {
  const stratSrc = source(ctx, "strategies");
  if (stratSrc?.status !== "OK") {
    return sourceEmpty(stratSrc, {
      title: "Strategy registry not connected",
      hint: "Deployment-eligible strategies appear here when strategies.json reports versions that are validated, approved and packaged.",
      compact: true,
    });
  }
  const ids = derived(ctx, "controls")?.deployment_eligible ?? [];
  const slots = derived(ctx, "agent_slots") ?? [];
  const agentsOk = source(ctx, "agents")?.status === "OK";
  const rows = ids.map((id) => {
    const s = findStrategy(ctx, id);
    const h = derived(ctx, "handoffs")?.find((x) => x.strategy_id === id);
    return { id, s, h, holders: slots.filter((x) => x.strategy?.strategy_id === id) };
  });
  return table({
    dense: true,
    columns: [
      { key: "id", label: "Strategy", render: (r) => html`<a class="ref" href="${strategyHref(r.id)}">${r.id}</a>${r.h ? html` <span class="mono muted">v${r.h.version}</span>` : ""}` },
      { key: "name", label: "Name", render: (r) => r.s?.name ?? null, cls: "ag-ellipsis" },
      { key: "status", label: "Status", render: (r) => (r.s ? badge(r.s.status) : null) },
      {
        key: "agent",
        label: "Assigned",
        render: (r) =>
          r.holders.length
            ? html`<span class="cluster">${r.holders.map((x) => html`<a class="ref" href="#/agents/${x.slot}">A${pad2(x.slot)}</a> <span class="muted small">${humanize(x.strategy.mode)}</span>`)}</span>`
            : agentsOk
              ? html`<span class="ag-none">UNASSIGNED</span>`
              : null,
      },
    ],
    rows,
    empty: emptyState({
      title: "No deployment-eligible strategy",
      reason: "No strategy version is validated, approved and packaged. Agents remain asleep — no trade is preferred to a weak trade.",
      compact: true,
      iconName: "shield",
      code: "no-eligible-strategy",
    }),
  });
}

function deploymentRule(ctx) {
  const actions = derived(ctx, "controls")?.actions ?? [];
  return html`
    <div class="ag-rule">
      <div class="ag-rule__mark">${icon("shield", "icon")}</div>
      <p class="ag-rule__text">Only a strategy version that research has <b>validated</b>, governance has <b>approved</b> and deployment has <b>packaged</b> can be assigned to an agent slot. Nothing else reaches the trading floor.</p>
    </div>
    ${steps(RULE_STEPS, { cls: "ag-rule__steps" })}
    ${subhead("Deployment-eligible now", html`<span class="muted">derived.controls</span>`)}
    ${eligibleTable(ctx)}
    ${subhead("Deployment & runtime controls", html`<span class="muted">locked · reasons computed from state</span>`)}
    ${actions.length ? html`<div class="ag-controls">${actions.map((a) => control(a))}</div>` : emptyState({ title: "No snapshot", compact: true })}
  `;
}

/* ------------------------------------------------------------------ shared memory */

function memoryNetwork(ctx) {
  const memSrc = source(ctx, "memory");
  const memOk = memSrc?.status === "OK";
  const resOk = source(ctx, "research")?.status === "OK";
  const stats = derived(ctx, "memory_stats");
  const total = stats?.available ? stats.total : null;
  const sys = derived(ctx, "system") ?? [];
  const research = sys.find((x) => x.key === "research_engine");
  const W = 1000;
  const H = 258;
  const xs = SLOTS.map((_, i) => 110 + i * ((W - 220) / (SLOTS.length - 1)));
  const p = [];
  const flow = (x1, y1, x2, y2, live) =>
    live
      ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(34,211,238,.22)" stroke-width="2"/><line class="flow-dash" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--cyan-2)" stroke-width="1.2"/>`
      : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 4"/>`;
  const valText = (x, y, v, suffix, cls = "", anchor = "middle") =>
    isNil(v)
      ? `<text x="${x}" y="${y}" text-anchor="${anchor}" class="svg-label svg-label--muted ${cls}" data-v data-empty="1">${EMPTY}</text>`
      : `<text x="${x}" y="${y}" text-anchor="${anchor}" class="svg-label ${cls}" data-v>${esc(String(v))}${suffix ? esc(suffix) : ""}</text>`;

  // research <-> memory
  const rmLive = resOk && memOk;
  p.push(flow(470, 66, 470, 112, rmLive));
  p.push(flow(530, 112, 530, 66, rmLive));
  p.push(`<path d="M466 106 L470 112 L474 106" fill="none" stroke="${rmLive ? "var(--cyan-2)" : "var(--faint)"}"/>`);
  p.push(`<path d="M526 72 L530 66 L534 72" fill="none" stroke="${rmLive ? "var(--cyan-2)" : "var(--faint)"}"/>`);
  p.push(`<text x="458" y="93" text-anchor="end" class="svg-label svg-label--muted" style="font-size:8.5px">WRITES FINDINGS · LESSONS</text>`);
  p.push(`<text x="542" y="93" class="svg-label svg-label--muted" style="font-size:8.5px">USES EVIDENCE · FAILURES</text>`);

  // research node
  const rState = research?.state ?? "NOT_CONNECTED";
  p.push(`<g class="ag-net__node ${toneClass(rState)}"><rect x="340" y="16" width="320" height="50" rx="3"/>`);
  p.push(`<text x="500" y="37" text-anchor="middle" class="svg-label svg-label--strong">ONE RESEARCH INTELLIGENCE</text>`);
  p.push(`<text x="500" y="54" text-anchor="middle" class="svg-label svg-label--muted" style="font-size:8.5px">${esc(humanize(rState))}</text></g>`);

  // memory bar
  p.push(`<g class="ag-net__node ag-net__mem ${memOk ? "tone-info" : "tone-muted"}"><rect x="60" y="112" width="880" height="52" rx="3"/>`);
  p.push(`<text x="500" y="133" text-anchor="middle" class="svg-label svg-label--strong">SHARED EVIDENCE-BACKED MEMORY</text>`);
  p.push(valText(500, 151, total, " MEMORIES"));
  p.push(`<text x="76" y="128" class="svg-label svg-label--muted" style="font-size:8px">memory.json · ${esc(sourceShort(memSrc))}</text></g>`);

  // agents
  SLOTS.forEach((n, i) => {
    const sv = slotView(ctx, n);
    const refs = sv.reported ? (sv.agent?.memory_refs ?? []).length : null;
    const live = memOk && !!refs;
    const x = xs[i];
    p.push(flow(x, 164, x, 196, live));
    // status starts 7 in from the left border and refs end 7 in from the right, so the longest
    // status (NOT REPORTED / SOURCE ERROR) stays inside the node instead of running past its edge.
    p.push(`<g class="ag-net__node ${toneClass(sv.status)}" data-net-slot="${n}"><rect x="${x - 78}" y="196" width="156" height="50" rx="3"/>`);
    p.push(`<text x="${x}" y="215" text-anchor="middle" class="svg-label svg-label--strong">AGENT ${pad2(n)}</text>`);
    p.push(`<text x="${x - 71}" y="234" class="svg-label svg-label--muted" style="font-size:8.5px" data-net-status>${esc(humanize(sv.status))}</text>`);
    p.push(valText(x + 71, 234, refs, " REFS", "ag-net__refs", "end"));
    p.push(`</g>`);
  });
  return html`<div class="diagram ag-net" style="--diagram-min:760px">${raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="One research intelligence, five agents, shared memory">${p.join("")}</svg>`)}</div>`;
}

function memoryRefs(ctx) {
  const agentsSrc = source(ctx, "agents");
  if (agentsSrc?.status !== "OK") {
    return sourceEmpty(agentsSrc, {
      title: "Agent memory references not connected",
      hint: "Each agent's memory_refs — the memories it reads and writes — appear here when agents.json is produced.",
      compact: true,
    });
  }
  const memOk = source(ctx, "memory")?.status === "OK";
  const rows = [];
  for (const n of SLOTS) {
    const sv = slotView(ctx, n);
    for (const id of sv.agent?.memory_refs ?? []) rows.push({ n, id, m: findMemory(ctx, id) });
  }
  if (!rows.length) {
    return emptyState({
      title: "No agent memory references",
      reason: "The agent runtime is connected; no slot reports memory references.",
      compact: true,
      iconName: "memory",
    });
  }
  return html`<div class="ag-memrefs">
    ${rows.map(
      (r) => html`<div class="ag-memrefs__row" data-memref="${r.id}">
        <a class="ag-memrefs__slot" href="#/agents/${r.n}">A${pad2(r.n)}</a>
        <a class="ref" href="${memoryHref(r.id)}">${r.id}</a>
        <span class="ag-memrefs__title">${r.m ? r.m.title : memOk ? "Not found in memory store" : "memory.json not connected — title unavailable"}</span>
        ${r.m ? badge(r.m.validation_state) : ""}
      </div>`,
    )}
  </div>`;
}

/* ------------------------------------------------------------------ view */

export default {
  title: "Agent Overview",
  async load() {
    return { events: await loadEvents({ limit: 40 }) };
  },
  render(ctx) {
    const agentsSrc = source(ctx, "agents");
    const evSrc = source(ctx, "agent_events");
    const res = ctx.extra?.events ?? null;
    const events = res?.events ?? [];
    const findings = findingsFor(ctx, "agents");
    const anyOk = ctx.snap && Object.values(ctx.snap.sources ?? {}).some((s) => s.status === "OK");

    return html`<div class="ag-page ag-page--floor">
      ${pageHeader({
        kicker: "TRADING FLOOR",
        code: "AGT",
        title: "Agent Overview",
        sub: "Five deployment slots for five specialised trading agents. A slot runs only a strategy that research has validated and governance has approved; until then it sleeps. An empty slot is a correct state, not a gap to fill.",
        right: html`${sourceTag(agentsSrc, { now: ctx.now })}${sourceTag(evSrc, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({
          span: 12,
          code: "AGT-01",
          title: "Fleet status",
          sub: agentsSrc?.status === "OK" ? "Slots counted by declared status" : `${sourceReason(agentsSrc)} Slots display as SLEEPING by default; no status has been reported.`,
          body: html`<div class="ag-fleet-wrap">${fleetBoard(ctx)}${fleetSide(ctx)}</div>`,
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "AGT-02",
          title: "Deployment slots",
          sub: "One research intelligence · five specialised agents · one shared memory",
          variant: "accent",
          body: html`<div class="ag-floor">${SLOTS.map((n) => slotCard(ctx, n))}</div>`,
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 5,
          code: "AGT-03",
          title: "Deployment rule",
          sub: "Validated + approved + packaged → assignable",
          body: deploymentRule(ctx),
        })}
        ${panel({
          span: 7,
          code: "AGT-04",
          title: "Latest activity · all agents",
          sub: res?.ok && events.length ? `Latest ${events.length} events, newest first` : "agent_events.jsonl",
          actions: html`${sourceTag(res?.source ?? evSrc, { now: ctx.now })}`,
          body: eventLog(ctx, events, {
            showSlot: true,
            compact: true,
            maxHeight: 560,
            prompt: events.length ? "sentry://agents/events — stream" : null,
            empty: logEmpty({
              reason: eventsAbsence(ctx, res),
              hint: "Observations, decisions, no-trade calls, orders and fills from every slot will stream here, newest first.",
            }),
          }),
          cls: "ag-fillbody",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 8,
          code: "AGT-05",
          title: "Shared memory",
          sub: "Agents learn from — and write back to — one evidence-backed memory",
          actions: goLink("#/memory/agents", "Agent memories"),
          body: html`
            ${memoryNetwork(ctx)}
            <p class="ag-note">SENTRY is one research intelligence and five specialised agents sharing one memory. Agents recall evidence-backed lessons — including failed mechanisms — before acting, and write observations back; research uses those lessons. Nothing enters memory without evidence, and nothing in memory changes a running strategy.</p>
            ${subhead("Memory references by agent", html`<span class="muted">agents.json · memory_refs</span>`)}
            ${memoryRefs(ctx)}
          `,
        })}
        ${panel({
          span: 4,
          code: "AGT-06",
          title: "Agent cross-checks",
          sub: "Consistency of declared agent state",
          body: findingsList(findings, {
            empty: emptyState({
              title: "No agent findings",
              reason: agentsSrc?.status === "OK" ? "Declared agent state is internally consistent with the strategy registry." : anyOk ? "agents.json is not connected, so there is no agent state to cross-check." : "Nothing is connected, so there is nothing to cross-check.",
              compact: true,
              iconName: "shield",
            }),
          }),
        })}
      </div>
    </div>`;
  },
};
