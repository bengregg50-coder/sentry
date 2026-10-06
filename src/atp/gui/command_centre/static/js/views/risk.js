// Risk — kill switch, declared risk limits, breaches and per-agent limits.
// Rule: limits are never invented or defaulted. A limit shown here is a limit a
// producer declared in risk.json or agents.json; anything else is shown absent.

import { html } from "../core/html.js";
import { fmtDateTime, fmtCount, humanize } from "../core/format.js";
import { toneClass } from "../core/tones.js";
import { doc, source, derived, sourceReason, sourceShort, findingsFor } from "../core/state.js";
import { pageHeader, panel, badge, stat, statRow, sourceTag, table, emptyState, findingsList, control, kv } from "../components/ui.js";
import { icon } from "../components/icons.js";
import { SLOTS, slotName, absentState, untilAvailable, limitRow, slotHead, slotAbsence, absent, provenance, doctrine, ghostHead, timeVal } from "./_ops-common.js";

const SECTIONS = [
  ["portfolio_limits", "RSK-03", "Portfolio limits", "Book-level limits across all agents"],
  ["daily_limits", "RSK-04", "Daily limits", "Limits that reset each trading session"],
  ["execution_limits", "RSK-05", "Execution limits", "Limits on order flow and fill quality"],
];

const LIMIT_STATES = ["OK", "WARN", "BREACH", "UNKNOWN"];

/* ---------------------------------------------------------------- RSK-01 kill switch */

function killSwitch(ctx, risk, src) {
  const ks = risk?.kill_switch ?? null;
  const state = risk ? ks?.state ?? "NOT_REPORTED" : absentState(src);
  const label = risk ? (ks ? humanize(ks.state) : "NOT REPORTED") : sourceShort(src);
  const reason = risk
    ? ks
      ? ks.detail
      : "risk.json is connected but declares no kill switch. Its state is not assumed."
    : `${sourceReason(src) ?? ""} The kill-switch state appears here ${untilAvailable(src, "the risk engine")}.`;
  const action = derived(ctx, "controls")?.actions?.find((a) => a.key === "TRIP_KILL_SWITCH");
  return html`<div class="ops-ks ${toneClass(state)}" data-kill-switch="${state}">
      <div class="ops-ks__emblem">${icon("power")}</div>
      <div class="ops-ks__body">
        <span class="label">Kill switch</span>
        <div class="ops-ks__state">${label}</div>
        <div class="ops-ks__reason">${reason ?? ""}</div>
      </div>
    </div>
    ${kv([
      ["Tripped at", ks?.tripped_at ? fmtDateTime(ks.tripped_at) : null],
      ["Risk as of", risk ? fmtDateTime(risk.as_of) : null],
    ])}
    ${action ? html`<div class="ops-gap">${control(action, "power")}</div>` : ""}`;
}

/* ---------------------------------------------------------------- RSK-02 posture */

/** The server's risk cross-check family ran (needs risk.json OK). */
function riskChecksRan(ctx, risk) {
  const cov = derived(ctx, "check_coverage")?.find((c) => c.key === "risk");
  return cov ? cov.ran === true : !!risk;
}

function posture(ctx, risk, src) {
  const nc = sourceShort(src);
  const all = risk ? SECTIONS.flatMap(([k]) => risk[k]) : null;
  const byState = (s) => (all ? fmtCount(all.filter((l) => l.state === s).length) : null);
  return html`${statRow(
    [
      ...SECTIONS.map(([k, , label]) => stat({ label, value: risk ? fmtCount(risk[k].length) : null, hint: "Declared", emptyLabel: nc })),
      stat({ label: "At WARN", value: byState("WARN"), hint: "Declared WARN", emptyLabel: nc }),
      stat({ label: "At BREACH", value: byState("BREACH"), hint: "Declared BREACH", emptyLabel: nc }),
      stat({ label: "Breaches", value: risk ? fmtCount(risk.breaches.length) : null, hint: "Recorded", emptyLabel: nc }),
    ],
    { min: 130 },
  )}
  <div class="ops-strip-head"><span class="label">Declared limit states</span>${risk ? html`<span class="small muted">AS OF <span class="mono text-2">${fmtDateTime(risk.as_of)}</span></span>` : ""}</div>
  ${
    all === null
      ? html`<div class="ops-strip ops-strip--ghost">${LIMIT_STATES.map((s) => html`<span class="ops-strip__cell">${badge(null, { label: s, ghost: true })}<span class="muted">${nc}</span></span>`)}</div>`
      : all.length
        ? html`<div class="ops-strip">${SECTIONS.flatMap(([k, , sec]) =>
            risk[k].map((l) => html`<span class="ops-strip__cell ${toneClass(l.state)}" data-strip-limit="${l.key}" title="${sec}: ${l.label}"><i></i><span class="ops-strip__label">${l.label}</span>${badge(l.state)}</span>`),
          )}</div>`
        : emptyState({ title: "No limits declared", reason: "risk.json is connected and declares no limits in any section. No default limits are assumed.", compact: true, code: "no-limits" })
  }
  <div class="ops-strip-head"><span class="label">Cross-check findings · section risk</span><span class="small muted">Command Centre consistency checks</span></div>
  ${findingsList(findingsFor(ctx, "risk"), {
    // "No findings" only when the risk checks actually ran (derived.check_coverage); otherwise say why not.
    empty: riskChecksRan(ctx, risk)
      ? emptyState({ title: "No risk findings", reason: "Connected risk state raises no cross-check findings.", compact: true, iconName: "shield", code: "no-risk-findings" })
      : emptyState({
          title: `Risk checks not run · ${sourceShort(src)}`,
          reason: `${sourceReason(src) ?? "risk.json is unavailable."} Limits and the kill switch are cross-checked only against a valid risk.json.`,
          compact: true,
          iconName: src?.status === "INVALID" || src?.status === "UNREADABLE" ? "alert" : "empty",
          code: "risk-checks-not-run",
        }),
  })}`;
}

/* ---------------------------------------------------------------- RSK-03..05 limits */

function limitSection(ctx, risk, key, title) {
  const head = ghostHead(["Limit", "Used vs limit", "State"], { cls: "ops-ghost-head--limits" });
  if (!risk) return html`${head}${absent(ctx, "risk", { what: title, hint: "Each declared limit appears with used vs limit and its state. Limits are never assumed." })}`;
  const rows = risk[key];
  if (!rows.length) return html`${head}${emptyState({ title: "None declared", reason: `risk.json declares no ${title.toLowerCase()}.`, compact: true, code: `no-${key}` })}`;
  return html`<div class="ops-limits">${rows.map((l) => limitRow(l))}</div>`;
}

/* ---------------------------------------------------------------- RSK-06 breaches */

function breaches(ctx, risk) {
  const columns = [
    { key: "at", label: "When", render: (r) => timeVal(r.at) },
    { key: "breach_id", label: "Breach", cls: "mono" },
    { key: "limit_key", label: "Limit", render: (r) => html`<span class="ref">${r.limit_key}</span>` },
    { key: "severity", label: "Severity", render: (r) => badge(r.severity) },
    { key: "agent_slot", label: "Agent", render: (r) => (r.agent_slot ? html`<a class="ops-slot-link" href="#/agents/${r.agent_slot}">${slotName(r.agent_slot)}</a>` : null) },
    { key: "detail", label: "Detail", cls: "wrap" },
  ];
  const head = ghostHead(columns.map((c) => c.label), { cls: "ops-ghost-head--6" });
  if (!risk) return html`${head}${absent(ctx, "risk", { what: "Breaches", hint: "Every recorded breach appears with its limit, severity and agent." })}`;
  const rows = [...risk.breaches].sort((a, b) => (a.at < b.at ? 1 : -1));
  return table({
    dense: true,
    columns,
    rows,
    maxHeight: 320,
    empty: html`${head}${emptyState({ title: "No breaches recorded", reason: "risk.json is connected and records no breaches.", compact: true, iconName: "shield", code: "no-breaches" })}`,
  });
}

/* ---------------------------------------------------------------- RSK-08 per-agent */

function agentLimits(ctx) {
  const slots = derived(ctx, "agent_slots") ?? SLOTS.map((n) => ({ slot: n, status: null, reported: false, agent: null }));
  return html`<div class="ops-slots">
    ${slots.map((s) => {
      const why = slotAbsence(ctx, s);
      const limits = s.agent?.risk_limits ?? [];
      return html`<div class="ops-slot" data-agent-limits="${s.slot}">
        ${slotHead(ctx, s)}
        <div class="ops-slot__body">
          ${why
            ? emptyState({ title: why.title, reason: why.reason, compact: true, code: `slot-${s.slot}-absent` })
            : limits.length
              ? html`<div class="ops-limits">${limits.map((l) => limitRow(l, { compact: true }))}</div>`
              : emptyState({ title: "No limits declared", reason: "This agent declares no risk limits.", compact: true, code: `slot-${s.slot}-none` })}
        </div>
      </div>`;
    })}
  </div>`;
}

export default {
  title: "Risk",
  render(ctx) {
    const risk = doc(ctx, "risk");
    const src = source(ctx, "risk");

    return html`<div class="ops-view">
      ${pageHeader({
        kicker: "OPERATIONS",
        code: "RSK",
        title: "Risk",
        sub: "Kill switch, declared limits and breaches from risk.json, with each agent's own declared limits. Limits are shown exactly as declared — no defaults are assumed and a missing limit is never treated as unlimited or as zero.",
        right: sourceTag(src, { now: ctx.now }),
      })}

      <div class="grid">
        ${panel({
          span: 4,
          code: "RSK-01",
          title: "Kill switch",
          sub: "Declared by the risk engine",
          variant: "accent",
          body: killSwitch(ctx, risk, src),
          cls: "lg-span-12",
        })}
        ${panel({
          span: 8,
          code: "RSK-02",
          title: "Risk posture",
          sub: risk ? "Declared limits, breaches and cross-checks" : sourceReason(src),
          body: posture(ctx, risk, src),
          cls: "lg-span-12",
        })}
      </div>

      <div class="grid">
        ${SECTIONS.map(([key, code, title, sub]) =>
          panel({
            span: 4,
            code,
            title,
            sub: risk ? `${fmtCount(risk[key].length)} declared` : "risk.json",
            foot: sub,
            body: limitSection(ctx, risk, key, title),
            // At narrow widths: two side by side, the third spanning the row (no orphan beside a void).
            cls: key === "execution_limits" ? "" : "md-span-6",
          }),
        )}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "RSK-06",
          title: "Breaches",
          sub: "Recorded by the risk engine, newest first",
          body: breaches(ctx, risk),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "RSK-07",
          title: "Per-agent risk limits",
          sub: "Declared by each agent in agents.json",
          actions: sourceTag(source(ctx, "agents"), { now: ctx.now }),
          body: agentLimits(ctx),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "RSK-08",
          title: "Risk doctrine",
          sub: "How risk state is displayed",
          body: doctrine([
            ["NO DEFAULT LIMITS", "A limit appears only when a producer declares it; absent limits are shown absent."],
            ["STATES AS DECLARED", "OK, WARN, BREACH and UNKNOWN are the producer's verdicts; warnings are never recoloured."],
            ["KILL SWITCH IS EXPLICIT", "ARMED, TRIPPED or NOT CONFIGURED is displayed only from risk.json — never inferred."],
          ]),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "RSK-09",
          title: "Provenance",
          sub: "Where these values come from",
          body: provenance(ctx, ["risk", "agents"]),
        })}
      </div>
    </div>`;
  },
};

