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
import { doc, source, derived, sourceReason, sourceShort, currentVersion, findingsFor } from "../core/state.js";
import { pageHeader, panel, badge, stat, statRow, sourceTag, sourceEmpty, emptyState, findingsList, metric, control, tabs, val } from "../components/ui.js";
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

function categoryTabs(ctx, F) {
  const sum = derived(ctx, "research_summary");
  const connected = !!sum?.strategies_available;
  return tabs(
    S.FILTER_ORDER.map((k) => {
      const f = S.FILTERS[k];
      return { key: k, href: "#" + f.path, label: f.tab, count: connected && !isNil(sum[f.summaryKey]) ? fmtCount(sum[f.summaryKey]) : null };
    }),
    F.key,
  );
}

function filterStrip(F, listed, rows, ssrc) {
  return html`<div class="st-filterdef" data-filter="${F.key}">
    <span class="st-filterdef__k">${icon("sources")}FILTER · ${F.tab.toUpperCase()}</span>
    <span class="st-filterdef__def">${F.definition}</span>
    <span class="st-filterdef__n">${
      rows
        ? html`<b class="mono">${fmtCount(listed.length)}</b> of <b class="mono">${fmtCount(rows.length)}</b> registered ${S.plural(rows.length, "strategy", "strategies")} listed`
        : html`<span class="st-nodata">${sourceShort(ssrc)} · NOTHING TO FILTER</span>`
    }</span>
  </div>`;
}

/* ---------------------------------------------------------------- verdict (validated strategies) */

function verdict(ctx, st, ssrc, rows) {
  if (!st) {
    return html`<div class="st-verdict is-nc" data-validated-state="not-connected">
      <div class="st-verdict__k">VALIDATED STRATEGIES · CURRENT VERSIONS</div>
      <div class="st-verdict__word" data-validated-count>NOT CONNECTED</div>
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
          ? `The registry is connected and lists ${fmtCount(rows.length)} ${S.plural(rows.length, "strategy", "strategies")}; the research engine has declared none of their current versions VALIDATED.`
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

function registryCounts(rows) {
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
    tiles.map(([label, split, hint]) => stat({ label, value: split ? S.splitVal(split) : null, hint, emptyLabel: "NOT CONNECTED", size: "sm" })),
    { min: 104 },
  );
}

function eligibility(ctx, st) {
  const ids = derived(ctx, "controls")?.deployment_eligible;
  const head = html`<div class="st-elig__k">DEPLOYMENT-ELIGIBLE <span class="st-faint">VALIDATED · APPROVED · PACKAGED — DERIVED FROM DECLARED STATE</span></div>`;
  if (!st) return html`<div class="st-elig">${head}<div class="st-elig__v">${val(null)} <span class="st-nodata">REGISTRY NOT CONNECTED</span></div></div>`;
  if (!ids?.length) return html`<div class="st-elig">${head}<div class="st-elig__v"><span class="st-none-word">NONE</span> <span class="small muted">No current version is validated, approved and packaged.</span></div></div>`;
  return html`<div class="st-elig">${head}<div class="st-elig__v cluster">${ids.map((id) => {
    const s = st.strategies.find((x) => x.strategy_id === id);
    return html`<span class="st-idchip"><a class="ref" href="${S.strategyHref(id)}">${id}</a>${s ? badge(s.status) : ""}</span>`;
  })}</div></div>`;
}

/* ---------------------------------------------------------------- registry table */

function registryTable(ctx, F, st, ssrc, listed, rows) {
  const columns = [
    {
      label: "Strategy",
      render: ({ s }) => html`<div class="st-cell-id"><a class="ref" href="${S.strategyHref(s.strategy_id)}" data-strategy-link="${s.strategy_id}">${s.strategy_id}</a><span class="st-cell-name">${s.name}</span></div>`,
      cls: "st-col-id",
    },
    { label: "Mechanism", render: ({ s }) => (s.mechanism ? html`<span class="text-2">${s.mechanism}</span>` : null), cls: "st-col-mech" },
    {
      label: "Market · inst · TF",
      title: "Market, instrument and timeframe",
      render: ({ s }) =>
        html`<div class="st-cell-mkt"><span class="st-cell-mkt__m">${s.market ?? val(null)}</span><span class="st-cell-mkt__i"><span class="st-cell-mkt__k">INST</span>${s.instrument ?? val(null)}<span class="st-cell-mkt__k">TF</span>${s.timeframe ?? val(null)}</span></div>`,
      cls: "st-col-mkt",
    },
    { label: "Status", render: ({ s }) => badge(s.status) },
    {
      label: "Version",
      title: "Current version / versions on record",
      render: ({ s }) => html`<span class="mono">v${s.current_version}</span><span class="st-faint"> / ${fmtCount(s.versions.length)}</span>`,
    },
    { label: "Validation", title: "Current version's validation status", render: ({ v }) => badge(v?.validation_status) },
    { label: "Net return", render: ({ v }) => metric(v?.metrics?.net_return), num: true, cls: "st-col-metric" },
    { label: "Sharpe", render: ({ v }) => metric(v?.metrics?.sharpe), num: true, cls: "st-col-metric" },
    { label: "Max DD", title: "Maximum drawdown", render: ({ v }) => metric(v?.metrics?.max_drawdown), num: true, cls: "st-col-metric" },
    { label: "Agent", render: ({ s }) => (isNil(s.assigned_agent) ? null : S.agentLink(s.assigned_agent)) },
    { label: "Updated", title: "Last update (UTC)", render: ({ s }) => (s.last_update ? html`<span class="mono small st-nowrap" title="${fmtDateTime(s.last_update)}">${fmtDate(s.last_update)}</span>` : null) },
    { label: "Origin", render: ({ s }) => S.originCell(s.origin) },
  ];

  let empty;
  if (!st) {
    empty = sourceEmpty(ssrc, {
      title: F.key === "validated" ? "Validated strategies — not connected" : "Strategy registry not connected",
      hint: "Each strategy will be listed with its mechanism, market, status, current version, validation status, headline net return, Sharpe and max drawdown (each tagged with its evidence basis), assigned agent, last update and origin.",
    });
  } else if (F.key === "validated") {
    empty = html`<div class="st-novalid" data-empty-state="no-validated-strategies">
      ${icon("validation", "st-novalid__icon")}
      <div class="st-novalid__title">NO VALIDATED STRATEGIES</div>
      <div class="st-novalid__reason">${
        rows.length
          ? `None of the ${fmtCount(rows.length)} registered ${S.plural(rows.length, "strategy", "strategies")} has a current version the research engine declares VALIDATED.`
          : "The strategy registry is connected and lists no strategies."
      } Nothing here can be approved, packaged or assigned to an agent.</div>
      <div class="st-novalid__doctrine"><span>NO-TRADE &gt; WEAK TRADE</span><span>NO EDGE FOUND &gt; FAKE EDGE FOUND</span></div>
      <div class="st-novalid__hint">When a version passes validation it appears here with its out-of-sample figures, then moves through governance approval and a deployment package before any agent may run it.</div>
    </div>`;
  } else {
    const msg = {
      all: ["No strategies registered", "strategies.json is connected and lists no strategies."],
      candidates: ["No candidate strategies", "No registered strategy is CANDIDATE or IN VALIDATION."],
      deployed: ["No strategy deployed", "No strategy is running in simulation or live. Nothing is trading."],
      retired: ["No retired strategies", "No strategy has been withdrawn from deployment."],
    }[F.key];
    empty = emptyState({ title: msg[0], reason: msg[1], compact: true, code: `none-${F.key}` });
  }

  return S.regTable({
    columns,
    rows: listed,
    empty,
    rowHref: ({ s }) => S.strategyHref(s.strategy_id),
    rowAttrs: ({ s, v }) => html`data-strategy="${s.strategy_id}" data-status="${s.status}" data-validation="${v?.validation_status ?? ""}"`,
    cls: "st-reg",
  });
}

/* ---------------------------------------------------------------- delivery flow */

function flowStages(ctx, st, rows) {
  const eligibleIds = derived(ctx, "controls")?.deployment_eligible ?? [];
  const agentsSrc = source(ctx, "agents");
  const slots = derived(ctx, "agent_slots");
  const mem = doc(ctx, "memory");
  const ops = ["portfolio", "risk", "execution", "live"];
  return [
    { key: "LIBRARY", code: "STR", label: "Strategy library", desc: "Registered strategies and their immutable versions", href: "#/strategies", value: rows ? S.originSplit(rows.map((r) => r.s)) : null, unit: "REGISTERED" },
    {
      key: "VALIDATION",
      code: "VAL",
      label: "Validation",
      desc: "Research engine declares the current version VALIDATED",
      href: "#/research/validation",
      value: rows ? S.originSplit(rows.filter((r) => S.FILTERS.validated.test(r.s, r.v)).map((r) => r.s)) : null,
      unit: "VALIDATED",
    },
    {
      key: "DEPLOYMENT",
      code: "GOV",
      label: "Deployment",
      desc: "Governance approval and a sealed deployment package",
      href: "#/governance",
      value: st ? S.originSplit(st.strategies.filter((s) => eligibleIds.includes(s.strategy_id))) : null,
      unit: "ELIGIBLE",
    },
    {
      key: "AGENT",
      code: "AGT",
      label: "Agent",
      desc: "Assigned to one of five agent slots — simulation first",
      href: "#/agents",
      value: agentsSrc?.status === "OK" && slots ? slots.filter((x) => x.has_strategy).length : null,
      unit: "SLOTS RUNNING A STRATEGY",
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
      unit: "MEMORIES CITING A STRATEGY",
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
      : sourceEmpty(ssrc, { compact: true, title: "Proposals not connected", hint: "Each proposed improvement will appear with its base version and — if released — the new version it became." }),
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
    const findings = findingsFor(ctx, "strategies");
    const controls = derived(ctx, "controls");
    const anyConnected = !!ctx.snap && Object.values(ctx.snap.sources ?? {}).some((x) => x.status === "OK");

    return html`
      ${pageHeader({
        kicker: "STRATEGIES",
        code: "STR",
        title: F.title,
        sub: F.sub,
        right: html`${sourceTag(ssrc, { now: ctx.now })}`,
      })}

      ${categoryTabs(ctx, F)}
      ${filterStrip(F, listed, rows, ssrc)}

      <div class="grid">
        ${panel({
          span: 8,
          cls: "lg-span-12",
          code: "STR-01",
          title: "Strategy lifecycle",
          sub: rows ? `Current status of ${fmtCount(rows.length)} registered ${S.plural(rows.length, "strategy", "strategies")}` : sourceReason(ssrc),
          body: html`<div class="st-lc-wrap">${lifecycleDiagram(rows, { highlight })}${lifecycleRoster(rows, { hrefFor: (s) => S.strategyHref(s.strategy_id) })}</div>
            <div class="st-lc-legend">
              <span>COUNT = STRATEGIES WHOSE CURRENT STATUS IS THIS · SPLIT BY RECORD ORIGIN, NEVER MERGED</span>
              ${F.key !== "all" && listed?.length ? html`<span class="st-lc-legend__hl">DASHED BRACKET = STATUSES OF THE STRATEGIES LISTED UNDER ${F.tab.toUpperCase()}</span>` : ""}
            </div>`,
        })}
        ${panel({
          span: 4,
          cls: "lg-span-12",
          code: "STR-02",
          title: "Registry verdict",
          sub: "Declared by the research engine",
          body: html`${verdict(ctx, st, ssrc, rows)}<div class="st-gap"></div><div class="st-kpis">${registryCounts(rows)}</div>${eligibility(ctx, st)}`,
          variant: "accent",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "STR-03",
          title: `Strategy registry · ${F.tab}`,
          sub: rows ? `${fmtCount(listed.length)} listed · current version shown · select a row for the full strategy record` : sourceReason(ssrc),
          body: registryTable(ctx, F, st, ssrc, listed, rows),
          cls: "st-regpanel",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "STR-04",
          title: "From library to live",
          sub: "How a validated strategy will travel — every hand-off gated and recorded",
          body: deliveryFlow(flowStages(ctx, st, rows)),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 7,
          cls: "lg-span-12",
          code: "STR-05",
          title: "Improvement proposals",
          sub: "A proposal can only ever become a new version — never an edit",
          body: html`${S.label("PROPOSALS BY STATE", "each step is gated; agents cannot release a version")}${proposalFlow(st)}${S.label("RECORDED PROPOSALS", st ? `${fmtCount(st.proposals.length)} on record · newest first` : null)}${proposalsTable(st, ssrc)}`,
        })}
        <div class="span-5 lg-span-12 stack st-pair">
          ${panel({
            code: "STR-06",
            title: "Strategy findings",
            sub: "Cross-checks of declared strategy state — not verdicts",
            body: findingsList(findings, {
              empty: emptyState({
                title: "No strategy findings",
                reason: st
                  ? "Declared strategy state passes the Command Centre's cross-checks."
                  : anyConnected
                    ? "The strategy registry is not connected, so there is nothing to cross-check."
                    : "Nothing is connected, so there is nothing to cross-check.",
                compact: true,
                iconName: "shield",
              }),
            }),
          })}
          ${panel({
            code: "STR-07",
            title: "Deployment controls",
            sub: "Locked — reasons computed from state",
            body: controls
              ? html`<div class="stack st-controls">${controls.actions.filter((a) => DEPLOY_ACTIONS.includes(a.key)).map((a) => control(a))}</div>`
              : emptyState({ title: "No snapshot", compact: true }),
          })}
        </div>
      </div>
    `;
  },
};
