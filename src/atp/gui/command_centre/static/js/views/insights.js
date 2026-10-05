// Insights — what producers declared in insights.json (research digests, null
// results, data / execution / governance / memory notes), plus a digest built
// ONLY from existing state: consistency findings by severity, declared integrity
// notices, latest governance changes and recorded negative outcomes. There is no
// generated "AI insight" and no speculation anywhere on this page.

import { html, cx } from "../core/html.js";
import { fmtDateTime, fmtCount, humanize, isNil } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort } from "../core/state.js";
import {
  pageHeader,
  panel,
  badge,
  stat,
  statRow,
  sourceTag,
  sourceEmpty,
  emptyState,
  originBadge,
  tabs,
  findingsList,
  integrityNotices,
  severityBadge,
  val,
} from "../components/ui.js";
import { icon } from "../components/icons.js";
import { ORIGINS, ORIGIN_LABEL, countWhere, refResolver, refChips, k, none, offTitle } from "./_data-common.js";

const KINDS = ["NULL_RESULT", "RESEARCH_DIGEST", "DATA", "EXECUTION", "GOVERNANCE", "MEMORY", "OTHER"];
const SEVERITIES = ["CRITICAL", "WARNING", "INFO"];
const KIND_SHORT = { NULL_RESULT: "Null result", RESEARCH_DIGEST: "Digest", DATA: "Data", EXECUTION: "Execution", GOVERNANCE: "Governance", MEMORY: "Memory", OTHER: "Other" };

const byAtDesc = (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime();

/* ------------------------------------------------------------------ cards */

function insightCard(i, resolve) {
  const isNull = i.kind === "NULL_RESULT";
  return html`<article class="${cx("dat-ins", isNull && "dat-ins--null")}" data-insight="${i.insight_id}" data-kind="${i.kind}">
    <header class="dat-ins__head">
      ${isNull ? html`<span class="dat-ins__null" title="A null result is a result">∅ Null result</span>` : html`<span class="dat-ins__kind">${humanize(i.kind)}</span>`}
      <span class="dat-ins__id">${i.insight_id}</span>
      ${originBadge(i.origin)}
      <span class="dat-ins__at">${val(fmtDateTime(i.at))}</span>
    </header>
    <h3 class="dat-ins__title">${i.title}</h3>
    ${i.body ? html`<p class="dat-ins__body">${i.body}</p>` : html`<p class="dat-ins__body dat-ins__body--none">No body declared.</p>`}
    <footer class="dat-ins__foot">
      <span class="dat-ins__f">${k("Source")}<span class="mono text-2">${i.source}</span></span>
      <span class="dat-ins__f">${k("Evidence")}${refChips(i.evidence_refs, resolve, { empty: none("None cited") })}</span>
    </footer>
  </article>`;
}

/* ------------------------------------------------------------------ digest blocks */

function digestBlock({ code, title, src, srcText, body, href, linkLabel }) {
  const at = src?.meta?.generated_at;
  return html`<section class="dat-dg" data-digest="${code}">
    <header class="dat-dg__head">
      <span class="dat-dg__code">${code}</span>
      <span class="dat-dg__title">${title}</span>
      ${href ? html`<a class="dat-dg__link" href="${href}">${linkLabel ?? "Open"} →</a>` : ""}
    </header>
    <div class="dat-dg__src">${src ? html`<span class="mono">${src.file}</span> · ${sourceShort(src)}${at ? html` · as of ${fmtDateTime(at)}` : ""}` : srcText}</div>
    <div class="dat-dg__body">${body}</div>
  </section>`;
}

function findingsDigest(ctx) {
  const findings = derived(ctx, "consistency") ?? [];
  const anyOk = Object.values(ctx.snap?.sources ?? {}).some((s) => s.status === "OK") || ctx.snap?.events_source?.status === "OK";
  const sections = [...new Set(findings.map((f) => f.section))];
  return html`
    <div class="dat-sevs">
      ${SEVERITIES.map((sev) => {
        const n = anyOk ? countWhere(findings, (f) => f.severity === sev) : null;
        return html`<div class="dat-sev" data-severity="${sev}">${severityBadge(sev)}${isNil(n) ? val(null) : html`<span class="v" data-v>${fmtCount(n)}</span>`}</div>`;
      })}
    </div>
    ${anyOk
      ? findings.length
        ? html`<div class="dat-dg__sub">${k("By section")}<span class="dat-refs">${sections.map((s) => html`<span class="dat-file">${s} <b>${fmtCount(countWhere(findings, (f) => f.section === s))}</b></span>`)}</span></div>
            ${findingsList(findings, { limit: 3 })}`
        : html`<div class="dat-none-line">${none("No findings — connected state is internally consistent")}</div>`
      : html`<div class="dat-none-line">${none("Nothing connected — nothing to cross-check")}</div>`}`;
}

function integrityDigest(ctx) {
  const research = doc(ctx, "research");
  const src = source(ctx, "research");
  if (!research) return sourceEmpty(src, { title: offTitle(src, "Integrity notices"), compact: true });
  const notices = research.integrity_notices;
  if (!notices.length) return emptyState({ title: "No integrity notices declared", reason: "research.json is connected and declares none.", compact: true, iconName: "shield" });
  return html`
    <div class="dat-sevs">${SEVERITIES.map((sev) => html`<div class="dat-sev">${severityBadge(sev)}<span class="v" data-v>${fmtCount(countWhere(notices, (n) => n.severity === sev))}</span></div>`)}</div>
    <div class="dat-dg__list">${integrityNotices(notices.slice(0, 3))}</div>
    ${notices.length > 3 ? html`<div class="small muted">+${notices.length - 3} more on the research history page</div>` : ""}`;
}

function changesDigest(ctx) {
  const gov = doc(ctx, "governance");
  const src = source(ctx, "governance");
  if (!gov) return sourceEmpty(src, { title: offTitle(src, "Change history"), compact: true });
  const changes = [...gov.change_history].sort(byAtDesc);
  if (!changes.length) return emptyState({ title: "No governance changes recorded", reason: "governance.json is connected and records none.", compact: true });
  return html`<ul class="dat-chg">
    ${changes.slice(0, 5).map(
      (c) => html`<li data-change="${c.change_id}">
        <span class="dat-chg__at mono">${val(fmtDateTime(c.at))}</span>
        <span class="dat-chg__kind">${badge(c.kind === "RECONSTRUCTION" ? "RECONSTRUCTED" : c.kind === "SEAL" ? "SEALED" : c.kind, { label: humanize(c.kind) })}</span>
        <span class="dat-chg__sum">${c.summary}<small>${c.actor}${c.ref ? html` · <span class="ref">${c.ref}</span>` : ""}</small></span>
      </li>`,
    )}
  </ul>
  ${changes.length > 5 ? html`<div class="small muted">+${changes.length - 5} earlier changes</div>` : ""}`;
}

function outcomesDigest(ctx) {
  const research = doc(ctx, "research");
  const memory = doc(ctx, "memory");
  const groups = [
    [
      "research",
      [
        ["Rejected hypotheses", research?.hypotheses, (h) => h.status === "REJECTED"],
        ["Blocked by data", research?.hypotheses, (h) => h.status === "BLOCKED_BY_DATA"],
        ["Abandoned hypotheses", research?.hypotheses, (h) => h.status === "ABANDONED"],
        ["Failed trials", research?.trials, (t) => t.outcome === "FAIL"],
        ["Inconclusive trials", research?.trials, (t) => t.outcome === "INCONCLUSIVE"],
      ],
    ],
    [
      "memory",
      [
        ["Failed mechanisms / hypotheses", memory?.memories, (m) => m.type === "FAILED_MECHANISM" || m.type === "FAILED_HYPOTHESIS"],
        ["Rejected assumptions", memory?.memories, (m) => m.type === "REJECTED_ASSUMPTION"],
      ],
    ],
  ];
  return html`<div class="table-wrap"><table class="table table--dense dat-oc">
    <thead><tr><th>Outcome</th>${ORIGINS.map((o) => html`<th class="num" title="${ORIGIN_LABEL[o]}">${o === "SYNTHETIC_FIXTURE" ? "Synthetic" : ORIGIN_LABEL[o]}</th>`)}</tr></thead>
    <tbody>${groups.map(([key, rows]) => {
      const src = source(ctx, key);
      return html`<tr class="dat-oc__group"><td colspan="${String(ORIGINS.length + 1)}"><span class="mono">${src?.file ?? key + ".json"}</span><span class="dat-oc__state">${sourceShort(src)}</span></td></tr>
        ${rows.map(
          ([label, list, pred]) => html`<tr data-outcome="${label}">
            <td class="strong">${label}</td>
            ${ORIGINS.map((o) => html`<td class="num">${list ? html`<span class="v" data-v>${fmtCount(countWhere(list, (r) => r.origin === o && pred(r)))}</span>` : val(null)}</td>`)}
          </tr>`,
        )}`;
    })}</tbody>
  </table></div>
  <div class="dat-foot-note">Counted from declared records, split by record origin and never merged. Failures stay visible — they narrow the search. Full records: <a href="#/research/history">research history</a>.</div>`;
}

/* ------------------------------------------------------------------ view */

export default {
  title: "Insights",
  render(ctx) {
    const src = source(ctx, "insights");
    const data = doc(ctx, "insights");
    const list = data ? [...data.insights].sort(byAtDesc) : null;
    const resolve = refResolver(ctx);
    const kindQ = KINDS.includes(ctx.query?.kind) ? ctx.query.kind : null;
    const nulls = list ? list.filter((i) => i.kind === "NULL_RESULT") : null;
    const shown = list ? (kindQ ? list.filter((i) => i.kind === kindQ) : list) : null;
    const off = sourceShort(src);
    const latest = list?.length ? list[0].at : null;

    const noneYet = (scope) =>
      data
        ? emptyState({
            title: scope ?? "No insights produced yet",
            reason: scope && list.length ? `insights.json declares ${list.length} insight${list.length === 1 ? "" : "s"}, none of this kind.` : "insights.json is connected and declares none.",
            hint: "Research digests and null results appear here when a producer writes them.",
            compact: true,
            iconName: "insights",
          })
        : sourceEmpty(src, { title: src?.status === "INVALID" || src?.status === "UNREADABLE" ? offTitle(src, "insights.json") : "No insights produced yet", hint: "Research digests and null results appear here when a producer writes insights.json.", compact: true, iconName: "insights" });

    return html`
      ${pageHeader({
        kicker: "OVERSIGHT",
        code: "INS",
        title: "Insights",
        sub: "Research digests and null results declared by producers, and a digest assembled only from existing state. Nothing here is generated, summarised by a model, or speculated.",
        right: html`${sourceTag(src, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({
          span: 5,
          cls: "lg-span-12",
          code: "INS-01",
          title: "Doctrine",
          variant: "hero",
          body: html`<div class="dat-hero">
            <div class="dat-hero__k">NULL RESULTS ARE RESULTS</div>
            <p class="dat-hero__p">A hypothesis that found no edge is evidence: it narrows the search, raises the multiple-testing bar and is written to memory. Null results are listed first here and never hidden behind successes.</p>
            <ul class="dat-hero__rules">
              <li>${icon("lock")}No generated or model-written insights</li>
              <li>${icon("lock")}No speculation, forecasts or recommendations</li>
              <li>${icon("lock")}Every item names its source and cited evidence</li>
            </ul>
          </div>`,
        })}
        ${panel({
          span: 7,
          cls: "lg-span-12",
          code: "INS-02",
          title: "Declared insights",
          sub: data ? `${list.length} declared${latest ? ` · latest ${fmtDateTime(latest)}` : ""}` : sourceReason(src),
          body: html`
            <div class="dat-sec">${k("By kind")}<span class="dat-sec__note">as declared in insights.json</span></div>
            <div class="dat-kinds">${statRow(
              [
                ...KINDS.map((kd) => {
                  const n = list ? countWhere(list, (i) => i.kind === kd) : null;
                  return stat({ label: KIND_SHORT[kd], value: isNil(n) ? null : fmtCount(n), emptyLabel: off, size: "sm", title: humanize(kd) });
                }),
                stat({ label: "Latest", value: latest ? fmtDateTime(latest) : null, emptyLabel: data ? "NONE DECLARED" : off, size: "sm" }),
              ],
              { min: 150 },
            )}</div>
            <div class="dat-sec dat-sec--gap">${k("By record origin")}<span class="dat-sec__note">never merged</span></div>
            ${statRow(
              ORIGINS.map((o) => stat({ label: ORIGIN_LABEL[o], value: list ? fmtCount(countWhere(list, (i) => i.origin === o)) : null, emptyLabel: off, size: "sm" })),
              { min: 120 },
            )}`,
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 5,
          cls: "lg-span-12",
          code: "INS-03",
          title: "Null results",
          sub: nulls ? `${nulls.length} declared · newest first` : sourceShort(src),
          variant: nulls?.length ? "accent" : undefined,
          body: html`<div class="dat-fit">${
            nulls
              ? nulls.length
                ? html`<div class="dat-ins-list">${nulls.map((i) => insightCard(i, resolve))}</div>`
                : emptyState({ title: "No null results declared", reason: data.insights.length ? "insights.json declares insights, none of kind NULL_RESULT." : "insights.json is connected and declares no insights.", compact: true, iconName: "insights" })
              : noneYet()
          }</div>
          <div class="dat-sec dat-sec--gap dat-sec--rule">${k("Negative outcomes on record")}<span class="dat-sec__note">research.json · memory.json · by record origin</span></div>
          ${outcomesDigest(ctx)}`,
        })}
        ${panel({
          span: 7,
          cls: "lg-span-12",
          code: "INS-04",
          title: "Insight stream",
          sub: kindQ ? `Filtered: ${humanize(kindQ)}` : "All kinds · newest first",
          body: html`<div class="dat-tabs">
            ${tabs(
              [
                { key: "ALL", label: "All", href: "#/insights", count: list ? list.length : null },
                ...KINDS.map((kd) => ({ key: kd, label: humanize(kd), href: `#/insights?kind=${kd}`, count: list ? countWhere(list, (i) => i.kind === kd) : null })),
              ],
              kindQ ?? "ALL",
            )}</div>
            <div class="dat-fit">${shown
              ? shown.length
                ? html`<div class="dat-ins-list">${shown.map((i) => insightCard(i, resolve))}</div>`
                : noneYet(kindQ ? `No ${humanize(kindQ).toLowerCase()} insights declared` : null)
              : noneYet()}</div>`,
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "INS-05",
          title: "State digest",
          sub: "Assembled only from existing state — counts and records, no interpretation",
          body: html`<div class="dat-digest">
            ${digestBlock({ code: "D1", title: "Consistency findings", srcText: "derived.consistency · Command Centre cross-checks", body: findingsDigest(ctx), href: "#/governance", linkLabel: "Governance" })}
            ${digestBlock({ code: "D2", title: "Integrity notices", src: source(ctx, "research"), body: integrityDigest(ctx), href: "#/research/history", linkLabel: "History" })}
            ${digestBlock({ code: "D3", title: "Latest governance changes", src: source(ctx, "governance"), body: changesDigest(ctx), href: "#/governance", linkLabel: "Governance" })}
          </div>`,
        })}
      </div>
    `;
  },
};
