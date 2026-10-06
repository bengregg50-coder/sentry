// Experiments — every trial as an experiment: what was tested, on which data
// and window, how it ended, and the reported gross / cost / net with their
// evidence basis and cost multiplier. ?kind= filters the register.
// Running trials are highlighted; LOST evidence is shown as LOST.
// Counts are per record origin and never merged.

import { html } from "../core/html.js";
import { fmtCount, fmtDate, fmtDateTime, humanize } from "../core/format.js";
import { derived, sourceReason } from "../core/state.js";
import { pageHeader, panel, badge, dot, chip, stat, statRow, sourceTag, emptyState, tabs } from "../components/ui.js";
import { toneClass } from "../core/tones.js";
import * as R from "./_research-a-common.js";

const PATH = "/research/experiments";

/* ---------------------------------------------------------------- summary */

function summaryBody(ctx, rs, src) {
  const trials = rs?.trials ?? null;
  const ta = derived(ctx, "trial_accounting");
  const d = ta?.available ? ta.declared : null;
  const off = R.offLabel(src);
  const nc = rs ? "NOT DECLARED" : off;
  const pick = (fn) => (trials ? R.splitByOrigin(trials.filter(fn)) : null);
  return statRow(
    [
      stat({ label: "Trial records", value: R.splitVal(R.splitByOrigin(trials)), hint: "Present in research.json", emptyLabel: off }),
      stat({ label: "Running", value: R.splitVal(pick((t) => t.outcome === "RUNNING")), hint: "Outcome RUNNING", emptyLabel: off }),
      stat({ label: "Evidence lost", value: R.splitVal(pick((t) => t.evidence_state === "LOST")), hint: "Evidence state LOST", emptyLabel: off }),
      stat({ label: "With metrics", value: R.splitVal(pick((t) => t.metrics.length > 0)), hint: "At least one reported metric", emptyLabel: off }),
      stat({ label: "Reconstructed baseline", value: R.count(d?.reconstructed_baseline), hint: "Declared by the ledger", emptyLabel: nc }),
      stat({ label: "Live-recorded", value: R.count(d?.live_recorded), hint: "Declared by the ledger", emptyLabel: nc }),
    ],
    { min: 140 },
  );
}

function matrixBody(rs, keys, keyFn, { caption, hrefFor, labelWidth }) {
  const trials = rs?.trials ?? null;
  const m = R.countMatrix(trials, keyFn);
  return R.originMatrix(
    keys.map((k) => ({ key: k, href: hrefFor ? hrefFor(k) : null, counts: m?.[k] })),
    { origins: R.originColumns(trials), available: !!rs, caption, labelWidth },
  );
}

/* ---------------------------------------------------------------- register */

function outcomeCell(t) {
  const running = t.outcome === "RUNNING";
  return html`<div class="rsa-stack-cell">
    <span class="cluster">${running ? dot(t.outcome, { pulse: true }) : ""}${badge(t.outcome)}</span>
    ${t.rejection_reason ? html`<span class="rsa-sub">${t.rejection_reason}</span>` : ""}
  </div>`;
}

function evidenceCell(t) {
  return html`<div class="rsa-stack-cell">
    <span class="cluster">${badge(t.evidence_state, { label: t.evidence_state === "LOST" ? "EVIDENCE LOST" : undefined })}${t.origin === "ORIGINAL" ? "" : R.originCell(t.origin)}</span>
    ${t.oos_state || t.validation_state
      ? html`<span class="cluster">${t.oos_state ? badge(t.oos_state, { label: "OOS · " + humanize(t.oos_state), ghost: true }) : ""}${
          t.validation_state ? badge(t.validation_state, { label: "VAL · " + humanize(t.validation_state), ghost: true }) : ""
        }</span>`
      : ""}
    ${t.evidence_refs?.length ? html`<span class="rsa-refs rsa-refs--col">${t.evidence_refs.map((r) => R.pathRef(r))}</span>` : ""}
    ${t.origin === "ORIGINAL" ? html`<span class="rsa-orig">ORIGINAL RECORD</span>` : ""}
  </div>`;
}

function registerBody(rs, src, kindFilter, rowsQ) {
  const all = rs ? [...rs.trials].sort(R.byTrialNumber) : null;
  const byKind = all ? R.groupBy(all, (t) => t.kind) : null;
  const rows = all ? (kindFilter === "ALL" ? all : all.filter((t) => t.kind === kindFilter)) : null;
  const running = rows ? rows.filter((t) => t.outcome === "RUNNING") : [];
  // Only a page of rows is materialised (a ledger of thousands of trials would freeze the page);
  // every count on this page is taken from the full arrays, never from the page.
  const page = R.pageRows(rows, rowsQ);
  const kindQ = kindFilter === "ALL" ? null : kindFilter;
  // Tabs: every kind when nothing is connected (structure); otherwise kinds with records plus the active filter.
  const kinds = all ? R.TRIAL_KINDS.filter((k) => byKind.has(k) || k === kindFilter) : R.TRIAL_KINDS;
  const tabItems = [
    // No numeric counts on tabs: they would merge record origins. Per-origin counts are in EXP-03.
    { key: "ALL", label: "All", href: R.qhref(PATH) },
    ...kinds.map((k) => ({ key: k, label: humanize(k), href: R.qhref(PATH, { kind: k }) })),
  ];
  const columns = [
    { key: "trial_number", label: "#", num: true, render: (t) => R.trialNumber(t.trial_number) },
    {
      key: "trial_id",
      label: "Trial · experiment",
      cls: "wrap",
      render: (t) => html`<div class="rsa-stack-cell">
        ${R.ref(t.trial_id, R.trialHref(t.trial_id), html`data-trial="${t.trial_id}"`)}
        <span class="rsa-title">${t.experiment ?? html`<span class="rsa-none">No experiment label</span>`}</span>
        <span class="rsa-kind">${chip(humanize(t.kind))}<span class="rsa-sub">STAGE ${humanize(t.stage)}</span></span>
      </div>`,
    },
    { key: "outcome", label: "Outcome", cls: "rsa-col-outcome", render: outcomeCell },
    {
      key: "hypothesis_id",
      label: "Hypothesis · programme",
      render: (t) =>
        t.hypothesis_id || t.programme_id
          ? html`<div class="rsa-stack-cell">${t.hypothesis_id ? R.ref(t.hypothesis_id, R.hypHref(t.hypothesis_id)) : html`<span class="rsa-sub">no hypothesis</span>`}${
              t.programme_id ? R.ref(t.programme_id, R.programmeHref(t.programme_id)) : html`<span class="rsa-sub">no programme</span>`
            }</div>`
          : null,
    },
    {
      key: "data",
      label: "Data · window",
      render: (t) =>
        t.data_used?.length || t.window_start || t.window_end
          ? html`<div class="rsa-stack-cell">${t.data_used?.length ? html`<span class="rsa-chips">${t.data_used.map((d) => chip(d))}</span>` : html`<span class="rsa-sub">no data declared</span>`}${R.windowVal(t.window_start, t.window_end)}</div>`
          : null,
    },
    { key: "evidence_state", label: "Evidence · origin", render: evidenceCell },
    {
      key: "recorded_at",
      label: "Recorded",
      render: (t) => html`<div class="rsa-stack-cell rsa-nowrap">${R.dateTimeVal(t.recorded_at)}${t.started_at ? html`<span class="rsa-sub mono">STARTED ${fmtDate(t.started_at)}</span>` : ""}</div>`,
    },
    { key: "metrics", label: "Gross · cost · net", render: (t) => R.metricsCell(t.metrics) },
  ];
  return html`<div class="rsa-tabs">${tabs(tabItems, kindFilter)}</div>
    ${running.length
      ? html`<div class="rsa-running" data-running="${String(running.length)}">
          <span class="rsa-running__k">${dot("RUNNING", { pulse: true })}RUNNING NOW</span>
          ${running.map(
            (t) => html`<span class="rsa-running__item">${R.ref(t.trial_id, R.trialHref(t.trial_id))}<span>${t.experiment ?? ""}</span>${
              t.hypothesis_id ? html`<span class="muted">·</span>${R.ref(t.hypothesis_id, R.hypHref(t.hypothesis_id))}` : ""
            }${t.started_at ? html`<span class="muted mono">since ${fmtDateTime(t.started_at)}</span>` : ""}</span>`,
          )}
        </div>`
      : ""}
    ${R.frameTable({
      columns,
      rows: page.shown,
      rowHref: (t) => R.trialHref(t.trial_id),
      rowCls: (t) =>
        t.outcome === "RUNNING"
          ? `rsa-row--running ${toneClass(t.outcome)}`
          : t.evidence_state === "LOST"
            ? `rsa-row--lost ${toneClass(t.evidence_state)}`
            : "",
      empty: rs
        ? emptyState({
            title: kindFilter === "ALL" ? "No trials recorded" : `No ${humanize(kindFilter)} trials`,
            reason: kindFilter === "ALL" ? "research.json is connected but lists no trial records." : "No trial record in research.json has this kind.",
            compact: true,
          })
        : R.srcEmpty(src, "Experiment ledger", {
            compact: true,
            hint: "Each trial appears with its experiment, data, window, outcome, evidence state and gross / cost / net metrics with basis.",
          }),
    })}
    ${R.pager(page, (n) => R.qhref(PATH, { kind: kindQ, rows: n }), { hint: kindQ ? "" : "select a kind above to narrow the register" })}`;
}

/* ---------------------------------------------------------------- view */

export default {
  title: "Experiments",
  render(ctx) {
    const { rs, src } = R.research(ctx);
    const kindFilter = ctx.query.kind || "ALL";
    const kindRows = rs ? rs.trials.filter((t) => kindFilter === "ALL" || t.kind === kindFilter) : null;
    const paged = R.pageRows(kindRows, ctx.query.rows);
    return html`
      ${pageHeader({
        kicker: "RESEARCH ENGINE",
        code: "EXP",
        title: "Experiments",
        sub: "Every trial run against a hypothesis — each one counts toward multiple-testing. Gross, cost and net are reported separately with their evidence basis; lost evidence is shown as lost.",
        right: sourceTag(src, { now: ctx.now }),
      })}

      <div class="grid">
        ${panel({ span: 12, code: "EXP-01", title: "Trial ledger", sub: rs ? "Records by origin · declared ledger counts shown separately" : sourceReason(src), body: summaryBody(ctx, rs, src), cls: "rsa-wraplabels" })}
      </div>

      <div class="grid">
        ${panel({
          span: 4,
          code: "EXP-02",
          title: "By outcome",
          sub: "Records per outcome, per origin",
          body: matrixBody(rs, R.TRIAL_OUTCOMES, (t) => t.outcome, { caption: "OUTCOME", labelWidth: 108 }),
          cls: "xl-span-6",
        })}
        ${panel({
          span: 5,
          code: "EXP-03",
          title: "By kind",
          sub: "Select a kind to filter the register",
          body: matrixBody(rs, R.TRIAL_KINDS, (t) => t.kind, { caption: "KIND", hrefFor: (k) => R.qhref(PATH, { kind: k }), labelWidth: 150 }),
          cls: "xl-span-6",
        })}
        ${panel({
          span: 3,
          code: "EXP-04",
          title: "Evidence state",
          sub: "Per record origin",
          body: matrixBody(rs, R.EVIDENCE_STATES, (t) => t.evidence_state, { caption: "STATE", labelWidth: 100 }),
          cls: "xl-span-12",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "EXP-05",
          title: "Experiment register",
          sub: rs
            ? `${R.splitText(kindRows, "trial records")}${kindFilter === "ALL" ? "" : " · " + humanize(kindFilter)}${
                paged.hidden.length ? ` · rows 1–${fmtCount(paged.shown.length)} shown` : ""
              } · select a row for its history`
            : sourceReason(src),
          body: registerBody(rs, src, kindFilter, ctx.query.rows),
          cls: "rsa-register",
        })}
      </div>
    `;
  },
};

