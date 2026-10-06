// Strategy Library — every registered strategy, filtered by category
// (/strategies, /candidates, /validated, /deployed, /retired via ctx.props.filter).
// Shows the status lifecycle with real counts (split by record origin), an
// honest validated-strategy verdict, the registry table with each current
// version's evidence-basis headline figures, the library → live delivery flow,
// improvement proposals, strategy findings and the locked deployment controls.
// Statuses, validation verdicts and eligibility are the producers'; this page
// only filters, counts and displays them.

import { html } from "../core/html.js";
import { fmtCount, fmtDate, fmtDateTime, isNil } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort, sourceTitle, currentVersion, findingsFor } from "../core/state.js";
import { pageHeader, panel, badge, stat, statRow, sourceTag, sourceEmpty, emptyState, findingsList, metric, tabs, val } from "../components/ui.js";
import { icon } from "../components/icons.js";
import * as S from "./_strategies-common.js";
import { lifecycleDiagram, lifecycleRoster, deliveryFlow } from "./_strategies-flow.js";
import { steps } from "../components/flow.js";

const DEPLOY_ACTIONS = ["ASSIGN_STRATEGY", "START_SIMULATION", "ENABLE_LIVE"];

function filterOf(ctx) {
  const k = ctx.props?.filter;
  return S.FILTERS[k] ?? S.FILTERS.all;
}

/* ---------------------------------------------------------------- tabs + filter definition */

/**
 * Category tabs. Each count is split by record origin ("3 · 2 RECON"), counted from the same
 * registry rows the filter lists — never one number across ORIGINAL and RECONSTRUCTED records.
 * No count at all while the registry is unavailable.
 */
function categoryTabs(F, rows) {
  return tabs(
    S.FILTER_ORDER.map((k) => {
      const f = S.FILTERS[k];
      const split = rows ? S.originSplit(rows.filter((r) => f.test(r.s, r.v)).map((r) => r.s)) : null;
      return { key: k, href: "#" + f.path, label: f.tab, count: split ? S.splitInline(split, { cls: "st-split--tab" }) : null };
    }),
    F.key,
  );
}

function filterStrip(F, listed, rows, ssrc) {
  const all = rows ? S.originSplit(rows.map((r) => r.s)) : null;
  return html`<div class="st-filterdef" data-filter="${F.key}">
    <span class="st-filterdef__k">${icon("sources")}FILTER · ${F.tab.toUpperCase()}</span>
    <span class="st-filterdef__def">${F.definition}</span>
    <span class="st-filterdef__n" data-filter-count>${
      rows
        ? html`${S.splitInline(S.originSplit(listed.map((r) => r.s)))} of ${S.splitInline(all)} registered ${S.plural(rows.length, "strategy", "strategies")} listed`
        : html`${S.offLabel(ssrc)}<span class="st-nodata"> · NOTHING TO FILTER</span>`
    }</span>
  </div>`;
}

/* ---------------------------------------------------------------- verdict (validated strategies) */

/** Rows whose current version is declared VALIDATED but whose strategy is RETIRED or REJECTED — excluded from "validated". */
function endedValidated(rows) {
  return rows.filter((r) => r.v?.validation_status === "VALIDATED" && S.ENDED.includes(r.s.status));
}

/** Names the strategies the validated filter excludes, so "none validated" is never read as "no version ever passed". */
function excludedNote(excl) {
  if (!excl.length) return "";
  return html` <span class="st-excluded" data-excluded-validated="${excl.map((r) => r.s.strategy_id).join(",")}">Excluded although their current version is VALIDATED: ${excl.map(
    ({ s, v }, i) => html`${i ? ", " : ""}<a class="ref" href="${S.strategyHref(s.strategy_id)}">${s.strategy_id}</a> <span class="mono small">v${v.version}</span> (${S.STATUS_LABEL[s.status] ?? s.status})`,
  )}.</span>`;
}

function verdict(ctx, st, ssrc, rows) {
  if (!st) {
    // The registry is unavailable — say why exactly (not connected ≠ not produced ≠ contract error ≠ unreadable).
    return html`<div class="st-verdict is-nc ${S.offTone(ssrc)}" data-validated-state="unavailable" data-source-status="${ssrc?.status ?? ""}">
      <div class="st-verdict__k">VALIDATED STRATEGIES · CURRENT VERSIONS</div>
      <div class="st-verdict__word" data-validated-count>${sourceShort(ssrc)}</div>
      <div class="st-verdict__why">${sourceReason(ssrc)} No strategy is shown as validated until the strategy registry reports it — none is assumed.</div>
    </div>`;
  }
  const validated = rows.filter((r) => S.FILTERS.validated.test(r.s, r.v));
  if (!validated.length) {
    return html`<div class="st-verdict is-none" data-validated-state="none">
      <div class="st-verdict__k">VALIDATED STRATEGIES · CURRENT VERSIONS</div>
      <div class="st-verdict__word" data-validated-count>NO VALIDATED STRATEGIES</div>
      <div class="st-verdict__why">${
        rows.length
          ? html`The registry is connected and lists ${S.splitInline(S.originSplit(rows.map((r) => r.s)))} ${S.plural(rows.length, "strategy", "strategies")}; none is an active strategy whose current version the research engine declares VALIDATED (RETIRED and REJECTED excluded).${excludedNote(endedValidated(rows))}`
          : "The registry is connected and lists no strategies."
      } No-trade is a valid outcome — no edge found is better than a fake edge found.</div>
    </div>`;
  }
  return html`<div class="st-verdict is-some" data-validated-state="some">
    <div class="st-verdict__k">VALIDATED STRATEGIES · CURRENT VERSIONS</div>
    <div class="st-verdict__num" data-validated-count>${S.splitVal(S.originSplit(validated.map((r) => r.s)), { cls: "st-split--xl" })}<span class="st-verdict__unit">DECLARED VALIDATED</span></div>
    <div class="st-verdict__ids">${validated.map(
      ({ s, v }) => html`<span class="st-idchip"><a class="ref" href="${S.strategyHref(s.strategy_id)}">${s.strategy_id}</a><span class="mono small muted">v${v.version}</span>${badge(s.status)}</span>`,
    )}</div>
  </div>`;
}

function registryCounts(rows, ssrc) {
  const by = (pred) => (rows ? S.originSplit(rows.filter(pred).map((r) => r.s)) : null);
  const tiles = [
    ["Registered", by(() => true), "All statuses"],
    ["Candidates", by((r) => S.FILTERS.candidates.test(r.s, r.v)), "Not yet validated"],
    ["Validated", by((r) => S.FILTERS.validated.test(r.s, r.v)), "Current version"],
    ["Deployed", by((r) => S.FILTERS.deployed.test(r.s, r.v)), "Sim · live · scaled"],
    ["Retired", by((r) => r.s.status === "RETIRED"), "Withdrawn"],
    ["Rejected", by((r) => r.s.status === "REJECTED"), "Kept on record"],
  ];
  return statRow(
    tiles.map(([label, split, hint]) => stat({ label, value: split ? S.splitVal(split) : null, hint, emptyLabel: sourceShort(ssrc), size: "sm" })),
    { min: 104 },
  );
}

function eligibility(ctx, st, ssrc) {
  const ids = derived(ctx, "controls")?.deployment_eligible;
  const head = html`<div class="st-elig__k">DEPLOYMENT-ELIGIBLE <span class="st-faint">VALIDATED · APPROVED · PACKAGED — DERIVED FROM DECLARED STATE</span></div>`;
  if (!st) return html`<div class="st-elig">${head}<div class="st-elig__v">${val(null)} ${S.offLabel(ssrc, "REGISTRY")}</div></div>`;
  if (!ids) return html`<div class="st-elig">${head}<div class="st-elig__v">${val(null)} <span class="st-nodata">NOT DERIVED</span></div></div>`;
  if (!ids.length) return html`<div class="st-elig">${head}<div class="st-elig__v"><span class="st-none-word">NONE</span> <span class="small muted">No current version in the registry is declared validated, approved and packaged.</span></div></div>`;
  return html`<div class="st-elig">${head}<div class="st-elig__v cluster">${ids.map((id) => {
    const s = st.strategies.find((x) => x.strategy_id === id);
    return html`<span class="st-idchip"><a class="ref" href="${S.strategyHref(id)}">${id}</a>${s ? badge(s.status) : ""}</span>`;
  })}</div></div>`;
}

/* ---------------------------------------------------------------- registry table */

/** Two-line column header: main label over a faint sub-label. */
const th2 = (main, sub) => html`<span class="st-th2">${main}<span class="st-th2__sub">${sub}</span></span>`;

function updatedText(s) {
  return s.last_update ? html`<span class="mono small st-nowrap" title="${fmtDateTime(s.last_update)}">${fmtDate(s.last_update)}</span>` : null;
}

function registryTable(ctx, F, st, ssrc, listed, rows) {
  // Identity, provenance and mechanism share the first cell, Status stacks version and
  // validation, and Agent stacks the record's last update, so the evidence-basis figures
  // (net return, Sharpe, max drawdown) fit without horizontal scroll down to 1024px. A
  // non-ORIGINAL record carries its origin badge next to its id on every width.
  const columns = [
    {
      label: th2("Strategy", "Name · mechanism"),
      title: "Strategy id and record origin, name and mechanism",
      render: ({ s }) => html`<div class="st-cell-id">
        <div class="st-cell-id__top"><a class="ref" href="${S.strategyHref(s.strategy_id)}" data-strategy-link="${s.strategy_id}">${s.strategy_id}</a>${
          s.origin === "ORIGINAL" ? "" : html`<span class="st-cell-origin" data-origin="${s.origin}">${S.originCell(s.origin)}</span>`
        }</div>
        <span class="st-cell-name" title="${s.name}">${s.name}</span>
        ${s.mechanism ? html`<span class="st-cell-mech" title="${s.mechanism}">${s.mechanism}</span>` : html`<span class="st-cell-mech st-nodata">MECHANISM NOT REPORTED</span>`}
      </div>`,
      cls: "st-col-id",
    },
    {
      label: th2("Market", "Inst · TF"),
      title: "Market, instrument and timeframe",
      render: ({ s }) =>
        html`<div class="st-cell-mkt"><span class="st-cell-mkt__m" title="${s.market ?? ""}">${s.market ?? val(null)}</span><span class="st-cell-mkt__i"><span class="st-cell-mkt__k">INST</span>${s.instrument ?? val(null)}<span class="st-cell-mkt__k">TF</span>${s.timeframe ?? val(null)}</span></div>`,
      cls: "st-col-mkt",
    },
    {
      label: th2("Status", "Version · validation"),
      title: "Registry status; current version / versions on record, and the current version's validation status",
      render: ({ s, v }) =>
        html`<div class="st-cell-stv">${badge(s.status)}<span class="st-cell-stv__v"><span class="mono" title="Current version / versions on record">v${s.current_version}<span class="st-faint">/${fmtCount(s.versions.length)}</span></span>${badge(v?.validation_status)}</span></div>`,
      cls: "st-col-stv",
    },
    { label: "Net return", render: ({ v }) => metric(v?.metrics?.net_return), num: true, cls: "st-col-metric" },
    { label: "Sharpe", render: ({ v }) => metric(v?.metrics?.sharpe), num: true, cls: "st-col-metric" },
    { label: "Max DD", title: "Maximum drawdown", render: ({ v }) => metric(v?.metrics?.max_drawdown), num: true, cls: "st-col-metric" },
    {
      label: th2("Agent", "Updated"),
      title: "Agent slot the registry names; last update of the registry record (UTC)",
      render: ({ s }) => html`<div class="st-cell-agt"><span>${isNil(s.assigned_agent) ? val(null) : S.agentLink(s.assigned_agent)}</span><span class="st-cell-agt__u">${updatedText(s) ?? val(null)}</span></div>`,
      cls: "st-col-agt",
    },
  ];

  let empty;
  if (!st) {
    empty = sourceEmpty(ssrc, {
      title: sourceTitle(ssrc, F.key === "validated" ? "Validated strategies" : "Strategy registry"),
      hint: "Each strategy will be listed with its record origin, name, mechanism, market, status, current version, validation status, headline net return, Sharpe and max drawdown (each tagged with its evidence basis), assigned agent and last update.",
    });
  } else if (F.key === "validated") {
    empty = html`<div class="st-novalid" data-empty-state="no-validated-strategies">
      ${icon("validation", "st-novalid__icon")}
      <div class="st-novalid__title">NO VALIDATED STRATEGIES</div>
      <div class="st-novalid__reason">${
        rows.length
          ? html`None of the ${S.splitInline(S.originSplit(rows.map((r) => r.s)))} registered ${S.plural(rows.length, "strategy", "strategies")} is an active strategy whose current version the research engine declares VALIDATED (RETIRED and REJECTED excluded).${excludedNote(endedValidated(rows))}`
          : "The strategy registry is connected and lists no strategies."
      } Under SENTRY policy only a validated version may proceed to approval, packaging and an agent.</div>
      <div class="st-novalid__doctrine"><span>NO-TRADE &gt; WEAK TRADE</span><span>NO EDGE FOUND &gt; FAKE EDGE FOUND</span></div>
      <div class="st-novalid__hint">When a version passes validation it appears here with its out-of-sample figures, then moves through governance approval and a deployment package before any agent may run it.</div>
    </div>`;
  } else {
    const msg = {
      all: ["No strategies registered", "strategies.json is connected and lists no strategies."],
      candidates: ["No candidate strategies", "No registered strategy is CANDIDATE or IN VALIDATION."],
      deployed: ["No deployed strategies", "No registered strategy has status DEPLOYED_SIM, DEPLOYED_LIVE or SCALED."],
      retired: ["No retired strategies", "No registered strategy has status RETIRED."],
    }[F.key];
    empty = emptyState({ title: msg[0], reason: msg[1], compact: true, code: `none-${F.key}` });
  }

  return S.regTable({
    columns,
    rows: listed,
    empty,
    rowHref: ({ s }) => S.strategyHref(s.strategy_id),
    rowAttrs: ({ s, v }) => html`data-strategy="${s.strategy_id}" data-status="${s.status}" data-validation="${v?.validation_status ?? ""}" data-origin="${s.origin}"`,
    cls: "st-reg",
  });
}

/* ---------------------------------------------------------------- delivery flow */

function flowStages(ctx, st, rows, ssrc) {
  const eligibleIds = derived(ctx, "controls")?.deployment_eligible ?? [];
  const agentsSrc = source(ctx, "agents");
  const slots = derived(ctx, "agent_slots");
  const mem = doc(ctx, "memory");
  // an unavailable source names its status under the empty value instead of a unit
  const unit = (ok, text, src, what) => (ok ? text : `${what} · ${sourceShort(src)}`);
  const ops = ["portfolio", "risk", "execution", "live"];
  return [
    { key: "LIBRARY", code: "STR", label: "Strategy library", desc: "Registered strategies and their immutable versions", href: "#/strategies", value: rows ? S.originSplit(rows.map((r) => r.s)) : null, unit: unit(rows, "REGISTERED", ssrc, "REGISTRY") },
    {
      key: "VALIDATION",
      code: "VAL",
      label: "Validation",
      desc: "Research engine declares the current version VALIDATED",
      href: "#/research/validation",
      value: rows ? S.originSplit(rows.filter((r) => S.FILTERS.validated.test(r.s, r.v)).map((r) => r.s)) : null,
      unit: unit(rows, "VALIDATED", ssrc, "REGISTRY"),
    },
    {
      key: "DEPLOYMENT",
      code: "GOV",
      label: "Deployment",
      desc: "Governance approval and a sealed deployment package",
      href: "#/governance",
      value: st ? S.originSplit(st.strategies.filter((s) => eligibleIds.includes(s.strategy_id))) : null,
      unit: unit(st, "ELIGIBLE", ssrc, "REGISTRY"),
    },
    {
      key: "AGENT",
      code: "AGT",
      label: "Agent",
      desc: "Assigned to one of five agent slots — simulation first",
      href: "#/agents",
      value: agentsSrc?.status === "OK" && slots ? slots.filter((x) => x.has_strategy).length : null,
      unit: unit(agentsSrc?.status === "OK", "SLOTS DECLARING AN ASSIGNMENT", agentsSrc, "AGENTS"),
    },
    {
      key: "OPERATIONS",
      code: "OPS",
      label: "Portfolio · risk · execution · live",
      desc: "Sized, limited, executed and monitored",
      href: "#/live",
      sources: ops.map((k) => source(ctx, k)),
      sourceKeys: ops,
      sourceLabels: ["Portfolio", "Risk", "Execution", "Live"],
    },
    {
      key: "MEMORY",
      code: "MEM",
      label: "Memory",
      desc: "Outcomes recorded as evidence-backed memory",
      href: "#/memory",
      value: mem ? S.originSplit(mem.memories.filter((m) => m.related_strategies?.length)) : null,
      unit: unit(mem, "MEMORIES CITING A STRATEGY", source(ctx, "memory"), "MEMORY"),
    },
  ];
}

/* ---------------------------------------------------------------- proposals */

const PROPOSAL_FLOW = [
  ["PROPOSED", "Proposed", "AGENT · RESEARCHER"],
  ["IN_RESEARCH", "In research", "RESEARCH ENGINE"],
  ["VALIDATED", "Validated", "RESEARCH ENGINE"],
  ["APPROVED", "Approved", "GOVERNANCE"],
  ["RELEASED_AS_VERSION", "Released as version", "GOVERNANCE"],
  ["REJECTED", "Rejected", "RESEARCH · GOVERNANCE"],
];

function proposalFlow(st) {
  return steps(
    PROPOSAL_FLOW.map(([state, label, owner]) => ({
      key: state,
      label,
      count: st ? st.proposals.filter((p) => p.state === state).length : null,
      owner,
      boundary: state === "APPROVED" || state === "REJECTED",
    })),
    { cls: "st-pflow" },
  );
}

function proposalsTable(st, ssrc) {
  const rows = st ? [...st.proposals].sort((a, b) => (a.proposed_at < b.proposed_at ? 1 : -1)) : null;
  const columns = [
    { label: "Proposal", render: (p) => html`<a class="ref" href="${S.qhref(`/strategy/${encodeURIComponent(p.strategy_id)}`, { proposal: p.proposal_id })}">${p.proposal_id}</a>` },
    { label: "Strategy", render: (p) => html`<a class="ref" href="${S.strategyHref(p.strategy_id)}">${p.strategy_id}</a>` },
    { label: "State", render: (p) => badge(p.state) },
    {
      label: "Version",
      title: "Base version → resulting version",
      render: (p) => html`<span class="mono small">v${p.base_version} → ${isNil(p.resulting_version) ? html`<span class="st-faint">—</span>` : `v${p.resulting_version}`}</span>`,
    },
    { label: "Summary", render: (p) => html`<span class="text-2">${p.summary}</span>`, cls: "st-wrap" },
    { label: "By", render: (p) => (isNil(p.agent_slot) ? html`<span class="mono small">${p.proposed_by}</span>` : S.agentLink(p.agent_slot)) },
    { label: "Proposed", render: (p) => html`<span class="mono small">${fmtDateTime(p.proposed_at)}</span>` },
  ];
  return S.regTable({
    columns,
    rows,
    rowAttrs: (p) => html`data-proposal="${p.proposal_id}"`,
    empty: st
      ? emptyState({ title: "No improvement proposals recorded", reason: "No agent or researcher has proposed a change to any strategy.", compact: true })
      : sourceEmpty(ssrc, { compact: true, title: sourceTitle(ssrc, "Proposals"), hint: "Each proposed improvement will appear with its base version and — if released — the new version it became." }),
    maxHeight: 340,
  });
}

/* ---------------------------------------------------------------- view */

export default {
  title: (ctx) => filterOf(ctx).title,
  render(ctx) {
    const F = filterOf(ctx);
    const st = doc(ctx, "strategies");
    const ssrc = source(ctx, "strategies");
    const rows = st ? st.strategies.map((s) => ({ s, v: currentVersion(s) })) : null;
    const listed = rows ? rows.filter((r) => F.test(r.s, r.v)).sort(S.byStrategyId) : null;
    const highlight = new Set(F.key === "all" || !listed ? [] : listed.map((r) => r.s.status));
    // filed under "strategies", or referencing a registered strategy / proposal from any check
    const findings = st ? S.strategyFindings(ctx, [...st.strategies.map((x) => x.strategy_id), ...st.proposals.map((p) => p.proposal_id)]) : findingsFor(ctx, "strategies");
    const controls = derived(ctx, "controls");

    return html`
      ${pageHeader({
        kicker: "STRATEGIES",
        code: "STR",
        title: F.title,
        sub: F.sub,
        right: html`${sourceTag(ssrc, { now: ctx.now })}`,
      })}

      ${categoryTabs(F, rows)}
      ${filterStrip(F, listed, rows, ssrc)}

      <div class="grid">
        ${panel({
          span: 8,
          cls: "lg-span-12 st-lcpanel",
          code: "STR-01",
          title: "Strategy lifecycle",
          sub: rows ? html`Current status of ${S.splitInline(S.originSplit(rows.map((r) => r.s)))} registered ${S.plural(rows.length, "strategy", "strategies")}` : sourceReason(ssrc),
          body: html`<div class="st-lc-wrap">${lifecycleDiagram(rows, { highlight })}${lifecycleRoster(rows, { hrefFor: (s) => S.strategyHref(s.strategy_id) })}</div>
            <div class="st-lc-legend">
              <span>COUNT = STRATEGIES WHOSE CURRENT STATUS IS THIS · SPLIT BY RECORD ORIGIN, NEVER MERGED</span>
              ${F.key !== "all" && listed?.length ? html`<span class="st-lc-legend__hl">DASHED BRACKET = STATUSES OF THE STRATEGIES LISTED UNDER ${F.tab.toUpperCase()}</span>` : ""}
            </div>`,
        })}
        ${panel({
          span: 4,
          cls: "lg-span-12 st-verdictpanel",
          code: "STR-02",
          title: "Registry verdict",
          sub: "Declared by the research engine",
          body: html`${verdict(ctx, st, ssrc, rows)}<div class="st-gap"></div><div class="st-kpis">${registryCounts(rows, ssrc)}</div>${eligibility(ctx, st, ssrc)}`,
          variant: "accent",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "STR-03",
          title: `Strategy registry · ${F.tab}`,
          sub: rows ? html`${S.splitInline(S.originSplit(listed.map((r) => r.s)))} listed · current version shown · select a row for the full strategy record` : sourceReason(ssrc),
          body: registryTable(ctx, F, st, ssrc, listed, rows),
          cls: "st-regpanel",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "STR-04",
          title: "From library to live",
          sub: "The path a validated strategy must take — every hand-off gated and recorded",
          body: deliveryFlow(flowStages(ctx, st, rows, ssrc)),
        })}
      </div>

      <div class="grid st-cols" data-cols="proposals">
        <div class="st-col st-col--main span-8">
          ${panel({
            cls: "st-o1",
            code: "STR-05",
            title: "Improvement proposals",
            sub: "A proposal may only become a new version — never an edit",
            body: html`${S.label("PROPOSALS BY STATE", "each step is gated; agents may not release a version")}${proposalFlow(st)}${S.label("RECORDED PROPOSALS", st ? `${fmtCount(st.proposals.length)} on record · newest first` : null)}${proposalsTable(st, ssrc)}`,
          })}
        </div>
        <div class="st-col st-col--rail span-4">
          ${panel({
            cls: "st-o2 st-half",
            code: "STR-07",
            title: "Deployment controls",
            sub: "Locked — reasons computed from state",
            body: controls ? S.lockedControls(controls.actions.filter((a) => DEPLOY_ACTIONS.includes(a.key))) : emptyState({ title: "No snapshot", compact: true }),
          })}
          ${panel({
            cls: "st-o3 st-half",
            code: "STR-06",
            title: "Strategy findings",
            sub: "Cross-checks of declared strategy state — not verdicts",
            body: findingsList(findings, { empty: S.noFindingsState(ctx, st, ssrc) }),
          })}
        </div>
      </div>
    `;
  },
  mount(root) {
    return S.mountOverflowEdges(root);
  },
};
