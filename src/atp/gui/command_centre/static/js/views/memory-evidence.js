// Evidence — every evidence item attached to a memory, flattened into one
// ledger. Supporting and contradicting items carry equal visual weight. A
// memory with no evidence attached is UNTRACEABLE and is listed as a warning.

import { html } from "../core/html.js";
import { isNil, fmtCount, fmtDateTime, humanize } from "../core/format.js";
import { sourceReason, sourceShort, findingsFor } from "../core/state.js";
import { toneOf } from "../core/tones.js";
import { pageHeader, panel, badge, stat, statRow, val, emptyState, sourceEmpty, tabs, findingsList } from "../components/ui.js";
import { icon } from "../components/icons.js";
import {
  EVIDENCE_KINDS,
  STANCES,
  memState,
  memHref,
  trialHref,
  qhref,
  countBy,
  tally,
  flattenEvidence,
  stanceBadge,
  untraceableBadge,
  bars,
  frameTable,
  sectionLabel,
  sourceTags,
} from "./_memory-common.js";

const PATH = "/memory/evidence";
const RESULTS = ["PASS", "FAIL", "PENDING", "INCONCLUSIVE", "BLOCKED", "NOT_RUN", "NOT_APPLICABLE"];
const TRACE_CODES = ["MEMORY_CONFIDENCE_WITHOUT_EVIDENCE", "MEMORY_HAS_CONTRADICTING_EVIDENCE"];

function byRecorded(a, b) {
  if (a.recorded_at === b.recorded_at) return a.memory.memory_id.localeCompare(b.memory.memory_id) || a.evidence_id.localeCompare(b.evidence_id);
  if (isNil(a.recorded_at)) return 1;
  if (isNil(b.recorded_at)) return -1;
  return a.recorded_at < b.recorded_at ? 1 : -1;
}

function refCell(e) {
  if (e.kind === "TRIAL") return html`<a class="ref" href="${trialHref(e.ref)}">${e.ref}</a>`;
  return html`<span class="ref mem-ref-plain" title="${e.ref}">${e.ref}</span>`;
}

function independentCell(v) {
  if (isNil(v)) return val(null);
  return html`<span class="${v ? "mem-yes" : "mem-no"}">${v ? "YES" : "NO"}</span>`;
}

function ledger(ctx, rows, all, src) {
  return frameTable({
    maxHeight: 640,
    rows,
    rowHref: (e) => memHref(e.memory.memory_id),
    rowAttrs: (e) => html`data-evidence-id="${e.evidence_id}" data-stance="${e.stance}"`,
    columns: [
      { key: "evidence_id", label: "Evidence", render: (e) => html`<span class="mono strong">${e.evidence_id}</span>` },
      { key: "kind", label: "Kind", render: (e) => html`<span class="mem-k">${humanize(e.kind)}</span>` },
      { key: "ref", label: "Reference", render: refCell },
      { key: "stance", label: "Stance", render: (e) => stanceBadge(e.stance) },
      { key: "result", label: "Result", render: (e) => (isNil(e.result) ? val(null) : badge(e.result)) },
      { key: "independent", label: "Indep.", render: (e) => independentCell(e.independent) },
      { key: "summary", label: "Summary", cls: "mem-td-sum", render: (e) => e.summary },
      {
        key: "memory",
        label: "Memory",
        render: (e) => html`<span class="mem-cell-mem"><a class="ref" href="${memHref(e.memory.memory_id)}">${e.memory.memory_id}</a><span class="mem-cell-mem__type">${humanize(e.memory.type)}</span></span>`,
      },
      { key: "recorded_at", label: "Recorded", cls: "mem-td-nowrap", render: (e) => (e.recorded_at ? html`<span class="mono v" data-v>${fmtDateTime(e.recorded_at)}</span>` : null) },
    ],
    empty: !all
      ? sourceEmpty(src, {
          compact: true,
          title: "No evidence to list",
          hint: "Every evidence item attached to a memory appears here: its kind, the experiment, trial or document it points to, whether it supports or contradicts the memory, its result and whether it is independent.",
        })
      : all.length === 0
        ? emptyState({ title: "0 evidence items recorded", reason: "memory.json is connected but no memory carries evidence.", compact: true, code: "evidence-none" })
        : emptyState({ title: "No match", reason: "No evidence item matches the active filter.", hint: html`<a class="ref" href="#${PATH}">Clear filters</a>`, compact: true, code: "evidence-filter-none" }),
  });
}

function traceability(ctx, mems, src) {
  if (!mems) {
    return sourceEmpty(src, {
      compact: true,
      title: "Traceability unknown",
      hint: "Every important memory must be traceable to evidence. Memories with no evidence attached are listed here as UNTRACEABLE.",
    });
  }
  const untraceable = mems.filter((m) => m.evidence.length === 0);
  const findings = findingsFor(ctx, "memory").filter((f) => TRACE_CODES.includes(f.code));
  return html`
    ${statRow(
      [
        stat({ label: "Traceable", value: fmtCount(mems.length - untraceable.length), hint: "≥1 evidence item", size: "sm" }),
        stat({ label: "Untraceable", value: fmtCount(untraceable.length), hint: "No evidence attached", size: "sm", tone: untraceable.length ? toneOf("WARN") : null }),
      ],
      { min: 110 },
    )}
    <div class="mem-gap">
      ${untraceable.length
        ? html`<ul class="mem-untrace">${untraceable.map(
            (m) => html`<li data-untraceable="${m.memory_id}">
              <a class="ref" href="${memHref(m.memory_id)}">${m.memory_id}</a>
              <span class="mem-untrace__title">${m.title}<span class="mem-untrace__meta">${humanize(m.type)} · ${humanize(m.confidence)} confidence · ${humanize(m.validation_state)}</span></span>
              ${untraceableBadge()}
            </li>`,
          )}</ul>`
        : mems.length
          ? emptyState({ title: "All memories traceable", reason: "Every memory carries at least one evidence item.", compact: true, iconName: "evidence", code: "evidence-all-traceable" })
          : emptyState({ title: "No memories recorded", reason: "memory.json is connected and holds no memories, so there is nothing to trace.", compact: true, code: "evidence-trace-none" })}
    </div>
    ${findings.length ? html`<div class="mem-gap">${sectionLabel("Evidence cross-checks")}${findingsList(findings)}</div>` : ""}`;
}

export default {
  title: "Evidence",
  render(ctx) {
    const { mems, src } = memState(ctx);
    const all = flattenEvidence(mems);
    const q = ctx.query;
    const stanceF = STANCES.includes(q.stance) ? q.stance : null;
    const kindF = EVIDENCE_KINDS.includes(q.kind) ? q.kind : null;
    const rows = all ? all.filter((e) => (!stanceF || e.stance === stanceF) && (!kindF || e.kind === kindF)).sort(byRecorded) : null;
    const forStance = all ? all.filter((e) => !kindF || e.kind === kindF) : null;
    const stanceCounts = forStance ? countBy(forStance, (e) => e.stance) : null;
    const allStance = all ? countBy(all, (e) => e.stance) : null;
    const kindCounts = all ? countBy(all, (e) => e.kind) : null;
    const resultCounts = all ? countBy(all, (e) => e.result ?? "NOT_REPORTED") : null;
    const why = sourceShort(src);
    const s = (n) => (all ? fmtCount(n) : null);

    return html`
      ${pageHeader({
        kicker: "MEMORY",
        code: "MEM-E",
        title: "Evidence",
        sub: "Every evidence item behind every memory. Contradicting evidence is shown with the same weight as supporting evidence — a memory is only as credible as what can be traced.",
        right: sourceTags(ctx, ["memory"]),
      })}

      <div class="grid">
        ${panel({
          span: 12,
          code: "MEM-E01",
          title: "Evidence ledger",
          sub: rows ? `${fmtCount(rows.length)} of ${fmtCount(all.length)} items${stanceF || kindF ? " · filtered" : ""}` : sourceReason(src),
          body: html`
            ${statRow(
              [
                stat({ label: "Evidence items", value: s(all?.length), emptyLabel: why }),
                stat({ label: "Supporting", value: s(tally(allStance, "SUPPORTS")), emptyLabel: why }),
                stat({ label: "Contradicting", value: s(tally(allStance, "CONTRADICTS")), emptyLabel: why }),
                stat({ label: "Neutral", value: s(tally(allStance, "NEUTRAL")), emptyLabel: why }),
                stat({ label: "Independent", value: s(all?.filter((e) => e.independent === true).length), hint: all ? `${fmtCount(all.filter((e) => isNil(e.independent)).length)} not reported` : null, emptyLabel: why }),
              ],
              { min: 120 },
            )}
            <div class="mem-gap">
              ${tabs(
                [
                  { key: "ALL", label: "All stances", href: qhref(PATH, q, { stance: null }), count: forStance ? forStance.length : null },
                  ...STANCES.map((st) => ({ key: st, label: humanize(st), href: qhref(PATH, q, { stance: st }), count: tally(stanceCounts, st) })),
                ],
                stanceF ?? "ALL",
              )}
              ${kindF ? html`<div class="mem-inline-note">${icon("info")}<span>Kind filter: <b>${humanize(kindF)}</b> · <a class="ref" href="${qhref(PATH, q, { kind: null })}">clear</a></span></div>` : ""}
              ${ledger(ctx, rows, all, src)}
            </div>`,
        })}
      </div>

      <div class="grid">
          ${panel({ span: 4, code: "MEM-E02", title: "Traceability", sub: "Every important memory needs evidence", body: traceability(ctx, mems, src), cls: "lg-span-12" })}
          ${panel({
            span: 4,
            cls: "lg-span-6",
            code: "MEM-E03",
            title: "By kind",
            sub: all ? "Select a kind to filter the ledger" : "Evidence kinds in the contract",
            body: bars(
              EVIDENCE_KINDS.map((k) => ({ key: k, n: tally(kindCounts, k), href: all ? qhref(PATH, q, { kind: kindF === k ? null : k }) : null, active: kindF === k })),
              { neutral: true },
            ),
          })}
          ${panel({
            span: 4,
            cls: "lg-span-6",
            code: "MEM-E04",
            title: "By result",
            sub: "Result of the referenced test, as reported",
            body: bars([...RESULTS, "NOT_REPORTED"].map((r) => ({ key: r, n: tally(resultCounts, r) }))),
          })}
      </div>
    `;
  },
};
