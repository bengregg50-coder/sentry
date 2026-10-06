// Datasets — the data catalogue as declared by the data pipeline (datasets.json).
// Coverage is drawn only from declared dates; identity is the declared content
// hash; reconstruction, integrity notes and gaps are shown exactly as declared.
// Cross-references (which trials cite a dataset) are row lookups, never inferred.

import { html, raw, cx } from "../core/html.js";
import { fmtCount, fmtDateTime, isNil, shortHash, humanize } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort } from "../core/state.js";
import { toneOf } from "../core/tones.js";
import {
  pageHeader,
  panel,
  badge,
  chip,
  sourceTag,
  sourceEmpty,
  emptyState,
  originBadge,
  kv,
  val,
  findingsList,
  legend,
} from "../components/ui.js";
import { coverageTimeline } from "./_data-timeline.js";
import {
  ORIGINS,
  ORIGIN_LABEL,
  ORIGIN_ABBR,
  originCounts,
  originText,
  countWhere,
  dayText,
  parseDay,
  refResolver,
  refChips,
  k,
  none,
  offTitle,
  noFindings,
} from "./_data-common.js";
import { stateOfStatus } from "./_command-common.js";

const INTEGRITY = ["PASS", "WARN", "FAIL", "UNKNOWN"];

const COMPOSITION = [
  ["Venue", "venue"],
  ["Asset class", "asset_class"],
  ["Kind", "kind"],
  ["Bar size", "bar_size"],
  ["Timezone", "timezone"],
];

// Descriptions say what each governance check examines — never what it found.
const DATA_CHECKS = [
  ["data_integrity", "Data integrity", "Checks datasets against their manifests"],
  ["dataset_identity", "Dataset identity", "Checks each result is bound to a dataset content hash"],
  ["reconstruction_status", "Reconstruction status", "Checks reconstructed material is kept apart from sealed evidence"],
];

const RECORD_FIELDS = [
  "root", "name", "venue", "asset class", "kind", "bar size", "timezone", "coverage start", "coverage end",
  "sessions", "rows", "sessions by year", "content hash", "manifest", "integrity", "integrity notes",
  "reconstruction", "gaps", "last verified", "used by", "origin",
];

const pct = (n) => raw(Number(n).toFixed(2));

/* ------------------------------------------------------------------ summary */

const latestOf = (xs) => (xs.length ? xs.reduce((a, b) => (a > b ? a : b)) : null);

/** Coverage span of one origin's records, from declared dates only. */
function coverageCell(rows) {
  const starts = rows.filter((d) => parseDay(d.coverage_start) !== null);
  const ends = rows.filter((d) => parseDay(d.coverage_end) !== null);
  if (!starts.length && !ends.length) return val(null);
  const first = starts.length ? starts.reduce((a, b) => (parseDay(a.coverage_start) <= parseDay(b.coverage_start) ? a : b)).coverage_start : null;
  const last = ends.length ? ends.reduce((a, b) => (parseDay(a.coverage_end) >= parseDay(b.coverage_end) ? a : b)).coverage_end : null;
  return html`<span class="dat-om__span">${val(dayText(first))}<i>→</i>${val(dayText(last))}</span>`;
}

/**
 * One row per record origin — counts of different origins are never summed.
 * A connected catalogue with no record of an origin shows real zeros (muted);
 * an unavailable source shows empty cells, never 0.
 */
function originMatrix(rows, has, off) {
  const cell = (n, tone) =>
    isNil(n) ? val(null) : html`<span class="${cx("v", n > 0 && tone && `tone-${tone}`)}" data-v>${fmtCount(n)}</span>`;
  return html`<div class="table-wrap"><table class="table table--dense dat-om" data-origin-matrix>
    <thead><tr>
      <th>Record origin</th><th class="num">Records</th>
      ${INTEGRITY.map((st) => html`<th class="num" title="Declared integrity ${st}">${st}</th>`)}
      <th class="num" title="Datasets declaring reconstructed = true">Recon. flag</th>
      <th class="num" title="Declared gaps, all datasets of this origin">Gaps</th>
      <th class="dat-om__wrap" title="Earliest declared start → latest declared end">Declared coverage</th>
      <th class="dat-om__wrap">Last verified</th>
    </tr></thead>
    <tbody>${ORIGINS.map((o) => {
      const rs = has ? rows.filter((d) => d.origin === o) : null;
      const count = (pred) => (rs ? countWhere(rs, pred) : null);
      const verified = rs ? latestOf(rs.map((d) => d.last_verified_at).filter((x) => !isNil(x))) : null;
      return html`<tr class="${cx(rs && !rs.length && "is-none")}" data-origin-row="${o}">
        <td class="strong">${ORIGIN_LABEL[o]}</td>
        <td class="num dat-om__n">${cell(rs ? rs.length : null)}</td>
        ${INTEGRITY.map((st) => html`<td class="num">${cell(count((d) => d.integrity === st), toneOf(st))}</td>`)}
        <td class="num">${cell(count((d) => d.reconstructed === true), toneOf("RECONSTRUCTED"))}</td>
        <td class="num">${cell(rs ? rs.reduce((n, d) => n + (d.gaps ?? []).length, 0) : null)}</td>
        <td class="dat-om__wrap">${rs ? coverageCell(rs) : val(null)}</td>
        <td class="dat-om__wrap">${val(verified ? fmtDateTime(verified) : null)}</td>
      </tr>`;
    })}</tbody>
  </table></div>
  ${has ? "" : html`<div class="dat-om__off"><span class="dat-none">datasets.json · ${off}</span></div>`}`;
}

/** Distinct declared values, each with its record count split by origin. */
function originTally(rs) {
  return html`${originCounts(rs).map(([o, n]) => html`<b>${fmtCount(n)}</b><i>${ORIGIN_ABBR[o]}</i>`)}`;
}

function summary(ds, src) {
  const off = sourceShort(src);
  const has = Array.isArray(ds);
  const rows = ds ?? [];

  return html`
    <div class="dat-sum" data-summary="${has ? "connected" : "unavailable"}">
      <div class="dat-sec">${k("Declared state by record origin")}<span class="dat-sec__note">one row per origin · never merged · not recomputed</span></div>
      ${originMatrix(rows, has, off)}
    </div>
    <div class="dat-sec dat-sec--gap">${k("Catalogue composition")}<span class="dat-sec__note">distinct declared values · record count by origin</span></div>
    <div class="${cx("dat-comp", has && rows.length && "dat-comp--list")}">
      ${COMPOSITION.map(([lbl, field]) => {
        const declared = rows.filter((d) => !isNil(d[field]) && d[field] !== "");
        const groups = new Map();
        for (const d of declared) {
          if (!groups.has(d[field])) groups.set(d[field], []);
          groups.get(d[field]).push(d);
        }
        const missing = rows.filter((d) => isNil(d[field]) || d[field] === "");
        return html`<div class="dat-comp__cell" data-comp="${field}">
          <span class="dat-comp__k">${lbl}</span>
          <span class="dat-comp__v">${
            !has
              ? html`${val(null)}<span class="dat-none">${off}</span>`
              : groups.size
                ? html`${[...groups.entries()].map(([v, rs]) => html`<span class="dat-file dat-tally" title="${v}">${field === "kind" ? humanize(v) : v} ${originTally(rs)}</span>`)}${missing.length ? html`<span class="dat-file dat-file--none dat-tally">NOT DECLARED ${originTally(missing)}</span>` : ""}`
                : none(rows.length ? "Not declared" : "None declared")
          }</span>
        </div>`;
      })}
    </div>`;
}

/* ------------------------------------------------------------------ governance */

function dataGovernance(ctx) {
  const gov = doc(ctx, "governance");
  const govSrc = source(ctx, "governance");
  const sys = (derived(ctx, "system") ?? []).find((s) => s.key === "data");
  const findings = (derived(ctx, "consistency") ?? []).filter((f) => f.section === "data");
  const byKey = new Map((gov?.checks ?? []).map((c) => [c.key, c]));
  return html`
    <div class="dat-gov">
      <div class="dat-gov__row" data-gov-row="subsystem">
        <div class="dat-gov__main"><span class="dat-gov__label">Data subsystem</span><span class="dat-gov__desc">${
          sys?.declared
            ? sys.declared.detail ?? "Declared by system.json"
            : source(ctx, "system")?.status === "OK"
              ? "Not declared by system.json — derived from datasets.json source status"
              : `${offTitle(source(ctx, "system"), "system.json")} — derived from datasets.json source status`
        }</span></div>
        <div class="dat-gov__state">${sys ? badge(sys.state) : badge("NO_SNAPSHOT", { label: "NO SNAPSHOT" })}<span class="dat-gov__meta">${
          sys?.declared?.heartbeat_at ? html`HB ${fmtDateTime(sys.declared.heartbeat_at)}` : sys?.declared ? "NO HEARTBEAT" : "SYSTEM.JSON"
        }</span></div>
      </div>
      ${DATA_CHECKS.map(([key, lbl, desc]) => {
        const c = byKey.get(key);
        // An unreported check says why: not reported by a connected governance.json, or the
        // governance source's real status (not connected / not produced / contract error / unreadable).
        const state = c?.state ?? (gov ? "NOT_REPORTED" : govSrc ? stateOfStatus(govSrc.status) : "NO_SNAPSHOT");
        const label = c ? undefined : gov ? "NOT REPORTED" : sourceShort(govSrc);
        return html`<div class="dat-gov__row" data-gov-row="${key}" data-state="${state}">
          <div class="dat-gov__main"><span class="dat-gov__label">${lbl}</span><span class="dat-gov__desc">${c?.detail ?? desc}</span></div>
          <div class="dat-gov__state">${badge(state, { label })}<span class="dat-gov__meta">${
            c?.checked_at ? html`CHECKED ${fmtDateTime(c.checked_at)}` : c ? "NO TIMESTAMP" : "GOVERNANCE.JSON"
          }</span></div>
        </div>`;
      })}
    </div>
    <div class="dat-sec dat-sec--gap">${k("Data-source findings")}<span class="dat-sec__note">Command Centre cross-checks</span></div>
    ${findingsList(findings, {
      limit: 3,
      empty: noFindings(ctx, { keys: ["provenance", "data_citations", "freshness"], what: "data-source findings" }),
    })}`;
}

/* ------------------------------------------------------------------ identity */

function yearBars(sby) {
  const entries = Object.entries(sby ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!entries.length) return html`<div class="dat-none-line">${none("Sessions by year not declared")}</div>`;
  const max = Math.max(...entries.map((e) => Number(e[1])));
  const dense = entries.length > 12;
  return html`<div class="dat-yb ${dense ? "is-dense" : ""}" style="--n:${raw(String(entries.length))}">
    ${entries.map(([y, n]) => {
      const h = max > 0 ? (Number(n) / max) * 100 : 0;
      return html`<div class="dat-yb__col" title="${y}: ${fmtCount(n)} sessions">
        <span class="dat-yb__n" data-v>${fmtCount(n)}</span>
        <span class="dat-yb__bar"><i style="height:${pct(h)}%"></i></span>
        <span class="dat-yb__y">${dense ? String(y).slice(-2) : y}</span>
      </div>`;
    })}
  </div>`;
}

function reconstruction(d) {
  if (d.reconstructed === true) {
    return html`<div class="dat-flag">${badge("RECONSTRUCTED")}<span class="dat-flag__detail">${d.reconstruction_detail ?? "No reconstruction detail declared"}</span></div>`;
  }
  if (d.reconstructed === false) return html`<div class="dat-flag">${chip("NOT RECONSTRUCTED")}${d.reconstruction_detail ? html`<span class="dat-flag__detail">${d.reconstruction_detail}</span>` : ""}</div>`;
  return html`<div class="dat-flag">${val(null)}<span class="dat-flag__detail muted">Reconstruction flag not reported</span></div>`;
}

function identityCard(d, resolve, citing, researchOn, researchState) {
  const notes = d.integrity_notes ?? [];
  const gaps = d.gaps ?? [];
  return html`<article class="dat-card" data-dataset="${d.dataset_id}" data-integrity="${d.integrity}">
    <header class="dat-card__head">
      <div class="dat-card__id"><b>${d.root}</b><span class="dat-card__name">${d.name ?? ""}</span></div>
      <div class="dat-card__badges">${badge(d.integrity, { title: "Declared integrity" })}${originBadge(d.origin)}</div>
    </header>
    <div class="dat-card__sub"><span class="mono">${d.dataset_id}</span>${d.venue ? html`<span class="dat-card__sep">·</span><span>${d.venue}</span>` : ""}</div>

    ${kv(
      [
        ["Venue", val(d.venue)],
        ["Asset class", val(d.asset_class)],
        ["Kind", val(d.kind ? humanize(d.kind) : null)],
        ["Bar size", val(d.bar_size)],
        ["Timezone", val(d.timezone)],
        ["Last verified", val(d.last_verified_at ? fmtDateTime(d.last_verified_at) : null)],
        ["Coverage start", val(dayText(d.coverage_start))],
        ["Coverage end", val(dayText(d.coverage_end))],
        ["Sessions", val(isNil(d.session_count) ? null : fmtCount(d.session_count))],
        ["Rows", val(isNil(d.row_count) ? null : fmtCount(d.row_count))],
        ["Content hash", d.content_hash ? html`<span class="v mono dat-hash" data-v title="${d.content_hash}">${shortHash(d.content_hash, 14)}</span>` : val(null)],
        ["Manifest", d.manifest_ref ? html`<span class="v ref ref--plain" data-v title="${d.manifest_ref}">${d.manifest_ref}</span>` : val(null)],
      ],
      { cols: 3 },
    )}

    <div class="dat-card__block">
      ${k("Reconstruction")}
      ${reconstruction(d)}
    </div>

    <div class="dat-card__cols">
      <div class="dat-card__block">
        ${k("Integrity notes")}
        ${notes.length
          ? html`<ul class="dat-list">${notes.map((n) => html`<li>${n}</li>`)}</ul>`
          : html`<div class="dat-none-line">${none("None declared")}</div>`}
      </div>
      <div class="dat-card__block">
        ${k("Declared gaps")}
        ${gaps.length
          ? html`<ul class="dat-list dat-list--gaps">${gaps.map(
              (g) => html`<li data-gap-row="${dayText(g.start)}"><span class="mono">${dayText(g.start)} → ${dayText(g.end)}</span>${g.reason ? html`<span class="muted"> · ${g.reason}</span>` : ""}</li>`,
            )}</ul>`
          : html`<div class="dat-none-line">${none("None declared")}</div>`}
      </div>
    </div>

    <div class="dat-card__cols">
      <div class="dat-card__block">
        ${k("Used by · declared")}
        ${refChips(d.used_by, resolve, { empty: html`<div class="dat-none-line">${none("None declared")}</div>` })}
      </div>
      <div class="dat-card__block">
        ${k("Cited by trials")}
        ${researchOn
          ? refChips(citing.map((t) => t.trial_id), resolve, { empty: html`<div class="dat-none-line">${none("No trial cites this dataset id")}</div>` })
          : html`<div class="dat-none-line">${none(`research.json · ${researchState}`)}</div>`}
      </div>
    </div>

    <div class="dat-card__block dat-card__block--years">
      <div class="split">${k("Sessions by year")}<span class="dat-sec__note">as declared</span></div>
      ${yearBars(d.sessions_by_year)}
    </div>
  </article>`;
}

function identityEmpty(src, has) {
  return html`<div class="dat-schematic">
    ${has
      ? emptyState({ title: "No datasets declared", reason: "datasets.json is connected and declares an empty catalogue.", hint: "Nothing is inferred from file names, trials or strategies.", compact: true, iconName: "data" })
      : sourceEmpty(src, { title: src?.status === "NOT_CONFIGURED" ? "No datasets connected" : offTitle(src, "datasets.json"), hint: "Dataset identity appears only when the data pipeline exports datasets.json.", compact: true, iconName: "data" })}
    <div class="dat-schematic__fields">
      <div class="dat-sec">${k("Each dataset record will show")}</div>
      <div class="dat-schematic__chips">${RECORD_FIELDS.map((f) => html`<span class="dat-field">${f}</span>`)}</div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ citations */

function citations(ctx, ds, dsSrc, resolve) {
  const research = doc(ctx, "research");
  const resSrc = source(ctx, "research");
  if (!research) return sourceEmpty(resSrc, { title: offTitle(resSrc, "Research ledger"), hint: "Trial citations of datasets appear when research.json declares data_used per trial.", compact: true });
  const refs = new Map();
  for (const t of research.trials) {
    for (const ref of t.data_used ?? []) {
      if (!refs.has(ref)) refs.set(ref, []);
      refs.get(ref).push(t);
    }
  }
  if (!refs.size) return emptyState({ title: "No dataset citations", reason: "No trial in research.json declares the data it used.", compact: true, iconName: "link" });
  const ids = new Set((ds ?? []).map((d) => d.dataset_id));
  return html`<div class="table-wrap"><table class="table table--dense dat-cite">
    <thead><tr><th>Dataset ref</th><th>Catalogue</th>${ORIGINS.map((o) => html`<th class="num">${ORIGIN_LABEL[o]}</th>`)}<th>Trials</th></tr></thead>
    <tbody>${[...refs.entries()].map(([ref, trials]) => {
      const cat = ds ? (ids.has(ref) ? badge("CATALOGUED", { label: "IN CATALOGUE" }) : badge("UNRESOLVED", { label: "NOT IN CATALOGUE" })) : badge(stateOfStatus(dsSrc?.status ?? "NOT_CONFIGURED"), { label: "CATALOGUE " + sourceShort(dsSrc) });
      return html`<tr data-cite="${ref}">
        <td><span class="ref ref--plain">${ref}</span></td>
        <td>${cat}</td>
        ${ORIGINS.map((o) => html`<td class="num"><span class="v" data-v>${fmtCount(countWhere(trials, (t) => t.origin === o))}</span></td>`)}
        <td class="wrap">${refChips(trials.slice(0, 8).map((t) => t.trial_id), resolve)}${trials.length > 8 ? html`<span class="muted small"> +${trials.length - 8} more</span>` : ""}</td>
      </tr>`;
    })}</tbody>
  </table></div>
  <div class="dat-foot-note">Counts are trial records whose <span class="mono">data_used</span> lists the id exactly, split by record origin. Matching is exact — ids are never fuzzy-matched to roots or names.</div>`;
}

/* ------------------------------------------------------------------ view */

export default {
  title: "Datasets",
  render(ctx) {
    const src = source(ctx, "datasets");
    const data = doc(ctx, "datasets");
    const ds = data ? data.datasets : null;
    const research = doc(ctx, "research");
    const resolve = refResolver(ctx);
    const has = Array.isArray(ds);

    const timelineEmpty = has
      ? { title: "No datasets declared", reason: "datasets.json is connected and declares an empty catalogue. Coverage is never inferred.", hint: "One bar per dataset will appear here, from coverage_start to coverage_end on a shared UTC axis." }
      : {
          title: `${src?.status === "NOT_CONFIGURED" ? "No datasets connected" : offTitle(src, "datasets.json")} — coverage is never inferred`,
          reason: sourceReason(src),
          hint: "One bar per dataset will appear here, from coverage_start to coverage_end on a shared UTC axis, with declared gaps cut in.",
        };

    return html`
      ${pageHeader({
        kicker: "DATA",
        code: "DAT",
        title: "Datasets",
        sub: "The data catalogue exactly as the data pipeline declares it: coverage, identity, integrity and reconstruction. Coverage is never inferred, gaps are never smoothed, and a hash is shown only when one was declared.",
        right: html`${sourceTag(src, { now: ctx.now })}`,
      })}

      <div class="grid">
        ${panel({
          span: 8,
          cls: "lg-span-12",
          code: "DAT-01",
          title: "Catalogue summary",
          sub: has ? (ds.length ? `Declared records: ${originText(ds)}` : "Connected — no dataset records declared") : sourceReason(src),
          body: summary(ds, src),
        })}
        ${panel({
          span: 4,
          cls: "lg-span-12",
          code: "DAT-02",
          title: "Data governance",
          sub: "Declared checks",
          body: dataGovernance(ctx),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "DAT-03",
          title: "Coverage timeline",
          sub: "Shared UTC axis · drawn only from declared dates",
          actions: has && ds.length ? legend([["Declared coverage", "accent"], ["Reconstructed", toneOf("RECONSTRUCTED")], ["Declared gap", "muted"]]) : "",
          body: coverageTimeline(ds, timelineEmpty),
          foot: html`Axis runs from 1 January of the earliest declared date to 1 January after the latest. Bars include their end date. A dataset with a missing start or end shows a single marker — nothing is extrapolated.`,
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "DAT-04",
          title: "Dataset identity",
          sub: has && ds.length ? "Content hash · manifest · integrity · reconstruction · sessions by year" : has ? "Connected — empty catalogue" : sourceShort(src),
          body: has && ds.length
            ? html`<div class="dat-cards">${ds.map((d) => identityCard(d, resolve, research ? research.trials.filter((t) => (t.data_used ?? []).includes(d.dataset_id)) : [], !!research, sourceShort(source(ctx, "research"))))}</div>`
            : identityEmpty(src, has),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 7,
          cls: "lg-span-12",
          code: "DAT-05",
          title: "Research citations",
          sub: "Dataset ids declared in trial data_used",
          body: citations(ctx, ds, src, resolve),
        })}
        ${panel({
          span: 5,
          cls: "lg-span-12",
          code: "DAT-06",
          title: "Data doctrine",
          sub: "How this page treats data state",
          body: html`<div class="doctrine dat-doctrine">
            <div class="doctrine__item"><b>COVERAGE IS DECLARED</b><span>Bars span only the dates a producer declared. Missing dates stay missing.</span></div>
            <div class="doctrine__item"><b>IDENTITY = CONTENT HASH</b><span>Results bind to the hash of the data they used; a dataset without a hash shows none.</span></div>
            <div class="doctrine__item"><b>RECONSTRUCTED ≠ ORIGINAL</b><span>Rebuilt datasets and manifests stay flagged wherever they appear.</span></div>
            <div class="doctrine__item"><b>GAPS STAY VISIBLE</b><span>Declared gaps are cut into coverage — never filled, never smoothed.</span></div>
          </div>`,
        })}
      </div>
    `;
  },
};
