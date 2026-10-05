// Datasets — the data catalogue as declared by the data pipeline (datasets.json).
// Coverage is drawn only from declared dates; identity is the declared content
// hash; reconstruction, integrity notes and gaps are shown exactly as declared.
// Cross-references (which trials cite a dataset) are row lookups, never inferred.

import { html, raw } from "../core/html.js";
import { fmtCount, fmtDateTime, isNil, shortHash, humanize } from "../core/format.js";
import { doc, source, derived, sourceReason, sourceShort } from "../core/state.js";
import { toneOf } from "../core/tones.js";
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
  originBadge,
  kv,
  val,
  findingsList,
  legend,
} from "../components/ui.js";
import { coverageTimeline } from "./_data-timeline.js";
import { ORIGINS, ORIGIN_LABEL, countBy, countWhere, dayText, parseDay, refResolver, refChips, k, none, offTitle } from "./_data-common.js";

const INTEGRITY = ["PASS", "WARN", "FAIL", "UNKNOWN"];

const ORIGIN_SHORT = { ORIGINAL: "Original", RECONSTRUCTED: "Reconstructed", SYNTHETIC_FIXTURE: "Synthetic" };
const ORIGIN_HINT = { ORIGINAL: "records", RECONSTRUCTED: "records", SYNTHETIC_FIXTURE: "not SENTRY state" };

const COMPOSITION = [
  ["Venue", "venue"],
  ["Asset class", "asset_class"],
  ["Kind", "kind"],
  ["Bar size", "bar_size"],
  ["Timezone", "timezone"],
];

const DATA_CHECKS = [
  ["data_integrity", "Data integrity", "Datasets verified against manifests"],
  ["dataset_identity", "Dataset identity", "Content hashes bound to every result"],
  ["reconstruction_status", "Reconstruction status", "Reconstructed material kept apart from sealed evidence"],
];

const RECORD_FIELDS = [
  "root", "name", "venue", "asset class", "kind", "bar size", "timezone", "coverage start", "coverage end",
  "sessions", "rows", "sessions by year", "content hash", "manifest", "integrity", "integrity notes",
  "reconstruction", "gaps", "last verified", "used by", "origin",
];

const pct = (n) => raw(Number(n).toFixed(2));

/* ------------------------------------------------------------------ summary */

function summary(ds, src) {
  const off = sourceShort(src);
  const has = Array.isArray(ds);
  const rows = ds ?? [];
  const starts = rows.map((d) => parseDay(d.coverage_start)).filter((t) => t !== null);
  const ends = rows.map((d) => parseDay(d.coverage_end)).filter((t) => t !== null);
  const verified = rows.map((d) => d.last_verified_at).filter((x) => !isNil(x)).sort();
  const minStart = starts.length ? rows.find((d) => parseDay(d.coverage_start) === Math.min(...starts)).coverage_start : null;
  const maxEnd = ends.length ? rows.find((d) => parseDay(d.coverage_end) === Math.max(...ends)).coverage_end : null;
  const noneLabel = has && !rows.length ? "NONE DECLARED" : "NOT DECLARED";
  const count = (pred) => (has ? fmtCount(countWhere(rows, pred)) : null);
  const gaps = has ? rows.reduce((n, d) => n + (d.gaps ?? []).length, 0) : null;

  return html`
    <div class="dat-sumgrid">
      <div>
        <div class="dat-sec">${k("Catalogue records by origin")}<span class="dat-sec__note">never merged</span></div>
        ${statRow(
          ORIGINS.map((o) => stat({ label: ORIGIN_SHORT[o], value: count((d) => d.origin === o), hint: ORIGIN_HINT[o], emptyLabel: off, size: "sm" })),
          { min: 120 },
        )}
      </div>
      <div>
        <div class="dat-sec">${k("Declared coverage")}<span class="dat-sec__note">min / max of declared dates</span></div>
        ${statRow(
          [
            stat({ label: "Earliest start", value: has ? dayText(minStart) : null, emptyLabel: has ? noneLabel : off, size: "sm" }),
            stat({ label: "Latest end", value: has ? dayText(maxEnd) : null, emptyLabel: has ? noneLabel : off, size: "sm" }),
            stat({ label: "Declared gaps", value: isNil(gaps) ? null : fmtCount(gaps), hint: "all datasets", emptyLabel: off, size: "sm" }),
          ],
          { min: 120 },
        )}
      </div>
    </div>
    <div class="dat-sec dat-sec--gap">${k("Integrity as declared")}<span class="dat-sec__note">per dataset · not recomputed</span></div>
    ${statRow(
      [
        ...INTEGRITY.map((s) => {
          const n = has ? countWhere(rows, (d) => d.integrity === s) : null;
          return stat({ label: s, value: isNil(n) ? null : fmtCount(n), tone: n ? toneOf(s) : undefined, hint: "datasets", emptyLabel: off, size: "sm" });
        }),
        stat({ label: "Reconstructed", value: count((d) => d.reconstructed === true), tone: has && countWhere(rows, (d) => d.reconstructed === true) ? toneOf("RECONSTRUCTED") : undefined, hint: "flag = true", emptyLabel: off, size: "sm" }),
        stat({ label: "Last verified", value: verified.length ? fmtDateTime(verified[verified.length - 1]) : null, hint: "most recent", emptyLabel: has ? noneLabel : off, size: "sm" }),
      ],
      { min: 110 },
    )}
    <div class="dat-sec dat-sec--gap">${k("Catalogue composition")}<span class="dat-sec__note">distinct declared values · record count</span></div>
    <div class="dat-comp">
      ${COMPOSITION.map(([lbl, field]) => {
        const groups = has ? countBy(rows.filter((d) => !isNil(d[field]) && d[field] !== ""), (d) => d[field]) : null;
        const missing = has ? countWhere(rows, (d) => isNil(d[field]) || d[field] === "") : 0;
        return html`<div class="dat-comp__cell" data-comp="${field}">
          <span class="dat-comp__k">${lbl}</span>
          <span class="dat-comp__v">${
            !has
              ? html`${val(null)}<span class="dat-none">${off}</span>`
              : groups.size
                ? html`${[...groups.entries()].map(([v, n]) => html`<span class="dat-file" title="${v}">${field === "kind" ? humanize(v) : v} <b>×${fmtCount(n)}</b></span>`)}${missing ? html`<span class="dat-file dat-file--none">NOT DECLARED <b>×${fmtCount(missing)}</b></span>` : ""}`
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
  const anyOk = Object.values(ctx.snap?.sources ?? {}).some((s) => s.status === "OK");
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
        <div class="dat-gov__state">${badge(sys?.state ?? "NOT_CONNECTED")}<span class="dat-gov__meta">${
          sys?.declared?.heartbeat_at ? html`HB ${fmtDateTime(sys.declared.heartbeat_at)}` : sys?.declared ? "NO HEARTBEAT" : "SYSTEM.JSON"
        }</span></div>
      </div>
      ${DATA_CHECKS.map(([key, lbl, desc]) => {
        const c = byKey.get(key);
        const state = c?.state ?? (gov ? "NOT_REPORTED" : "NOT_CONNECTED");
        return html`<div class="dat-gov__row" data-gov-row="${key}" data-state="${state}">
          <div class="dat-gov__main"><span class="dat-gov__label">${lbl}</span><span class="dat-gov__desc">${c?.detail ?? desc}</span></div>
          <div class="dat-gov__state">${badge(state)}<span class="dat-gov__meta">${
            c?.checked_at ? html`CHECKED ${fmtDateTime(c.checked_at)}` : c ? "NO TIMESTAMP" : gov ? "NOT REPORTED" : sourceShort(govSrc)
          }</span></div>
        </div>`;
      })}
    </div>
    <div class="dat-sec dat-sec--gap">${k("Data-source findings")}<span class="dat-sec__note">Command Centre cross-checks</span></div>
    ${findingsList(findings, {
      limit: 3,
      empty: html`<div class="dat-none-line">${none(anyOk ? "No data-source findings — connected documents conform" : "Nothing connected — nothing to cross-check")}</div>`,
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
      const cat = ds ? (ids.has(ref) ? badge("CATALOGUED", { label: "IN CATALOGUE" }) : badge("UNRESOLVED", { label: "NOT IN CATALOGUE" })) : badge(dsSrc?.status ?? "NOT_CONFIGURED", { label: "CATALOGUE " + sourceShort(dsSrc) });
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
          sub: has ? `${ds.length} dataset record${ds.length === 1 ? "" : "s"} declared` : sourceReason(src),
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
