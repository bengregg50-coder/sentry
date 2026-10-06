// Research History — the permanent record. Every trial stays visible: passed,
// failed, inconclusive, lost or reconstructed. FAILED ≠ LOST — failures inform
// future research. Integrity notices come first; trial accounting is shown with
// reconstructed baseline and live-recorded counts kept apart; the ledger is
// grouped by programme (sealed programmes marked SEALED) and can be filtered by
// ?outcome= and ?programme=. ?focus=<trial_id> highlights a row and scrolls it
// into view. Hypotheses that terminated are listed with their decision reasons.

import { html } from "../core/html.js";
import { humanize, fmtCount, fmtDate, fmtDateTime, shortHash, isNil } from "../core/format.js";
import { derived, findingsFor } from "../core/state.js";
import { toneClass } from "../core/tones.js";
import { pageHeader, panel, badge, stat, statRow, sourceTag, sourceEmpty, emptyState, integrityNotices, findingsList, kv, notice, originBadge, val } from "../components/ui.js";
import * as B from "./_research-b-common.js";

const PATH = "/research/history";
const NONE = "NONE";

/* ---------------------------------------------------------------- doctrine + notices */

function header(rs, rsrc) {
  const notices = rs
    ? rs.integrity_notices.length
      ? integrityNotices(rs.integrity_notices)
      : emptyState({ title: "No integrity notices declared", reason: "research.json declares no loss, reconstruction or integrity event.", compact: true, iconName: "shield" })
    : sourceEmpty(rsrc, { compact: true, title: "Integrity notices not connected", hint: "Declared loss and reconstruction events — with references to how material was rebuilt — appear here first." });
  return html`<div class="rsb-hero" data-doctrine="failed-not-lost">
      <div class="rsb-hero__mark"><span>DOCTRINE</span></div>
      <div class="rsb-hero__statement rsb-failed">FAILED <span class="rsb-failed__ne">≠</span> LOST <span class="rsb-failed__sub">— failures inform future research</span></div>
      <p class="rsb-hero__lead">A failed trial is evidence: it narrows the search, raises the multiple-testing bar and is written to memory. Nothing here is hidden, deleted, re-labelled or backfilled. Lost originals stay marked LOST; reconstructed records stay marked RECONSTRUCTED.</p>
    </div>
    <div class="rsb-label rsb-gap">Integrity notices <span class="rsb-label__extra">declared by the research engine</span></div>
    <div class="rsb-notices">${notices}</div>`;
}

/* ---------------------------------------------------------------- accounting */

function accounting(ctx, rs, rsrc) {
  const ta = derived(ctx, "trial_accounting");
  if (!ta?.available) {
    return html`${statRow(
      [
        stat({ label: "Reconstructed baseline", value: null, emptyLabel: "NOT CONNECTED" }),
        stat({ label: "Live-recorded", value: null, emptyLabel: "NOT CONNECTED" }),
        stat({ label: "Global (declared)", value: null, emptyLabel: "NOT CONNECTED" }),
      ],
      { min: 120 },
    )}
    <div class="rsb-label rsb-gap">Individual records present <span class="rsb-label__extra">by origin · never merged</span></div>
    <div class="rsb-recs">${["ORIGINAL", "RECONSTRUCTED"].map((o) => html`<div class="rsb-recs__item" data-origin="${o}"><span class="rsb-recs__k">${humanize(o)}</span>${val(null)}</div>`)}</div>
    ${kv([
      ["Ledger", null],
      ["Ledger hash", null],
      ["Sealed evidence separate", null],
      ["As of", null],
    ])}
    <p class="rsb-note">Counts are never estimated. They appear when the research ledger exports trial_accounting; reconstructed and live-recorded trials are always shown separately.</p>`;
  }
  const d = ta.declared;
  const recs = ta.records_by_origin ?? {};
  const nd = "NOT DECLARED";
  return html`
    ${statRow(
      [
        stat({ label: "Reconstructed baseline", value: B.count(d?.reconstructed_baseline), hint: "Declared · rebuilt after loss", emptyLabel: nd }),
        stat({ label: "Live-recorded", value: B.count(d?.live_recorded), hint: "Declared · recorded at the time", emptyLabel: nd }),
        stat({ label: "Global (declared)", value: B.count(d?.global_count), hint: "As declared by the ledger", emptyLabel: nd }),
      ],
      { min: 120 },
    )}
    <div class="rsb-label rsb-gap">Individual records present <span class="rsb-label__extra">by origin · never merged</span></div>
    <div class="rsb-recs">${B.ORIGINS.filter((o) => o !== "SYNTHETIC_FIXTURE" || recs[o] > 0).map(
      (o) => html`<div class="rsb-recs__item" data-origin="${o}"><span class="rsb-recs__k ${toneClass(o)}">${humanize(o)}</span>${val(isNil(recs[o]) ? null : fmtCount(recs[o]))}</div>`,
    )}</div>
    ${d
      ? kv([
          ["Ledger", d.ledger_ref ? html`<span class="ref">${d.ledger_ref}</span>` : null],
          ["Ledger hash", d.ledger_hash ? html`<span class="mono">${shortHash(d.ledger_hash, 16)}</span>` : null],
          ["Sealed evidence separate", isNil(d.sealed_evidence_separate) ? null : badge(d.sealed_evidence_separate ? "PASS" : "FAIL", { label: d.sealed_evidence_separate ? "SEPARATE" : "NOT SEPARATE" })],
          ["As of", d.as_of ? html`<span class="mono">${fmtDateTime(d.as_of)}</span>` : null],
        ])
      : emptyState({ title: "Trial accounting not declared", reason: "research.json is connected but carries no trial_accounting block.", compact: true })}
    ${(() => {
      const f = findingsFor(ctx, "research");
      return f.length ? html`<div class="rsb-gap">${findingsList(f)}</div>` : "";
    })()}
  `;
}

/* ---------------------------------------------------------------- ledger */

function progKey(t) {
  return t.programme_id ?? NONE;
}

function filterBar(rs, all, outcome, programme) {
  const inProg = programme === "ALL" ? all : all.filter((t) => (t.programme_id ?? NONE) === programme);
  const inOut = outcome === "ALL" ? all : all.filter((t) => t.outcome === outcome);
  const outs = ["ALL", ...B.TRIAL_OUTCOMES].map((o) => {
    const rows = o === "ALL" ? inProg : inProg.filter((t) => t.outcome === o);
    return html`<a class="rsb-filter__opt ${o === outcome ? "is-on" : ""}" href="${B.qhref(PATH, { outcome: o === "ALL" ? null : o, programme: programme === "ALL" ? null : programme })}" data-filter-outcome="${o}">
      <span class="${"rsb-filter__sw " + (o === "ALL" ? "" : toneClass(o))}"></span>${o === "ALL" ? "All outcomes" : humanize(o)}<span class="rsb-filter__n">${B.splitVal(B.originSplit(rows))}</span>
    </a>`;
  });
  const progIds = new Set(rs.programmes.map((p) => p.programme_id));
  const extra = [...new Set(all.map((t) => t.programme_id ?? NONE))].filter((id) => !progIds.has(id));
  const progs = [
    html`<a class="rsb-filter__opt ${programme === "ALL" ? "is-on" : ""}" href="${B.qhref(PATH, { outcome: outcome === "ALL" ? null : outcome })}" data-filter-programme="ALL">All programmes<span class="rsb-filter__n">${B.splitVal(B.originSplit(inOut))}</span></a>`,
    ...rs.programmes.map(
      (p) => html`<a class="rsb-filter__opt ${programme === p.programme_id ? "is-on" : ""}" href="${B.qhref(PATH, { outcome: outcome === "ALL" ? null : outcome, programme: p.programme_id })}" data-filter-programme="${p.programme_id}" title="${p.name}">
        <span class="mono">${p.programme_id}</span>${badge(p.status)}<span class="rsb-filter__n">${B.splitVal(B.originSplit(inOut.filter((t) => t.programme_id === p.programme_id)))}</span>
      </a>`,
    ),
    ...extra.map(
      (id) => html`<a class="rsb-filter__opt ${programme === id ? "is-on" : ""}" href="${B.qhref(PATH, { outcome: outcome === "ALL" ? null : outcome, programme: id })}" data-filter-programme="${id}">
        <span class="mono">${id === NONE ? "NO PROGRAMME" : id}</span>${id === NONE ? "" : html`<span class="rsb-faint">UNRESOLVED</span>`}<span class="rsb-filter__n">${B.splitVal(B.originSplit(inOut.filter((t) => (t.programme_id ?? NONE) === id)))}</span>
      </a>`,
    ),
  ];
  return html`<div class="rsb-filter">
    <div class="rsb-filter__row"><span class="rsb-filter__k">OUTCOME</span><div class="rsb-filter__opts">${outs}</div></div>
    <div class="rsb-filter__row"><span class="rsb-filter__k">PROGRAMME</span><div class="rsb-filter__opts">${progs}</div></div>
  </div>`;
}

/** The filter bar's structure when the ledger is not connected: outcomes listed, no counts. */
function filterFrame() {
  return html`<div class="rsb-filter is-empty">
    <div class="rsb-filter__row"><span class="rsb-filter__k">OUTCOME</span><div class="rsb-filter__opts">${["ALL", ...B.TRIAL_OUTCOMES].map(
      (o) => html`<span class="rsb-filter__opt" data-filter-outcome="${o}"><span class="rsb-filter__sw"></span>${o === "ALL" ? "All outcomes" : humanize(o)}<span class="rsb-filter__n">${val(null)}</span></span>`,
    )}</div></div>
    <div class="rsb-filter__row"><span class="rsb-filter__k">PROGRAMME</span><div class="rsb-filter__opts"><span class="rsb-faint">PROGRAMMES APPEAR WHEN THE LEDGER IS CONNECTED · SEALED PROGRAMMES ARE MARKED SEALED</span></div></div>
  </div>`;
}

function groupHead(p, id, rows) {
  if (!p) {
    return html`<div class="rsb-gh" data-programme="${id}">
      <span class="rsb-gh__id">${id === NONE ? "NO PROGRAMME" : id}</span>
      <span class="rsb-sub">${id === NONE ? "Trials not linked to a programme" : "Programme not found in research.json"}</span>
      <span class="rsb-gh__n">${B.splitVal(B.originSplit(rows))}<span class="rsb-faint">TRIALS SHOWN</span></span>
    </div>`;
  }
  return html`<div class="rsb-gh" data-programme="${p.programme_id}" data-programme-status="${p.status}">
    <span class="rsb-gh__id">${p.programme_id}</span>
    ${badge(p.status, { label: p.status === "SEALED" ? "SEALED" : undefined })}
    <span class="rsb-gh__name">${p.name}</span>
    ${p.family ? html`<span class="chip">${p.family}</span>` : ""}
    ${p.sealed_at ? html`<span class="rsb-faint">SEALED ${fmtDate(p.sealed_at)}</span>` : p.frozen_at ? html`<span class="rsb-faint">FROZEN ${fmtDate(p.frozen_at)}</span>` : ""}
    ${p.outcome ? html`<span class="rsb-gh__out"><span class="rsb-faint">PROGRAMME OUTCOME</span> ${p.outcome}</span>` : ""}
    ${originBadge(p.origin)}
    <span class="rsb-gh__n">${B.splitVal(B.originSplit(rows))}<span class="rsb-faint">TRIALS SHOWN</span></span>
  </div>`;
}

function stateTriple(t) {
  return html`<div class="rsb-tri">
    <span class="rsb-tri__k">EVID</span><span data-evidence-state="${t.evidence_state}">${badge(t.evidence_state)}</span>
    <span class="rsb-tri__k">OOS</span><span>${B.stateCell(t.oos_state)}</span>
    <span class="rsb-tri__k">VAL</span><span>${B.stateCell(t.validation_state)}</span>
  </div>`;
}

function dateCell(t) {
  return html`<div class="rsb-tri rsb-tri--dates">
    <span class="rsb-tri__k">REC</span>${B.dateVal(t.recorded_at)}
    <span class="rsb-tri__k">START</span>${B.dateVal(t.started_at)}
  </div>`;
}

function familyHypCell(t, hypById) {
  const h = t.hypothesis_id ? hypById.get(t.hypothesis_id) : null;
  return html`<div class="rsb-stack">
    ${t.experiment ? html`<span class="rsb-title">${t.experiment}</span>` : html`<span class="rsb-faint">EXPERIMENT NOT RECORDED</span>`}
    ${t.family ? html`<span class="rsb-fam">${t.family}</span>` : html`<span class="rsb-faint">FAMILY NOT RECORDED</span>`}
    ${t.hypothesis_id
      ? html`<span class="rsb-sub">${B.refLink(t.hypothesis_id, B.hypHref(t.hypothesis_id))} ${h ? h.title : html`<span class="rsb-faint">UNRESOLVED</span>`}</span>`
      : html`<span class="rsb-faint">NO HYPOTHESIS</span>`}
  </div>`;
}

function ledger(rs, rsrc, query) {
  const columns = [
    { label: "Trial", render: (t) => B.trialCell(t), cls: "rsb-nowrap" },
    { label: "Experiment · family · hypothesis", render: (t) => familyHypCell(t, hypById), cls: "rsb-w-exp" },
    { label: "Result", render: (t) => html`<span data-outcome="${t.outcome}">${badge(t.outcome)}</span>` },
    { label: "Reason for rejection", render: (t) => (t.rejection_reason ? html`<span class="rsb-reason">${t.rejection_reason}</span>` : null), cls: "rsb-w-reason" },
    { label: "Evidence · OOS · val.", render: stateTriple, cls: "rsb-nowrap" },
    { label: "Date", render: dateCell, cls: "rsb-nowrap" },
    { label: "Window · data", render: (t) => html`<div class="rsb-stack">${B.windowStack(t.window_start, t.window_end)}${B.chipList(t.data_used)}</div>` },
    { label: "Lineage · origin", render: (t) => html`<div class="rsb-stack">${B.lineageCell(t.lineage)}${B.originCell(t.origin)}</div>` },
  ];
  const hypById = new Map((rs?.hypotheses ?? []).map((h) => [h.hypothesis_id, h]));
  if (!rs) {
    const focusNote = query.focus
      ? html`<div class="rsb-gap0">${notice({ title: `Focus ${query.focus} cannot be located`, body: "research.json is not connected, so no trial can be shown. Nothing is displayed in its place.", tone: "info", iconName: "info" })}</div>`
      : "";
    return html`${filterFrame()}${focusNote}${B.regTable({
      columns,
      rows: null,
      empty: sourceEmpty(rsrc, {
        title: "Research ledger not connected",
        hint: "Every trial ever run will be listed here by programme — family, hypothesis, experiment, result, reason for rejection, evidence / OOS / validation state, dates, data used, trial number, lineage and origin. Failed trials are never removed.",
      }),
    })}`;
  }
  const outcome = B.TRIAL_OUTCOMES.includes(query.outcome) ? query.outcome : "ALL";
  const programme = query.programme ?? "ALL";
  const focus = query.focus ?? null;
  const all = [...rs.trials].sort(B.byTrialNumber);
  const rows = all.filter((t) => (outcome === "ALL" || t.outcome === outcome) && (programme === "ALL" || (t.programme_id ?? NONE) === programme));
  const progById = new Map(rs.programmes.map((p) => [p.programme_id, p]));
  const byProg = B.groupBy(rows, (t) => progKey(t));
  const order = [...rs.programmes.map((p) => p.programme_id), ...[...byProg.keys()].filter((k) => !progById.has(k) && k !== NONE), NONE];
  const groups = order.filter((k) => byProg.has(k)).map((k) => ({ key: k, head: groupHead(progById.get(k), k, byProg.get(k)), rows: byProg.get(k) }));

  let focusNote = "";
  if (focus) {
    const ft = all.find((t) => t.trial_id === focus);
    if (!ft) focusNote = notice({ title: `Trial ${focus} not found`, body: "No trial with this id exists in research.json. Nothing is shown in its place.", tone: "warn" });
    else if (!rows.includes(ft))
      focusNote = notice({
        title: `${focus} is hidden by the current filter`,
        body: html`It is a ${humanize(ft.outcome)} trial${ft.programme_id ? ` in ${ft.programme_id}` : ""}. <a href="${B.trialHref(focus)}">Show it with all trials</a>.`,
        tone: "info",
        iconName: "info",
      });
    else
      focusNote = html`<div class="rsb-focusbar" data-focus-bar="${focus}"><span class="rsb-focusbar__k">FOCUS</span>${B.refLink(ft.trial_id)}<span class="text-2">${ft.experiment ?? ""}</span>${badge(ft.outcome)}${
        ft.rejection_reason ? html`<span class="rsb-sub">${ft.rejection_reason}</span>` : ""
      }<a class="rsb-focusbar__clear" href="${B.qhref(PATH, { outcome: outcome === "ALL" ? null : outcome, programme: programme === "ALL" ? null : programme })}">CLEAR FOCUS</a></div>`;
  }
  const filtered = outcome !== "ALL" || programme !== "ALL";
  const empty = rs.trials.length
    ? emptyState({ title: "No trials match this filter", reason: `Outcome ${humanize(outcome)} · programme ${programme === NONE ? "none" : humanize(programme)}.`, hint: "Clear the filter to see every trial.", compact: true })
    : emptyState({ title: "No trials recorded", reason: "research.json is connected and its trial ledger is empty. When trials run — pass or fail — they are listed here permanently.", compact: true });
  return html`
    ${filterBar(rs, all, outcome, programme)}
    ${focusNote ? html`<div class="rsb-gap0">${focusNote}</div>` : ""}
    ${B.regTable({
      columns,
      groups: groups.length ? groups : null,
      rows: groups.length ? null : [],
      empty,
      cls: "rsb-ledger",
      rowCls: (t) => [t.trial_id === focus ? "rsb-row--focus" : "", t.outcome === "FAIL" ? "rsb-row--fail" : ""].join(" "),
      rowAttrs: (t) => html`data-trial="${t.trial_id}" data-outcome="${t.outcome}" data-evidence="${t.evidence_state}" ${t.trial_id === focus ? html`data-focus="1"` : ""}`,
    })}
    ${filtered ? html`<p class="rsb-note">Filtered view. <a href="${B.qhref(PATH, { focus })}">Show all ${B.splitText(B.originSplit(all), "trials")}</a>.</p>` : ""}
  `;
}

/* ---------------------------------------------------------------- terminated hypotheses */

function terminated(rs, rsrc) {
  const rows = rs
    ? rs.hypotheses.filter((h) => B.TERMINATED.includes(h.terminal) || B.TERMINATED.includes(h.status)).sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? "")))
    : null;
  const columns = [
    { label: "Hypothesis", render: (h) => html`<div class="rsb-stack">${B.refLink(h.hypothesis_id, B.hypHref(h.hypothesis_id))}<span class="rsb-title">${h.title}</span></div>`, cls: "rsb-w-exp" },
    { label: "Family · programme", render: (h) => html`<div class="rsb-stack">${h.family ? html`<span class="rsb-fam">${h.family}</span>` : val(null)}${h.programme_id ? B.refLink(h.programme_id, B.programmeHref(h.programme_id)) : html`<span class="rsb-faint">NO PROGRAMME</span>`}</div>` },
    { label: "Terminated", render: (h) => html`<span data-terminal="${h.terminal ?? h.status}">${badge(h.terminal ?? h.status)}</span>` },
    { label: "Stage reached", render: (h) => html`<span class="rsb-kindlbl">${humanize(h.stage_reached)}</span>` },
    { label: "Decided", render: (h) => B.dateVal(h.decided_at), cls: "rsb-nowrap" },
    { label: "Decision reason", render: (h) => (h.decision_reason ? html`<span class="rsb-reason">${h.decision_reason}</span>` : null), cls: "rsb-w-reason" },
    {
      label: "Trials",
      title: "Trials linked to the hypothesis — by the trial's hypothesis_id or the hypothesis's declared trial numbers",
      render: (h) => {
        const { trials, missing } = B.trialsOfHypothesis(rs, h);
        if (!trials.length && !missing.length) {
          return html`<span class="rsb-muted" data-trials-linked="0" title="No trial record names this hypothesis and it declares no trial numbers. This does not assert that none were run.">NO TRIALS LINKED</span>`;
        }
        return html`<span class="rsb-chips" data-trials-linked="${String(trials.length)}">${trials.map(
          (t) => html`<a class="ref" href="${B.trialHref(t.trial_id)}" data-linked-trial="${t.trial_id}" title="${t.trial_id} · ${humanize(t.outcome)}">${isNil(t.trial_number) ? t.trial_id : `#${t.trial_number}`}</a>`,
        )}${missing.map((n) => html`<span class="rsb-faint" data-missing-trial="${String(n)}" title="Declared by the hypothesis, but no trial record with this number is present">#${n}</span>`)}</span>`;
      },
    },
    { label: "Origin", render: (h) => B.originCell(h.origin) },
  ];
  const empty = !rs
    ? sourceEmpty(rsrc, { compact: true, title: "Hypotheses not connected", hint: "Hypotheses that ended REJECTED, BLOCKED BY DATA or ABANDONED will be listed with their decision reasons." })
    : emptyState({ title: "No terminated hypotheses", reason: "No hypothesis in research.json has ended REJECTED, BLOCKED BY DATA or ABANDONED.", compact: true });
  return B.regTable({ columns, rows, empty, rowAttrs: (h) => html`data-hypothesis="${h.hypothesis_id}"` });
}

/* ---------------------------------------------------------------- view */

let scrolledFor = null;

export default {
  title: "Research History",
  render(ctx) {
    const { rs, rsrc } = B.sources(ctx);
    const term = rs ? rs.hypotheses.filter((h) => B.TERMINATED.includes(h.terminal) || B.TERMINATED.includes(h.status)) : null;
    return html`
      ${pageHeader({
        kicker: "RESEARCH LEDGER",
        code: "HIS",
        title: "Research History",
        sub: "Every trial ever run, by programme — passed, failed, inconclusive, lost or reconstructed. Nothing is removed. FAILED ≠ LOST — failures inform future research.",
        right: html`${sourceTag(rsrc, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({ span: 7, code: "HIS-01", title: "Record integrity", sub: rs ? `${fmtCount(rs.integrity_notices.length)} integrity notice(s) declared` : "research.json not connected", variant: "hero", cls: "lg-span-12", body: header(rs, rsrc) })}
        ${panel({ span: 5, code: "HIS-02", title: "Trial accounting", sub: "Reconstructed and live-recorded kept apart", cls: "lg-span-12 rsb-statwrap", body: accounting(ctx, rs, rsrc) })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "HIS-03",
          title: "Research ledger",
          sub: rs ? `${B.splitText(B.originSplit(rs.trials), "trial records")} · grouped by programme · ledger order` : "Source not connected",
          body: ledger(rs, rsrc, ctx.query),
          id: "ledger",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "HIS-04",
          title: "Terminated hypotheses",
          sub: term ? `${B.splitText(B.originSplit(term), "hypotheses")} · rejected, blocked by data or abandoned · most recent decision first` : "Source not connected",
          body: terminated(rs, rsrc),
        })}
      </div>
    `;
  },
  mount(root, ctx) {
    const focus = ctx.query.focus;
    const key = location.hash;
    const reset = () => {
      scrolledFor = null;
    };
    window.addEventListener("hashchange", reset);
    if (focus && scrolledFor !== key) {
      scrolledFor = key;
      // After the shell resets the scroll position for a newly opened route.
      requestAnimationFrame(() => {
        const row = root.querySelector('tr[data-focus="1"]');
        if (row) row.scrollIntoView({ block: "center" });
      });
    }
    return () => window.removeEventListener("hashchange", reset);
  },
};
