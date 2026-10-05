// Research Overview — the research command centre.
// Current focus, programmes, the full research → deployment pipeline, research
// roles, integrity notices and trial accounting. Everything comes from
// research.json / strategies.json via the snapshot; reconstructed and
// live-recorded trial counts are shown side by side and never summed here.

import { html } from "../core/html.js";
import { fmtCount, fmtDate, fmtDateTime, humanize, shortHash, isNil } from "../core/format.js";
import { source, derived, sourceReason } from "../core/state.js";
import {
  pageHeader,
  panel,
  badge,
  chip,
  stat,
  statRow,
  sourceTag,
  sourceEmpty,
  emptyState,
  kv,
  val,
  notice,
  findingsList,
  legend,
} from "../components/ui.js";
import { pipelineDiagram, pipelineTracks, TERMINALS } from "../components/pipeline.js";
import { toneOf, toneClass, severityTone } from "../core/tones.js";
import { icon } from "../components/icons.js";
import * as R from "./_research-a-common.js";

const ACCOUNTING_CODES = new Set([
  "TRIAL_COUNT_MISMATCH",
  "RECONSTRUCTED_RECORDS_INCOMPLETE",
  "LIVE_RECORD_COUNT_DIFFERS",
  "SEALED_EVIDENCE_NOT_SEPARATE",
]);

/* ---------------------------------------------------------------- focus */

function focusSlot(kind, id, record, href) {
  return html`<div class="rsa-focus__slot" data-focus-kind="${kind}">
    <div class="rsa-focus__k">${kind}</div>
    ${isNil(id)
      ? html`<div class="rsa-focus__id">${val(null)}</div><div class="rsa-focus__none">Not declared in focus</div>`
      : html`<div class="rsa-focus__id">${R.ref(id, href(id))}${record?.status ? badge(record.status) : ""}</div>
          <div class="rsa-focus__title">${record ? record.name ?? record.title : html`<span class="rsa-focus__none">Not found in the register</span>`}</div>`}
  </div>`;
}

function focusBody(rs, src) {
  if (!rs) {
    return sourceEmpty(src, {
      title: "Research focus not connected",
      hint: "The programme and hypothesis under investigation, a summary and the next action appear here once the research engine exports research.json.",
    });
  }
  const f = rs.focus;
  if (!f || [f.programme_id, f.hypothesis_id, f.summary, f.next_action].every(isNil)) {
    return emptyState({
      title: "No focus declared",
      reason: "research.json is connected but declares no current research focus.",
      hint: "When the research engine sets a focus, the programme, hypothesis and next action appear here.",
      iconName: "target",
    });
  }
  const prog = f.programme_id ? rs.programmes.find((p) => p.programme_id === f.programme_id) : null;
  const hyp = f.hypothesis_id ? rs.hypotheses.find((h) => h.hypothesis_id === f.hypothesis_id) : null;
  return html`<div class="rsa-focus">
    <div class="rsa-focus__slots">
      ${focusSlot("PROGRAMME", f.programme_id, prog, R.programmeHref)}
      ${focusSlot("HYPOTHESIS", f.hypothesis_id, hyp, R.hypHref)}
    </div>
    <div class="rsa-focus__summary">${f.summary ? f.summary : html`<span class="muted">No summary declared.</span>`}</div>
    <div class="rsa-next">
      ${icon("flow")}
      <div class="rsa-next__body"><div class="rsa-next__k">NEXT ACTION</div><div class="rsa-next__v">${f.next_action ?? val(null)}</div></div>
    </div>
    ${prog || hyp
      ? kv(
          [
            ["Universe", prog?.universe_status ? badge(prog.universe_status) : null],
            ["Spec frozen", prog ? R.dateVal(prog.frozen_at) : null],
            ["Hypothesis stage", hyp ? R.stageCell(hyp.stage_reached, hyp.terminal) : null],
            ["Preregistered", hyp ? R.dateVal(hyp.preregistered_at) : null],
          ],
          { cols: 2 },
        )
      : ""}
  </div>`;
}

/* ---------------------------------------------------------------- summary */

function summaryBody(ctx, rs) {
  const sum = derived(ctx, "research_summary");
  const hyps = rs?.hypotheses ?? null;
  const trials = rs?.trials ?? null;
  const running = trials ? trials.filter((t) => t.outcome === "RUNNING") : null;
  const families = sum?.research_available ? sum.families : null;
  const origins = R.originColumns(hyps);
  const byStatus = R.countMatrix(hyps, (h) => h.status);
  const reason = rs ? null : "NOT CONNECTED";
  return html`
    ${statRow(
      [
        stat({ label: "Programmes", value: R.splitVal(R.splitByOrigin(rs?.programmes ?? null)), hint: "Declared", emptyLabel: reason }),
        stat({ label: "Hypotheses", value: R.splitVal(R.splitByOrigin(hyps)), hint: "Per record origin", emptyLabel: reason }),
        stat({ label: "Trial records", value: R.splitVal(R.splitByOrigin(trials)), hint: "Records present", emptyLabel: reason }),
        stat({ label: "Running trials", value: R.splitVal(R.splitByOrigin(running)), hint: "Outcome RUNNING", emptyLabel: reason }),
        stat({ label: "Families", value: R.count(families?.length), hint: "On hypotheses", emptyLabel: reason }),
      ],
      { min: 130 },
    )}
    <div class="rsa-sum">
      <div class="rsa-sum__matrix">
        <div class="rsa-label">Hypotheses by status</div>
        ${R.originMatrix(
          R.HYP_STATUSES.map((s) => ({ key: s, href: R.qhref("/research/hypotheses", { status: s }), counts: byStatus?.[s] })),
          { origins, available: !!rs, caption: "STATUS", labelWidth: 130 },
        )}
      </div>
      <div class="rsa-sum__families">
        <div class="rsa-label">Families on record</div>
        ${families
          ? families.length
            ? html`<div class="rsa-chips">${families.map((f) => chip(f))}</div>`
            : html`<div class="rsa-none">No families declared on any hypothesis.</div>`
          : html`<div class="rsa-none">Not connected — families appear as hypotheses are registered.</div>`}
        <a class="rsa-more" href="#/research/discovery">${icon("discovery")}Families explored &amp; research areas</a>
        <a class="rsa-more" href="#/research/hypotheses">${icon("hypothesis")}Hypothesis register</a>
        <a class="rsa-more" href="#/research/experiments">${icon("experiment")}Experiment ledger</a>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- programmes */

function windowsCell(ws) {
  if (!ws || ws.length === 0) return null;
  return html`<div class="rsa-windows">${ws.map(
    (w) => html`<div class="rsa-window">
      <div class="rsa-window__top">${chip(w.role ? humanize(w.role) : "ROLE NOT SET", { cls: "rsa-window__role" })}<span class="rsa-window__label">${w.label ?? ""}</span></div>
      ${R.windowVal(w.start, w.end)}
    </div>`,
  )}</div>`;
}

function datedLine(label, iso) {
  return html`<span class="rsa-dated"><span class="rsa-dated__k">${label}</span>${R.dateVal(iso)}</span>`;
}

function programmeHyps(rs, p) {
  const hs = rs.hypotheses.filter((h) => h.programme_id === p.programme_id);
  return html`<div class="rsa-prog__hyps"><span class="rsa-prog__k">HYPOTHESES</span>${
    hs.length ? html`<span class="rsa-refs">${hs.map((h) => R.ref(h.hypothesis_id, R.hypHref(h.hypothesis_id)))}</span>` : html`<span class="rsa-none">none registered</span>`
  }</div>`;
}

function programmesBody(rs, src, focusId) {
  const columns = [
    {
      key: "programme_id",
      label: "Programme",
      cls: "wrap",
      render: (p) => html`<div class="rsa-prog">
        <div class="rsa-prog__id"><span class="ref" data-programme="${p.programme_id}">${p.programme_id}</span>${R.originCell(p.origin)}</div>
        <div class="rsa-prog__name">${p.name}</div>
        ${p.notes?.length ? html`<ul class="rsa-notes">${p.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}
        ${programmeHyps(rs, p)}
      </div>`,
    },
    {
      key: "family",
      label: "Family · mechanism",
      cls: "rsa-col-fam",
      render: (p) => (p.family || p.mechanism ? html`<div class="rsa-stack-cell"><span class="mono rsa-nowrap">${p.family ?? "—"}</span><span class="rsa-sub">${p.mechanism ?? ""}</span></div>` : null),
    },
    {
      key: "status",
      label: "Status · universe",
      render: (p) => html`<div class="rsa-stack-cell">${badge(p.status)}${p.universe_status ? badge(p.universe_status, { label: "UNIVERSE " + humanize(p.universe_status), ghost: true }) : html`<span class="rsa-sub">universe not declared</span>`}</div>`,
    },
    {
      key: "spec",
      label: "Specification",
      render: (p) =>
        p.spec_ref || p.spec_hash
          ? html`<div class="rsa-stack-cell">${p.spec_ref ? html`<span class="ref">${p.spec_ref}</span>` : val(null)}<span class="rsa-sub mono" title="${p.spec_hash ?? ""}">${p.spec_hash ? "#" + shortHash(p.spec_hash, 12) : "no hash"}</span></div>`
          : null,
    },
    { key: "dates", label: "Frozen · sealed", render: (p) => html`<div class="rsa-stack-cell">${datedLine("FROZEN", p.frozen_at)}${datedLine("SEALED", p.sealed_at)}</div>` },
    { key: "outcome", label: "Outcome", render: (p) => (p.outcome ? html`<span class="rsa-outcome">${p.outcome}</span>` : null) },
    { key: "windows", label: "Evaluation windows", render: (p) => windowsCell(p.evaluation_windows) },
  ];
  return R.frameTable({
    columns,
    rows: rs ? [...rs.programmes].sort(R.byId("programme_id")) : null,
    rowCls: (p) => (p.programme_id === focusId ? "rsa-row--focus" : ""),
    empty: rs
      ? emptyState({ title: "No programmes declared", reason: "research.json is connected but lists no research programmes.", compact: true })
      : sourceEmpty(src, {
          title: "Programmes not connected",
          compact: true,
          hint: "Each programme appears with its status (e.g. SPEC FROZEN, SEALED, DEFERRED), universe status, frozen specification hash and evaluation windows.",
        }),
  });
}

/* ---------------------------------------------------------------- trial accounting */

function accountingBody(ctx, src) {
  const ta = derived(ctx, "trial_accounting");
  if (!ta?.available) {
    return html`${statRow(
      [
        stat({ label: "Reconstructed baseline", value: null, emptyLabel: "NOT CONNECTED" }),
        stat({ label: "Live-recorded", value: null, emptyLabel: "NOT CONNECTED" }),
        stat({ label: "Global (declared)", value: null, emptyLabel: "NOT CONNECTED" }),
      ],
      { min: 130 },
    )}
    <div class="rsa-autoh">${sourceEmpty(src, { title: "Trial ledger not connected", compact: true, hint: "Counts are never estimated. They appear only when the research ledger exports trial_accounting." })}</div>`;
  }
  const d = ta.declared;
  const recs = ta.records_by_origin ?? {};
  const findings = (derived(ctx, "consistency") ?? []).filter((f) => ACCOUNTING_CODES.has(f.code));
  return html`
    ${statRow(
      [
        stat({ label: "Reconstructed baseline", value: R.count(d?.reconstructed_baseline), hint: "Rebuilt after source loss", emptyLabel: d ? "NOT DECLARED" : "NO ACCOUNTING" }),
        stat({ label: "Live-recorded", value: R.count(d?.live_recorded), hint: "Recorded by the live ledger", emptyLabel: d ? "NOT DECLARED" : "NO ACCOUNTING" }),
        stat({ label: "Global (declared)", value: R.count(d?.global_count), hint: "As declared by the ledger", emptyLabel: d ? "NOT DECLARED" : "NO ACCOUNTING" }),
      ],
      { min: 130 },
    )}
    <div class="rsa-acct-note">
      Shown separately, never summed by the Command Centre. Individual records present:
      <span class="mono text-2">${fmtCount(recs.ORIGINAL)} ORIGINAL</span> ·
      <span class="mono text-2">${fmtCount(recs.RECONSTRUCTED)} RECONSTRUCTED</span>${recs.SYNTHETIC_FIXTURE ? html` · <span class="mono text-2">${fmtCount(recs.SYNTHETIC_FIXTURE)} SYNTHETIC</span>` : ""}.
    </div>
    ${d
      ? kv([
          ["Ledger", d.ledger_ref ? html`<span class="ref">${d.ledger_ref}</span>` : null],
          ["Ledger hash", d.ledger_hash ? html`<span class="mono" title="${d.ledger_hash}">${shortHash(d.ledger_hash, 16)}</span>` : null],
          [
            "Sealed evidence separate",
            isNil(d.sealed_evidence_separate) ? null : badge(d.sealed_evidence_separate ? "PASS" : "FAIL", { label: d.sealed_evidence_separate ? "SEPARATE" : "NOT SEPARATE" }),
          ],
          ["As of", d.as_of ? fmtDateTime(d.as_of) : null],
        ])
      : emptyState({ title: "Trial accounting not declared", reason: "research.json is connected but carries no trial_accounting block.", compact: true })}
    ${d?.notes?.length ? html`<ul class="rsa-notes rsa-notes--block">${d.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}
    <div class="rsa-label rsa-label--gap">Ledger cross-checks</div>
    ${findingsList(findings, {
      empty: emptyState({ title: "No accounting discrepancies", reason: "Declared counts are consistent with the records present.", compact: true, iconName: "shield" }),
    })}`;
}

/* ---------------------------------------------------------------- roles */

function rolesBody(rs, src) {
  const byRole = new Map((rs?.roles ?? []).map((r) => [r.role, r]));
  return html`<div class="rsa-roles">${R.ROLES.map(([key, label, desc]) => {
    const r = byRole.get(key);
    const state = r?.state ?? (rs ? "NOT_REPORTED" : "NOT_CONNECTED");
    return html`<div class="rsa-role ${toneClass(r ? r.state : null)}" data-role="${key}" data-state="${state}">
      <div class="split"><span class="rsa-role__label">${label}</span>${badge(state)}</div>
      <div class="rsa-role__desc">${r?.detail ?? desc}</div>
      <div class="rsa-role__meta">${r?.last_activity_at
        ? html`LAST ACTIVITY ${fmtDateTime(r.last_activity_at)}`
        : html`<span>${r ? "NO ACTIVITY RECORDED" : rs ? "NOT REPORTED BY RESEARCH ENGINE" : "SOURCE NOT CONNECTED"}</span>`}</div>
    </div>`;
  })}</div>${rs ? "" : html`<div class="rsa-foot-note">${sourceReason(src)}</div>`}`;
}

/* ---------------------------------------------------------------- notices + doctrine */

function noticesBody(rs, src) {
  if (!rs) return sourceEmpty(src, { title: "Integrity notices not connected", compact: true, hint: "Source losses, reconstructions and other integrity events declared by the research engine appear here." });
  if (!rs.integrity_notices.length) return emptyState({ title: "No integrity notices declared", reason: "The research engine reports no integrity events.", compact: true, iconName: "shield" });
  return html`${rs.integrity_notices.map((n) =>
    notice({
      title: html`${n.title}`,
      tone: severityTone(n.severity),
      body: html`<div>${n.detail ?? ""}</div>
        <div class="rsa-notice-meta">
          <span class="mono">${n.notice_id}</span>
          ${n.occurred_on ? html`<span class="mono">${fmtDate(n.occurred_on)}</span>` : ""}
          ${n.reference ? html`<span class="ref">${n.reference}</span>` : ""}
          ${n.affects?.length ? html`<span class="rsa-chips">${n.affects.map((a) => chip("AFFECTS " + a.toUpperCase()))}</span>` : ""}
        </div>`,
    }),
  )}`;
}

function doctrineBody() {
  return html`<div class="doctrine rsa-doctrine">
      <div class="doctrine__item"><b>MECHANISMS, NOT PARAMETER SEARCH</b><span>Every hypothesis starts from an economic mechanism; parameters are fixed before testing.</span></div>
      <div class="doctrine__item"><b>NO CHERRY-PICKING</b><span>Every trial is recorded and counted toward multiple-testing, including failures.</span></div>
      <div class="doctrine__item"><b>NO RULE CHANGES AFTER HOLDOUT</b><span>Specifications are frozen before evaluation windows are opened.</span></div>
      <div class="doctrine__item"><b>ONE BACKTEST IS NOT PROOF</b><span>Evidence must survive costs, robustness, out-of-sample tests and referee reproduction.</span></div>
    </div>
    <a class="rsa-failed" href="#/research/history" data-link="research-history">
      <span class="rsa-failed__mark">FAILED <span>≠</span> LOST</span>
      <span class="rsa-failed__text">Rejected, blocked and abandoned research stays on the record — it tells SENTRY where not to look again.</span>
      <span class="rsa-failed__go">Research history ${icon("expand")}</span>
    </a>`;
}

/* ---------------------------------------------------------------- view */

let scrolledFor = null;

export default {
  title: "Research Overview",
  render(ctx) {
    const { rs, src } = R.research(ctx);
    const stratSrc = source(ctx, "strategies");
    const pipeline = derived(ctx, "pipeline");
    const focusProgramme = ctx.query.programme ?? null;
    const items = pipeline?.available ? pipeline.items : null;

    return html`
      ${pageHeader({
        kicker: "RESEARCH ENGINE",
        code: "RES",
        title: "Research Overview",
        sub: "What SENTRY is investigating, how far each idea has travelled, and where it stopped. Mechanisms are tested, not parameters searched — and every failure stays on the record.",
        right: html`${sourceTag(src, { now: ctx.now })}${sourceTag(stratSrc, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({ span: 4, code: "RES-01", title: "Current focus", sub: "Declared by the research engine", body: focusBody(rs, src), cls: "lg-span-12", variant: "accent" })}
        ${panel({ span: 8, code: "RES-02", title: "Research summary", sub: rs ? "Counts of declared records, by origin" : sourceReason(src), body: summaryBody(ctx, rs), cls: "lg-span-12" })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "RES-03",
          title: "Research → deployment pipeline",
          sub: pipeline?.available ? "Items reaching each stage · terminal lanes show where they stopped" : "research.json and strategies.json not connected",
          actions: legend(TERMINALS.map((t) => [humanize(t), toneOf(t)])),
          body: html`<div class="rsa-pipe">${pipelineDiagram(pipeline)}</div>`,
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "RES-04",
          title: "Pipeline tracks",
          sub: items ? `${R.splitText(items, "items")} · each hypothesis and strategy to the furthest stage it reached` : "Per-item progression",
          body: items
            ? html`<div class="rsa-tracks">${pipelineTracks(items, { hrefFor: R.itemHref, limit: 40 })}</div>`
            : R.tracksFrame(
                sourceEmpty(src, {
                  title: "No pipeline items",
                  compact: true,
                  hint: "Each hypothesis and strategy appears as a track from DISCOVERY to the stage it reached, ending in its terminal outcome.",
                }),
              ),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "RES-05",
          title: "Research programmes",
          sub: rs ? `${R.splitText(rs.programmes, "declared")} · specification, universe and evaluation windows` : sourceReason(src),
          body: programmesBody(rs, src, focusProgramme),
          variant: "flush",
          cls: "rsa-flush",
        })}
      </div>

      <div class="grid">
        ${panel({ span: 5, code: "RES-06", title: "Trial accounting", sub: "Declared by the research ledger", body: accountingBody(ctx, src), cls: "lg-span-12 rsa-wraplabels" })}
        ${panel({ span: 7, code: "RES-07", title: "Research roles", sub: rs ? `${rs.roles.length} of ${R.ROLES.length} reported` : "Seven roles of the research engine", body: rolesBody(rs, src), cls: "lg-span-12" })}
      </div>

      <div class="grid">
        ${panel({ span: 6, code: "RES-08", title: "Integrity notices", sub: "Declared by the research engine", body: noticesBody(rs, src), cls: "lg-span-12" })}
        ${panel({ span: 6, code: "RES-09", title: "Research doctrine", sub: "The standard every result is held to", body: doctrineBody(), cls: "lg-span-12" })}
      </div>
    `;
  },
  mount(root, ctx) {
    // Bring a ?programme= row into view once per navigation (the shell resets scroll after mount).
    if (!ctx.query.programme) {
      scrolledFor = null;
      return undefined;
    }
    const key = location.hash;
    if (scrolledFor === key) return undefined;
    const id = requestAnimationFrame(() => {
      const row = root.querySelector("tr.rsa-row--focus");
      if (row) row.scrollIntoView({ block: "center" });
      scrolledFor = key;
    });
    return () => cancelAnimationFrame(id);
  },
};
