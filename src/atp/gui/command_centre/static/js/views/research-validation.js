// Validation — the gate between research and deployment. Shows whether any
// strategy's current version is declared VALIDATED (and says plainly when none
// is), the validation matrix of strategies × the thirteen contract checks
// (NOT REPORTED where the research engine has not reported a check), the
// multiple-testing treatment per strategy, the full check detail for one
// strategy (?strategy=), and the strategy-section consistency findings.
// Verdicts are the research engine's; this page only displays them.

import { html } from "../core/html.js";
import { humanize, fmtCount, fmtDateTime, shortHash } from "../core/format.js";
import { derived, findingsFor, sourceReason } from "../core/state.js";
import { pageHeader, panel, badge, stat, statRow, sourceTag, emptyState, findingsList, originBadge, val } from "../components/ui.js";
import { toneClass } from "../core/tones.js";
import * as B from "./_research-b-common.js";

const PATH = "/research/validation";
/** Strategy statuses that end a strategy: a VALIDATED current version under them is not counted as validated. */
const ENDED = ["RETIRED", "REJECTED"];

/** What a strategy must demonstrate, mapped to the contract checks that report it. Doctrine. */
const GATE = [
  ["Economic rationale", "A causal reason the effect should exist, stated before testing.", ["economic_rationale"]],
  ["Positive expectancy", "Expectancy above zero after every cost.", ["positive_expectancy"]],
  ["Realistic costs", "Commission, spread and slippage at realistic levels — and survival when they are stressed.", ["realistic_costs", "cost_sensitivity"]],
  ["Robustness", "The result survives perturbation and resampling.", ["robustness", "monte_carlo"]],
  ["Parameter stability", "A plateau, not a knife-edge optimum.", ["parameter_stability"]],
  ["Regime resilience", "Behaviour across regimes is understood — where appropriate.", ["regime_analysis"]],
  ["Out-of-sample evidence", "It holds on data never used to build or select it.", ["out_of_sample"]],
  ["Walk-forward", "It holds when re-fitted and tested forward in time — where appropriate.", ["walk_forward"]],
  ["Multiple-testing treatment", "Significance corrected for every trial ever run in the family.", ["multiple_testing"]],
  ["Realistic execution", "Fills, latency and capacity that can actually be achieved.", ["execution_realism"]],
  ["Sufficient sample size", "Enough independent observations to support the claim.", ["sample_size"]],
];

/* ---------------------------------------------------------------- gate status */

/** Names the strategies the validated count excludes, so "none validated" is never read as "no version ever passed". */
function excludedNote(former) {
  if (!former.length) return "";
  return html`<div class="rsb-gate__former" data-excluded-validated="${former.map(({ s }) => s.strategy_id).join(",")}">Excluded although their current version is VALIDATED: ${former.map(
    ({ s, v }, i) => html`${i ? ", " : ""}${B.refLink(s.strategy_id, B.strategyHref(s.strategy_id))} <span class="mono small">v${v.version}</span> <span class="muted">(${humanize(s.status)})</span>`,
  )} — not counted.</div>`;
}

function gateStatus(ctx, st, ssrc, cv) {
  const controls = derived(ctx, "controls");
  const eligible = controls?.deployment_eligible ?? null;
  if (!st) {
    return html`<div class="rsb-gate ${B.srcBroken(ssrc) ? "is-bad " + toneClass(ssrc.status) : ""}" data-gate="unknown" data-source-off="${ssrc?.status ?? ""}">
      <div class="rsb-gate__k">VALIDATED STRATEGIES</div>
      <div class="rsb-gate__v is-empty">${val(null)}<span class="rsb-gate__word">${B.offLabel(ssrc)}</span></div>
      <div class="rsb-gate__why">${sourceReason(ssrc)} Nothing can be shown as validated until the strategy registry reports it — none is assumed.</div>
    </div>
    ${validationCounts(null, ssrc)}`;
  }
  // Active strategies only: a VALIDATED current version under a RETIRED or REJECTED strategy is
  // named separately (the same filter derive.research_summary.validated applies).
  const live = cv.filter(({ s, v }) => v.validation_status === "VALIDATED" && !ENDED.includes(s.status));
  const former = cv.filter(({ s, v }) => v.validation_status === "VALIDATED" && ENDED.includes(s.status));
  const active = cv.filter(({ s }) => !ENDED.includes(s.status));
  const none = live.length === 0;
  const strategiesText = (rows) => B.splitText(B.originSplit(rows.map(({ s }) => s)), rows.length === 1 && rows[0].s.origin === "ORIGINAL" ? "strategy" : "strategies");
  const noEligible = eligible && eligible.length === 0;
  return html`<div class="rsb-gate ${none ? "is-none" : ""}" data-gate="${none ? "none" : "some"}" data-validated="${String(live.length)}">
      <div class="rsb-gate__k">VALIDATED STRATEGIES · CURRENT VERSIONS · ACTIVE ONLY</div>
      ${
        none
          ? html`<div class="rsb-gate__none">NO VALIDATED STRATEGY</div>
              <div class="rsb-gate__why" data-gate-why>${
                cv.length
                  ? `The registry lists ${strategiesText(cv)}${
                      cv.length === active.length ? "" : ` (${strategiesText(active)} active)`
                    }; none is an active strategy whose current version the research engine declares VALIDATED (RETIRED and REJECTED excluded).`
                  : "The strategy registry is connected and lists no strategies."
              }${noEligible ? " Nothing is deployment-eligible." : ""} No-trade is a valid outcome.</div>`
          : html`<div class="rsb-gate__v">${B.splitVal(B.originSplit(live.map(({ s }) => s)))}<span class="rsb-gate__word">DECLARED VALIDATED</span></div>
              <div class="rsb-gate__ids">${live.map(({ s, v }) => html`<span class="rsb-gate__id">${B.refLink(s.strategy_id, B.strategyHref(s.strategy_id))}<span class="mono small muted">v${v.version}</span>${badge(s.status)}${originBadge(s.origin)}</span>`)}</div>`
      }
      ${excludedNote(former)}
      <div class="rsb-gate__elig">DEPLOYMENT-ELIGIBLE <span class="rsb-faint">VALIDATED · APPROVED · PACKAGED</span> ${
        !eligible
          ? val(null)
          : eligible.length
            ? html`${eligible.map((id) => {
                const s = st.strategies.find((x) => x.strategy_id === id);
                return html`<span class="rsb-gate__id">${B.refLink(id, B.strategyHref(id))}${s ? badge(s.status) : ""}${s ? originBadge(s.origin) : ""}</span>`;
              })}`
            : html`<span class="v" data-v>NONE</span>`
      }</div>
    </div>
    ${validationCounts(cv, ssrc)}`;
}

function validationCounts(cv, ssrc) {
  return html`<div class="rsb-label rsb-gap">Current versions by validation status <span class="rsb-label__extra">per record origin</span></div>
    <div class="rsb-stats4">${statRow(
      B.VALIDATION_STATUSES.map((vs) =>
        stat({
          label: humanize(vs),
          value: cv ? B.splitVal(B.originSplit(cv.filter(({ v }) => v.validation_status === vs).map(({ s }) => s))) : null,
          emptyLabel: B.offLabel(ssrc),
          hint: { NOT_STARTED: "No checks begun", IN_PROGRESS: "Checks under way", VALIDATED: "Declared by research", FAILED: "Failed validation" }[vs],
        }),
      ),
      { min: 110 },
    )}</div>`;
}

/* ---------------------------------------------------------------- doctrine */

function gateDoctrine() {
  return html`<div class="rsb-hero" data-doctrine="validation-gate">
    <div class="rsb-hero__mark"><span>DOCTRINE · THE VALIDATION GATE</span></div>
    <div class="rsb-hero__statement rsb-hero__statement--sm">No edge found is better than a fake edge found.</div>
    <p class="rsb-hero__lead">Before any strategy can be approved for an agent, the research engine must show — and record — each of the following. A missing check is reported as missing, never assumed.</p>
    <ol class="rsb-gatelist">
      ${GATE.map(
        ([t, d, keys], i) => html`<li class="rsb-gatelist__item">
          <span class="rsb-gatelist__n">${String(i + 1).padStart(2, "0")}</span>
          <div class="rsb-gatelist__body"><b>${t}</b><span>${d}</span></div>
          <span class="rsb-gatelist__keys">${keys.map((k) => html`<code>${k}</code>`)}</span>
        </li>`,
      )}
    </ol>
    ${B.gateChain("VALIDATION")}
  </div>`;
}

/* ---------------------------------------------------------------- matrix */

function matrix(st, ssrc, cv, selected) {
  const columns = [
    {
      label: "Strategy · current version · validation status",
      render: ({ s, v }) => html`<div class="rsb-stack">
        <span class="cluster">${B.refLink(s.strategy_id, B.strategyHref(s.strategy_id))}<span class="mono small">v${v.version}</span>${badge(s.status)}</span>
        <span class="rsb-sub">${s.name}</span>
        <span class="cluster"><span class="rsb-vs" data-validation-status="${v.validation_status}"><span class="rsb-faint">VALIDATION</span>${badge(v.validation_status)}</span>${originBadge(s.origin)}</span>
      </div>`,
      cls: "rsb-mx__lead",
    },
    ...B.CHECKS.map((c, i) => ({
      label: html`<span class="rsb-mx__no">${String(i + 1).padStart(2, "0")}</span>${c.short}`,
      title: `${c.label} — ${c.desc}`,
      render: ({ v }) => B.checkCell(v.validation[c.key], c.key),
      cls: "rsb-mx__cell",
      hcls: "rsb-mx__h",
    })),
  ];
  const empty = !st
    ? B.srcEmpty(ssrc, { hint: "Every strategy's current version will appear as a row against the thirteen checks above, each showing the state the research engine reported — or NOT REPORTED." })
    : emptyState({ title: "No strategies registered", reason: "strategies.json is connected and lists no strategies. There is nothing to validate.", compact: true });
  return html`${B.regTable({
    columns,
    rows: cv,
    empty,
    cls: "rsb-mx rsb-mx--val",
    rowCls: ({ s }) => (s.strategy_id === selected ? "is-selected" : ""),
    rowAttrs: ({ s, v }) => html`data-strategy="${s.strategy_id}" data-version="${String(v.version)}" data-href="${B.qhref(PATH, { strategy: s.strategy_id })}"`,
  })}
  ${cv && cv.length ? html`<div class="rsb-legendrow">
    <span class="legend">
      <span><i class="swatch tone-ok"></i>Pass</span><span><i class="swatch tone-bad"></i>Fail</span><span><i class="swatch tone-warn"></i>Pending · inconclusive · blocked</span><span><i class="swatch tone-muted"></i>Not run · not applicable</span>
    </span>
    <span class="rsb-faint">DASHED = NOT REPORTED · SELECT A ROW FOR ITS CHECK DETAIL (VAL-05)</span>
  </div>` : ""}`;
}

/* ---------------------------------------------------------------- multiple testing */

function multipleTesting(ctx, st, ssrc, rsrc, cv) {
  const ta = derived(ctx, "trial_accounting");
  const declared = ta?.available ? ta.declared : null;
  const columns = [
    { label: "Strategy", render: ({ s, v }) => html`<span class="cluster">${B.refLink(s.strategy_id, B.strategyHref(s.strategy_id))}<span class="mono small muted">v${v.version}</span></span>` },
    { label: "Treatment state", render: ({ v }) => (v.multiple_testing ? badge(v.multiple_testing.state) : html`<span class="rsb-cell rsb-cell--nr rsb-cell--inline">NOT REPORTED</span>`) },
    { label: "Method", render: ({ v }) => (v.multiple_testing?.method ? html`<span class="text-2">${v.multiple_testing.method}</span>` : null) },
    { label: "Trials in family", render: ({ v }) => B.num(v.multiple_testing?.trials_in_family), num: true },
    { label: "Global trials at decision", render: ({ v }) => B.num(v.multiple_testing?.global_trials_at_decision), num: true },
    { label: "Adjusted threshold", render: ({ v }) => B.num(v.multiple_testing?.adjusted_threshold), num: true },
    { label: "Deflated Sharpe", render: ({ v }) => B.num(v.multiple_testing?.deflated_sharpe), num: true },
    // Left-aligned text after a right-aligned numeric column: separated so header and values do not run together.
    { label: "Detail", render: ({ v }) => (v.multiple_testing?.detail ? html`<span class="rsb-sub">${v.multiple_testing.detail}</span>` : null), cls: "rsb-w-reason rsb-colsep", hcls: "rsb-colsep" },
    { label: "Check", title: "The multiple_testing validation check reported for this version", render: ({ v }) => B.checkCell(v.validation.multiple_testing, "multiple_testing"), cls: "rsb-mx__cell" },
  ];
  const empty = !st
    ? B.srcEmpty(ssrc, { compact: true, hint: "Per strategy: the correction method, trials in its family, global trials counted at the decision, the adjusted threshold and the deflated Sharpe ratio, as reported." })
    : emptyState({ title: "No strategies registered", reason: "No strategy, so no multiple-testing treatment to show.", compact: true });
  const foot = declared
    ? html`For reference, the research ledger now declares <b class="mono">${val(B.count(declared.global_count))}</b> global trials${
        declared.as_of ? html` (as of ${fmtDateTime(declared.as_of)})` : ""
      } — counts are shown side by side, never recomputed or adjusted here.`
    : ta?.available
      ? html`research.json declares no trial_accounting, so the ledger's global trial count is not shown for reference.`
      : html`The ledger's global trial count is not shown for reference: ${B.srcPhrase(rsrc)}.`;
  return html`${B.regTable({ columns, rows: cv, empty, cls: "rsb-mt", rowAttrs: ({ s }) => html`data-strategy="${s.strategy_id}"` })}<p class="rsb-note">${foot}</p>`;
}

/* ---------------------------------------------------------------- check detail */

function checkDetail(st, ssrc, cv, selectedId) {
  const sel = cv?.find(({ s }) => s.strategy_id === selectedId) ?? null;
  const connected = !!st;
  const head = sel
    ? html`<div class="rsb-detail__head">
        <span class="cluster">${B.refLink(sel.s.strategy_id, B.strategyHref(sel.s.strategy_id))}<span class="mono small">v${sel.v.version} of ${fmtCount(sel.s.versions.length)}</span>${badge(sel.s.status)}${badge(sel.v.validation_status)}${originBadge(sel.s.origin)}</span>
        <span class="rsb-sub">${sel.s.name}${sel.v.spec_hash ? html` · spec <span class="mono">${shortHash(sel.v.spec_hash, 14)}</span>` : ""}</span>
      </div>`
    : connected && selectedId
      ? html`<div class="rsb-detail__head"><span class="rsb-faint">STRATEGY ${selectedId} IS NOT IN THE REGISTRY</span></div>`
      : "";
  if (connected && !cv.length) return emptyState({ title: "No strategies registered", reason: "There is no strategy whose checks could be listed.", compact: true });
  return html`${head}
    ${!connected ? html`<div class="rsb-autoh">${B.srcEmpty(ssrc, { compact: true, hint: "The thirteen checks below will show their reported state, detail, timestamp and evidence references." })}</div>` : ""}
    <div class="rsb-checks" data-strategy="${sel?.s.strategy_id ?? ""}">
      ${B.CHECKS.map((c, i) => {
        const chk = sel ? sel.v.validation[c.key] : null;
        return html`<div class="rsb-checks__row" data-check-row="${c.key}">
          <span class="rsb-checks__n">${String(i + 1).padStart(2, "0")}</span>
          <div class="rsb-checks__body"><b>${c.label}</b><span>${chk?.detail ?? c.desc}</span>${
            chk?.evidence_refs?.length ? html`<span class="rsb-checks__refs">${chk.evidence_refs.map((r) => html`<span class="ref">${r}</span>`)}</span>` : ""
          }</div>
          <span class="rsb-checks__at">${chk?.checked_at ? fmtDateTime(chk.checked_at) : ""}</span>
          ${connected && !sel
            ? html`<span class="rsb-cell rsb-cell--nr" data-check="${c.key}" data-state="NO_STRATEGY" title="No strategy selected from the registry">NO STRATEGY</span>`
            : B.checkCell(chk, c.key, { connected, src: ssrc })}
        </div>`;
      })}
    </div>`;
}

/* ---------------------------------------------------------------- findings */

/**
 * An empty findings list means only "none from the checks that ran": it is
 * phrased from derived.check_coverage, never as a statement that the declared
 * state is sound.
 */
function findingsEmpty(ctx, st, ssrc) {
  if (!st) {
    return B.srcEmpty(ssrc, { compact: true, hint: "Findings such as a strategy declared VALIDATED while a required check is not PASS will appear here." });
  }
  const cov = (derived(ctx, "check_coverage") ?? []).find((c) => c.key === "strategy_rules") ?? null;
  if (!cov?.ran) {
    return emptyState({
      title: "Strategy cross-checks did not run",
      reason: cov ? cov.note ?? `Missing: ${cov.missing.join(", ") || "unknown"}.` : "The snapshot reports no coverage for the strategy cross-checks, so an empty list asserts nothing.",
      compact: true,
      code: "strategy-checks-not-run",
    });
  }
  return emptyState({
    title: "No findings from the strategy cross-checks that ran",
    reason: "They look for a version declared VALIDATED while a required check is not PASS, a deployment without validation, approval or package, and an in-sample headline figure on a validated version, among others. None raised a finding on the declared state.",
    compact: true,
    iconName: "shield",
    code: "strategy-checks-none",
  });
}

/* ---------------------------------------------------------------- view */

export default {
  title: "Validation",
  render(ctx) {
    const { st, ssrc, rsrc } = B.sources(ctx);
    const cv = B.currentVersions(st);
    // Default detail: the first strategy with at least one reported check (a display choice only).
    const firstReported = cv?.find(({ v }) => B.CHECKS.some((c) => v.validation[c.key])) ?? cv?.[0];
    const selected = ctx.query.strategy ?? firstReported?.s.strategy_id ?? null;
    const findings = findingsFor(ctx, "strategies");
    return html`
      ${pageHeader({
        kicker: "RESEARCH ENGINE",
        code: "VAL",
        title: "Validation",
        sub: "The gate between research and deployment. Every check is shown exactly as the research engine reported it; a check that was never reported is shown as NOT REPORTED, never as passed.",
        right: html`${sourceTag(ssrc, { now: ctx.now })}${sourceTag(rsrc, { now: ctx.now })}`,
      })}

      <div class="grid">
        <div class="span-5 lg-span-12 stack">
          ${panel({ code: "VAL-01", title: "Gate status", sub: st ? "Declared validation of current versions" : B.srcPhrase(ssrc), variant: "accent", body: gateStatus(ctx, st, ssrc, cv) })}
          ${panel({
            code: "VAL-02",
            title: "Strategy findings",
            sub: "Cross-checks of declared strategy state — not verdicts",
            body: findingsList(findings, { empty: findingsEmpty(ctx, st, ssrc) }),
          })}
        </div>
        ${panel({ span: 7, code: "VAL-03", title: "What a strategy must demonstrate", sub: "Eleven requirements · thirteen contract checks", variant: "hero", cls: "lg-span-12", body: gateDoctrine() })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "VAL-04",
          title: "Validation matrix",
          sub: cv ? `${B.splitText(B.originSplit(cv.map(({ s }) => s)), "strategies")} × ${B.CHECKS.length} checks · current versions · select a row for its check detail` : `Strategies × ${B.CHECKS.length} checks · ${B.srcPhrase(ssrc)}`,
          body: matrix(st, ssrc, cv, selected),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "VAL-05",
          title: "Check detail",
          sub: selected && cv ? `${selected} · all thirteen checks as reported` : "Thirteen contract checks",
          body: checkDetail(st, ssrc, cv, selected),
          id: "check-detail",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "VAL-06",
          title: "Multiple-testing treatment",
          sub: "Per strategy current version · as reported",
          body: multipleTesting(ctx, st, ssrc, rsrc, cv),
        })}
      </div>
    `;
  },
};
