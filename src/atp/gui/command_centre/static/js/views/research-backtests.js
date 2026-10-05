// Backtests — every trial of kind BACKTEST with gross / cost / net reported
// separately (basis chip and cost multiplier always visible), its outcome,
// hypothesis, window, data and origin. Doctrine first: an in-sample backtest
// is not validation. In-sample figures in the strategy registry are listed so
// they can never be mistaken for validation evidence.

import { html } from "../core/html.js";
import { humanize, fmtCount } from "../core/format.js";
import { derived } from "../core/state.js";
import { pageHeader, panel, badge, stat, statRow, sourceTag, sourceEmpty, emptyState, metric, findingsList } from "../components/ui.js";
import * as B from "./_research-b-common.js";

const KINDS = ["BACKTEST"];

/* ---------------------------------------------------------------- summary */

function summary(rs, trials) {
  const pick = (fn) => (trials ? B.originSplit(trials.filter(fn)) : null);
  const nc = "NOT CONNECTED";
  return statRow(
    [
      stat({ label: "Records", value: B.splitVal(B.originSplit(trials)), hint: "Kind BACKTEST", emptyLabel: nc }),
      stat({ label: "Pass", value: B.splitVal(pick((t) => t.outcome === "PASS")), hint: "Further testing only", emptyLabel: nc }),
      stat({ label: "Fail", value: B.splitVal(pick((t) => t.outcome === "FAIL")), hint: "Kept as evidence", emptyLabel: nc }),
      stat({ label: "Inconclusive", value: B.splitVal(pick((t) => t.outcome === "INCONCLUSIVE")), hint: "Neither pass nor fail", emptyLabel: nc }),
      stat({ label: "Running", value: B.splitVal(pick((t) => t.outcome === "RUNNING")), hint: "No outcome yet", emptyLabel: nc }),
      stat({ label: "Evidence lost", value: B.splitVal(pick((t) => t.evidence_state === "LOST")), hint: "Original lost", emptyLabel: nc }),
      stat({ label: "Net reported", value: B.splitVal(pick((t) => t.metrics.some((m) => m.metric.component === "NET"))), hint: "With a NET metric", emptyLabel: nc }),
      stat({ label: "Cost reported", value: B.splitVal(pick((t) => t.metrics.some((m) => m.metric.component === "COST"))), hint: "With a COST metric", emptyLabel: nc }),
    ],
    { min: 118 },
  );
}

/* ---------------------------------------------------------------- register */

function register(rs, rsrc, trials) {
  const hypById = new Map((rs?.hypotheses ?? []).map((h) => [h.hypothesis_id, h]));
  const hasOther = (trials ?? []).some((t) => t.metrics.some((m) => !m.metric.component));
  const columns = [
    { label: "Trial", render: (t) => B.trialCell(t, { kind: false }), cls: "rsb-nowrap" },
    { label: "Experiment · hypothesis", render: (t) => B.experimentCell(t, hypById), cls: "rsb-w-exp" },
    { label: "Outcome", render: (t) => B.outcomeCell(t), cls: "rsb-w-out" },
    { label: "Window · data", render: (t) => html`<div class="rsb-stack">${B.windowStack(t.window_start, t.window_end)}${B.chipList(t.data_used)}</div>` },
    { label: "Gross", render: (t) => B.componentCell(t.metrics, "GROSS"), cls: "rsb-nowrap rsb-cmp", title: "GROSS-component metrics as reported, with basis" },
    { label: "Cost", render: (t) => B.componentCell(t.metrics, "COST"), cls: "rsb-nowrap rsb-cmp", title: "COST-component metrics with the cost multiplier used" },
    { label: "Net", render: (t) => B.componentCell(t.metrics, "NET"), cls: "rsb-nowrap rsb-cmp", title: "NET-component metrics; several rows when reported at several cost multipliers" },
    ...(hasOther ? [{ label: "Other metrics", render: (t) => B.otherMetricsCell(t.metrics), cls: "rsb-nowrap" }] : []),
    { label: "Evidence · origin", render: (t) => B.evidenceOriginCell(t) },
  ];
  let empty;
  if (!rs) empty = sourceEmpty(rsrc, { title: "Backtest register not connected", hint: "Each backtest trial will appear here with gross, cost and net reported separately, its basis and cost multiplier, outcome, window, data and origin." });
  else empty = emptyState({ title: "No backtests recorded", reason: "research.json is connected and contains no trial of kind BACKTEST.", hint: "A backtest appears here once the research ledger records it — passed, failed or running.", compact: true });
  return B.regTable({
    columns,
    rows: trials,
    empty,
    rowAttrs: (t) => html`data-trial="${t.trial_id}" data-outcome="${t.outcome}"`,
    rowCls: (t) => (t.outcome === "RUNNING" ? "rsb-row--running" : ""),
  });
}

function registerFoot(rs) {
  if (!rs) return "";
  const elsewhere = rs.trials.filter((t) => t.stage === "BACKTEST" && t.kind !== "BACKTEST");
  if (!elsewhere.length) return html`Gross, cost and net are shown exactly as reported; nothing is netted or recomputed here.`;
  return html`Gross, cost and net are shown exactly as reported. ${B.splitText(B.originSplit(elsewhere), "other trial record(s)")} at stage BACKTEST carry a different kind (${[
    ...new Set(elsewhere.map((t) => humanize(t.kind))),
  ].join(", ")}) — listed in <a href="#/research/history">Research History</a>.`;
}

/* ---------------------------------------------------------------- in-sample figures in the registry */

function inSampleFigures(ctx, st, ssrc) {
  const cv = B.currentVersions(st);
  const columns = [
    { label: "Strategy", render: (r) => html`<div class="rsb-stack">${B.refLink(r.s.strategy_id, B.strategyHref(r.s.strategy_id))}<span class="rsb-sub">${r.s.name}</span></div>` },
    { label: "Version", render: (r) => html`<span class="mono">v${r.v.version}</span>`, cls: "rsb-nowrap" },
    { label: "Validation status", render: (r) => badge(r.v.validation_status) },
    { label: "Figure", render: (r) => html`<span class="text-2">${r.m.label}</span>` },
    { label: "Reported value", render: (r) => metric(r.m.metric), cls: "rsb-nowrap" },
    { label: "Origin", render: (r) => B.originCell(r.s.origin) },
  ];
  const rows = cv
    ? cv.flatMap(({ s, v }) =>
        B.versionMetrics(v)
          .filter((m) => m.metric.basis === "IN_SAMPLE")
          .map((m) => ({ s, v, m })),
      )
    : null;
  const empty = !st
    ? sourceEmpty(ssrc, { title: "Strategy registry not connected", compact: true, hint: "Any current-version metric reported on an IN_SAMPLE basis will be listed here." })
    : emptyState({ title: "No in-sample figures", reason: `No current strategy version reports a metric on an IN_SAMPLE basis (${fmtCount(st.strategies.length)} strategies checked).`, compact: true, iconName: "shield" });
  const findings = (derived(ctx, "consistency") ?? []).filter((f) => f.code === "HEADLINE_METRIC_IN_SAMPLE");
  return html`
    ${B.regTable({ columns, rows, empty, rowAttrs: (r) => html`data-strategy="${r.s.strategy_id}"` })}
    ${findings.length ? html`<div class="rsb-gap">${findingsList(findings)}</div>` : ""}
  `;
}

/* ---------------------------------------------------------------- cost multipliers */

function costMultipliers(rs, rsrc, trials) {
  if (!rs) return sourceEmpty(rsrc, { compact: true, title: "Not connected", hint: "Cost multipliers declared on backtest COST / NET metrics will be grouped here." });
  const withCost = trials.filter((t) => t.metrics.some((m) => m.metric.component === "COST" || m.metric.component === "NET"));
  if (!withCost.length) {
    return emptyState({ title: "No cost treatment reported", reason: "No backtest record reports a COST or NET component.", compact: true });
  }
  // A trial is grouped under every multiplier its COST / NET metrics declare;
  // only a trial that declares none is listed as NOT DECLARED.
  const groups = new Map();
  for (const t of withCost) {
    const declared = new Set(
      t.metrics.filter((m) => (m.metric.component === "COST" || m.metric.component === "NET") && m.metric.cost_multiplier != null).map((m) => m.metric.cost_multiplier),
    );
    const mults = declared.size ? declared : new Set([null]);
    for (const k of mults) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
  }
  const keys = [...groups.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
  return html`<div class="rsb-mults">
    <div class="rsb-mults__row rsb-mults__row--head"><span>Multiplier</span><span>Trials</span><span>Trial ids</span></div>
    ${keys.map(
      (k) => html`<div class="rsb-mults__row" data-mult="${k === null ? "none" : String(k)}">
        <span class="rsb-mults__k">${k === null ? html`<span class="rsb-faint">NOT DECLARED</span>` : html`<span class="chip">${String(k)}× COST</span>`}</span>
        <span class="rsb-mults__n">${B.splitVal(B.originSplit(groups.get(k)))}</span>
        <span class="rsb-mults__ids">${groups.get(k).map((t) => B.refLink(t.trial_id, B.trialHref(t.trial_id)))}</span>
      </div>`,
    )}
  </div>
  <p class="rsb-note">Grouped by the multiplier each trial declares on its COST / NET metrics. A multiplier above 1× is a cost-stress result; see <a href="#/research/robustness">Robustness</a> for cost-sensitivity trials.</p>`;
}

/* ---------------------------------------------------------------- view */

export default {
  title: "Backtests",
  render(ctx) {
    const { rs, rsrc, st, ssrc } = B.sources(ctx);
    const trials = B.trialsOfKinds(rs, KINDS);
    return html`
      ${pageHeader({
        kicker: "RESEARCH ENGINE",
        code: "BKT",
        title: "Backtests",
        sub: "Historical simulations of preregistered hypotheses. Each one is a counted trial; gross, cost and net are reported separately with their evidence basis and cost multiplier.",
        right: html`${sourceTag(rsrc, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({
          span: 7,
          code: "BKT-01",
          title: "What a backtest establishes",
          variant: "hero",
          cls: "lg-span-12",
          body: B.doctrineHero({
            code: "in-sample",
            statement: "An in-sample backtest is not validation.",
            lead: "A backtest decides only whether a preregistered hypothesis has earned further testing. Credibility is earned later, on evidence the hypothesis has never seen.",
            points: [
              ["COUNTED", "Every backtest is a trial in the ledger and raises the multiple-testing bar for everything after it."],
              ["COSTED", "Gross, cost and net are reported separately, with the cost multiplier that was applied."],
              ["BASIS SHOWN", "Every figure carries its basis chip — IS figures are never presented as OOS evidence."],
              ["KEPT", "Failed backtests stay on record. A failure is evidence, not an embarrassment."],
            ],
            current: "BACKTEST",
          }),
        })}
        ${panel({
          span: 5,
          code: "BKT-02",
          title: "Backtest ledger",
          sub: trials ? B.splitText(B.originSplit(trials), "records") : "research.json not connected",
          cls: "lg-span-12",
          body: html`<div class="rsb-stats4">${summary(rs, trials)}</div>
            <div class="rsb-label rsb-gap">By outcome <span class="rsb-label__extra">per record origin</span></div>
            ${B.outcomeSplits(trials, { href: (o) => B.qhref("/research/history", { outcome: o }) })}`,
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "BKT-03",
          title: "Backtest register",
          sub: trials ? `${B.splitText(B.originSplit(trials), "trials")} · ledger order · select a trial id for its full history` : "Source not connected",
          body: register(rs, rsrc, trials),
          foot: registerFoot(rs),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 7,
          code: "BKT-04",
          title: "In-sample registry figures",
          sub: "strategies.json · current versions · basis IN_SAMPLE — not validation evidence",
          cls: "lg-span-12",
          body: inSampleFigures(ctx, st, ssrc),
        })}
        ${panel({
          span: 5,
          code: "BKT-05",
          title: "Cost multipliers applied",
          sub: "As declared on backtest COST / NET metrics",
          cls: "lg-span-12",
          body: costMultipliers(rs, rsrc, trials ?? []),
        })}
      </div>
    `;
  },
};

