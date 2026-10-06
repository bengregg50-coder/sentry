// Out-of-Sample — evidence on data the hypothesis never saw. Shows the
// governance OOS-separation check, programmes' declared evaluation windows on a
// timeline drawn only from real dates (with OOS / walk-forward trial windows
// beneath them), strategies' out_of_sample / walk_forward checks, and the
// register of OOS and walk-forward trials with their oos_state.

import { html } from "../core/html.js";
import { humanize, fmtCount, fmtDate, fmtDateTime } from "../core/format.js";
import { pageHeader, panel, badge, stat, statRow, sourceTag, sourceEmpty, emptyState, originBadge, val } from "../components/ui.js";
import * as B from "./_research-b-common.js";
import { windowTimeline, mountTimeline, roleLegend, ROLE_LABEL } from "./_research-b-timeline.js";

const KINDS = ["OOS", "WALK_FORWARD"];
const OOS_STATES = ["PASS", "FAIL", "PENDING", "INCONCLUSIVE", "BLOCKED", "NOT_RUN", "NOT_APPLICABLE"];

/* ---------------------------------------------------------------- governance separation */

function separation(gov, gsrc) {
  const doctrine = html`<div class="rsb-hero">
    <div class="rsb-hero__mark"><span>DOCTRINE</span></div>
    <div class="rsb-hero__statement rsb-hero__statement--sm">Out-of-sample data is looked at once.</div>
    <p class="rsb-hero__lead">Evaluation windows are fixed in the frozen specification before any result exists. Data used to develop, select or tune a hypothesis can never be its out-of-sample evidence.</p>
  </div>`;
  let body;
  if (!gov) {
    body = sourceEmpty(gsrc, { compact: true, title: "Governance not connected", hint: "The oos_separation check — holdout data untouched until its declared evaluation — will show here." });
  } else {
    const c = gov.checks.find((x) => x.key === "oos_separation") ?? null;
    const state = c?.state ?? "NOT_REPORTED";
    body = html`<div class="rsb-sep" data-check="oos_separation" data-state="${state}">
      <div class="split"><span class="rsb-sep__k">OOS SEPARATION · GOVERNANCE</span>${badge(state, { size: "lg", label: c ? undefined : "NOT REPORTED" })}</div>
      <div class="rsb-sep__d">${c?.detail ?? "Holdout data untouched until its declared evaluation."}</div>
      <div class="rsb-sep__m">${
        c
          ? html`${c.checked_at ? html`CHECKED ${fmtDateTime(c.checked_at)}` : "NO CHECK TIMESTAMP"}${c.evidence_ref ? html` · <span class="ref">${c.evidence_ref}</span>` : ""}`
          : "NOT REPORTED BY GOVERNANCE"
      }</div>
    </div>`;
  }
  return html`${doctrine}<div class="rsb-gap">${body}</div><div class="rsb-gap">${B.gateChain("OOS")}</div>`;
}

/* ---------------------------------------------------------------- summary */

function summary(rs, trials, cv) {
  const nc = "NOT CONNECTED";
  const pick = (fn) => (trials ? B.originSplit(trials.filter(fn)) : null);
  const progs = rs ? rs.programmes.filter((p) => p.evaluation_windows.length) : null;
  const oosSplit = B.checkStateSplit(cv, "out_of_sample");
  const oosReported = oosSplit ? oosSplit.reduce((a, [, n]) => a + n, 0) : null;
  return html`<div class="rsb-stats4">${statRow(
    [
      stat({ label: "OOS trials", value: B.splitVal(pick((t) => t.kind === "OOS")), hint: "Kind OOS", emptyLabel: nc }),
      stat({ label: "Walk-forward trials", value: B.splitVal(pick((t) => t.kind === "WALK_FORWARD")), hint: "Kind WALK_FORWARD", emptyLabel: nc }),
      stat({ label: "With windows", value: progs ? B.splitVal(B.originSplit(progs)) : null, hint: "Programmes declaring them", emptyLabel: nc }),
      stat({
        label: "OOS checks reported",
        title: "Current strategy versions reporting the out_of_sample check, in any state — not a pass count",
        value: cv ? html`<span data-check-reported="out_of_sample">${val(fmtCount(oosReported))}<span class="unit">/ ${fmtCount(cv.length)}</span></span>` : null,
        hint: html`<span class="rsb-stat-split" data-check-split="out_of_sample">${B.checkSplitBadges(oosSplit, { none: "NONE REPORTED" })}</span>`,
        emptyLabel: nc,
      }),
    ],
    { min: 118 },
  )}</div>
  <div class="rsb-label rsb-gap">OOS state of OOS / walk-forward trials <span class="rsb-label__extra">per record origin</span></div>
  ${B.outcomeSplits(trials, { outcomes: OOS_STATES, field: "oos_state", nullLabel: "Not reported" })}
  <div class="rsb-label rsb-gap">Trial outcome <span class="rsb-label__extra">per record origin · select to open in Research History</span></div>
  ${B.outcomeSplits(trials, { href: (o) => B.qhref("/research/history", { outcome: o }) })}`;
}

/* ---------------------------------------------------------------- windows */

function lanesFor(rs, trials) {
  const progIds = new Set(rs.programmes.map((p) => p.programme_id));
  const lanes = rs.programmes.map((p) => ({
    key: p.programme_id,
    title: p.name,
    status: p.status,
    sub: p.sealed_at ? `SEALED ${fmtDate(p.sealed_at)}` : p.frozen_at ? `SPEC FROZEN ${fmtDate(p.frozen_at)}` : "SPEC NOT FROZEN",
    windows: p.evaluation_windows,
    trials: trials.filter((t) => t.programme_id === p.programme_id),
  }));
  const orphan = B.groupBy(
    trials.filter((t) => !progIds.has(t.programme_id)),
    (t) => t.programme_id ?? "",
  );
  for (const [pid, rows] of orphan) {
    lanes.push({ key: pid || "NO PROGRAMME", title: pid ? "Programme not found in research.json" : "Trials not linked to a programme", status: null, sub: "", windows: [], trials: rows });
  }
  return lanes;
}

// Lanes of the last render, redrawn at the real container width by mount().
let lastLanes = null;

function windowsPanel(rs, rsrc, trials) {
  lastLanes = null;
  if (!rs) {
    return html`<div class="rsb-tl-frame" data-timeline="0">
      <div class="rsb-tl-frame__axis"></div>
      ${sourceEmpty(rsrc, { title: "Evaluation windows not connected", hint: "Each programme's declared windows — primary evidence, confirmation, holdout, out-of-sample, implementation verification — will be drawn on a time axis from their real dates, with OOS and walk-forward trial windows beneath them." })}
    </div>${roleLegend()}`;
  }
  lastLanes = lanesFor(rs, trials);
  const svg = windowTimeline(lastLanes);
  const declared = rs.programmes.flatMap((p) => p.evaluation_windows.map((w) => ({ p, w })));
  const undrawnProgs = rs.programmes.filter((p) => !p.evaluation_windows.length && !trials.some((t) => t.programme_id === p.programme_id));
  const columns = [
    { label: "Programme", render: ({ p }) => html`<span class="cluster">${B.refLink(p.programme_id, B.programmeHref(p.programme_id))}${badge(p.status)}${originBadge(p.origin)}</span>` },
    { label: "Window", render: ({ w }) => (w.label ? html`<span class="text-2">${w.label}</span>` : null) },
    { label: "Role", render: ({ w }) => (w.role ? html`<span class="rsb-role"><i class="${"rsb-tl-sw rsb-tl-role--" + w.role}"></i>${ROLE_LABEL[w.role] ?? humanize(w.role)}</span>` : null) },
    { label: "Start", render: ({ w }) => B.dateVal(w.start), cls: "rsb-nowrap" },
    { label: "End", render: ({ w }) => B.dateVal(w.end), cls: "rsb-nowrap" },
    { label: "Fixed in spec", render: ({ p }) => (p.frozen_at || p.sealed_at ? html`<span class="mono small">${p.sealed_at ? "SEALED " + fmtDate(p.sealed_at) : "FROZEN " + fmtDate(p.frozen_at)}</span>` : html`<span class="rsb-faint">SPEC NOT FROZEN</span>`) },
    { label: "Spec", render: ({ p }) => (p.spec_ref ? html`<span class="ref">${p.spec_ref}</span>` : null) },
  ];
  return html`
    ${svg ??
    html`<div class="rsb-tl-frame" data-timeline="0"><div class="rsb-tl-frame__axis"></div>${emptyState({
      title: "No dated windows to draw",
      reason: `${fmtCount(rs.programmes.length)} programme(s) connected; none declares a dated evaluation window and no OOS / walk-forward trial records a window.`,
      compact: true,
    })}</div>`}
    ${roleLegend()}
    <p class="rsb-note rsb-note--fixed" data-note="windows-fixed"><b>Windows are fixed before results.</b> They are declared in each programme's frozen specification; the freeze or seal date is shown with them. Trial windows beneath each programme are as recorded by the ledger — the timeline draws, it does not judge overlap.</p>
    <div class="rsb-gap">${B.label("Declared evaluation windows", `${fmtCount(declared.length)} across ${fmtCount(rs.programmes.length)} programmes`)}</div>
    ${B.regTable({
      columns,
      rows: declared,
      empty: emptyState({ title: "No evaluation windows declared", reason: "No programme in research.json declares evaluation_windows.", compact: true }),
      rowAttrs: ({ p, w }) => html`data-programme="${p.programme_id}" data-role="${w.role ?? ""}"`,
    })}
    ${undrawnProgs.length ? html`<p class="rsb-note">No windows and no OOS / walk-forward trials: ${undrawnProgs.map((p, i) => html`${i ? ", " : ""}${B.refLink(p.programme_id, B.programmeHref(p.programme_id))} <span class="muted">(${humanize(p.status)})</span>`)}.</p>` : ""}
  `;
}

/* ---------------------------------------------------------------- strategies */

function checkDetail(check, key) {
  return html`<div class="rsb-stack rsb-chk">
    ${B.checkCell(check, key)}
    ${check?.detail ? html`<span class="rsb-sub">${check.detail}</span>` : ""}
    ${check?.checked_at ? html`<span class="rsb-faint">CHECKED ${fmtDateTime(check.checked_at)}</span>` : ""}
    ${check?.evidence_refs?.length ? html`<span class="rsb-refs">${check.evidence_refs.map((r) => html`<span class="ref" title="${r}">${r}</span>`)}</span>` : ""}
  </div>`;
}

function strategies(st, ssrc, cv) {
  const columns = [
    {
      label: "Strategy · current version",
      render: ({ s, v }) => html`<div class="rsb-stack"><span class="cluster">${B.refLink(s.strategy_id, B.strategyHref(s.strategy_id))}<span class="mono small">v${v.version}</span>${badge(s.status)}</span><span class="rsb-sub">${s.name}</span>${originBadge(s.origin)}</div>`,
    },
    { label: "Validation status", render: ({ v }) => badge(v.validation_status) },
    { label: "Out-of-sample check", render: ({ v }) => checkDetail(v.validation.out_of_sample, "out_of_sample"), cls: "rsb-w-chk" },
    { label: "Walk-forward check", render: ({ v }) => checkDetail(v.validation.walk_forward, "walk_forward"), cls: "rsb-w-chk" },
    {
      label: "Figures on OOS / WF basis",
      render: ({ v }) => B.namedMetrics(B.versionMetrics(v).filter((m) => m.metric.basis === "OUT_OF_SAMPLE" || m.metric.basis === "WALK_FORWARD"), { grid: true }),
      cls: "rsb-w-figs",
    },
  ];
  const empty = !st
    ? sourceEmpty(ssrc, { title: "Strategy registry not connected", compact: true, hint: "Each strategy's current version will appear with its out_of_sample and walk_forward checks and any figures reported on an OOS or walk-forward basis." })
    : emptyState({ title: "No strategies registered", reason: "strategies.json is connected and lists no strategies.", compact: true });
  return B.regTable({ columns, rows: cv, empty, rowAttrs: ({ s }) => html`data-strategy="${s.strategy_id}"` });
}

/* ---------------------------------------------------------------- register */

function register(rs, rsrc, trials) {
  const hypById = new Map((rs?.hypotheses ?? []).map((h) => [h.hypothesis_id, h]));
  const columns = [
    { label: "Trial", render: (t) => B.trialCell(t), cls: "rsb-nowrap" },
    { label: "Experiment · hypothesis", render: (t) => B.experimentCell(t, hypById), cls: "rsb-w-exp" },
    { label: "Outcome", render: (t) => B.outcomeCell(t), cls: "rsb-w-out" },
    {
      label: "OOS · validation",
      render: (t) => html`<div class="rsb-tri"><span class="rsb-tri__k">OOS</span><span data-oos="${t.oos_state ?? ""}">${B.stateCell(t.oos_state)}</span><span class="rsb-tri__k">VAL</span><span>${B.stateCell(t.validation_state)}</span></div>`,
      cls: "rsb-nowrap",
    },
    { label: "Window · data", render: (t) => html`<div class="rsb-stack">${B.windowStack(t.window_start, t.window_end)}${B.chipList(t.data_used)}</div>` },
    { label: "Gross", render: (t) => B.componentCell(t.metrics, "GROSS"), cls: "rsb-nowrap rsb-cmp" },
    { label: "Cost", render: (t) => B.componentCell(t.metrics, "COST"), cls: "rsb-nowrap rsb-cmp" },
    { label: "Net", render: (t) => B.componentCell(t.metrics, "NET"), cls: "rsb-nowrap rsb-cmp" },
    { label: "Evidence · origin", render: (t) => B.evidenceOriginCell(t) },
  ];
  const empty = !rs
    ? sourceEmpty(rsrc, { title: "OOS register not connected", hint: "Every out-of-sample and walk-forward trial will be listed here with its oos_state, outcome, window, data and gross / cost / net." })
    : emptyState({ title: "No OOS or walk-forward trials recorded", reason: "The ledger records no trial of kind OOS or WALK_FORWARD.", compact: true });
  return B.regTable({ columns, rows: trials, empty, rowAttrs: (t) => html`data-trial="${t.trial_id}" data-oos-state="${t.oos_state ?? ""}"` });
}

/* ---------------------------------------------------------------- view */

export default {
  title: "Out-of-Sample",
  render(ctx) {
    const { rs, rsrc, st, ssrc, gov, gsrc } = B.sources(ctx);
    const cv = B.currentVersions(st);
    const trials = B.trialsOfKinds(rs, KINDS);
    return html`
      ${pageHeader({
        kicker: "RESEARCH ENGINE",
        code: "OOS",
        title: "Out-of-Sample",
        sub: "Evidence on data the hypothesis never saw: declared evaluation windows, the trials run on them, the governance separation check, and each strategy's out-of-sample and walk-forward checks.",
        right: html`${sourceTag(rsrc, { now: ctx.now })}${sourceTag(gsrc, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({ span: 5, code: "OOS-01", title: "Separation", sub: "governance.json · oos_separation", variant: "hero", cls: "lg-span-12", body: separation(gov, gsrc) })}
        ${panel({
          span: 7,
          code: "OOS-02",
          title: "Out-of-sample ledger",
          sub: trials ? B.splitText(B.originSplit(trials), "OOS / walk-forward records") : "research.json not connected",
          cls: "lg-span-12",
          body: summary(rs, trials, cv),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "OOS-03",
          title: "Evaluation windows",
          sub: rs ? "Programmes' declared windows · OOS and walk-forward trial windows beneath · drawn from real dates only" : "research.json not connected",
          body: windowsPanel(rs, rsrc, trials ?? []),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "OOS-04",
          title: "Strategy out-of-sample evidence",
          sub: cv ? `${fmtCount(cv.length)} strategies · current versions` : "strategies.json not connected",
          body: strategies(st, ssrc, cv),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "OOS-05",
          title: "OOS & walk-forward register",
          sub: trials ? `${B.splitText(B.originSplit(trials), "trials")} · ledger order` : "Source not connected",
          body: register(rs, rsrc, trials),
        })}
      </div>
    `;
  },
  mount(root) {
    return mountTimeline(root, lastLanes);
  },
};

