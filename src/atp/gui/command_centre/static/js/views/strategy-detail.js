// Strategy detail — the permanent interface for one strategy (/strategy/:id,
// optional ?v=N to display a non-current version, ?proposal=ID to highlight a
// proposal). Identity and rationale, every reported metric with its evidence
// basis (gross / cost / net separately), the thirteen validation checks,
// multiple-testing treatment, regime results, the immutable version history,
// the deployment hand-off (derived for the current version), approval and
// deployment-package identities, research lineage, improvement proposals,
// related memories and consistency findings.
//
// When the registry is unavailable (not connected, not produced, rejected by the
// contract or unreadable — each worded as such) the full structure renders with every
// field empty; an unknown id renders a not-found state. Nothing is computed
// here beyond selecting, filtering and counting declared records.

import { html } from "../core/html.js";
import { humanize, fmtCount, fmtDate, fmtDateTime, shortHash, isNil, pad2 } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort, sourceTitle, currentVersion, handoffFor } from "../core/state.js";
import {
  pageHeader,
  panel,
  badge,
  chip,
  basisChip,
  sourceTag,
  sourceEmpty,
  emptyState,
  findingsList,
  metric,
  kv,
  val,
  notice,
} from "../components/ui.js";
import { steps } from "../components/flow.js";
import { agentMini } from "../components/agent.js";
import { icon } from "../components/icons.js";
import * as S from "./_strategies-common.js";

const HANDOFF = ["VALIDATION", "APPROVAL", "DEPLOYMENT_PACKAGE", "AGENT_ASSIGNMENT", "SIMULATION", "LIVE"];
const DEPLOY_ACTIONS = ["ASSIGN_STRATEGY", "START_SIMULATION", "ENABLE_LIVE"];
const BASES = [
  ["IN_SAMPLE", "In-sample"],
  ["OUT_OF_SAMPLE", "Out-of-sample"],
  ["WALK_FORWARD", "Walk-forward"],
  ["MONTE_CARLO", "Monte Carlo"],
  ["SIMULATION", "Simulation"],
  ["PAPER", "Paper"],
  ["LIVE", "Live"],
];
const TILES = [
  ["expected_return", "Expected return", "Return the evidence supports"],
  ["expectancy", "Expectancy", "Average result per trade"],
  ["sharpe", "Sharpe", "Return per unit of volatility"],
  ["sortino", "Sortino", "Return per unit of downside volatility"],
  ["max_drawdown", "Max drawdown", "Largest peak-to-trough decline"],
  ["trade_count", "Trade count", "Trades in the evaluation"],
  ["win_rate", "Win rate", "Share of trades that won"],
  ["slippage", "Slippage", "Fill versus reference price"],
  ["capacity", "Capacity", "Size before the edge decays"],
];
const GCN = [
  ["gross_return", "GROSS", "Gross return", "Before any cost"],
  ["costs", "COST", "Costs", "Commission · spread · slippage"],
  ["net_return", "NET", "Net return", "After modelled costs"],
];

const num = (n) => (isNil(n) ? null : val(fmtCount(n)));
const rawNum = (n) => (isNil(n) ? null : val(String(n)));
const dt = (iso) => (iso ? html`<span class="mono small">${fmtDateTime(iso)}</span>` : null);
const mono = (s) => (isNil(s) || s === "" ? null : html`<span class="mono small">${s}</span>`);
const hash = (h) => (h ? html`<span class="mono small" title="${h}">${shortHash(h, 18)}</span>` : null);

/* ================================================================ header + identity */

function hero(ctx, s, v, h, ssrc) {
  const cur = s ? currentVersion(s) : null;
  const isCur = s && v && v.version === s.current_version;
  const cell = (k, body, attrs) => html`<div class="st-hero__cell" ${attrs ?? ""}><div class="st-hero__k">${k}</div><div class="st-hero__v">${body}</div></div>`;
  return html`<div class="st-hero" data-hero>
    ${cell("STATUS", s ? badge(s.status, { size: "lg" }) : S.offBadge(ssrc, { size: "lg" }), html`data-hero-status="${s?.status ?? ""}"`)}
    ${cell(html`VALIDATION${v ? html` · v${v.version}` : ""}`, v ? badge(v.validation_status) : val(null))}
    ${cell("CURRENT VERSION", cur ? val(`v${cur.version}`) : val(null))}
    ${cell(
      "VIEWING",
      v ? html`${val(`v${v.version}`)} <span class="st-flag ${isCur ? "is-current" : "is-hist"}">${isCur ? "CURRENT" : "EARLIER VERSION"}</span>` : val(null),
      html`data-viewing="${v?.version ?? ""}"`,
    )}
    ${cell("ASSIGNED AGENT", s && !isNil(s.assigned_agent) ? S.agentLink(s.assigned_agent) : val(null))}
    ${cell(
      h ? `DEPLOYMENT · v${h.version}` : "DEPLOYMENT",
      h ? (h.deployment_eligible ? badge("PASS", { label: "ELIGIBLE" }) : badge("NOT_ELIGIBLE", { label: "NOT ELIGIBLE" })) : val(null),
      html`data-eligible="${h ? (h.deployment_eligible ? "1" : "0") : ""}"`,
    )}
    ${cell("LAST UPDATE", s?.last_update ? val(fmtDateTime(s.last_update)) : val(null))}
    ${cell("ORIGIN", s ? S.originCell(s.origin) : val(null), html`data-hero-origin="${s?.origin ?? ""}"`)}
  </div>`;
}

/** Identity only — status, current version, agent, last update and origin live in the header strip above. */
function identity(s, ssrc) {
  return html`<div class="st-kvwide st-kvwide--4" data-identity>${kv(
    [
      ["Strategy ID", s ? html`<span class="mono strong">${s.strategy_id}</span>` : null],
      ["Name", s?.name],
      ["Mechanism", s?.mechanism],
      ["Market", s?.market],
      ["Instrument", mono(s?.instrument)],
      ["Timeframe", mono(s?.timeframe)],
      ["Versions on record", s ? num(s.versions.length) : null],
    ],
    { cols: 2 },
  )}</div>
  ${S.label("ECONOMIC RATIONALE", "why the effect should exist")}
  <div class="st-rationale ${s?.economic_rationale ? "" : "is-empty"}" data-rationale>${
    s?.economic_rationale
      ? s.economic_rationale
      : s
        ? html`<span class="st-nodata">NOT STATED BY THE RESEARCH ENGINE</span>`
        : S.offLabel(ssrc, "REGISTRY")
  }</div>`;
}

/* ================================================================ performance */

function performance(v, ssrc) {
  const m = v?.metrics ?? null;
  const emptyHint = v ? "NOT REPORTED" : sourceShort(ssrc);
  const additional = m?.additional ?? [];
  return html`<div class="st-perf">
      <div class="st-gcn" data-gcn>
        ${S.label("GROSS · COST · NET")}
        ${GCN.map(
          ([k, comp, label, hint], i) => html`${i ? html`<div class="st-gcn__join" aria-hidden="true"></div>` : ""}<div class="st-gcn__row" data-component="${comp}" data-metric="${k}">
              <div class="st-gcn__k">${label}</div>
              <div class="st-gcn__v">${metric(m?.[k])}</div>
              <div class="st-gcn__h">${m?.[k] ? S.windowText(m[k]) || hint : html`<span class="st-nodata">${emptyHint}</span>`}</div>
            </div>`,
        )}
      </div>
      <div class="st-mgrid">${TILES.map(([k, label, hint]) => S.metricTile(label, m?.[k], { key: k, hint, emptyHint }))}</div>
    </div>
    ${S.label("ADDITIONAL METRICS", "cost stress and other named figures")}
    ${
      additional.length
        ? html`<div class="st-addl">${additional.map(
            (nm) => html`<div class="st-addl__row" data-metric="${nm.key}" data-basis="${nm.metric.basis}">
              <span class="st-addl__k">${nm.label}</span>
              <span class="st-addl__v">${metric(nm.metric)}</span>
              <span class="st-addl__h">${S.windowText(nm.metric)}${nm.metric.source_ref ? html` <span class="ref st-ref--plain">${nm.metric.source_ref}</span>` : ""}</span>
            </div>`,
          )}</div>`
        : emptyState({
            title: v ? `No additional metrics reported for v${v.version}` : sourceTitle(ssrc, "Additional metrics"),
            reason: "Cost-stress variants and other named figures appear here when the research engine reports them.",
            compact: true,
            inline: true,
          })
    }
    <div class="st-basis" data-basis-legend>
      <span class="st-basis__k">EVIDENCE BASIS</span>
      ${BASES.map(([b, label]) => html`<span class="st-basis__i">${basisChip(b)}${label}</span>`)}
      <span class="st-basis__note">Every figure carries its basis. An in-sample figure is never validation evidence.</span>
    </div>`;
}

/* ================================================================ validation checks */

function checkRow(n, def, chk, fallback, fallbackLabel) {
  const [key, label, desc] = def;
  const state = chk?.state ?? fallback;
  return html`<div class="st-chk" data-check="${key}" data-state="${state}">
    <span class="st-chk__n">${pad2(n)}</span>
    <div class="st-chk__body">
      <div class="st-chk__label">${label}</div>
      <div class="st-chk__desc">${desc}</div>
      ${chk?.detail ? html`<div class="st-chk__detail">${chk.detail}</div>` : ""}
      ${
        chk && (chk.checked_at || chk.evidence_refs?.length)
          ? html`<div class="st-chk__meta">${chk.checked_at ? html`CHECKED ${fmtDateTime(chk.checked_at)}` : ""}${chk.evidence_refs.map((r) => html` <span class="ref">${r}</span>`)}</div>`
          : ""
      }
    </div>
    <span class="st-chk__state">${badge(state, { label: chk?.state ? undefined : fallbackLabel })}</span>
  </div>`;
}

/** Position of a check in the displayed order (matches the numbering in STR-D03). */
function checkNo(key) {
  return S.CHECK_KEYS.indexOf(key) + 1;
}

/** State shown for a check with no record: NOT_REPORTED for a resolved version, else the registry's status. */
function checkFallback(v, ssrc) {
  return v ? ["NOT_REPORTED", undefined] : [S.offState(ssrc), sourceShort(ssrc)];
}

function checksSummary(v) {
  if (!v) return "";
  const counts = new Map();
  for (const k of S.CHECK_KEYS) {
    const st = v.validation?.[k]?.state ?? "NOT_REPORTED";
    counts.set(st, (counts.has(st) ? counts.get(st) : 0) + 1); // row counter
  }
  const order = ["PASS", "FAIL", "PENDING", "INCONCLUSIVE", "BLOCKED", "NOT_RUN", "NOT_APPLICABLE", "NOT_REPORTED"];
  return html`<div class="st-chksum cluster" data-check-summary>${order
    .filter((st) => counts.has(st))
    .map((st) => badge(st, { label: `${counts.get(st)} ${humanize(st)}`, ghost: true }))}<span class="st-faint">OF ${S.CHECK_KEYS.length} CONTRACT CHECKS · v${v.version}</span></div>`;
}

function checks(v, ssrc) {
  const fb = checkFallback(v, ssrc);
  let n = 0;
  return html`${checksSummary(v)}
    <div class="st-chkgroups">
      ${S.CHECK_GROUPS.map(
        (g) => html`<div class="st-chkgroup" data-check-group="${g.key}">
          <div class="st-chkgroup__h">${g.label}</div>
          ${g.checks.map((c) => checkRow(++n, c, v?.validation?.[c[0]], ...fb))}
        </div>`,
      )}
    </div>`;
}

/* ================================================================ multiple testing + regimes */

function multipleTesting(v, ssrc) {
  const mt = v?.multiple_testing ?? null;
  return html`${
    v && !mt
      ? html`<div class="st-inline-note">${icon("info")}<span>No multiple-testing treatment reported for v${v.version}. It is shown as missing, never assumed applied.</span></div>`
      : ""
  }
  <div class="st-kvwide">${kv(
    [
      ["Treatment state", mt ? badge(mt.state) : null],
      ["Method", mt?.method],
      ["Trials in family", num(mt?.trials_in_family)],
      ["Global trials at decision", num(mt?.global_trials_at_decision)],
      ["Adjusted threshold", rawNum(mt?.adjusted_threshold)],
      ["Deflated Sharpe ratio", rawNum(mt?.deflated_sharpe)],
    ],
    { cols: 2 },
  )}</div>
  ${mt?.detail ? html`<p class="prose st-pad-t">${mt.detail}</p>` : ""}
  <div class="st-chk-solo">${checkRow(checkNo("multiple_testing"), ["multiple_testing", "Multiple-testing check", "The validation check as reported for this version"], v?.validation?.multiple_testing, ...checkFallback(v, ssrc))}</div>`;
}

function regimes(v, ssrc) {
  const list = v?.regimes ?? null;
  const solo = html`<div class="st-chk-solo">${checkRow(checkNo("regime_analysis"), ["regime_analysis", "Regime analysis check", "Behaviour across market regimes is understood"], v?.validation?.regime_analysis, ...checkFallback(v, ssrc))}</div>`;
  let body;
  if (!v) body = S.offEmpty(ssrc, sourceTitle(ssrc, "Regime results"), "Each regime will show its window, state and metrics.");
  else if (!list.length)
    body = emptyState({ title: `No per-regime results reported for v${v.version}`, reason: "Each regime's window, state and metrics appear here when the research engine reports them.", compact: true });
  else
    body = html`<ul class="st-regs">${list.map(
      (r) => html`<li class="st-reg-i" data-regime="${r.regime}">
        <div class="split"><span class="st-reg-i__name">${r.regime}</span>${r.state ? badge(r.state) : html`<span class="st-nodata">STATE NOT REPORTED</span>`}</div>
        ${
          r.window
            ? html`<div class="st-reg-i__win mono">${r.window.label ?? humanize(r.window.role ?? "")}${r.window.start || r.window.end ? html` · ${r.window.start ?? "…"} → ${r.window.end ?? "…"}` : ""}</div>`
            : ""
        }
        ${r.metrics.length ? html`<div class="st-regm">${r.metrics.map((nm) => html`<span class="st-regm__i" data-metric="${nm.key}"><span class="st-regm__k">${nm.label}</span>${metric(nm.metric)}</span>`)}</div>` : ""}
      </li>`,
    )}</ul>`;
  return html`${solo}<div class="st-gap"></div>${body}`;
}

/* ================================================================ versions */

function versionTimeline(s, v, st, ssrc) {
  if (!s) {
    return sourceEmpty(ssrc, {
      compact: true,
      title: sourceTitle(ssrc, "Version history"),
      hint: "Every version — v1, v2, … — with its parent, status, validation status, change summary and rationale, proposer, proposal and specification hash.",
    });
  }
  const vs = [...s.versions].sort((a, b) => a.version - b.version);
  const first = vs[0]?.version;
  return html`<div class="st-vt" data-versions="${vs.map((x) => x.version).join(",")}">
    ${vs.map((x, i) => {
      const isCur = x.version === s.current_version;
      const isSel = x.version === v.version;
      return html`${
        i
          ? html`<div class="st-vt__arrow" aria-hidden="true"><span>${isNil(x.parent_version) ? "NO PARENT" : `FROM v${x.parent_version}`}</span><i></i></div>`
          : ""
      }<div class="st-vt__card ${isCur ? "is-current" : ""} ${isSel ? "is-selected" : ""}" data-version="${x.version}" data-current="${isCur ? "1" : "0"}" data-selected="${isSel ? "1" : "0"}">
        <div class="st-vt__top">
          <a class="st-vt__v" href="${S.strategyHref(s.strategy_id, isCur ? null : x.version)}" title="Display v${x.version}">v${x.version}</a>
          <span class="cluster">${isCur ? html`<span class="st-flag is-current">CURRENT</span>` : ""}${isSel ? html`<span class="st-flag is-viewing">VIEWING</span>` : ""}</span>
        </div>
        <div class="cluster st-vt__badges">${badge(x.status)}${badge(x.validation_status)}</div>
        <div class="st-vt__sum">${x.change_summary ?? html`<span class="st-nodata">NO CHANGE SUMMARY RECORDED</span>`}</div>
        ${x.change_rationale ? html`<div class="st-vt__why"><span class="st-vt__whyk">RATIONALE</span>${x.change_rationale}</div>` : ""}
        <dl class="st-vt__kv">
          <div><dt>PARENT</dt><dd>${
            isNil(x.parent_version)
              ? x.version === first
                ? html`<span class="st-faint">NONE · FIRST VERSION</span>`
                : val(null)
              : html`<a class="ref" href="${S.strategyHref(s.strategy_id, x.parent_version === s.current_version ? null : x.parent_version)}">v${x.parent_version}</a>`
          }</dd></div>
          <div><dt>CREATED</dt><dd>${dt(x.created_at) ?? val(null)}</dd></div>
          <div><dt>PROPOSED BY</dt><dd>${mono(x.proposed_by) ?? val(null)}</dd></div>
          <div><dt>PROPOSAL</dt><dd>${x.proposal_id ? html`<a class="ref" href="${S.qhref(`/strategy/${encodeURIComponent(s.strategy_id)}`, { v: isCur ? null : x.version, proposal: x.proposal_id })}">${x.proposal_id}</a>` : val(null)}</dd></div>
          <div><dt>SPEC HASH</dt><dd>${hash(x.spec_hash) ?? val(null)}</dd></div>
          <div><dt>SPEC</dt><dd>${x.spec_ref ? html`<span class="ref st-ref--plain">${x.spec_ref}</span>` : val(null)}</dd></div>
        </dl>
      </div>`;
    })}
    ${nextVersion(s, st)}
  </div>`;
}

const OPEN_PROPOSAL_STATES = ["PROPOSED", "IN_RESEARCH", "VALIDATED", "APPROVED"];

/** Ghost card after the newest version: how a next version can come to exist. Architecture text plus a row count. */
function nextVersion(s, st) {
  const open = st ? st.proposals.filter((p) => p.strategy_id === s.strategy_id && OPEN_PROPOSAL_STATES.includes(p.state)) : [];
  return html`<div class="st-vt__arrow st-vt__arrow--ghost" aria-hidden="true"><span>NEXT</span><i></i></div>
    <div class="st-vt__card st-vt__card--ghost" data-next-version>
      <div class="st-vt__top"><span class="st-vt__v st-vt__v--ghost">v·next</span><span class="st-flag is-hist">NOT CREATED</span></div>
      <div class="st-vt__sum">A new version may be created only after a proposal passes research validation and governance approval.</div>
      <div class="st-vt__steps"><span>PROPOSAL</span><i></i><span>RESEARCH VALIDATION</span><i></i><span>GOVERNANCE APPROVAL</span><i></i><span>NEW VERSION</span></div>
      <dl class="st-vt__kv">
        <div><dt>OPEN PROPOSALS</dt><dd>${val(fmtCount(open.length))}</dd></div>
        <div><dt>IDS</dt><dd>${open.length ? html`${open.map((p, i) => html`${i ? ", " : ""}<a class="ref" href="${S.qhref(`/strategy/${encodeURIComponent(s.strategy_id)}`, { proposal: p.proposal_id })}">${p.proposal_id}</a>`)}` : html`<span class="st-faint">NONE OPEN</span>`}</dd></div>
      </dl>
    </div>`;
}

/* ================================================================ handoff, approval, package */

function handoff(ctx, s, v, h, ssrc) {
  const controls = derived(ctx, "controls");
  const list = HANDOFF.map((k) => {
    const st = h?.steps?.find((x) => x.step === k);
    return { key: k, label: humanize(k), state: st?.state, detail: st ? st.detail : s ? "Not derived" : S.offWord(ssrc) };
  });
  const viewingOther = s && v && h && v.version !== h.version;
  const actions = controls?.actions?.filter((a) => DEPLOY_ACTIONS.includes(a.key)) ?? [];
  return html`${steps(list, { cls: "st-handoff" })}
    ${viewingOther ? html`<div class="st-inline-note">${icon("info")}<span>The hand-off is derived for the current version v${h.version}. You are viewing v${v.version}, shown for its record only.</span></div>` : ""}
    ${S.label("AGENTS REPORTING THIS STRATEGY", "as declared by the agent runtime")}
    ${assignedAgents(ctx, s, ssrc)}
    <div class="st-ctlrow">${S.label("DEPLOYMENT CONTROLS", "locked — blockers computed from declared state")}${controls ? S.lockedControls(actions) : html`<span class="st-nodata">NO SNAPSHOT</span>`}</div>`;
}

function assignedAgents(ctx, s, ssrc) {
  const asrc = source(ctx, "agents");
  if (asrc?.status !== "OK") {
    return html`<div class="st-inline-note ${S.offTone(asrc)}" data-agents-source="${asrc?.status ?? ""}">${icon("info")}<span>${sourceReason(asrc)} Agents assigned this strategy will appear here with their status, mode and package.</span></div>`;
  }
  if (!s) return html`<div class="st-inline-note ${S.offTone(ssrc)}">${icon("info")}<span>${sourceReason(ssrc) ?? "Strategy not resolved."} No agent assignment can be matched to this strategy without it.</span></div>`;
  const slots = (derived(ctx, "agent_slots") ?? []).filter((x) => x.strategy?.strategy_id === s.strategy_id);
  if (!slots.length) {
    return emptyState({ title: `No agent declares ${s.strategy_id}`, reason: "None of the agent slots in agents.json declares an assignment to this strategy.", compact: true, inline: true });
  }
  return html`<div class="st-agents">${slots.map((slot) => {
    const asg = slot.agent?.assignment;
    return html`<div class="st-agent" data-agent-slot="${slot.slot}">
      ${agentMini(slot, { now: ctx.now })}
      ${kv(
        [
          ["Mode", asg ? badge(asg.mode) : null],
          ["Version", asg ? html`<span class="mono">v${asg.version}</span>` : null],
          ["Assigned", dt(asg?.assigned_at)],
          ["Package", mono(asg?.package_id)],
          ["Approval ref", asg?.approval_ref ? html`<span class="ref st-ref--plain">${asg.approval_ref}</span>` : null],
        ],
        { cols: 1 },
      )}
    </div>`;
  })}</div>`;
}

function approvalPackage(v, ssrc) {
  const a = v?.approval ?? null;
  const p = v?.deployment_package ?? null;
  const missing = (what) => html`<div class="st-inline-note ${v ? "" : S.offTone(ssrc)}">${icon("info")}<span>${v ? `No ${what} recorded for v${v.version}.` : sourceReason(ssrc)}</span></div>`;
  return html`${S.label("GOVERNANCE APPROVAL", v ? `v${v.version}` : null)}
    ${a ? "" : missing("governance approval")}
    <div class="st-kvwide">${kv(
      [
        ["Decision", a ? badge(a.decision) : null],
        ["Scope", a ? chip(humanize(a.scope)) : null],
        ["Decided by", mono(a?.decided_by)],
        ["Decided at", dt(a?.decided_at)],
        ["Decision ref", a?.decision_ref ? html`<span class="ref st-ref--plain">${a.decision_ref}</span>` : null],
        ["Conditions", a?.conditions?.length ? html`<ul class="st-ul">${a.conditions.map((c) => html`<li>${c}</li>`)}</ul>` : a ? html`<span class="st-faint">NONE STATED</span>` : null],
      ],
      { cols: 2 },
    )}</div>
    <div class="st-gap"></div>
    ${S.label("DEPLOYMENT PACKAGE", "sealed identities the agent runs")}
    ${p ? "" : missing("deployment package")}
    <div class="st-kvwide st-kvwide--4">${kv(
      [
        ["Package", p ? html`<span class="mono strong" data-package="${p.package_id}">${p.package_id}</span>` : null],
        ["Created", dt(p?.created_at)],
        ["Spec hash", hash(p?.spec_hash)],
        ["Data identity", mono(p?.data_identity)],
        ["Executor identity", mono(p?.executor_identity)],
        ["Cost model identity", mono(p?.cost_model_identity)],
        ["Risk limits", p?.risk_limits_ref ? html`<span class="ref st-ref--plain">${p.risk_limits_ref}</span>` : null],
        ["Notes", p?.notes?.length ? html`<ul class="st-ul">${p.notes.map((c) => html`<li>${c}</li>`)}</ul>` : null],
      ],
      { cols: 2 },
    )}</div>`;
}

/* ================================================================ lineage, proposals, memories, findings */

function lineage(ctx, s, v, st, ssrc) {
  if (!v) return S.offEmpty(ssrc, sourceTitle(ssrc, "Lineage"), "Will list the hypotheses, trials, memories, proposals and earlier versions this version derives from.");
  const research = doc(ctx, "research");
  const fromHyps = research ? research.hypotheses.filter((h) => h.strategy_id === s.strategy_id) : [];
  const declared = v.lineage ?? [];
  const row = (kind, ref, href, note, by) => html`<li class="st-lin" data-lineage-kind="${kind}">
    <span class="st-lin__kind">${humanize(kind)}</span>
    <span class="st-lin__ref">${S.refLink(ref, href)}</span>
    <span class="st-lin__note">${note ?? ""}${by ? html`<span class="st-faint">${by}</span>` : ""}</span>
  </li>`;
  return html`${S.label(`DECLARED BY v${v.version}`, "the version's own lineage references")}
    ${
      declared.length
        ? html`<ul class="st-lins">${declared.map((l) => row(l.kind, l.ref, S.lineageHref(l, st?.proposals), l.note))}</ul>`
        : emptyState({ title: `No lineage recorded for v${v.version}`, compact: true, inline: true })
    }
    ${S.label("DECLARED BY RESEARCH", "hypotheses that name this strategy")}
    ${
      research
        ? fromHyps.length
          ? html`<ul class="st-lins">${fromHyps.map((h) => row("HYPOTHESIS", h.hypothesis_id, S.hypHref(h.hypothesis_id), h.title, null))}</ul>`
          : emptyState({ title: "No hypothesis names this strategy", compact: true, inline: true })
        : html`<div class="st-inline-note ${S.offTone(source(ctx, "research"))}">${icon("info")}<span>${sourceReason(source(ctx, "research"))}</span></div>`
    }`;
}

function proposals(ctx, s, st, ssrc, memIds) {
  const focus = ctx.query?.proposal ?? null;
  const rows = s ? st.proposals.filter((p) => p.strategy_id === s.strategy_id).sort((a, b) => (a.proposed_at < b.proposed_at ? 1 : -1)) : null;
  const vlink = (n) => (s.versions.some((x) => x.version === n) ? html`<a class="ref" href="${S.strategyHref(s.strategy_id, n === s.current_version ? null : n)}">v${n}</a>` : html`<span class="mono">v${n}</span>`);
  const columns = [
    {
      label: "Proposal",
      render: (p) => html`<div class="st-stack"><span class="mono strong">${p.proposal_id}</span><span class="mono small muted" title="${fmtDateTime(p.proposed_at)}">${fmtDate(p.proposed_at)}</span></div>`,
    },
    { label: "State", render: (p) => badge(p.state) },
    { label: "Base → result", render: (p) => html`<span class="mono small">${vlink(p.base_version)} → ${isNil(p.resulting_version) ? html`<span class="st-faint">NO VERSION YET</span>` : vlink(p.resulting_version)}</span>` },
    {
      label: "Summary · rationale",
      render: (p) => html`<div class="st-stack"><span class="text-2">${p.summary}</span>${p.rationale ? html`<span class="st-faint-sans">${p.rationale}</span>` : ""}</div>`,
      cls: "st-wrap",
    },
    {
      label: "Proposed by",
      // one proposer reference: the agent slot when declared (raw producer ref as its tooltip), else the raw ref
      render: (p) => (isNil(p.agent_slot) ? html`<span class="mono small">${p.proposed_by}</span>` : S.agentLink(p.agent_slot, { title: p.proposed_by })),
    },
    {
      label: "Evidence",
      render: (p) => (p.evidence_refs.length ? html`<span class="st-stack">${p.evidence_refs.map((r) => S.refLink(r, memIds.has(r) ? S.memoryHref(r) : null))}</span>` : null),
    },
  ];
  return S.regTable({
    columns,
    rows,
    rowCls: (p) => (p.proposal_id === focus ? "is-focus" : ""),
    rowAttrs: (p) => html`data-proposal="${p.proposal_id}" data-proposal-focus="${p.proposal_id === focus ? "1" : "0"}"`,
    empty: s
      ? emptyState({ title: `No proposals recorded for ${s.strategy_id}`, reason: "Agents and researchers may propose improvements; under SENTRY policy each may only become a new version after research validation and governance approval.", compact: true })
      : sourceEmpty(ssrc, { compact: true, title: sourceTitle(ssrc, "Proposals") }),
  });
}

function memories(ctx, id) {
  const mem = doc(ctx, "memory");
  const msrc = source(ctx, "memory");
  const rows = mem ? mem.memories.filter((m) => m.related_strategies?.includes(id)) : null;
  const columns = [
    { label: "Memory", render: (m) => html`<a class="ref" href="${S.memoryHref(m.memory_id)}">${m.memory_id}</a>` },
    {
      label: "Title · type",
      render: (m) => html`<div class="st-stack"><span class="text-2">${m.title}</span><span class="st-faint">${humanize(m.type)}</span></div>`,
      cls: "st-wrap",
    },
    { label: "Confidence", render: (m) => badge(m.confidence) },
    { label: "Validation", render: (m) => badge(m.validation_state) },
    { label: "Status", render: (m) => badge(m.status) },
    { label: "Origin", render: (m) => S.originCell(m.origin) },
  ];
  return S.regTable({
    columns,
    rows,
    rowHref: (m) => S.memoryHref(m.memory_id),
    rowAttrs: (m) => html`data-memory="${m.memory_id}"`,
    empty: mem
      ? emptyState({ title: `No memory references ${id}`, reason: "Lessons and observations that cite this strategy will appear here with their confidence and validation state.", compact: true })
      : sourceEmpty(msrc, { compact: true, title: sourceTitle(msrc, "Memory store"), hint: "Evidence-backed memories that cite this strategy will appear here." }),
  });
}

function findings(ctx, s, st, ssrc) {
  const ids = s ? [s.strategy_id, ...st.proposals.filter((p) => p.strategy_id === s.strategy_id).map((p) => p.proposal_id)] : [];
  const mine = s ? S.strategyFindings(ctx, ids, { section: false }) : [];
  return findingsList(mine, { empty: S.noFindingsState(ctx, s ? st : null, ssrc, { subject: s ? `${s.strategy_id} or its proposals` : undefined }) });
}

/* ================================================================ page states */

/**
 * Layout: one column seam for the whole page. Above and below the full-width version history, a
 * narrow fact rail (4/12) sits beside the main evidence column (8/12); each column stacks its own
 * panels, so no panel is stretched to match an unrelated neighbour. The rail and main contents are
 * paired so the columns end close together; the last panel of each column takes up the remainder.
 * Below 1440px both columns dissolve into the grid and panels follow the reading order (st-o*).
 */
function body(ctx, { s, v, st, ssrc, h, id }) {
  const vtag = v ? `v${v.version}` : "";
  const memDoc = doc(ctx, "memory");
  const memIds = new Set(memDoc ? memDoc.memories.map((m) => m.memory_id) : []);
  const off = S.offWord(ssrc);
  return html`
    ${hero(ctx, s, v, h, ssrc)}

    <div class="grid st-cols" data-cols="evidence">
      <div class="st-col st-col--rail span-4">
        ${panel({ cls: "st-o1", code: "STR-D01", title: "Identity & rationale", sub: s ? s.strategy_id : sourceTitle(ssrc, "Registry"), body: identity(s, ssrc) })}
        ${panel({ cls: "st-o4", code: "STR-D04", title: "Multiple testing", sub: v ? `Treatment for ${vtag}` : off, body: multipleTesting(v, ssrc) })}
        ${panel({ cls: "st-o5", code: "STR-D05", title: "Regime analysis", sub: v ? `Per-regime results for ${vtag}` : off, body: regimes(v, ssrc) })}
        ${panel({ cls: "st-o6", code: "STR-D09", title: "Research lineage", sub: v ? `Where ${vtag} comes from` : sourceTitle(ssrc, "Registry"), body: lineage(ctx, s, v, st, ssrc) })}
      </div>
      <div class="st-col st-col--main span-8">
        ${panel({
          cls: "st-o2",
          code: "STR-D02",
          title: `Performance${vtag ? " · " + vtag : ""}`,
          sub: v ? "As reported for this version — every figure carries its basis" : sourceReason(ssrc),
          body: performance(v, ssrc),
        })}
        ${panel({
          cls: "st-o3",
          code: "STR-D03",
          title: `Validation checks${vtag ? " · " + vtag : ""}`,
          sub: v ? "States exactly as reported; a missing check shows NOT REPORTED" : sourceReason(ssrc),
          actions: v ? html`<span class="st-faint">VALIDATION</span>${badge(v.validation_status)}` : "",
          body: checks(v, ssrc),
        })}
      </div>
    </div>

    <div class="grid">
      ${panel({
        span: 12,
        code: "STR-D06",
        title: "Version history",
        sub: s ? `${fmtCount(s.versions.length)} ${S.plural(s.versions.length, "version", "versions")} on record · select a version to display its metrics and checks` : sourceReason(ssrc),
        body: versionTimeline(s, v, st, ssrc),
        foot: html`<span class="st-immutable">${icon("lock")}<b>Versions are immutable</b> — by contract an improvement creates a new version; a recorded version may never be modified in place.</span>`,
      })}
    </div>

    <div class="grid st-cols" data-cols="deployment">
      <div class="st-col st-col--rail span-4">
        ${panel({ cls: "st-o2", code: "STR-D08", title: `Approval & package${vtag ? " · " + vtag : ""}`, sub: "Governance decision and deployment identities", body: approvalPackage(v, ssrc) })}
        ${panel({ cls: "st-o5", code: "STR-D12", title: "Consistency findings", sub: "Cross-checks whose references include this strategy", body: findings(ctx, s, st, ssrc) })}
      </div>
      <div class="st-col st-col--main span-8">
        ${panel({
          cls: "st-o1",
          code: "STR-D07",
          title: "Deployment hand-off",
          sub: h ? `Current version v${h.version} · derived from declared facts` : s ? "No hand-off derived" : sourceReason(ssrc),
          actions: h ? (h.deployment_eligible ? badge("PASS", { label: "DEPLOYMENT ELIGIBLE" }) : badge("NOT_ELIGIBLE", { label: "NOT ELIGIBLE" })) : "",
          body: handoff(ctx, s, v, h, ssrc),
        })}
        ${panel({ cls: "st-o3", code: "STR-D10", title: "Improvement proposals", sub: "Proposals may only become new versions", body: proposals(ctx, s, st, ssrc, memIds) })}
        ${panel({ cls: "st-o4", code: "STR-D11", title: "Related memories", sub: "Memories that cite this strategy", body: memories(ctx, s?.strategy_id ?? id) })}
      </div>
    </div>
  `;
}

function backLink() {
  return html`<a class="btn st-back" href="#/strategies">${icon("collapse")}Library</a>`;
}

function notFound(ctx, id, st, ssrc) {
  const known = [...st.strategies].sort((a, b) => String(a.strategy_id).localeCompare(String(b.strategy_id), "en", { numeric: true }));
  return html`
    ${pageHeader({ kicker: "STRATEGY LIBRARY", code: "STR", title: "Strategy not found", sub: "The requested strategy id is not in the strategy registry.", right: html`${backLink()}${sourceTag(ssrc, { now: ctx.now })}` })}
    <div class="grid">
      ${panel({
        span: 8,
        cls: "lg-span-12",
        code: "STR-D00",
        title: "Unknown strategy",
        body: html`<div class="st-notfound">${emptyState({
          title: `${id} is not in the registry`,
          reason: html`strategies.json is connected and lists ${S.splitInline(S.originSplit(st.strategies))} ${S.plural(st.strategies.length, "strategy", "strategies")}; none has this id. Nothing is shown in its place.`,
          hint: "Strategy ids are assigned by the research engine when a strategy is registered. Check the id, or pick one from the registry.",
          iconName: "strategies",
          code: "strategy-not-found",
        })}</div>`,
      })}
      ${panel({
        span: 4,
        cls: "lg-span-12",
        code: "STR-REG",
        title: "Registered strategies",
        sub: html`${S.splitInline(S.originSplit(known))} on record`,
        body: known.length
          ? html`<ul class="st-known">${known.map(
              (s) => html`<li><a class="ref" href="${S.strategyHref(s.strategy_id)}">${s.strategy_id}</a><span class="st-known__name">${s.name}</span>${badge(s.status)}</li>`,
            )}</ul>`
          : emptyState({ title: "No strategies registered", compact: true }),
      })}
    </div>`;
}

/* ================================================================ view */

export default {
  title: (ctx) => ctx.params?.id ?? "Strategy",
  render(ctx) {
    const id = ctx.params.id;
    const st = doc(ctx, "strategies");
    const ssrc = source(ctx, "strategies");

    if (!st) {
      // The registry is unavailable: say exactly why (not connected ≠ not produced ≠ contract error ≠ unreadable).
      return html`
        ${pageHeader({
          kicker: "STRATEGY LIBRARY",
          code: "STR",
          title: html`<span class="st-title-id">${id}</span> <span class="st-title-name st-title-name--nc ${S.offTone(ssrc)}" data-source-status="${ssrc?.status ?? ""}">${sourceTitle(ssrc, "Registry")}</span>`,
          sub: "The full strategy record renders below with every field empty until a valid strategy registry (strategies.json) is available.",
          right: html`${backLink()}${sourceTag(ssrc, { now: ctx.now })}`,
        })}
        <div class="st-ncbar">${sourceEmpty(ssrc, {
          compact: true,
          title: `Cannot resolve ${id} — ${sourceTitle(ssrc, "strategy registry")}`,
          hint: "Nothing below is inferred. Each panel shows exactly which field will appear once the registry is available and valid.",
        })}</div>
        ${body(ctx, { s: null, v: null, st: null, ssrc, h: null, id })}`;
    }

    const s = st.strategies.find((x) => x.strategy_id === id);
    if (!s) return notFound(ctx, id, st, ssrc);

    const cur = currentVersion(s);
    let v = cur;
    let missing = null;
    const q = ctx.query?.v;
    if (!isNil(q) && q !== "") {
      const n = Number(q);
      const found = Number.isInteger(n) ? s.versions.find((x) => x.version === n) : null;
      if (found) v = found;
      else missing = q;
    }
    const h = handoffFor(ctx, s.strategy_id);
    const versionsText = [...s.versions].sort((a, b) => a.version - b.version).map((x) => `v${x.version}`).join(", ");

    return html`
      ${pageHeader({
        kicker: "STRATEGY LIBRARY",
        code: "STR",
        title: html`<span class="st-title-id">${s.strategy_id}</span> <span class="st-title-name">${s.name}</span>`,
        sub: s.mechanism ? html`<span class="st-faint">MECHANISM</span> ${s.mechanism}` : html`<span class="st-faint">MECHANISM NOT REPORTED</span>`,
        right: html`${backLink()}${sourceTag(ssrc, { now: ctx.now })}`,
      })}
      ${
        missing
          ? html`<div class="st-notice">${notice({
              tone: "warn",
              title: `Version v${missing} does not exist`,
              body: html`${s.strategy_id} has ${versionsText} on record. Showing the current version, v${cur.version}.`,
            })}</div>`
          : ""
      }
      ${
        v !== cur
          ? html`<div class="st-notice" data-earlier-version="${v.version}">${notice({
              tone: "info",
              iconName: "version",
              title: `Viewing v${v.version} — not the current version`,
              body: html`v${v.version} is recorded as ${humanize(v.status)}. The current version is <a class="ref" href="${S.strategyHref(s.strategy_id)}">v${cur.version}</a>. Versions are immutable records; this one is shown exactly as recorded.`,
            })}</div>`
          : ""
      }
      ${body(ctx, { s, v, st, ssrc, h, id })}`;
  },
  mount(root) {
    const el = root.querySelector('[data-proposal-focus="1"]');
    if (el) el.scrollIntoView({ block: "center" });
    return S.mountOverflowEdges(root);
  },
};
