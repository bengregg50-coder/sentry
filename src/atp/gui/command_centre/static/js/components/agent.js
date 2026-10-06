// Compact agent tile used on the Command Centre and the Trading Floor overview.
// Values only come from derived.agent_slots (+ the agent payload joined by slot);
// a sleeping slot shows no numbers.
//
// The "no strategy" line follows one rule everywhere:
//   agents.json unreadable / contract error  -> STATE UNAVAILABLE (never "sleeping")
//   connected runtime did not report the slot -> NO STRATEGY REPORTED
//   reported slot without an assignment, or the not-connected default -> NO ACTIVE STRATEGY

import { html } from "../core/html.js";
import { pad2, humanize, fmtAge } from "../core/format.js";
import { badge, dot, val, metric } from "./ui.js";
import { icon } from "./icons.js";
import { sparkline } from "./chart.js";

function noneLine(slot, status) {
  if (status === "SOURCE_ERROR") {
    return html`<span class="agent-mini__none agent-mini__none--error" data-none="unavailable">${icon("alert")} STATE UNAVAILABLE</span>`;
  }
  if (!slot.reported && slot.source_status === "OK") {
    return html`<span class="agent-mini__none" data-none="not-reported">${icon("empty")} NO STRATEGY REPORTED</span>`;
  }
  const sleeping = status === "SLEEPING";
  return html`<span class="agent-mini__none" data-none="no-strategy">${icon(sleeping ? "sleep" : "empty")} NO ACTIVE STRATEGY</span>`;
}

function strategyLine(strat) {
  const flags = [];
  if (strat.known === false) flags.push(badge("VIOLATION", { label: "NOT IN REGISTRY", title: `${strat.strategy_id} is not in the strategy registry` }));
  else if (strat.known_version === false) flags.push(badge("VIOLATION", { label: `v${strat.version} NOT IN REGISTRY`, title: `Registry has no v${strat.version}; current is v${strat.current_version ?? "?"}` }));
  else if (strat.is_current === false) flags.push(badge("WARN", { label: "NOT CURRENT", title: `Registry current version is v${strat.current_version}` }));
  return html`<span class="ref">${strat.strategy_id} v${strat.version}</span><span class="muted"> · ${humanize(strat.mode)}</span>${flags.length ? html` ${flags}` : ""}`;
}

export function agentMini(slot, { now } = {}) {
  const a = slot.agent;
  const status = slot.status ?? "NOT_REPORTED";
  const sleeping = status === "SLEEPING" || status === "SOURCE_ERROR" || !slot.reported;
  const stale = slot.stale === true;
  const strat = slot.strategy;
  const pos = a?.positions?.[0];
  const label = status === "SOURCE_ERROR" ? "SOURCE ERROR" : humanize(status);
  return html`<a class="agent-mini ${sleeping ? "is-sleeping" : ""} ${status === "SOURCE_ERROR" ? "is-error" : ""}" href="#/agents/${slot.slot}" data-agent-slot="${slot.slot}" data-agent-status="${status}" ${stale ? html`data-stale="1"` : ""}>
    <div class="agent-mini__head">
      <span class="agent-mini__id">AGENT ${pad2(slot.slot)}</span>
      ${dot(status, { pulse: !sleeping && !stale })}
      ${badge(status, { label })}
      ${stale ? badge("STALE", { title: "Heartbeat older than the producer's declared freshness bound" }) : ""}
    </div>
    <div class="agent-mini__strategy">${strat ? strategyLine(strat) : noneLine(slot, status)}</div>
    <div class="agent-mini__trace">${sparkline(a?.equity?.map((p) => p.v), { width: 200, height: 26 })}</div>
    <dl class="agent-mini__kv">
      <div><dt>MARKET</dt><dd title="${a?.market ?? ""}">${val(a?.market)}</dd></div>
      <div><dt>POSITION</dt><dd>${pos ? val(`${pos.side} ${pos.quantity}`) : val(null)}</dd></div>
      <div><dt>P&amp;L · DAY</dt><dd class="agent-mini__pnl">${a?.pnl?.day ? metric(a.pnl.day) : val(null)}</dd></div>
      <div><dt>HEARTBEAT</dt><dd>${val(a?.last_heartbeat ? fmtAge(a.last_heartbeat, now) : null)}</dd></div>
    </dl>
    <div class="agent-mini__foot" title="${slot.status_reason ?? ""}">${slot.status_reason ?? (slot.reported ? "" : "Not reported")}</div>
  </a>`;
}
