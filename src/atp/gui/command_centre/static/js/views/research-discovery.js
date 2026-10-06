// Discovery — where research comes from. Research areas declared by the
// research engine, the discovery queue (hypotheses at DISCOVERY / HYPOTHESIS
// with no terminal outcome), and every family already explored with its
// terminal outcomes, so exhausted directions stay visible.
// Only areas present in research.json are listed; nothing is suggested here.

import { html } from "../core/html.js";
import { fmtCount, fmtDate, humanize } from "../core/format.js";
import { sourceReason } from "../core/state.js";
import { toneClass } from "../core/tones.js";
import { pageHeader, panel, badge, chip, stat, statRow, sourceTag, emptyState, val } from "../components/ui.js";
import { steps } from "../components/flow.js";
import { TERMINALS } from "../components/pipeline.js";
import * as R from "./_research-a-common.js";

const QUEUE_STAGES = new Set(["DISCOVERY", "HYPOTHESIS"]);
// Hypothesis ids listed per family row; each row is one family and one origin, so the remainder is never a merged count.
const ID_CAP = 12;

const AREA_DESC = {
  CANDIDATE_AREA: "Proposed direction — not yet researched",
  ACTIVE: "Programmes running under this mechanism",
  DEFERRED: "Parked — data, cost or priority",
  EXHAUSTED: "Explored to conclusion — kept so it is not re-mined",
};

/* ---------------------------------------------------------------- hero */

function heroBody(rs, src) {
  const areas = rs?.research_areas ?? null;
  const byStatus = areas ? R.groupBy(areas, (a) => a.status) : null;
  const queue = rs ? rs.hypotheses.filter((h) => QUEUE_STAGES.has(h.stage_reached) && !h.terminal) : null;
  // Distinct families per record origin (the per-origin sets may overlap; never added together).
  const families = rs ? R.distinctByOrigin([...rs.hypotheses, ...rs.trials], (r) => r.family) : null;
  const nc = rs ? undefined : R.offLabel(src);
  return html`<div class="rsa-hero">
    <div class="rsa-hero__main">
      ${statRow(
        [
          stat({ label: "Areas", value: R.count(areas?.length), hint: "Declared", emptyLabel: nc }),
          ...R.AREA_STATUSES.map((s) =>
            stat({ label: humanize(s === "CANDIDATE_AREA" ? "CANDIDATE" : s), value: R.count(byStatus ? byStatus.get(s)?.length ?? 0 : null), hint: "Areas", emptyLabel: nc }),
          ),
          stat({ label: "Queue", value: R.splitVal(R.splitByOrigin(queue)), hint: "Untested", emptyLabel: nc }),
          stat({
            label: "Families",
            value: R.splitVal(families, { what: "distinct families" }),
            hint: "Explored, per origin",
            emptyLabel: nc,
            title: "Distinct families on hypotheses and trials, counted per record origin; a family on both original and reconstructed records appears in both counts, which are never added.",
          }),
        ],
        { min: 96 },
      )}
      <div class="rsa-hero__flow">
        ${steps(
          [
            { key: "MECHANISM", label: "Economic mechanism", detail: "Who pays whom, and why it should persist" },
            { key: "AREA", label: "Research area", detail: "Mechanism class, rationale, literature" },
            { key: "PROGRAMME", label: "Programme", detail: "Specification frozen before data" },
            { key: "HYPOTHESIS", label: "Hypothesis", detail: "Preregistered, falsifiable statement" },
            { key: "TRIAL", label: "Trial", detail: "Every test counted toward multiple-testing" },
          ],
          { cls: "rsa-steps" },
        )}
      </div>
    </div>
    <aside class="rsa-hero__doctrine">
      <div class="rsa-hero__k">MECHANISM FIRST</div>
      <p>Research must start from an <b>economically motivated mechanism</b> — never from an endless parameter search.</p>
      <p>A direction the research engine declares exhausted stays listed here, so it is not silently re-mined under a new name.</p>
    </aside>
  </div>`;
}

/* ---------------------------------------------------------------- research areas */

function areaCard(a, rs) {
  return html`<article class="rsa-area" data-area="${a.area_id}">
    <div class="rsa-area__head"><span class="rsa-area__id">${a.area_id}</span>${badge(a.status)}</div>
    <div class="rsa-area__name">${a.name}</div>
    <div class="rsa-area__class">${a.mechanism_class ? chip(a.mechanism_class.toUpperCase(), { title: "Mechanism class" }) : html`<span class="rsa-none">Mechanism class not declared</span>`}</div>
    <div class="rsa-area__k">Rationale</div>
    <div class="rsa-area__v">${a.rationale ?? html`<span class="rsa-none">Not declared</span>`}</div>
    <div class="rsa-area__k">Literature</div>
    ${a.literature.length ? html`<ul class="rsa-lit">${a.literature.map((l) => html`<li>${l}</li>`)}</ul>` : html`<div class="rsa-none">None cited</div>`}
    <div class="rsa-area__k">Programmes</div>
    ${a.programme_ids.length
      ? html`<div class="rsa-area__progs">${a.programme_ids.map((pid) => {
          const p = rs.programmes.find((x) => x.programme_id === pid);
          return html`<span class="rsa-area__prog">${R.ref(pid, R.programmeHref(pid))}${p ? badge(p.status) : html`<span class="rsa-none" title="Referenced but not declared in research.programmes">unresolved</span>`}</span>`;
        })}</div>`
      : html`<div class="rsa-none">None linked</div>`}
  </article>`;
}

function areasBody(rs, src) {
  const by = rs ? R.groupBy(rs.research_areas, (a) => a.status) : null;
  return html`<div class="rsa-board">${R.AREA_STATUSES.map((s) => {
    const list = by ? by.get(s) ?? [] : null;
    return html`<section class="rsa-board__col ${toneClass(list?.length ? s : null)}" data-area-status="${s}">
      <header class="rsa-board__head">
        <div><div class="rsa-board__title">${humanize(s)}</div><div class="rsa-board__desc">${AREA_DESC[s]}</div></div>
        <span class="rsa-board__count">${val(list ? fmtCount(list.length) : null)}</span>
      </header>
      <div class="rsa-board__body">
        ${list === null
          ? html`<div class="rsa-board__none">${R.offLabel(src)}</div>`
          : list.length
            ? list.map((a) => areaCard(a, rs))
            : html`<div class="rsa-board__none">NONE DECLARED</div>`}
      </div>
    </section>`;
  })}</div>`;
}

/* ---------------------------------------------------------------- queue */

function queueBody(rs, src, rowsQ) {
  const rows = rs ? rs.hypotheses.filter((h) => QUEUE_STAGES.has(h.stage_reached) && !h.terminal).sort(R.byId("hypothesis_id")) : null;
  // Only a page of the queue is materialised; the DSC-01 queue count comes from the full list.
  const page = R.pageRows(rows, rowsQ);
  return html`${R.frameTable({
    dense: true,
    rows: page.shown,
    rowHref: (h) => R.hypHref(h.hypothesis_id),
    columns: [
      {
        key: "hypothesis_id",
        label: "Hypothesis",
        cls: "wrap",
        render: (h) => html`<div class="rsa-stack-cell"><span class="cluster">${R.ref(h.hypothesis_id, R.hypHref(h.hypothesis_id), html`data-hyp="${h.hypothesis_id}"`)}${h.origin === "ORIGINAL" ? "" : R.originCell(h.origin)}</span><span class="rsa-title">${h.title}</span></div>`,
      },
      {
        key: "family",
        label: "Family · programme",
        render: (h) =>
          h.family || h.programme_id
            ? html`<div class="rsa-stack-cell">${h.family ? html`<span class="mono rsa-nowrap">${h.family}</span>` : html`<span class="rsa-sub">family not declared</span>`}${
                h.programme_id ? R.ref(h.programme_id, R.programmeHref(h.programme_id)) : html`<span class="rsa-sub">programme not declared</span>`
              }</div>`
            : null,
      },
      { key: "status", label: "Status · stage", render: (h) => html`<div class="rsa-stack-cell">${badge(h.status)}${R.stageCell(h.stage_reached, h.terminal)}</div>` },
      { key: "prereg", label: "Preregistered", render: (h) => R.preregCell(h) },
    ],
    empty: rs
      ? emptyState({ title: "Discovery queue empty", reason: "No hypothesis is at DISCOVERY or HYPOTHESIS stage without a terminal outcome.", compact: true })
      : R.srcEmpty(src, "Discovery queue", { compact: true, hint: "Hypotheses registered but not yet tested appear here, with their preregistration status." }),
  })}${R.pager(page, (n) => R.qhref("/research/discovery", { rows: n }), { noun: "hypotheses" })}`;
}

function stoppedBody(rs, src) {
  const rows = rs ? rs.hypotheses.filter((h) => QUEUE_STAGES.has(h.stage_reached) && h.terminal).sort(R.byId("hypothesis_id")) : null;
  return R.frameTable({
    dense: true,
    rows,
    rowHref: (h) => R.hypHref(h.hypothesis_id),
    columns: [
      {
        key: "hypothesis_id",
        label: "Hypothesis",
        cls: "wrap",
        render: (h) => html`<div class="rsa-stack-cell">${R.ref(h.hypothesis_id, R.hypHref(h.hypothesis_id), html`data-hyp="${h.hypothesis_id}"`)}<span class="rsa-title">${h.title}</span>${R.originCell(h.origin)}</div>`,
      },
      { key: "terminal", label: "Stopped as", render: (h) => html`<div class="rsa-stack-cell">${badge(h.terminal)}<span class="rsa-sub">at ${humanize(h.stage_reached)}</span></div>` },
      {
        key: "decision",
        label: "Decision",
        cls: "wrap",
        render: (h) =>
          h.decision_reason || h.decided_at
            ? html`<div class="rsa-stack-cell"><span>${h.decision_reason ?? html`<span class="rsa-sub">reason not declared</span>`}</span><span class="rsa-sub mono">${h.decided_at ? fmtDate(h.decided_at) : "decision date not declared"}</span></div>`
            : null,
      },
    ],
    empty: rs
      ? emptyState({ title: "None stopped before testing", reason: "No hypothesis ended at DISCOVERY or HYPOTHESIS stage.", compact: true })
      : R.srcEmpty(src, "Stopped hypotheses", { compact: true, hint: "Ideas blocked by data or abandoned before any test appear here — they remain part of the record." }),
  });
}

/* ---------------------------------------------------------------- families */

function familyRows(rs) {
  const hypG = R.groupBy(rs.hypotheses, (h) => `${h.family ?? ""}\u0000${h.origin}`);
  const trialG = R.groupBy(rs.trials, (t) => `${t.family ?? ""}\u0000${t.origin}`);
  const keys = new Set([...hypG.keys(), ...trialG.keys()]);
  const famTotal = new Map();
  for (const h of rs.hypotheses) famTotal.set(h.family ?? "", (famTotal.get(h.family ?? "") ?? 0) + 1);
  const originRank = { ORIGINAL: 0, RECONSTRUCTED: 1, SYNTHETIC_FIXTURE: 2 };
  const rows = [...keys].map((k) => {
    const [family, origin] = k.split("\u0000");
    const hs = hypG.get(k) ?? [];
    const terminals = Object.fromEntries(TERMINALS.map((t) => [t, hs.filter((h) => h.terminal === t).length]));
    return {
      family: family || null,
      origin,
      hyps: hs.length,
      open: hs.filter((h) => !h.terminal).length,
      validated: hs.filter((h) => h.status === "VALIDATED").length,
      terminals,
      trials: (trialG.get(k) ?? []).length,
      programmes: [...new Set(hs.map((h) => h.programme_id).filter(Boolean))],
      ids: hs.map((h) => h.hypothesis_id),
    };
  });
  rows.sort(
    (a, b) =>
      (famTotal.get(b.family ?? "") ?? 0) - (famTotal.get(a.family ?? "") ?? 0) ||
      String(a.family ?? "~").localeCompare(String(b.family ?? "~")) ||
      originRank[a.origin] - originRank[b.origin],
  );
  // Mark the first row of each family so sub-rows of another origin read as continuations.
  rows.forEach((r, i) => (r.first = i === 0 || rows[i - 1].family !== r.family));
  return rows;
}

function profileBar(r) {
  const segs = [["ACTIVE", r.open, "Open (no terminal)"], ...TERMINALS.map((t) => [t, r.terminals[t], humanize(t)])].filter(([, n]) => n > 0);
  if (!segs.length) return html`<span class="rsa-profile is-empty" title="No hypotheses"></span>`;
  return html`<span class="rsa-profile">${segs.map(
    ([state, n, label]) => html`<i class="rsa-profile__seg ${toneClass(state)}" style="flex:${String(n)}" title="${label}: ${n}"></i>`,
  )}</span>`;
}

function familiesBody(rs, src) {
  const rows = rs ? familyRows(rs) : null;
  const zero = (n) => (n > 0 ? html`<span class="v" data-v>${fmtCount(n)}</span>` : html`<span class="rsa-zero" data-v>0</span>`);
  const columns = [
    {
      key: "family",
      label: "Family",
      render: (r) => html`<div class="rsa-fam ${r.first ? "" : "rsa-fam--sub"}">
        ${r.first ? html`<span class="rsa-fam__name">${r.family ?? html`<span class="rsa-none">No family declared</span>`}</span>` : html`<span class="rsa-fam__cont">↳</span>`}
        ${r.origin === "ORIGINAL" ? "" : R.originCell(r.origin)}
      </div>`,
    },
    { key: "hyps", label: "Hypotheses", num: true, render: (r) => zero(r.hyps) },
    { key: "open", label: "Open", num: true, render: (r) => zero(r.open) },
    ...TERMINALS.map((t) => ({ key: t, label: humanize(t), num: true, render: (r) => zero(r.terminals[t]) })),
    { key: "validated", label: "Validated", num: true, render: (r) => zero(r.validated) },
    { key: "trials", label: "Trials", num: true, render: (r) => zero(r.trials) },
    { key: "profile", label: "Outcome profile", render: (r) => profileBar(r) },
    {
      key: "ids",
      label: "Hypotheses / programmes",
      cls: "wrap",
      render: (r) =>
        r.ids.length || r.programmes.length
          ? html`<span class="rsa-refs">${r.ids.slice(0, ID_CAP).map((id) => R.ref(id, R.hypHref(id)))}${
              r.ids.length > ID_CAP ? html`<span class="rsa-sub" data-ids-hidden="${String(r.ids.length - ID_CAP)}">+${fmtCount(r.ids.length - ID_CAP)} more</span>` : ""
            }${r.programmes.length ? html`<span class="rsa-refs__sep">·</span>` : ""}${r.programmes.map((p) => R.ref(p, R.programmeHref(p)))}</span>`
          : null,
    },
  ];
  return R.frameTable({
    dense: true,
    columns,
    rows,
    rowCls: (r) => (r.first ? "rsa-fam-row" : `rsa-fam-row rsa-fam-row--sub ${toneClass(r.origin)}`),
    empty: rs
      ? emptyState({ title: "No families explored", reason: "No hypothesis or trial in research.json declares a family.", compact: true })
      : R.srcEmpty(src, "Families", {
          compact: true,
          hint: "Every family ever explored appears here with its open and terminal outcomes — including the ones that failed.",
        }),
  });
}

/* ---------------------------------------------------------------- view */

export default {
  title: "Discovery",
  render(ctx) {
    const { rs, src } = R.research(ctx);
    const areaCount = rs ? rs.research_areas.length : null;
    return html`
      ${pageHeader({
        kicker: "RESEARCH ENGINE",
        code: "DSC",
        title: "Discovery",
        sub: "Where new research comes from: economically motivated mechanisms, not endless parameter search. Directions declared explored or exhausted stay on screen, so they are not silently re-mined.",
        right: sourceTag(src, { now: ctx.now }),
      })}

      <div class="grid">
        ${panel({ span: 12, code: "DSC-01", title: "Mechanism-first discovery", sub: rs ? "Declared areas and the untested queue" : sourceReason(src), body: heroBody(rs, src), cls: "rsa-wraplabels" })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "DSC-02",
          title: "Research areas",
          sub: rs ? `${areaCount} declared by the research engine · only declared areas are listed` : sourceReason(src),
          body: areasBody(rs, src),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 7,
          code: "DSC-03",
          title: "Discovery queue",
          sub: "Hypotheses at DISCOVERY / HYPOTHESIS stage with no terminal outcome",
          body: queueBody(rs, src, ctx.query.rows),
          variant: "flush",
          cls: "lg-span-12 rsa-flush rsa-subwrap",
        })}
        ${panel({
          span: 5,
          code: "DSC-04",
          title: "Stopped before testing",
          sub: "Terminal outcome at DISCOVERY / HYPOTHESIS",
          body: stoppedBody(rs, src),
          variant: "flush",
          cls: "lg-span-12 rsa-flush rsa-subwrap",
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "DSC-05",
          title: "Families explored",
          sub: "Hypotheses grouped by family and record origin · terminal outcomes stay visible",
          body: familiesBody(rs, src),
          variant: "flush",
          cls: "rsa-flush",
          foot: rs
            ? html`Counts are rows of research.json grouped for display; each record origin is its own row and is never merged. Open = no terminal outcome declared.`
            : "",
        })}
      </div>
    `;
  },
};
