// Research Overview — the research command centre.
// Current focus, programmes, the full research → deployment pipeline, research
// roles, integrity notices and trial accounting. Everything comes from
// research.json / strategies.json via the snapshot; reconstructed and
// live-recorded trial counts are shown side by side and never summed here.

import { html } from "../core/html.js";
import { fmtCount, fmtDate, fmtDateTime, humanize, shortHash, isNil } from "../core/format.js";
import { source, derived, sourceReason, sourceShort } from "../core/state.js";
import {
  pageHeader,
  panel,
  badge,
  chip,
  stat,
  statRow,
  sourceTag,
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

// Ledger cross-checks are run by the server (derive.py, consistency findings). Each one
// compares declared trial_accounting fields with the records present, and runs only when
// those fields are declared — so "no finding" from a check that could not run is never
// shown as consistency. The field preconditions mirror derive.py's (the snapshot does not
// yet say per check whether it ran); the view decides nothing about the counts themselves.
const ACCOUNTING_CHECKS = [
  {
    key: "GLOBAL_SUM",
    label: "Global = baseline + live-recorded",
    needs: ["reconstructed_baseline", "live_recorded", "global_count"],
    codes: ["TRIAL_COUNT_MISMATCH"],
  },
  {
    key: "RECONSTRUCTED_RECORDS",
    label: "Reconstructed records vs baseline",
    needs: ["reconstructed_baseline"],
    codes: ["RECONSTRUCTED_RECORDS_INCOMPLETE", "RECONSTRUCTED_RECORDS_EXCEED_BASELINE"],
  },
  { key: "LIVE_RECORDS", label: "Original records vs live-recorded", needs: ["live_recorded"], codes: ["LIVE_RECORD_COUNT_DIFFERS"] },
  { key: "SEALED_SEPARATE", label: "Sealed evidence kept separate", needs: ["sealed_evidence_separate"], codes: ["SEALED_EVIDENCE_NOT_SEPARATE"] },
];
const ACCOUNTING_CODES = new Set(ACCOUNTING_CHECKS.flatMap((c) => c.codes));
const SEVERITY_RANK = { CRITICAL: 3, WARNING: 2, INFO: 1 };

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

/**
 * The current research family as the focus declares it (ResearchFocus.family). The focus
 * programme's and hypothesis's own declared families are listed separately, each labelled
 * by its record — one is never picked to stand in for the focus family.
 */
function focusFamily(f, prog, hyp) {
  const recs = [];
  if (prog?.family) recs.push(["PROGRAMME", f.programme_id, prog.family]);
  if (hyp?.family) recs.push(["HYPOTHESIS", f.hypothesis_id, hyp.family]);
  const same = recs.length === 2 && recs[0][2] === recs[1][2];
  return html`<div class="rsa-focus__fam" data-focus-family="${f.family ?? ""}">
    <div class="rsa-focus__k">CURRENT RESEARCH FAMILY</div>
    <div class="rsa-focus__famv">${f.family
      ? html`<span class="v rsa-focus__famname" data-v>${f.family}</span>`
      : html`${val(null)}<span class="rsa-focus__none">Not declared in focus</span>`}</div>
    ${recs.length
      ? html`<div class="rsa-focus__famrecs">${(same ? [["PROGRAMME · HYPOTHESIS", `${recs[0][1]} · ${recs[1][1]}`, recs[0][2]]] : recs).map(
          ([kind, id, fam]) => html`<span class="rsa-focus__famrec" data-family-of="${kind}"><span class="rsa-focus__famk">${kind} FAMILY</span><span class="mono">${fam}</span><span class="rsa-sub">${id}</span></span>`,
        )}</div>`
      : ""}
  </div>`;
}

function focusBody(rs, src) {
  if (!rs) {
    return R.srcEmpty(src, "Research focus", {
      hint: "The programme, hypothesis and research family under investigation, a summary and the next action appear here once the research engine exports research.json.",
    });
  }
  const f = rs.focus;
  if (!f || [f.programme_id, f.hypothesis_id, f.family, f.summary, f.next_action].every(isNil)) {
    return emptyState({
      title: "No focus declared",
      reason: "research.json is connected but declares no current research focus.",
      hint: "When the research engine sets a focus, the programme, hypothesis, research family and next action appear here.",
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
    ${focusFamily(f, prog, hyp)}
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

function summaryBody(ctx, rs, src) {
  const sum = derived(ctx, "research_summary");
  const hyps = rs?.hypotheses ?? null;
  const trials = rs?.trials ?? null;
  const running = trials ? trials.filter((t) => t.outcome === "RUNNING") : null;
  const families = sum?.research_available ? sum.families : null;
  // Families per record origin: the per-origin sets may overlap, so they are shown side by side, never added.
  const famSplit = R.distinctByOrigin(hyps, (h) => h.family);
  const famOrigins = new Map();
  for (const h of hyps ?? []) {
    if (!h.family) continue;
    if (!famOrigins.has(h.family)) famOrigins.set(h.family, new Set());
    famOrigins.get(h.family).add(h.origin);
  }
  const origins = R.originColumns(hyps);
  const byStatus = R.countMatrix(hyps, (h) => h.status);
  const reason = rs ? null : R.offLabel(src);
  return html`
    ${statRow(
      [
        stat({ label: "Programmes", value: R.splitVal(R.splitByOrigin(rs?.programmes ?? null)), hint: "Declared", emptyLabel: reason }),
        stat({ label: "Hypotheses", value: R.splitVal(R.splitByOrigin(hyps)), hint: "Per record origin", emptyLabel: reason }),
        stat({ label: "Trial records", value: R.splitVal(R.splitByOrigin(trials)), hint: "Records present", emptyLabel: reason }),
        stat({ label: "Running trials", value: R.splitVal(R.splitByOrigin(running)), hint: "Outcome RUNNING", emptyLabel: reason }),
        stat({
          label: "Families",
          value: R.splitVal(famSplit, { what: "distinct families" }),
          hint: "Distinct, per origin",
          emptyLabel: reason,
          title: "Distinct families declared on hypotheses, counted per record origin. A family on both original and reconstructed records appears in both counts; they are never added.",
        }),
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
            ? html`<div class="rsa-chips">${families.map((f) => {
                // a family declared only on non-original records carries its origin tag
                const os = famOrigins.get(f);
                const only = os && !os.has("ORIGINAL") ? [...os] : [];
                return only.length
                  ? html`<span class="chip rsa-famchip" data-family="${f}" title="Declared only on ${only.map((o) => humanize(o).toLowerCase()).join(" / ")} records">${f}${only.map((o) => html`<span class="rsa-split__tag ${toneClass(o)}">${R.ORIGIN_SHORT[o]}</span>`)}</span>`
                  : html`<span class="chip rsa-famchip" data-family="${f}">${f}</span>`;
              })}</div>`
            : html`<div class="rsa-none">No families declared on any hypothesis.</div>`
          : html`<div class="rsa-none">${R.offLabel(src)} — families appear as hypotheses are registered.</div>`}
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
      <div class="rsa-window__top">${w.role ? chip(humanize(w.role), { cls: "rsa-window__role" }) : chip("ROLE NOT DECLARED", { cls: "rsa-chip-quiet" })}<span class="rsa-window__label">${w.label ?? ""}</span></div>
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
      label: "Status · universe · outcome",
      render: (p) => html`<div class="rsa-stack-cell">${badge(p.status)}${
        p.universe_status ? badge(p.universe_status, { label: "UNIVERSE " + humanize(p.universe_status), ghost: true }) : html`<span class="rsa-sub">universe not declared</span>`
      }<span class="rsa-dated rsa-dated--outcome" data-outcome="${p.outcome ?? ""}"><span class="rsa-dated__k">OUTCOME</span>${p.outcome ? html`<span class="rsa-outcome">${p.outcome}</span>` : val(null)}</span></div>`,
    },
    {
      key: "spec",
      label: "Specification · frozen · sealed",
      render: (p) => html`<div class="rsa-stack-cell">
        ${p.spec_ref ? html`<span class="ref">${p.spec_ref}</span>` : html`<span class="rsa-sub">specification not declared</span>`}
        ${p.spec_hash ? html`<span class="rsa-sub mono" title="${p.spec_hash}">#${shortHash(p.spec_hash, 12)}</span>` : p.spec_ref ? html`<span class="rsa-sub">hash not declared</span>` : ""}
        ${datedLine("FROZEN", p.frozen_at)}${datedLine("SEALED", p.sealed_at)}
      </div>`,
    },
    { key: "windows", label: "Evaluation windows", render: (p) => windowsCell(p.evaluation_windows) },
  ];
  return R.frameTable({
    columns,
    rows: rs ? [...rs.programmes].sort(R.byId("programme_id")) : null,
    rowCls: (p) => (p.programme_id === focusId ? "rsa-row--focus" : ""),
    empty: rs
      ? emptyState({ title: "No programmes declared", reason: "research.json is connected but lists no research programmes.", compact: true })
      : R.srcEmpty(src, "Programmes", {
          compact: true,
          hint: "Each programme appears with its status (e.g. SPEC FROZEN, SEALED, DEFERRED), universe status, frozen specification hash and evaluation windows.",
        }),
  });
}

/* ---------------------------------------------------------------- trial accounting */

function accountingBody(ctx, src) {
  const ta = derived(ctx, "trial_accounting");
  if (!ta?.available) {
    const off = R.offLabel(src);
    return html`${statRow(
      [
        stat({ label: "Reconstructed baseline", value: null, emptyLabel: off }),
        stat({ label: "Live-recorded", value: null, emptyLabel: off }),
        stat({ label: "Global (declared)", value: null, emptyLabel: off }),
      ],
      { min: 130 },
    )}
    <div class="rsa-autoh">${R.srcEmpty(src, "Trial ledger", { compact: true, hint: "Counts are never estimated. They appear only when the research ledger exports trial_accounting." })}</div>`;
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
    ${crossChecksBody(ctx, d, findings)}`;
}

/** Which ledger cross-checks ran, and what they found. Nothing checked is never shown as consistent. */
function crossChecksBody(ctx, d, findings) {
  const failed = (derived(ctx, "errors") ?? []).some((e) => e.section === "consistency");
  const coverage = (derived(ctx, "check_coverage") ?? []).find((c) => c.key === "trial_accounting");
  const head = (note) => html`<div class="rsa-label rsa-label--gap rsa-xc__label">Ledger cross-checks${note ? html`<span class="rsa-xc__note">${note}</span>` : ""}</div>`;
  if (failed) {
    return html`${head(null)}${emptyState({
      title: "Cross-checks not run",
      reason: "The consistency checks could not be computed from the declared state (see DERIVATION_ERROR in Governance).",
      compact: true,
      iconName: "alert",
      code: "accounting-checks-failed",
    })}`;
  }
  if (coverage && !coverage.ran) {
    return html`${head(null)}${emptyState({
      title: "Cross-checks not run",
      reason: coverage.note ?? `The trial-accounting checks did not run${coverage.missing?.length ? ` (missing: ${coverage.missing.join(", ")})` : ""}.`,
      inline: true,
      code: "accounting-checks-not-run",
    })}`;
  }
  if (!d) {
    return html`${head(null)}${emptyState({
      title: "Cross-checks not run",
      reason: "trial_accounting is not declared, so there are no ledger counts to check the records against.",
      inline: true,
      code: "accounting-checks-not-run",
    })}`;
  }
  const rows = ACCOUNTING_CHECKS.map((c) => {
    const missing = c.needs.filter((k) => isNil(d[k]));
    const hits = findings.filter((f) => c.codes.includes(f.code));
    const worst = hits.reduce((w, f) => ((SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[w] ?? 0) ? f.severity : w), hits[0]?.severity ?? null);
    const state = missing.length ? "NOT_RUN" : hits.length ? "FLAGGED" : "NO_DISCREPANCY";
    return { c, missing, hits, worst, state };
  });
  const ran = rows.filter((r) => r.state !== "NOT_RUN").length;
  const note = ran === rows.length ? `${ran} of ${rows.length} run` : `${ran} of ${rows.length} run · partially checked`;
  return html`${head(note)}
    <div class="rsa-xc" data-checks-run="${String(ran)}" data-checks-total="${String(rows.length)}">${rows.map(
      (r) => html`<div class="rsa-xc__row" data-check="${r.c.key}" data-check-state="${r.state}">
        <span class="rsa-xc__k">${r.c.label}</span>
        <span class="rsa-xc__v">${
          r.state === "NOT_RUN"
            ? html`${chip("NOT RUN", { cls: "rsa-chip-quiet" })}<span class="rsa-xc__why">${r.missing.join(", ")} not declared</span>`
            : r.state === "FLAGGED"
              ? html`<span class="badge tone-${severityTone(r.worst)}" data-state="${r.worst}">FLAGGED · ${r.worst}</span>`
              : chip("NO DISCREPANCY", { title: "This check ran on the declared counts and raised no finding" })
        }</span>
      </div>`,
    )}</div>
    ${findings.length
      ? findingsList(findings)
      : ran === rows.length
        ? emptyState({ title: "No accounting discrepancies", reason: "Every ledger cross-check ran on the declared counts and raised no finding.", compact: true, iconName: "shield", code: "accounting-consistent" })
        : ""}`;
}

/* ---------------------------------------------------------------- roles */

function rolesBody(rs, src) {
  const byRole = new Map((rs?.roles ?? []).map((r) => [r.role, r]));
  return html`<div class="rsa-roles-wrap"><div class="rsa-roles">${R.ROLES.map(([key, label, desc]) => {
    const r = byRole.get(key);
    const state = r?.state ?? (rs ? "NOT_REPORTED" : R.offState(src));
    return html`<div class="rsa-role ${toneClass(r ? r.state : null)}" data-role="${key}" data-state="${state}">
      <div class="split"><span class="rsa-role__label">${label}</span>${r || rs ? badge(state) : R.offBadge(src)}</div>
      <div class="rsa-role__desc">${r?.detail ?? desc}</div>
      <div class="rsa-role__meta">${r?.last_activity_at
        ? html`LAST ACTIVITY ${fmtDateTime(r.last_activity_at)}`
        : html`<span>${r ? "LAST ACTIVITY NOT DECLARED" : rs ? "NOT REPORTED BY RESEARCH ENGINE" : `SOURCE ${sourceShort(src)}`}</span>`}</div>
    </div>`;
  })}</div></div>${rs ? "" : html`<div class="rsa-foot-note">${sourceReason(src)}</div>`}`;
}

/* ---------------------------------------------------------------- notices + doctrine */

function noticesBody(rs, src) {
  if (!rs) return R.srcEmpty(src, "Integrity notices", { compact: true, hint: "Source losses, reconstructions and other integrity events declared by the research engine appear here." });
  if (!rs.integrity_notices.length) return emptyState({ title: "No integrity notices declared", reason: "research.json lists no integrity notices.", compact: true, iconName: "shield" });
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
      <div class="doctrine__item"><b>MECHANISMS, NOT PARAMETER SEARCH</b><span>A hypothesis must start from an economic mechanism, with parameters fixed before testing.</span></div>
      <div class="doctrine__item"><b>NO CHERRY-PICKING</b><span>Every trial must be recorded and counted toward multiple-testing, failures included.</span></div>
      <div class="doctrine__item"><b>NO RULE CHANGES AFTER HOLDOUT</b><span>A specification must be frozen before its evaluation windows are opened.</span></div>
      <div class="doctrine__item"><b>ONE BACKTEST IS NOT PROOF</b><span>Evidence must survive costs, robustness, out-of-sample tests and referee reproduction.</span></div>
    </div>
    <a class="rsa-failed" href="#/research/history" data-link="research-history">
      <span class="rsa-failed__mark">FAILED <span>≠</span> LOST</span>
      <span class="rsa-failed__text">Rejected, blocked and abandoned research belongs on the record — it tells SENTRY where not to look again.</span>
      <span class="rsa-failed__go">Research history ${icon("expand")}</span>
    </a>`;
}

/* ---------------------------------------------------------------- pipeline coverage */

/**
 * The pipeline is derived when either source is connected; whatever comes from an
 * unavailable source is absent, and that is said in the source's own status words
 * (never shown as an empty pipeline). null when both sources are connected.
 */
function pipelineGap(src, stratSrc) {
  const gaps = [];
  if (src?.status !== "OK") gaps.push(`hypotheses not included: ${R.srcPhrase(src)}`);
  if (stratSrc?.status !== "OK") gaps.push(`strategies not included: ${R.srcPhrase(stratSrc)}`);
  return gaps.length ? gaps.join(" · ") : null;
}

function gapNote(src, stratSrc) {
  const gap = pipelineGap(src, stratSrc);
  if (!gap) return "";
  const broken = [src, stratSrc].some((x) => R.srcBroken(x));
  return html`<div class="rsa-gap ${toneClass(broken ? "INVALID" : null)}" data-pipeline-gap="${gap}">${icon("alert")}<span>Partial pipeline — ${gap}.</span></div>`;
}

const TRACKS_STEP = 40;

function tracksBody(ctx, items, src, stratSrc) {
  if (!items) {
    return R.tracksFrame(
      R.srcEmpty(src, "Pipeline tracks", {
        compact: true,
        hint: "Each hypothesis and strategy appears as a track from DISCOVERY to the stage it reached, ending in its terminal outcome.",
      }),
    );
  }
  // Only a page of tracks is materialised; the panel's per-origin counts come from every item.
  const page = R.pageRows(items, ctx.query.tracks, TRACKS_STEP);
  return html`${gapNote(src, stratSrc)}<div class="rsa-tracks">${pipelineTracks(page.shown, { hrefFor: R.itemHref, limit: Infinity })}</div>
    ${R.pager(page, (n) => R.qhref("/research", { programme: ctx.query.programme, tracks: n }), { step: TRACKS_STEP, noun: "items" })}`;
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
        sub: "What SENTRY is investigating, how far each idea has travelled, and where it stopped. Mechanisms are to be tested, not parameters searched — and failures belong on the record.",
        right: html`${sourceTag(src, { now: ctx.now })}${sourceTag(stratSrc, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({ span: 4, code: "RES-01", title: "Current focus", sub: "Declared by the research engine", body: focusBody(rs, src), cls: "lg-span-12", variant: "accent" })}
        ${panel({ span: 8, code: "RES-02", title: "Research summary", sub: rs ? "Counts of declared records, by origin" : sourceReason(src), body: summaryBody(ctx, rs, src), cls: "lg-span-12" })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "RES-03",
          title: "Research → deployment pipeline",
          sub: pipeline?.available
            ? "Items reaching each stage · terminal lanes show where they stopped"
            : [src, stratSrc].map((x) => R.srcPhrase(x)).join(" · "),
          actions: legend(TERMINALS.map((t) => [humanize(t), toneOf(t)])),
          body: html`${pipeline?.available ? gapNote(src, stratSrc) : ""}<div class="rsa-pipe">${pipelineDiagram(pipeline)}</div>`,
          cls: "rsa-subwrap",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "RES-04",
          title: "Pipeline tracks",
          sub: items ? `${R.splitText(items, "items")} · each hypothesis and strategy to the furthest stage it reached` : "Per-item progression",
          body: tracksBody(ctx, items, src, stratSrc),
          cls: "rsa-subwrap",
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
