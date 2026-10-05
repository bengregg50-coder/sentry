// Governance — declared governance state plus Command Centre cross-checks.
// Rule: warnings are never recoloured. DIFFERS shows as DIFFERS; RECONSTRUCTED
// shows as RECONSTRUCTED; a check that was not reported shows NOT REPORTED.

import { html } from "../core/html.js";
import { fmtDateTime, fmtCount, humanize, shortHash, isNil } from "../core/format.js";
import { doc, source, derived, sourceReason } from "../core/state.js";
import {
  pageHeader,
  panel,
  badge,
  stat,
  statRow,
  sourceTag,
  sourceEmpty,
  table,
  kv,
  val,
  findingsList,
  integrityNotices,
  control,
  emptyState,
} from "../components/ui.js";

const CHECKS = [
  ["trial_accounting", "Trial accounting", "Append-only ledger of every tested candidate"],
  ["global_trial_count", "Global trial count", "All trials counted toward multiple-testing"],
  ["research_live_separation", "Research / live separation", "Research code paths cannot reach execution"],
  ["oos_separation", "OOS separation", "Holdout data untouched until declared evaluation"],
  ["multiple_testing", "Multiple-testing status", "Correction applied across the trial family"],
  ["referee", "Referee", "Independent reproduction of recorded results"],
  ["data_integrity", "Data integrity", "Datasets verified against manifests"],
  ["dataset_identity", "Dataset identity", "Content hashes bound to every result"],
  ["validation_status", "Validation status", "Promotion gates applied as specified"],
  ["reconstruction_status", "Reconstruction status", "Reconstructed material kept apart from sealed evidence"],
  ["strategy_approval", "Strategy approval", "Only approved strategies may enter deployment"],
];

function checkTile(def, check, govAvailable) {
  const [key, label, desc] = def;
  const state = check?.state ?? (govAvailable ? "NOT_REPORTED" : "NOT_CONNECTED");
  return html`<div class="gov-check" data-check="${key}" data-state="${state}">
    <div class="split"><span class="gov-check__label">${label}</span>${badge(state)}</div>
    <div class="gov-check__desc">${check?.detail ?? desc}</div>
    <div class="gov-check__meta">${check?.checked_at ? html`CHECKED ${fmtDateTime(check.checked_at)}` : html`<span class="muted">${check ? "NO CHECK TIMESTAMP" : govAvailable ? "NOT REPORTED BY GOVERNANCE" : "SOURCE NOT CONNECTED"}</span>`}${
      check?.evidence_ref ? html` · <span class="ref">${check.evidence_ref}</span>` : ""
    }</div>
  </div>`;
}

function trialAccounting(ctx) {
  const ta = derived(ctx, "trial_accounting");
  const src = source(ctx, "research");
  if (!ta?.available) return sourceEmpty(src, { title: "Trial ledger not connected", hint: "Counts are never estimated. They appear only when the research ledger exports trial_accounting." });
  const d = ta.declared;
  if (!d) return emptyState({ title: "Trial accounting not declared", reason: "research.json is connected but carries no trial_accounting block.", compact: true });
  const recs = ta.records_by_origin ?? {};
  return html`
    ${statRow([
      stat({ label: "Reconstructed baseline", value: isNil(d.reconstructed_baseline) ? null : fmtCount(d.reconstructed_baseline), hint: "Rebuilt after source loss" }),
      stat({ label: "Live-recorded", value: isNil(d.live_recorded) ? null : fmtCount(d.live_recorded), hint: "Recorded by the live ledger" }),
      stat({ label: "Global (declared)", value: isNil(d.global_count) ? null : fmtCount(d.global_count), hint: "As declared by the ledger" }),
    ], { min: 150 })}
    <div class="small muted" style="margin-top:8px">
      Counts are shown separately and never merged. Individual records present:
      <span class="mono text-2">${fmtCount(recs.ORIGINAL)} ORIGINAL</span> ·
      <span class="mono text-2">${fmtCount(recs.RECONSTRUCTED)} RECONSTRUCTED</span>.
    </div>
    <div class="divider"></div>
    ${kv([
      ["Ledger", d.ledger_ref ? html`<span class="ref">${d.ledger_ref}</span>` : null],
      ["Ledger hash", d.ledger_hash ? html`<span class="mono">${shortHash(d.ledger_hash, 16)}</span>` : null],
      ["Sealed evidence separate", isNil(d.sealed_evidence_separate) ? null : badge(d.sealed_evidence_separate ? "PASS" : "FAIL", { label: d.sealed_evidence_separate ? "SEPARATE" : "NOT SEPARATE" })],
      ["As of", d.as_of ? fmtDateTime(d.as_of) : null],
    ])}
  `;
}

function referee(gov, govSrc) {
  if (!gov) return sourceEmpty(govSrc, { title: "Referee status not connected", compact: true });
  const r = gov.referee;
  if (!r) return emptyState({ title: "Referee not reported", reason: "governance.json carries no referee block.", compact: true });
  return html`<div class="split" style="margin-bottom:10px">${badge(r.state, { size: "lg" })}<span class="small muted">${r.last_run_at ? html`LAST RUN ${fmtDateTime(r.last_run_at)}` : "NEVER RUN"}</span></div>
    ${r.detail ? html`<p class="prose" style="margin-bottom:8px">${r.detail}</p>` : ""}
    ${kv([
      ["Lock", r.lock_ref ? html`<span class="ref">${r.lock_ref}</span>` : null],
      ["Lock hash", r.lock_hash ? html`<span class="mono">${shortHash(r.lock_hash, 16)}</span>` : null],
    ])}`;
}

export default {
  title: "Governance",
  render(ctx) {
    const gov = doc(ctx, "governance");
    const govSrc = source(ctx, "governance");
    const research = doc(ctx, "research");
    const byKey = new Map((gov?.checks ?? []).map((c) => [c.key, c]));
    const findings = derived(ctx, "consistency") ?? [];
    const controls = derived(ctx, "controls");
    const changes = gov?.change_history ? [...gov.change_history].sort((a, b) => (a.at < b.at ? 1 : -1)) : null;

    return html`
      ${pageHeader({
        kicker: "OVERSIGHT",
        code: "GOV",
        title: "Governance",
        sub: "Declared governance state alongside the Command Centre's own cross-checks of that state. Warnings are displayed exactly as reported — never recoloured.",
        right: html`${sourceTag(govSrc, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({
          span: 8,
          code: "GOV-01",
          title: "Governance checks",
          sub: gov ? `${gov.checks.length} of ${CHECKS.length} reported` : sourceReason(govSrc),
          body: html`<div class="gov-checks">${CHECKS.map((c) => checkTile(c, byKey.get(c[0]), !!gov))}</div>`,
          cls: "lg-span-12",
        })}
        <div class="span-4 lg-span-12 stack">
          ${panel({ code: "GOV-02", title: "Referee", body: referee(gov, govSrc) })}
          ${panel({ code: "GOV-03", title: "Trial accounting", body: trialAccounting(ctx) })}
        </div>
      </div>

      <div class="grid">
        ${panel({
          span: 7,
          code: "GOV-04",
          title: "Consistency findings",
          sub: "Cross-checks of declared state — not research verdicts",
          body: findingsList(findings, {
            empty: emptyState({
              title: "No findings",
              reason: ctx.snap && Object.values(ctx.snap.sources).some((s) => s.status === "OK") ? "Connected state is internally consistent." : "Nothing is connected, so there is nothing to cross-check.",
              compact: true,
              iconName: "shield",
            }),
          }),
          cls: "lg-span-12",
        })}
        ${panel({
          span: 5,
          code: "GOV-05",
          title: "Integrity notices",
          sub: "Declared by the research engine",
          body: research
            ? research.integrity_notices.length
              ? integrityNotices(research.integrity_notices)
              : emptyState({ title: "No integrity notices declared", compact: true, iconName: "shield" })
            : sourceEmpty(source(ctx, "research"), { compact: true }),
          cls: "lg-span-12",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 5,
          code: "GOV-06",
          title: "Deployment & live controls",
          sub: "Locked — reasons computed from state",
          body: controls
            ? html`<div class="stack">${controls.actions.map((a) => control(a))}</div>`
            : emptyState({ title: "No snapshot", compact: true }),
          cls: "lg-span-12",
        })}
        ${panel({
          span: 7,
          code: "GOV-07",
          title: "Change history",
          sub: "Seals, spec freezes, approvals, reconstructions",
          body: changes
            ? table({
                dense: true,
                maxHeight: 360,
                columns: [
                  { key: "at", label: "When", render: (r) => html`<span class="mono">${fmtDateTime(r.at)}</span>` },
                  { key: "kind", label: "Kind", render: (r) => badge(r.kind === "RECONSTRUCTION" ? "RECONSTRUCTED" : r.kind === "SEAL" ? "SEALED" : r.kind, { label: humanize(r.kind) }) },
                  { key: "summary", label: "Summary", cls: "wrap" },
                  { key: "actor", label: "Actor", cls: "mono" },
                  {
                    key: "approved_before_results",
                    label: "Pre-results",
                    render: (r) => (isNil(r.approved_before_results) ? val(null) : badge(r.approved_before_results ? "PASS" : "WARN", { label: r.approved_before_results ? "YES" : "NO" })),
                  },
                  { key: "ref", label: "Ref", render: (r) => (r.ref ? html`<span class="ref">${r.ref}</span>` : null) },
                ],
                rows: changes,
                empty: emptyState({ title: "No changes recorded", compact: true }),
              })
            : sourceEmpty(govSrc, { compact: true }),
          cls: "lg-span-12",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "GOV-08",
          title: "Research doctrine",
          sub: "The standards every displayed state is held to",
          body: html`<div class="doctrine gov-doctrine">
            <div class="doctrine__item"><b>NO-TRADE &gt; WEAK TRADE</b><span>Absence of a strategy is a valid, displayed outcome.</span></div>
            <div class="doctrine__item"><b>NO EDGE &gt; FAKE EDGE</b><span>Failed and null results remain visible; nothing is backfilled or estimated.</span></div>
            <div class="doctrine__item"><b>EVIDENCE BEFORE PROMOTION</b><span>Only validated, approved and packaged strategies can reach an agent.</span></div>
            <div class="doctrine__item"><b>VERSIONS, NOT EDITS</b><span>Improvements become new strategy versions; live versions are never modified in place.</span></div>
          </div>`,
        })}
      </div>
    `;
  },
};
