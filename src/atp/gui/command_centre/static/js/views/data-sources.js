// State Sources — the integration page. Every contract document the Command
// Centre reads (snapshot.sources) plus the agent event stream (events_source):
// status, location, envelope meta, and the full validation error for INVALID /
// UNREADABLE documents. Explains how a producer connects. Read-only: links go
// to local JSON Schemas and GET endpoints only.

import { html, raw, cx } from "../core/html.js";
import { fmtDateTime, fmtBytes, fmtCount, isNil, pad2 } from "../core/format.js";
import { derived, sourceShort } from "../core/state.js";
import { toneOf } from "../core/tones.js";
import { pageHeader, panel, badge, dot, chip, val, originBadge, emptyState, notice, severityBadge, kv } from "../components/ui.js";
import { icon } from "../components/icons.js";
import { PAYLOAD_MODEL, SOURCE_STATUSES, ORIGINS, ORIGIN_LABEL, schemaHref, schemaFile, k, none, codeLine } from "./_data-common.js";
import { stateOfStatus } from "./_command-common.js";

const STATUS_DESC = {
  OK: "Conforms to the contract",
  MISSING: "File not produced yet",
  INVALID: "Fails contract validation",
  UNREADABLE: "Cannot be read or parsed",
  NOT_CONFIGURED: "No state directory",
};

const SEVERITIES = ["CRITICAL", "WARNING", "INFO"];

/*
 * Provider statuses are shown through the shared display state (stateOfStatus):
 * OK -> CONNECTED (cyan), never green — a document being connected and
 * contract-valid is not a passed research or governance check, and fixture or
 * reconstructed documents are "OK" too. data-status keeps the raw provider value.
 */
const shownState = (status) => stateOfStatus(status);
const shownLabel = (status) => sourceShort({ status });

function statusBadge(status) {
  return badge(shownState(status), { label: shownLabel(status), title: `Provider status ${status}` });
}

const API = [
  ["/api/cc/health", "Liveness, versions, provider"],
  ["/api/cc/revision", "Cheap change token (polled every 4s)"],
  ["/api/cc/snapshot", "Sources + documents + derived, in one read"],
  ["/api/cc/sources", "Per-document status only"],
  ["/api/cc/events", "Agent events · ?slot= &limit= &kind="],
  ["/api/cc/contract", "Contract index: files, labels, event stream"],
];

function originOf(meta) {
  if (!meta) return val(null);
  return meta.origin === "ORIGINAL" ? badge("ORIGINAL") : originBadge(meta.origin);
}

/* ------------------------------------------------------------------ provider */

function providerPanel(snap) {
  const loc = snap.provider?.location;
  return html`
    <div class="dat-prov ${loc ? "is-on" : ""}">
      <div class="dat-prov__icon">${icon(loc ? "data" : "empty")}</div>
      <div class="dat-prov__main">
        ${k("State location")}
        ${loc ? html`<code class="dat-prov__path" title="${loc}">${loc}</code>` : html`<div class="dat-prov__none">${badge("NOT_CONFIGURED")}<span>No state directory or provider location</span></div>`}
      </div>
    </div>
    ${kv(
      [
        ["Provider kind", html`<span class="mono">${snap.provider?.kind ?? ""}</span>`],
        ["Contract version", html`<span class="mono">v${snap.contract_version}</span>`],
        ["Access", html`<span class="cluster">${chip("READ-ONLY")}${chip("GET ONLY")}</span>`],
        ["App version", html`<span class="mono">${snap.app_version}</span>`],
        ["Snapshot generated", html`<span class="mono">${fmtDateTime(snap.generated_at)}</span>`],
        ["Revision", html`<span class="mono">${snap.revision}</span>`],
      ],
      { cols: 2 },
    )}`;
}

/* ------------------------------------------------------------------ validation summary */

function validationPanel(snap) {
  const srcs = Object.values(snap.sources ?? {});
  const ev = snap.events_source;
  const byOrigin = new Map(ORIGINS.map((o) => [o, srcs.filter((s) => s.meta?.origin === o)]));
  const anyMeta = srcs.some((s) => s.meta);
  return html`
    <div class="dat-vs">
      ${SOURCE_STATUSES.map((st) => {
        const n = srcs.filter((s) => s.status === st).length;
        // A status no document is in stays muted; a hit is toned by its display state (OK -> CONNECTED, cyan).
        return html`<div class="${cx("dat-vs__row", n > 0 && "is-hit")} tone-${n > 0 ? toneOf(shownState(st)) : "muted"}" data-status-count="${st}">
          <span class="dat-vs__badge">${n > 0 ? statusBadge(st) : badge(null, { label: shownLabel(st), title: `Provider status ${st}` })}</span>
          <span class="dat-vs__desc">${STATUS_DESC[st]}</span>
          <span class="dat-vs__count">${String(n)}<span>/${String(srcs.length)}</span></span>
          <span class="dat-vs__bar"><i style="width:${raw(srcs.length ? ((n / srcs.length) * 100).toFixed(1) : "0")}%"></i></span>
        </div>`;
      })}
    </div>
    <div class="dat-vs__events">
      ${k("Event stream")}<span class="mono text-2">${ev.file}</span>${statusBadge(ev.status)}
      ${ev.status === "OK" || ev.status === "INVALID"
        ? html`<span class="mono small text-2">${fmtCount(ev.total_lines)} lines · ${fmtCount(ev.valid_events)} valid · ${fmtCount(ev.invalid_lines)} invalid</span>`
        : html`<span class="muted small">${STATUS_DESC[ev.status] ?? sourceShort(ev)}</span>`}
    </div>
    <div class="dat-sec dat-sec--gap">${k("Envelope provenance")}<span class="dat-sec__note">meta.origin per document · never merged</span></div>
    <div class="dat-prov-origins">
      ${ORIGINS.map((o) => {
        const docs = byOrigin.get(o);
        return html`<div class="dat-po" data-origin="${o}">
          <span class="dat-po__k">${ORIGIN_LABEL[o]}</span>
          <span class="dat-po__v">${docs.length ? html`<span class="dat-refs">${docs.map((s) => html`<span class="dat-file">${s.file}</span>`)}</span>` : none(anyMeta ? "None" : "No envelope read")}</span>
        </div>`;
      })}
    </div>`;
}

/* ------------------------------------------------------------------ subsystem feeds */

function feedsPanel(ctx) {
  const sys = derived(ctx, "system") ?? [];
  const snap = ctx.snap;
  const fileOf = (key) => (key === "agent_events" ? snap.events_source.file : snap.sources[key]?.file ?? key);
  if (!sys.length) return emptyState({ title: "No snapshot", compact: true });
  return html`<div class="dat-feeds">
    ${sys.map(
      (s) => html`<div class="dat-feed" data-subsystem="${s.key}">
        <div class="split"><span class="dat-feed__label">${s.label}</span>${badge(s.state)}</div>
        <div class="dat-feed__srcs">${Object.entries(s.sources).map(
          ([key, st]) => html`<span class="dat-feed__src" data-feed-status="${st}" title="${fileOf(key)}: ${shownLabel(st)}">${dot(shownState(st))}<span>${fileOf(key)}</span></span>`,
        )}</div>
        <div class="dat-feed__meta">${s.declared ? "DECLARED BY SYSTEM.JSON" : "FROM SOURCE STATUS · NOT DECLARED"}</div>
      </div>`,
    )}
  </div>`;
}

/* ------------------------------------------------------------------ documents */

function locCell(src) {
  if (!src.path) {
    return html`<span class="dat-doc__loc">${val(null)}<small>${src.status === "NOT_CONFIGURED" ? "No state directory" : "No path reported"}</small></span>`;
  }
  return html`<span class="dat-doc__loc"><code title="${src.path}"><bdi>${src.path}</bdi></code><small>${val(src.modified_at ? fmtDateTime(src.modified_at) : null)}<span class="dat-doc__dot">·</span>${val(isNil(src.size) ? null : fmtBytes(src.size))}</small></span>`;
}

function docRow(src, i) {
  const st = src.status;
  const meta = src.meta;
  const err = st === "INVALID" || st === "UNREADABLE" ? src.error : null;
  return html`<div class="dat-doc tone-${toneOf(shownState(st))}" data-source-row="${src.key}" data-status="${st}" data-kind="document" role="row">
    <span class="dat-doc__n">${pad2(i)}</span>
    <span class="dat-doc__status">${statusBadge(st)}</span>
    <span class="dat-doc__name"><b>${src.file}</b><small>${src.label} · ${PAYLOAD_MODEL[src.key] ?? src.key}</small></span>
    ${locCell(src)}
    <span class="dat-doc__meta">${meta
      ? html`<span class="mono" title="producer">${meta.producer}</span><small>${val(fmtDateTime(meta.generated_at))}<span class="dat-doc__dot">·</span>schema v${meta.schema_version}</small>${
          meta.notes?.length ? html`<small class="dat-doc__note" title="${meta.notes.join("\n")}">NOTE${meta.notes.length > 1 ? `S ${meta.notes.length}` : ""} · ${meta.notes[0]}</small>` : ""
        }`
      : html`${val(null)}<small>${st === "INVALID" ? "Envelope meta invalid" : "No envelope read"}</small>`}</span>
    <span class="dat-doc__origin">${originOf(meta)}</span>
    <a class="dat-doc__schema" href="${schemaHref(src.key)}" target="_blank" rel="noopener" title="JSON Schema for ${src.file}">${icon("file")}<span>${schemaFile(src.key)}</span></a>
    ${err
      ? html`<div class="dat-doc__err" data-source-error="${src.key}"><span class="dat-doc__err-k">${icon("alert")}${st === "INVALID" ? "Contract validation error" : "Read error"} · ${src.file}</span><pre>${err}</pre></div>`
      : ""}
    ${st === "MISSING" ? html`<div class="dat-doc__hint">${icon("info")}Not produced yet — the provider expects it at <code>${src.path}</code></div>` : ""}
  </div>`;
}

function eventsRow(ev, i) {
  const st = ev.status;
  const read = st === "OK" || st === "INVALID";
  const err = st === "INVALID" || st === "UNREADABLE" ? ev.error : null;
  return html`<div class="dat-doc tone-${toneOf(shownState(st))}" data-source-row="agent_events" data-status="${st}" data-kind="stream" role="row">
    <span class="dat-doc__n">${pad2(i)}</span>
    <span class="dat-doc__status">${statusBadge(st)}</span>
    <span class="dat-doc__name"><b>${ev.file}</b><small>${ev.label} · ${PAYLOAD_MODEL.agent_events}</small></span>
    ${locCell({ ...ev, size: null })}
    <span class="dat-doc__meta">${read
      ? html`<span class="mono">${val(fmtCount(ev.total_lines))} lines</span><small>${val(fmtCount(ev.valid_events))} valid<span class="dat-doc__dot">·</span>${val(fmtCount(ev.invalid_lines))} invalid</small>`
      : html`${val(null)}<small>Append-only · one event per line</small>`}</span>
    <span class="dat-doc__origin"><span class="muted small">PER EVENT</span></span>
    <a class="dat-doc__schema" href="${schemaHref("agent_events")}" target="_blank" rel="noopener" title="JSON Schema for one agent event">${icon("file")}<span>${schemaFile("agent_events")}</span></a>
    ${err ? html`<div class="dat-doc__err" data-source-error="agent_events"><span class="dat-doc__err-k">${icon("alert")}${st === "INVALID" ? "Invalid event lines" : "Read error"} · ${ev.file}</span><pre>${err}</pre></div>` : ""}
    ${st === "MISSING" ? html`<div class="dat-doc__hint">${icon("info")}Not produced yet — the provider expects it at <code>${ev.path}</code></div>` : ""}
  </div>`;
}

function documentsPanel(snap) {
  const srcs = Object.values(snap.sources ?? {});
  const broken = srcs.filter((s) => s.status === "INVALID" || s.status === "UNREADABLE");
  return html`
    ${broken.length
      ? html`<div class="dat-doc-alert">${notice({
          title: `${broken.length} document${broken.length === 1 ? "" : "s"} rejected by the contract`,
          body: html`${broken.map((s) => s.file).join(", ")} — the Command Centre shows these as unavailable rather than rendering partial or coerced state. Full errors below.`,
          tone: "bad",
        })}</div>`
      : ""}
    <div class="dat-docs" role="table" aria-label="Contract documents">
      <div class="dat-doc dat-doc--head" role="row">
        <span>#</span><span>Status</span><span>Document · payload model</span><span>Location · modified · size</span><span>Producer · generated · schema</span><span>Origin</span><span>JSON Schema</span>
      </div>
      ${srcs.map((s, i) => docRow(s, i + 1))}
      ${eventsRow(snap.events_source, srcs.length + 1)}
    </div>`;
}

/* ------------------------------------------------------------------ data flow */

function flowPanel(ctx) {
  const snap = ctx.snap;
  const srcs = Object.values(snap.sources ?? {});
  const configured = !!snap.provider?.location;
  const present = srcs.filter((s) => s.status !== "NOT_CONFIGURED" && s.status !== "MISSING");
  const ok = srcs.filter((s) => s.status === "OK");
  const producers = [...new Set(srcs.map((s) => s.meta?.producer).filter(Boolean))];
  const findings = derived(ctx, "consistency") ?? [];
  const statusHits = SOURCE_STATUSES.map((st) => [st, srcs.filter((s) => s.status === st).length]).filter(([, n]) => n > 0);

  const stages = [
    {
      key: "PRODUCERS",
      title: "Producers",
      sub: "Research engine · validation · deployment · agents · execution · data pipeline",
      live: present.length > 0,
      body: producers.length
        ? html`<div class="dat-flow__count">${String(producers.length)} <span>declared in envelopes</span></div><span class="dat-refs">${producers.slice(0, 2).map((p) => html`<span class="dat-file" title="${p}">${p}</span>`)}${producers.length > 2 ? html`<span class="dat-file dat-file--none" title="${producers.slice(2).join(", ")}">+${producers.length - 2}</span>` : ""}</span>`
        : none(configured ? "No producer declared" : "Not connected"),
    },
    {
      key: "STATE",
      title: "State directory",
      sub: `StateProvider · ${srcs.length} documents + ${snap.events_source.file}`,
      live: configured,
      body: configured ? html`<code class="dat-flow__code" title="${snap.provider.location}">${snap.provider.kind} · ${snap.provider.location}</code>` : badge("NOT_CONFIGURED"),
    },
    {
      key: "VALIDATION",
      title: "Validation",
      sub: `Contract v${snap.contract_version} · unknown fields rejected`,
      live: present.length > 0,
      body: html`<span class="cluster">${statusHits.map(([st, n]) => badge(shownState(st), { label: `${n} ${shownLabel(st)}`, title: `Provider status ${st}` }))}</span>`,
    },
    {
      key: "DERIVED",
      title: "Derived cross-checks",
      sub: "Aggregates and cross-checks — never decides research",
      live: ok.length > 0,
      body: ok.length
        ? html`<span class="cluster">${SEVERITIES.map((sev) => html`<span class="dat-sevc">${severityBadge(sev)}<b>${String(findings.filter((f) => f.severity === sev).length)}</b></span>`)}</span>`
        : none("Nothing to cross-check"),
    },
    { key: "API", title: "Read-only API", sub: "GET /api/cc/* · no mutating endpoint exists", live: true, body: html`<code class="dat-flow__code">REV ${snap.revision}</code>` },
    { key: "UI", title: "Command Centre", sub: "Renders declared state · never authors it", live: true, body: html`<span class="dat-flow__here">${icon("command")}THIS INTERFACE</span>` },
  ];

  const conn = (on) =>
    raw(
      `<svg class="dat-flow__conn" viewBox="0 0 40 12" aria-hidden="true">` +
        (on
          ? `<line x1="0" y1="6" x2="36" y2="6" stroke="rgba(34,211,238,.25)" stroke-width="2"/><line class="flow-dash" x1="0" y1="6" x2="36" y2="6" stroke="var(--cyan-2)" stroke-width="1.4"/>`
          : `<line x1="0" y1="6" x2="36" y2="6" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 3"/>`) +
        `<path d="M32 2 L38 6 L32 10" fill="none" stroke="${on ? "var(--cyan-2)" : "var(--faint)"}" stroke-width="1.2"/></svg>`,
    );

  return html`<div class="dat-flow" role="list">
    ${stages.map(
      (s, i) => html`${i > 0 ? html`<span class="dat-flow__link ${stages[i - 1].live && s.live ? "is-on" : ""}" aria-hidden="true">${conn(stages[i - 1].live && s.live)}</span>` : ""}
        <div class="${cx("dat-flow__node", s.live ? "is-live" : "is-dormant")}" data-flow-stage="${s.key}" role="listitem">
          <div class="dat-flow__idx">${pad2(i + 1)}</div>
          <div class="dat-flow__title">${s.title}</div>
          <div class="dat-flow__sub">${s.sub}</div>
          <div class="dat-flow__body">${s.body}</div>
        </div>`,
    )}
  </div>`;
}

/* ------------------------------------------------------------------ how to connect */

function connectPanel(snap) {
  const v = snap.contract_version;
  return html`<ol class="dat-steps">
    <li>
      <div class="dat-steps__t">Point the Command Centre at a state directory</div>
      ${codeLine("python -m atp.gui --state-dir <DIR>", "serves 127.0.0.1:8765")}
      ${codeLine("SENTRY_STATE_DIR=<DIR> python -m atp.gui", "same, via environment")}
    </li>
    <li>
      <div class="dat-steps__t">Export or check the contract schemas</div>
      ${codeLine("python -m atp.gui.command_centre.contract export [DIR]", "one JSON Schema per document")}
      ${codeLine("python -m atp.gui.command_centre.contract check [DIR]", "fails if schemas drift from the models")}
    </li>
    <li>
      <div class="dat-steps__t">Write documents from a producer — validated, then replaced atomically</div>
      <pre class="dat-pre">from atp.gui.command_centre.producer import write_document, append_event

write_document(state_dir, "research", payload,
               producer="&lt;producer id&gt;", origin="ORIGINAL")
append_event(state_dir, event)   # agent_events.jsonl — append-only</pre>
    </li>
    <li>
      <div class="dat-steps__t">…or serve existing state logic through a StateProvider</div>
      <pre class="dat-pre">from atp.gui.command_centre import mount_command_centre

# provider implements: kind, location(), load(key), load_events(), revision()
mount_command_centre(app, provider)   # adds /api/cc/*, /cc/static/*, UI at "/"</pre>
    </li>
    <li>
      <div class="dat-steps__t">Every document is an envelope</div>
      <pre class="dat-pre">{"meta": {"schema_version": "${v}", "producer": "…", "generated_at": "…",
          "origin": "ORIGINAL | RECONSTRUCTED | SYNTHETIC_FIXTURE", "notes": []},
 "data": &lt;payload model&gt;}</pre>
      <div class="dat-steps__note">Unknown fields are rejected, so contract drift shows here as INVALID instead of being silently dropped. Records carry their own <span class="mono">origin</span>; counts of different origins are never merged.</div>
    </li>
  </ol>`;
}

function apiPanel(snap) {
  const keys = Object.keys(snap.sources ?? {});
  return html`
    <div class="dat-sec">${k("Read-only endpoints")}<span class="dat-sec__note">GET only · local</span></div>
    <div class="dat-api">
      ${API.map(([path, desc]) => html`<a class="dat-api__row" href="${path}" target="_blank" rel="noopener"><span class="dat-api__m">GET</span><code>${path}</code><span class="dat-api__d">${desc}</span></a>`)}
    </div>
    <div class="dat-sec dat-sec--gap">${k("Contract schemas")}<span class="dat-sec__note">/api/cc/contract/&lt;name&gt;.schema.json</span></div>
    <div class="dat-schemas">
      ${[...keys, "agent_events"].map(
        (key) => html`<a class="dat-schema" href="${schemaHref(key)}" target="_blank" rel="noopener" data-schema="${key}">${icon("file")}<span>${schemaFile(key)}</span></a>`,
      )}
    </div>`;
}

/**
 * Overall header state, from source statuses only (colour via tones.js). Every document
 * connected is CONNECTED (cyan), not green: connection is not a passed check.
 */
function headState(srcs, configured) {
  if (!configured) return "NOT_CONNECTED";
  if (srcs.some((s) => s.status === "INVALID" || s.status === "UNREADABLE")) return "SOURCE_ERROR";
  const ok = srcs.filter((s) => s.status === "OK").length;
  if (ok === srcs.length) return "CONNECTED";
  return ok ? "PARTIAL" : "NOT_PRODUCED";
}

/* ------------------------------------------------------------------ view */

export default {
  title: "State Sources",
  render(ctx) {
    const snap = ctx.snap;
    const srcs = Object.values(snap.sources ?? {});
    const okN = srcs.filter((s) => s.status === "OK").length;
    const configured = !!snap.provider?.location;

    return html`
      ${pageHeader({
        kicker: "DATA",
        code: "SRC",
        title: "State Sources",
        sub: "The integration seam. Every contract document the Command Centre reads, whether it is connected and valid, who produced it and where it is expected. Producers write state; the Command Centre only reads and validates it.",
        right: html`<span class="dat-hdr">${badge(headState(srcs, configured), {
          label: configured ? `${okN}/${srcs.length} DOCUMENTS CONNECTED` : "NO STATE SOURCE",
        })}${chip(`CONTRACT v${snap.contract_version}`)}${chip("READ-ONLY")}</span>`,
      })}

      <div class="grid">
        ${panel({ span: 4, cls: "lg-span-6 md-span-6", code: "SRC-01", title: "Provider", sub: "Where state is read from", body: providerPanel(snap) })}
        ${panel({ span: 4, cls: "lg-span-6 md-span-6", code: "SRC-02", title: "Validation", sub: `${srcs.length} contract documents + event stream`, body: validationPanel(snap) })}
        ${panel({ span: 4, cls: "lg-span-12", code: "SRC-03", title: "Subsystem feeds", sub: "Which documents feed each subsystem", body: feedsPanel(ctx) })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "SRC-04",
          title: "Contract documents",
          sub: configured ? `${okN} of ${srcs.length} connected · state dir ${snap.provider.location}` : "No state directory configured — every document is NOT CONNECTED",
          body: documentsPanel(snap),
        })}
      </div>

      <div class="grid">
        ${panel({
          span: 12,
          code: "SRC-05",
          title: "Read-only data flow",
          sub: "Producers → state directory → validation → derived cross-checks → read-only API → UI",
          body: flowPanel(ctx),
          foot: html`Animated links carry state that is actually flowing now. Dashed links are dormant: nothing upstream is connected. There is no reverse path — the UI cannot write, order or deploy.`,
        })}
      </div>

      <div class="grid">
        ${panel({ span: 7, cls: "lg-span-12", code: "SRC-06", title: "How to connect", sub: "For the research engine and every other producer", body: connectPanel(snap) })}
        ${panel({ span: 5, cls: "lg-span-12", code: "SRC-07", title: "Contract & API", sub: "Local URLs only", body: apiPanel(snap) })}
      </div>
    `;
  },
};
