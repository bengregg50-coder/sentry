// Compact agent tile used on the Command Centre and the Trading Floor overview.
// Values only come from derived.agent_slots; a sleeping slot shows no numbers.

import { html } from "../core/html.js";
import { pad2, humanize, fmtAge } from "../core/format.js";
import { badge, dot, val, metric } from "./ui.js";
import { icon } from "./icons.js";
import { sparkline } from "./chart.js";

export function agentMini(slot, { now } = {}) {
  const a = slot.agent;
  const status = slot.status ?? "NOT_REPORTED";
  const sleeping = status === "SLEEPING" || !slot.reported;
  const strat = slot.strategy;
  const pos = a?.positions?.[0];
  return html`<a class="agent-mini ${sleeping ? "is-sleeping" : ""}" href="#/agents/${slot.slot}" data-agent-slot="${slot.slot}" data-agent-status="${status}">
    <div class="agent-mini__head">
      <span class="agent-mini__id">AGENT ${pad2(slot.slot)}</span>
      ${dot(status, { pulse: !sleeping })}
      ${badge(status, { label: humanize(status) })}
    </div>
    <div class="agent-mini__strategy">
      ${strat
        ? html`<span class="ref">${strat.strategy_id} v${strat.version}</span><span class="muted"> · ${humanize(strat.mode)}</span>`
        : html`<span class="agent-mini__none">${icon(sleeping ? "sleep" : "empty")} NO ACTIVE STRATEGY</span>`}
    </div>
    <div class="agent-mini__trace">${sparkline(a?.equity?.map((p) => p.v), { width: 200, height: 26 })}</div>
    <dl class="agent-mini__kv">
      <div><dt>MARKET</dt><dd>${val(a?.market)}</dd></div>
      <div><dt>POSITION</dt><dd>${pos ? val(`${pos.side} ${pos.quantity}`) : val(null)}</dd></div>
      <div><dt>P&amp;L</dt><dd>${a?.pnl?.day ? metric(a.pnl.day, { showBasis: false }) : val(null)}</dd></div>
      <div><dt>HEARTBEAT</dt><dd>${val(a?.last_heartbeat ? fmtAge(a.last_heartbeat, now) : null)}</dd></div>
    </dl>
    <div class="agent-mini__foot">${slot.status_reason ?? (slot.reported ? "" : "Not reported")}</div>
  </a>`;
}
