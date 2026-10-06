// Robustness — does a result survive perturbation, stressed costs, neighbouring
// parameters, other regimes and resampling? Shows the robustness battery
// (trials of kinds ROBUSTNESS / COST_SENSITIVITY / PARAMETER_STABILITY /
// REGIME / MONTE_CARLO), the matching validation checks across strategies'
// current versions, reported cost-stress figures, and declared regime results.
// ?kind= filters the trial register.

import { html } from "../core/html.js";
import { humanize, fmtDate } from "../core/format.js";
import { pageHeader, panel, badge, sourceTag, emptyState, tabs, legend, val, originBadge } from "../components/ui.js";
import * as B from "./_research-b-common.js";

const PATH = "/research/robustness";

/** Trial kind -> matching validation check, with what it asks. Architecture labels. */
const BATTERY = [
  { kind: "ROBUSTNESS", check: "robustness", title: "Perturbation", ask: "Does the result survive small changes to data, rules and sampling?" },
  { kind: "COST_SENSITIVITY", check: "cost_sensitivity", title: "Cost stress", ask: "Does the edge survive realistic and pessimistic cost multipliers?" },
  { kind: "PARAMETER_STABILITY", check: "parameter_stability", title: "Neighbourhood", ask: "Is the optimum a plateau, or a knife-edge that will not survive?" },
  { kind: "REGIME", check: "regime_analysis", title: "Regimes", ask: "Where does it work, where does it fail, and is that understood?" },
  { kind: "MONTE_CARLO", check: "monte_carlo", title: "Resampling", ask: "What is the distribution of outcomes under resampled paths?" },
];
const KINDS = BATTERY.map((b) => b.kind);
const MATRIX_CHECKS = ["robustness", "parameter_stability", "regime_analysis", "cost_sensitivity", "monte_carlo"];
/** Cost-sensitivity trials listed in ROB-03 before the rest are summarised (all are in ROB-05). */
const CS_ROWS = 12;

/* ---------------------------------------------------------------- battery tiles */

function latest(rows) {
  const ts = rows.map((t) => t.recorded_at ?? t.started_at).filter(Boolean).sort();
  return ts.length ? ts[ts.length - 1] : null;
}

function batteryTile(b, rows, cv, kindFilter, rsrc, ssrc) {
  const connected = !!rows;
  const outs = connected ? B.TRIAL_OUTCOMES.filter((o) => rows.some((t) => t.outcome === o)) : [];
  const checkLabel = B.CHECK_BY_KEY[b.check].label;
  return html`<a class="rsb-bat ${kindFilter === b.kind ? "is-active" : ""}" href="${B.qhref(PATH, { kind: b.kind })}" data-kind="${b.kind}">
    <div class="rsb-bat__head"><span class="rsb-bat__title">${b.title}</span><span class="rsb-bat__kind">${humanize(b.kind)}</span></div>
    <div class="rsb-bat__ask">${b.ask}</div>
    <div class="rsb-bat__n">${connected ? B.splitVal(B.originSplit(rows)) : val(null)}<span class="rsb-bat__unit">${connected ? "TRIAL RECORDS" : B.offLabel(rsrc)}</span></div>
    <div class="rsb-bat__outs">${
      !connected
        ? html`<span class="rsb-faint">NO OUTCOMES SHOWN · ${B.srcLine(rsrc)}</span>`
        : outs.length
          ? outs.map((o) => html`<span class="rsb-bat__out">${badge(o)}${B.splitVal(B.originSplit(rows.filter((t) => t.outcome === o)))}</span>`)
          : html`<span class="rsb-faint">NONE RECORDED</span>`
    }</div>
    <div class="rsb-bat__foot">
      <span>LAST ${val(connected && latest(rows) ? fmtDate(latest(rows)) : null)}</span>
      <span class="rsb-bat__rep" data-check-reported="${b.check}" title="Strategies whose current version reports the ${checkLabel} check, in any state — not a pass count, counted per strategy origin. The split below gives each reported state.">REPORTED ${
        cv ? B.reportedVal(cv, b.check) : val(null)
      }</span>
    </div>
    <div class="rsb-bat__checks" data-check-split="${b.check}" title="${checkLabel} check as reported by strategies' current versions">${
      cv ? B.checkSplitView(cv, b.check, { none: "CHECK NOT REPORTED" }) : html`<span class="rsb-faint">CHECKS NOT SHOWN · ${B.srcLine(ssrc)}</span>`
    }</div>
  </a>`;
}

/* ---------------------------------------------------------------- check matrix */

function checkMatrix(st, ssrc, cv) {
  const columns = [
    {
      label: "Strategy · current version",
      render: ({ s, v }) => html`<div class="rsb-stack">
        <span class="cluster">${B.refLink(s.strategy_id, B.strategyHref(s.strategy_id))}<span class="mono small">v${v.version}</span>${badge(s.status)}</span>
        <span class="rsb-sub">${s.name}</span>
        ${originBadge(s.origin)}
      </div>`,
      cls: "rsb-mx__lead",
    },
    ...MATRIX_CHECKS.map((k) => ({ label: B.CHECK_BY_KEY[k].short, title: B.CHECK_BY_KEY[k].label + " — " + B.CHECK_BY_KEY[k].desc, render: ({ v }) => B.checkCell(v.validation[k], k), cls: "rsb-mx__cell", hcls: "rsb-mx__h" })),
  ];
  const empty = !st
    ? B.srcEmpty(ssrc, { compact: true, hint: "Each strategy's current version will appear as a row with its robustness, parameter-stability, regime, cost-sensitivity and Monte Carlo checks." })
    : emptyState({ title: "No strategies registered", reason: "strategies.json is connected and lists no strategies, so there are no strategy-level robustness checks to show.", compact: true });
  return html`${B.regTable({ columns, rows: cv, empty, cls: "rsb-mx", rowAttrs: ({ s, v }) => html`data-strategy="${s.strategy_id}" data-version="${String(v.version)}"` })}
    ${cv && cv.length ? html`<div class="rsb-legendrow">${legend([
      ["Pass", "ok"],
      ["Fail", "bad"],
      ["Pending / inconclusive / blocked", "warn"],
      ["Not run / not applicable", "muted"],
    ])}<span class="rsb-faint">DASHED = NOT REPORTED BY THE RESEARCH ENGINE</span></div>` : ""}`;
}

/* ---------------------------------------------------------------- cost stress */

function costStress(rs, rsrc, st, ssrc, cv) {
  const stratRows = cv
    ? cv
        .map(({ s, v }) => ({
          s,
          v,
          list: B.versionMetrics(v).filter((m) => m.metric.cost_multiplier != null || m.metric.component === "COST" || m.metric.component === "NET"),
        }))
        .filter((r) => r.list.length)
    : null;
  const trialRows = rs ? rs.trials.filter((t) => t.kind === "COST_SENSITIVITY").sort(B.byTrialNumber) : null;
  const shownTrials = trialRows ? trialRows.slice(0, CS_ROWS) : null;
  const restTrials = trialRows ? trialRows.slice(CS_ROWS) : [];
  const stratBody = !st
    ? B.srcEmpty(ssrc, { compact: true })
    : stratRows.length
      ? html`<div class="rsb-cs">${stratRows.map(
          (r) => html`<div class="rsb-cs__row" data-strategy="${r.s.strategy_id}">
            <div class="rsb-cs__id">${B.refLink(r.s.strategy_id, B.strategyHref(r.s.strategy_id))}<span class="mono small muted">v${r.v.version}</span></div>
            ${B.namedMetrics(r.list)}
          </div>`,
        )}</div>`
      : emptyState({ title: "None reported", reason: "No current strategy version reports a COST / NET component or a cost multiplier.", compact: true });
  const trialBody = !rs
    ? B.srcEmpty(rsrc, { compact: true })
    : trialRows.length
      ? html`<div class="rsb-cs">${shownTrials.map(
          (t) => html`<div class="rsb-cs__row" data-trial="${t.trial_id}">
            <div class="rsb-cs__id">${B.refLink(t.trial_id, B.trialHref(t.trial_id))}${badge(t.outcome)}${t.origin !== "ORIGINAL" ? B.originCell(t.origin) : ""}</div>
            ${t.metrics.length ? B.namedMetrics(t.metrics) : html`<span class="rsb-faint">NO METRICS REPORTED${t.evidence_state === "LOST" ? " · EVIDENCE LOST" : ""}</span>`}
          </div>`,
        )}</div>${
          restTrials.length
            ? html`<p class="rsb-note" data-cs-hidden="${String(restTrials.length)}">First ${B.count(CS_ROWS)} in ledger order. Not shown here: ${B.splitText(B.originSplit(restTrials), "trials")} — <a href="${B.qhref(PATH, { kind: "COST_SENSITIVITY" })}">all cost-sensitivity trials in ROB-05</a>.</p>`
            : ""
        }`
      : emptyState({ title: "No cost-sensitivity trials", reason: "The ledger records no trial of kind COST_SENSITIVITY.", compact: true });
  return html`${B.label("Strategy registry", "current versions")}<div class="rsb-sec">${stratBody}</div>
    <div class="rsb-gap">${B.label("Cost-sensitivity trials", "ledger order")}</div><div class="rsb-sec">${trialBody}</div>
    <p class="rsb-note">Figures exactly as reported, each with its basis and the cost multiplier declared by the producer. Nothing is re-costed here.</p>`;
}

/* ---------------------------------------------------------------- regimes */

function regimes(st, ssrc, cv) {
  const rows = cv ? cv.flatMap(({ s, v }) => (v.regimes ?? []).map((r) => ({ s, v, r }))) : null;
  const columns = [
    { label: "Strategy", render: ({ s, v }) => html`<span class="cluster">${B.refLink(s.strategy_id, B.strategyHref(s.strategy_id))}<span class="mono small muted">v${v.version}</span></span>` },
    { label: "Regime", render: ({ r }) => html`<span class="strong">${r.regime}</span>` },
    { label: "Window", render: ({ r }) => (r.window ? html`<div class="rsb-stack">${B.windowCell(r.window.start, r.window.end)}${r.window.label ? html`<span class="rsb-sub">${r.window.label}</span>` : ""}</div>` : null) },
    { label: "State", render: ({ r }) => B.stateCell(r.state) },
    { label: "Metrics", render: ({ r }) => B.namedMetrics(r.metrics) },
    { label: "Regime check", render: ({ v }) => B.checkCell(v.validation.regime_analysis, "regime_analysis"), cls: "rsb-mx__cell" },
  ];
  const empty = !st
    ? B.srcEmpty(ssrc, { compact: true, hint: "Per-regime results declared on each strategy version (version.regimes) will be listed here with window, state and metrics." })
    : emptyState({
        title: "No regime results reported",
        reason: cv.length
          ? `None of the current versions of ${B.splitText(B.originSplit(cv.map(({ s }) => s)), "strategies")} declares per-regime results (version.regimes).`
          : "strategies.json is connected and lists no strategies, so no version declares per-regime results.",
        hint: "A regime_analysis check can be reported without a per-regime breakdown; the check column of ROB-02 shows it.",
        compact: true,
      });
  return B.regTable({ columns, rows, empty, rowAttrs: ({ s, r }) => html`data-strategy="${s.strategy_id}" data-regime="${r.regime}"` });
}

/* ---------------------------------------------------------------- register */

function register(rs, rsrc, kindFilter, query) {
  const all = B.trialsOfKinds(rs, KINDS);
  const rows = all ? (kindFilter === "ALL" ? all : all.filter((t) => t.kind === kindFilter)) : null;
  const hypById = new Map((rs?.hypotheses ?? []).map((h) => [h.hypothesis_id, h]));
  const columns = [
    { label: "Trial", render: (t) => B.trialCell(t), cls: "rsb-nowrap" },
    { label: "Experiment · hypothesis", render: (t) => B.experimentCell(t, hypById), cls: "rsb-w-exp" },
    { label: "Outcome", render: (t) => B.outcomeCell(t), cls: "rsb-w-out" },
    { label: "Window · data", render: (t) => html`<div class="rsb-stack">${B.windowStack(t.window_start, t.window_end)}${B.chipList(t.data_used)}</div>` },
    { label: "Gross", render: (t) => B.componentCell(t.metrics, "GROSS"), cls: "rsb-nowrap rsb-cmp" },
    { label: "Cost", render: (t) => B.componentCell(t.metrics, "COST"), cls: "rsb-nowrap rsb-cmp", title: "COST-component metrics with the declared cost multiplier" },
    { label: "Net", render: (t) => B.componentCell(t.metrics, "NET"), cls: "rsb-nowrap rsb-cmp" },
    ...((rows ?? []).some((t) => t.metrics.some((m) => !m.metric.component)) ? [{ label: "Other metrics", render: (t) => B.otherMetricsCell(t.metrics), cls: "rsb-nowrap" }] : []),
    { label: "Evidence · origin", render: (t) => B.evidenceOriginCell(t) },
  ];
  let empty;
  if (!rs) empty = B.srcEmpty(rsrc, { hint: "Every robustness, cost-sensitivity, parameter-stability, regime and Monte Carlo trial will be listed here with gross, cost and net and its cost multiplier." });
  else if (kindFilter !== "ALL") empty = emptyState({ title: `No ${humanize(kindFilter).toLowerCase()} trials recorded`, reason: `The ledger records no trial of kind ${kindFilter}.`, compact: true });
  else empty = emptyState({ title: "No robustness trials recorded", reason: "The ledger records no trial of any robustness kind.", compact: true });
  const tabItems = [{ key: "ALL", label: "All kinds", href: B.qhref(PATH) }, ...KINDS.map((k) => ({ key: k, label: humanize(k), href: B.qhref(PATH, { kind: k }) }))];
  // Only a page of rows is materialised; every count on this page comes from the full arrays.
  const page = B.pageRows(rows, query.rows, { from: query.from });
  return html`${tabs(tabItems, kindFilter)}${B.regTable({
    columns,
    rows: page.shown,
    empty,
    rowAttrs: (t) => html`data-trial="${t.trial_id}" data-kind="${t.kind}"`,
    rowCls: (t) => (t.outcome === "RUNNING" ? "rsb-row--running" : ""),
  })}${B.pager(page, (q) => B.withQuery(PATH, query, q), { noun: "trials", hint: kindFilter === "ALL" ? "select a kind above to narrow the register" : "" })}`;
}

/* ---------------------------------------------------------------- view */

export default {
  title: "Robustness",
  render(ctx) {
    const { rs, rsrc, st, ssrc } = B.sources(ctx);
    const cv = B.currentVersions(st);
    const kindFilter = KINDS.includes(ctx.query.kind) ? ctx.query.kind : "ALL";
    const all = B.trialsOfKinds(rs, KINDS);
    return html`
      ${pageHeader({
        kicker: "RESEARCH ENGINE",
        code: "ROB",
        title: "Robustness",
        sub: "Whether a result survives perturbation, stressed costs, neighbouring parameters, other regimes and resampling — trial by trial, and as reported on each strategy's current version.",
        right: html`${sourceTag(rsrc, { now: ctx.now })}${sourceTag(ssrc, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({
          span: 12,
          code: "ROB-01",
          title: "Robustness battery",
          sub: all ? `${B.splitText(B.originSplit(all), "trial records")} across the five robustness kinds · select a kind to filter ROB-05` : B.srcPhrase(rsrc),
          variant: "hero",
          body: html`
            <div class="rsb-doctrine-line" data-doctrine="robustness"><span class="rsb-doctrine-line__k">DOCTRINE</span>A result that holds at one parameter setting, in one regime, or at zero cost is not an edge.</div>
            <div class="rsb-batswrap"><div class="rsb-bats">${BATTERY.map((b) => batteryTile(b, all ? all.filter((t) => t.kind === b.kind) : null, cv, kindFilter, rsrc, ssrc))}</div></div>
            <div class="rsb-gap">${B.gateChain("ROBUSTNESS")}</div>`,
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 7,
          code: "ROB-02",
          title: "Robustness check matrix",
          sub: cv ? `${B.splitText(B.originSplit(cv.map(({ s }) => s)), "strategies")} · current versions · as reported by the research engine` : B.srcPhrase(ssrc),
          cls: "xl-span-12",
          body: checkMatrix(st, ssrc, cv),
        })}
        ${panel({
          span: 5,
          code: "ROB-03",
          title: "Cost stress",
          sub: "Net and cost at declared cost multipliers",
          cls: "xl-span-12",
          body: costStress(rs, rsrc, st, ssrc, cv),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "ROB-04",
          title: "Regime results",
          sub: st ? "Declared per-regime results on strategies' current versions" : B.srcPhrase(ssrc),
          body: regimes(st, ssrc, cv),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "ROB-05",
          title: "Robustness trial register",
          sub: all ? `${kindFilter === "ALL" ? "All robustness kinds" : humanize(kindFilter)} · ledger order` : B.srcPhrase(rsrc),
          body: register(rs, rsrc, kindFilter, ctx.query),
        })}
      </div>
    `;
  },
};
