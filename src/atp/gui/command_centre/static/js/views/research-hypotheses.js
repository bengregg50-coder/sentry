// Hypotheses — the register of every hypothesis SENTRY has recorded,
// validated or not. ?status= filters the register; ?focus=<id> opens the
// detail panel (statement, mechanism, rationale, decision, pipeline track,
// trials). The knowledge graph links here with ?focus=.

import { html } from "../core/html.js";
import { fmtCount, fmtDate, fmtDateTime, humanize, isNil } from "../core/format.js";
import { derived, source, sourceReason } from "../core/state.js";
import { toneClass } from "../core/tones.js";
import { pageHeader, panel, badge, chip, sourceTag, emptyState, tabs, kv, val } from "../components/ui.js";
import { pipelineTracks } from "../components/pipeline.js";
import { icon } from "../components/icons.js";
import * as R from "./_research-a-common.js";

const PATH = "/research/hypotheses";

/* ---------------------------------------------------------------- lifecycle */

function lifeNode(status, counts, available, active) {
  // Colour marks a status only when records hold it; empty statuses stay neutral.
  const present = available && counts && Object.values(counts).some((n) => n > 0);
  return html`<a class="rsa-life__node ${toneClass(present ? status : null)} ${active ? "is-active" : ""}" href="${R.qhref(PATH, { status })}" data-life="${status}">
    <span class="rsa-life__label">${humanize(status)}</span>
    <span class="rsa-life__n">${available ? R.splitVal(counts ?? { ORIGINAL: 0, RECONSTRUCTED: 0, SYNTHETIC_FIXTURE: 0 }) : val(null)}</span>
    <span class="rsa-life__desc">${R.HYP_STATUS_DESC[status]}</span>
  </a>`;
}

function lifecycleBody(rs, statusFilter) {
  const byStatus = R.countMatrix(rs?.hypotheses ?? null, (h) => h.status);
  return html`<div class="rsa-life">
    <div class="rsa-life__lane">
      <span class="rsa-life__lane-k">PROGRESSION</span>
      <div class="rsa-life__flow">${R.HYP_FLOW.map((s) => lifeNode(s, byStatus?.[s], !!rs, statusFilter === s))}</div>
    </div>
    <div class="rsa-life__lane rsa-life__lane--stops">
      <span class="rsa-life__lane-k">STOPPED</span>
      <div class="rsa-life__stops">${R.HYP_STOPS.map((s) => lifeNode(s, byStatus?.[s], !!rs, statusFilter === s))}</div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- shared cells */

function trialRefs(h, trialsByNumber) {
  if (!h.trial_numbers?.length) return null;
  return html`<span class="rsa-refs">${h.trial_numbers.map((n) => {
    const t = trialsByNumber.get(n);
    return t
      ? html`<a class="ref" href="${R.trialHref(t.trial_id)}" title="${t.trial_id}${t.experiment ? " · " + t.experiment : ""}">#${n}</a>`
      : html`<span class="rsa-unres" title="No trial record with this number is present">#${n}</span>`;
  })}</span>`;
}

/* ---------------------------------------------------------------- detail */

function textBlock(label, text, { lead = false } = {}) {
  return html`<div class="rsa-block ${lead ? "rsa-block--lead" : ""}">
    <div class="rsa-block__k">${label}</div>
    <div class="rsa-block__v">${text ?? html`<span class="rsa-none">Not declared</span>`}</div>
  </div>`;
}

function trialsOf(rs, h) {
  const nums = new Set(h.trial_numbers ?? []);
  return rs.trials.filter((t) => t.hypothesis_id === h.hypothesis_id || (!isNil(t.trial_number) && nums.has(t.trial_number))).sort(R.byTrialNumber);
}

function detailTrials(rs, h) {
  const trials = trialsOf(rs, h);
  const present = new Set(trials.map((t) => t.trial_number).filter((n) => !isNil(n)));
  const missing = (h.trial_numbers ?? []).filter((n) => !present.has(n));
  return html`${R.frameTable({
    dense: true,
    rows: trials,
    rowHref: (t) => R.trialHref(t.trial_id),
    columns: [
      { key: "trial_number", label: "#", num: true, render: (t) => R.trialNumber(t.trial_number) },
      {
        key: "trial_id",
        label: "Trial",
        cls: "wrap",
        render: (t) => html`<div class="rsa-stack-cell">${R.ref(t.trial_id, R.trialHref(t.trial_id), html`data-trial="${t.trial_id}"`)}<span class="rsa-title">${t.experiment ?? ""}</span></div>`,
      },
      { key: "kind", label: "Kind · stage", render: (t) => html`<div class="rsa-stack-cell">${chip(humanize(t.kind))}<span class="rsa-sub">${humanize(t.stage)}</span></div>` },
      {
        key: "outcome",
        label: "Outcome",
        render: (t) => html`<div class="rsa-stack-cell">${badge(t.outcome)}${t.rejection_reason ? html`<span class="rsa-sub">${t.rejection_reason}</span>` : ""}</div>`,
      },
      { key: "evidence_state", label: "Evidence · origin", render: (t) => html`<span class="cluster">${badge(t.evidence_state, { label: t.evidence_state === "LOST" ? "EVIDENCE LOST" : undefined })}${t.origin === "ORIGINAL" ? "" : R.originCell(t.origin)}</span>` },
      { key: "metrics", label: "Gross · cost · net", render: (t) => R.metricsCell(t.metrics) },
      { key: "recorded_at", label: "Recorded", cls: "mono", render: (t) => R.dateTimeVal(t.recorded_at) },
    ],
    empty: emptyState({ title: "No trial records", reason: "No trial in research.json references this hypothesis.", compact: true }),
  })}
  ${missing.length
    ? html`<div class="rsa-missing ${toneClass("WARNING")}">${icon("alert")}Declared trial number${missing.length > 1 ? "s" : ""} ${missing.map((n) => html`<span class="mono">#${n}</span> `)}ha${missing.length > 1 ? "ve" : "s"} no record present. Missing records are not estimated.</div>`
    : ""}`;
}

/** Why a declared strategy has no track here — phrased from the strategy registry's source status. */
function strategyGap(ctx, id) {
  const src = source(ctx, "strategies");
  const ok = src?.status === "OK";
  return html`<div class="rsa-foot-note ${ok ? "" : toneClass(R.srcBroken(src) ? src.status : null)}" data-strategy-gap="${ok ? "NOT_IN_REGISTRY" : src?.status ?? "NO_SNAPSHOT"}">Declared as strategy <span class="ref">${id}</span>; ${
    ok ? "strategies.json lists no strategy with this id, so it has no track here." : html`its track cannot be shown — ${R.srcPhrase(src)}.`
  }</div>`;
}

function detailBody(ctx, rs, h) {
  const strategyItem = h.strategy_id ? (derived(ctx, "pipeline")?.items ?? []).find((it) => it.kind === "STRATEGY" && it.id === h.strategy_id) : null;
  const ownTrack = {
    id: h.hypothesis_id,
    label: h.title,
    kind: "HYPOTHESIS",
    stage_reached: h.stage_reached,
    terminal: h.terminal,
    status: h.status,
    origin: h.origin,
  };
  return html`<div class="rsa-detail" data-rsa-detail="${h.hypothesis_id}">
    <div class="rsa-detail__head">
      <span class="rsa-detail__id">${h.hypothesis_id}</span>
      <span class="rsa-detail__title">${h.title}</span>
      <span class="cluster">${badge(h.status, { size: "lg" })}${h.terminal ? badge(h.terminal, { size: "lg", label: "TERMINAL · " + humanize(h.terminal) }) : chip("OPEN")}${R.originCell(h.origin)}</span>
    </div>
    <div class="rsa-detail__grid">
      <div class="rsa-detail__text">
        ${textBlock("Statement", h.statement, { lead: true })}
        ${textBlock("Mechanism", h.mechanism)}
        ${textBlock("Economic rationale", h.economic_rationale)}
        <div class="rsa-block rsa-block--decision ${toneClass(h.decided_at || h.decision_reason ? h.terminal ?? h.status : null)}">
          <div class="rsa-block__k">Decision</div>
          <div class="rsa-block__v">${h.decision_reason ?? html`<span class="rsa-none">${h.terminal ? "No decision reason declared" : "No decision recorded — hypothesis is open"}</span>`}</div>
          <div class="rsa-block__meta">${h.decided_at ? html`DECIDED ${fmtDateTime(h.decided_at)}` : "DECISION DATE NOT DECLARED"}</div>
        </div>
      </div>
      <div class="rsa-detail__facts">
        ${kv(
          [
            ["Programme", h.programme_id ? R.ref(h.programme_id, R.programmeHref(h.programme_id)) : null],
            ["Family", h.family ? html`<span class="mono">${h.family}</span>` : null],
            ["Stage reached", R.stageCell(h.stage_reached, h.terminal)],
            ["Terminal", R.terminalCell(h.terminal)],
            ["Preregistered", R.preregCell(h)],
            ["Prereg ref", h.prereg_ref ? html`<span class="ref">${h.prereg_ref}</span>` : null],
            ["Created", h.created_at ? html`<span class="mono">${fmtDateTime(h.created_at)}</span>` : null],
            ["Decided", h.decided_at ? html`<span class="mono">${fmtDateTime(h.decided_at)}</span>` : null],
            ["Strategy", h.strategy_id ? R.ref(h.strategy_id, R.strategyHref(h.strategy_id)) : null],
            ["Trials declared", h.trial_numbers?.length ? html`<span class="mono">${fmtCount(h.trial_numbers.length)}</span>` : null],
          ],
          { cols: 2 },
        )}
      </div>
    </div>
    <div class="rsa-label rsa-label--gap">Pipeline track</div>
    <div class="rsa-tracks">${pipelineTracks(strategyItem ? [ownTrack, strategyItem] : [ownTrack], { hrefFor: R.itemHref })}</div>
    ${h.strategy_id && !strategyItem ? strategyGap(ctx, h.strategy_id) : ""}
    <div class="rsa-label rsa-label--gap">Trials <span class="muted">· open in research history</span></div>
    ${detailTrials(rs, h)}
  </div>`;
}

function detailPanel(ctx, rs, src, id, statusFilter) {
  const close = html`<a class="btn" href="${R.qhref(PATH, { status: statusFilter === "ALL" ? null : statusFilter })}">${icon("collapse")}Close</a>`;
  if (!rs) {
    return panel({
      span: 12,
      code: "HYP-00",
      title: "Hypothesis detail",
      sub: id,
      actions: close,
      body: R.srcEmpty(src, "Hypothesis register", { hint: "The requested hypothesis can only be shown from research.json; nothing is reconstructed in the browser." }),
    });
  }
  const h = rs.hypotheses.find((x) => x.hypothesis_id === id);
  if (!h) {
    return panel({
      span: 12,
      code: "HYP-00",
      title: "Hypothesis detail",
      sub: id,
      actions: close,
      body: emptyState({
        title: "Hypothesis not in the register",
        reason: `research.json has no hypothesis with id ${id}.`,
        hint: "A reference may point to a record that was never registered. Nothing is inferred.",
        iconName: "alert",
        code: "hypothesis-not-found",
      }),
    });
  }
  return panel({ span: 12, code: "HYP-00", title: "Hypothesis detail", sub: h.hypothesis_id, actions: close, variant: "accent", body: detailBody(ctx, rs, h) });
}

/* ---------------------------------------------------------------- register */

function registerBody(rs, src, statusFilter, focusId, rowsQ) {
  const all = rs ? [...rs.hypotheses].sort(R.byId("hypothesis_id")) : null;
  const rows = all ? (statusFilter === "ALL" ? all : all.filter((h) => h.status === statusFilter)) : null;
  // Only a page of rows is materialised; every count on this page comes from the full register.
  const page = R.pageRows(rows, rowsQ);
  const statusQ = statusFilter === "ALL" ? null : statusFilter;
  const trialsByNumber = new Map((rs?.trials ?? []).filter((t) => !isNil(t.trial_number)).map((t) => [t.trial_number, t]));
  const focusQ = focusId ?? null;
  const tabItems = [
    // No numeric counts on tabs: they would merge record origins. Per-origin counts are in HYP-01.
    { key: "ALL", label: "All", href: R.qhref(PATH, { focus: focusQ }) },
    ...R.HYP_STATUSES.map((s) => ({ key: s, label: humanize(s), href: R.qhref(PATH, { status: s, focus: focusQ }) })),
  ];
  const columns = [
    {
      key: "hypothesis_id",
      label: "Hypothesis · origin",
      cls: "wrap",
      render: (h) => html`<div class="rsa-stack-cell"><span class="cluster">${R.ref(h.hypothesis_id, R.hypHref(h.hypothesis_id), html`data-hyp="${h.hypothesis_id}"`)}${
        h.origin === "ORIGINAL" ? "" : R.originCell(h.origin)
      }</span><span class="rsa-title">${h.title}</span></div>`,
    },
    {
      key: "family",
      label: "Family · programme",
      render: (h) =>
        h.family || h.programme_id
          ? html`<div class="rsa-stack-cell">${h.family ? html`<span class="mono">${h.family}</span>` : html`<span class="rsa-sub">family not declared</span>`}${
              h.programme_id ? R.ref(h.programme_id, R.programmeHref(h.programme_id)) : html`<span class="rsa-sub">programme not declared</span>`
            }</div>`
          : null,
    },
    {
      key: "status",
      label: "Status · terminal",
      render: (h) => html`<div class="rsa-stack-cell rsa-status-term">${badge(h.status)}<span class="rsa-status-term__t"><span class="rsa-dated__k">TERMINAL</span>${R.terminalCell(h.terminal)}</span></div>`,
    },
    { key: "stage_reached", label: "Stage reached", cls: "rsa-col-stage", render: (h) => R.stageCell(h.stage_reached, h.terminal) },
    { key: "prereg", label: "Preregistered", render: (h) => R.preregCell(h) },
    {
      key: "decision",
      label: "Decision",
      cls: "wrap",
      render: (h) =>
        h.decided_at || h.decision_reason
          ? html`<div class="rsa-stack-cell"><span class="mono rsa-sub">${h.decided_at ? fmtDate(h.decided_at) : "decision date not declared"}</span><span>${h.decision_reason ?? html`<span class="rsa-sub">reason not declared</span>`}</span></div>`
          : null,
    },
    { key: "trials", label: "Trials", render: (h) => trialRefs(h, trialsByNumber) },
  ];
  return html`<div class="rsa-tabs">${tabs(tabItems, statusFilter)}</div>
    ${R.frameTable({
      columns,
      rows: page.shown,
      rowHref: (h) => R.qhref(PATH, { status: statusQ, focus: h.hypothesis_id, rows: rowsQ }),
      rowCls: (h) => (h.hypothesis_id === focusId ? "rsa-row--focus" : ""),
      empty: rs
        ? emptyState({
            title: statusFilter === "ALL" ? "No hypotheses registered" : `No ${humanize(statusFilter)} hypotheses`,
            reason: statusFilter === "ALL" ? "research.json is connected but lists no hypotheses." : "No hypothesis in research.json currently has this status.",
            compact: true,
          })
        : R.srcEmpty(src, "Hypothesis register", {
            compact: true,
            hint: "Every hypothesis appears here — validated, pending, rejected, blocked or abandoned — with its preregistration, decision and trials.",
          }),
    })}
    ${R.pager(page, (n) => R.qhref(PATH, { status: statusQ, focus: focusQ, rows: n }), { noun: "hypotheses", hint: statusQ ? "" : "select a status above to narrow the register" })}`;
}

/* ---------------------------------------------------------------- view */

export default {
  title: "Hypotheses",
  render(ctx) {
    const { rs, src } = R.research(ctx);
    const focusId = ctx.query.focus || null;
    const statusFilter = ctx.query.status || "ALL";
    const regRows = rs ? rs.hypotheses.filter((h) => statusFilter === "ALL" || h.status === statusFilter) : null;
    const paged = R.pageRows(regRows, ctx.query.rows);
    return html`
      ${pageHeader({
        kicker: "RESEARCH ENGINE",
        code: "HYP",
        title: "Hypotheses",
        sub: "Every hypothesis in the research register, validated or not. Rejected, blocked and abandoned ideas are part of the evidence and stay listed here.",
        right: sourceTag(src, { now: ctx.now }),
      })}

      ${focusId ? html`<div class="grid">${detailPanel(ctx, rs, src, focusId, statusFilter)}</div>` : ""}

      <div class="grid">
        ${panel({
          span: 12,
          code: "HYP-01",
          title: "Hypothesis lifecycle",
          sub: rs ? "Records per status · select a status to filter the register" : sourceReason(src),
          body: lifecycleBody(rs, statusFilter),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "HYP-02",
          title: "Hypothesis register",
          sub: rs
            ? `${R.splitText(rs.hypotheses, "registered")}${paged.hidden.length ? ` · rows 1–${fmtCount(paged.shown.length)} shown` : ""} · select a row for detail`
            : sourceReason(src),
          body: registerBody(rs, src, statusFilter, focusId, ctx.query.rows),
          cls: "rsa-register",
        })}
      </div>
    `;
  },
};
