// SENTRY Command Centre shell: sidebar, topbar, banners, status bar, routing.

import { html, raw, cx } from "./core/html.js";
import { store } from "./core/store.js";
import { sourceShort } from "./core/state.js";
import { refreshSnapshot, startPolling } from "./core/api.js";
import { parseHash, match } from "./core/router.js";
import { fmtTime, humanize, fmtAge } from "./core/format.js";
import { toneOf, severityTone } from "./core/tones.js";
import { NAV } from "./nav.js";
import { icon, BRAND_MARK } from "./components/icons.js";
import { dot } from "./components/ui.js";
import { mountCharts } from "./components/chart.js";
import { mountGraph } from "./components/graph.js";

const $ = (id) => document.getElementById(id);
const els = {
  app: $("app"),
  banners: $("banners"),
  sidebar: $("sidebar"),
  topbar: $("topbar"),
  main: $("main"),
  view: $("view"),
  statusbar: $("statusbar"),
};

const prefs = {
  get(k, d) {
    try {
      const v = localStorage.getItem("sentry-cc:" + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("sentry-cc:" + k, JSON.stringify(v));
    } catch {
      /* storage unavailable: preference not persisted */
    }
  },
};

/* ------------------------------------------------------------------ shell */

function renderSidebar() {
  const collapsedGroups = prefs.get("navClosed", {});
  els.sidebar.innerHTML = String(html`
    <div class="brand">
      ${BRAND_MARK}
      <div class="brand__text"><span class="brand__name">SENTRY</span><span class="brand__sub">Command Centre</span></div>
    </div>
    <nav class="nav" id="nav">
      ${NAV.map(
        (g) => html`<div class="nav__group" data-group="${g.key}" data-open="${collapsedGroups[g.key] ? "false" : "true"}">
          <div class="nav__flyout" role="group" aria-label="${g.label}">
            <div class="nav__flyout-head">${g.label}</div>
            ${g.items.map((it) => html`<a class="${cx("nav__fly-link", it.sub && "nav__fly-link--sub")}" href="#${it.href}" data-fly-href="${it.href}" tabindex="-1">${it.label}</a>`)}
          </div>
          <button class="nav__heading" type="button" data-toggle-group="${g.key}"><span>${g.label}</span>${icon("chevron", "chev")}</button>
          <ul class="nav__items">
            ${g.items.map(
              (it) => html`<li><a class="${cx("nav__link", it.sub && "nav__link--sub")}" href="#${it.href}" data-nav-href="${it.href}" title="${it.label}">
                ${icon(it.icon)}<span class="nav__label">${it.label}</span><span class="nav__meta" data-nav-meta="${it.href}"></span>
              </a></li>`,
            )}
          </ul>
        </div>`,
      )}
    </nav>
    <div class="sidebar__foot">
      ${icon("lock")}<span class="foot-text">READ-ONLY · NO ORDER ENTRY</span>
      <button class="nav-toggle" type="button" id="nav-toggle" title="Collapse navigation">${icon("collapse")}</button>
    </div>`);
  els.sidebar.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-toggle-group]");
    if (t) {
      const g = t.closest(".nav__group");
      const open = g.dataset.open !== "false";
      g.dataset.open = open ? "false" : "true";
      const closed = prefs.get("navClosed", {});
      closed[g.dataset.group] = open;
      prefs.set("navClosed", closed);
    }
    if (ev.target.closest("#nav-toggle")) {
      if (narrowNav.matches) {
        // narrow screens: the toggle opens the full sidebar as an overlay (routes never hidden)
        els.app.dataset.nav = els.app.dataset.nav === "open" ? restingNav() : "open";
      } else {
        const collapsed = els.app.dataset.nav === "collapsed";
        els.app.dataset.nav = collapsed ? "expanded" : "collapsed";
        prefs.set("navCollapsed", !collapsed);
      }
    }
    if (ev.target.closest("a[href^='#']") && els.app.dataset.nav === "open") els.app.dataset.nav = restingNav();
  });
  els.app.dataset.nav = restingNav();
}

const narrowNav = window.matchMedia("(max-width: 1279px)");

function restingNav() {
  return prefs.get("navCollapsed", false) ? "collapsed" : "expanded";
}

function renderTopbar() {
  els.topbar.innerHTML = String(html`
    <div class="crumbs" id="crumbs"><span>SENTRY</span></div>
    <div class="topbar__status" id="sys-pills"></div>
    <div class="topbar__right">
      <span id="alert-chip"></span>
      <span class="ro-chip" title="The Command Centre has no write, order or deployment capability">${icon("lock", "icon")}<span class="ro-chip__text">READ-ONLY</span></span>
      <span class="clock" id="clock"></span>
    </div>`);
}

function updateClock() {
  const now = new Date();
  $("clock").innerHTML = String(html`${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 19)}<small>UTC</small>`);
}

function updateShell(state) {
  const snap = state.snapshot;
  const d = snap?.derived;

  // banners
  const banners = [];
  if (state.error) {
    banners.push(html`<div class="banner banner--error">${icon("alert")}<b>API unreachable</b><span>${state.error}</span><span>${snap ? "· showing last snapshot (stale)" : ""}</span></div>`);
  }
  if (d?.synthetic) {
    banners.push(html`<div class="banner banner--fixture" data-banner="synthetic">${icon("alert")}<b>Synthetic fixture data loaded</b><span>— nothing displayed is SENTRY state · ${snap.provider.location ?? ""}</span></div>`);
  }
  if (d?.reconstructed_sources?.length) {
    banners.push(html`<div class="banner banner--reconstructed" data-banner="reconstructed">${icon("history")}<b>Reconstructed material</b><span>— ${d.reconstructed_sources.join(", ")}: rebuilt after source loss, not original evidence</span></div>`);
  }
  if (snap && !snap.provider.location) {
    banners.push(html`<div class="banner" data-banner="no-source" style="color:var(--text-2)">${icon("info")}<b>No state source configured</b><span>— start with <code>python -m atp.gui --state-dir &lt;DIR&gt;</code> or set <code>SENTRY_STATE_DIR</code>. Every panel shows what is genuinely known: nothing.</span></div>`);
  }
  els.banners.innerHTML = String(html`${banners}`);

  // subsystem pills
  const pills = d?.system ?? [];
  $("sys-pills").innerHTML = String(
    html`${pills.map(
      (s) => html`<a class="sys-pill" href="${pillHref(s.key)}" title="${s.label}: ${humanize(s.state)}${s.source_problem ? ` — ${s.source_problem}` : ""}" data-subsystem="${s.key}" data-state="${s.state}">${dot(s.state, { pulse: toneOf(s.state) === "info" })}<span class="pill-label">${s.label}</span><span class="pill-abbr" aria-hidden="true">${PILL_ABBR[s.key] ?? ""}</span></a>`,
    )}`,
  );

  // alerts — "not connected" is never presented as "no findings"
  const chip = snap ? alertChip(snap) : null;
  $("alert-chip").innerHTML = chip
    ? String(
        html`<a class="${cx("alert-chip", chip.tone && `tone-${chip.tone}`)}" href="#/governance" title="${chip.title}" data-alert-state="${chip.state}">${icon("shield", "icon")}${chip.label}</a>`,
      )
    : "";

  // nav meta (agent status dots, data sources)
  if (d) {
    for (const s of d.agent_slots ?? []) {
      const el = document.querySelector(`[data-nav-meta="/agents/${s.slot}"]`);
      if (el) el.innerHTML = String(dot(s.status ?? "NOT_REPORTED"));
    }
    const srcs = Object.values(snap.sources ?? {});
    const ok = srcs.filter((s) => s.status === "OK").length;
    const el = document.querySelector('[data-nav-meta="/data/sources"]');
    if (el) el.textContent = `${ok}/${srcs.length}`;
    const gov = document.querySelector('[data-nav-meta="/governance"]');
    if (gov) gov.innerHTML = chip?.dot ? String(dot(chip.dot)) : "";
  }

  // status bar — the STATE path shrinks with an ellipsis and low-priority segments drop first,
  // so the right-hand group (POLL, API state) is never cut mid-token.
  const srcs = snap ? Object.values(snap.sources) : [];
  const ok = srcs.filter((s) => s.status === "OK").length;
  const loc = snap?.provider.location ?? "not configured";
  els.statusbar.innerHTML = String(html`
    <span class="seg">${dot(state.error ? "ERROR" : snap ? "CONNECTED" : "PENDING", { pulse: !state.error && !!snap })}<b>${state.error ? "API ERROR" : snap ? "API LINKED" : "CONNECTING"}</b></span>
    <span class="seg seg--opt">CONTRACT <b>v${snap?.contract_version ?? "?"}</b></span>
    <span class="seg seg--opt">PROVIDER <b>${snap?.provider.kind ?? "—"}</b></span>
    <span class="seg seg--path" title="${loc}">STATE <b>${loc}</b></span>
    <span class="seg">SOURCES <b>${snap ? `${ok}/${srcs.length} OK` : "—"}</b></span>
    <span class="seg">EVENTS <b>${snap ? sourceShort(snap.events_source) : "—"}</b></span>
    <span class="seg push seg--opt">REV <b>${snap?.revision ?? "—"}</b></span>
    <span class="seg seg--keep">POLL <b>${state.lastFetchAt ? fmtTime(state.lastFetchAt) : "—"}</b></span>
    <span class="seg seg--opt">LAT <b>${state.latencyMs ?? "—"}ms</b></span>
    <span class="seg seg--opt">APP <b>${snap?.app_version ?? "—"}</b></span>`);
}

/**
 * Global findings chip. Order of truth:
 *   no source connected            -> CHECKS · NOT CONNECTED (muted): nothing could be cross-checked
 *   CRITICAL / WARNING findings    -> count, red / amber
 *   only INFO findings             -> count, info tone (never hidden behind "no findings")
 *   connected and zero findings    -> NO FINDINGS (muted, never green: only the checks that ran)
 */
function alertChip(snap) {
  const d = snap?.derived;
  const counts = d?.alert_counts ?? {};
  const crit = counts.CRITICAL ?? 0;
  const warn = counts.WARNING ?? 0;
  const info = counts.INFO ?? 0;
  const anyOk = Object.values(snap?.sources ?? {}).some((s) => s.status === "OK") || snap?.events_source?.status === "OK";
  if (crit) return { state: "CRITICAL", label: `${crit} CRITICAL`, tone: severityTone("CRITICAL"), dot: "CRITICAL", title: "Consistency findings" };
  if (warn) return { state: "WARNING", label: `${warn} WARNING`, tone: severityTone("WARNING"), dot: "WARNING", title: "Consistency findings" };
  if (!anyOk) return { state: "NOT_CONNECTED", label: "CHECKS · NOT CONNECTED", tone: null, dot: null, title: "No state connected — nothing to cross-check" };
  if (info) return { state: "INFO", label: `${info} INFO`, tone: severityTone("INFO"), dot: "RUNNING", title: "Informational consistency findings" };
  const skipped = (d?.check_coverage ?? []).filter((c) => !c.ran).length;
  return {
    state: "NO_FINDINGS",
    label: "NO FINDINGS",
    tone: null,
    dot: null,
    title: skipped ? `No findings from the checks that ran (${skipped} check families could not run)` : "No findings from the checks that ran",
  };
}

const PILL_ABBR = { research_engine: "RES", trading_engine: "TRD", agent_network: "AGT", data: "DAT", governance: "GOV", memory: "MEM" };

function pillHref(key) {
  return (
    {
      research_engine: "#/research",
      trading_engine: "#/live",
      agent_network: "#/agents",
      data: "#/data",
      governance: "#/governance",
      memory: "#/memory",
    }[key] ?? "#/"
  );
}

/* ------------------------------------------------------------------ views */

const moduleCache = new Map();
let cleanup = null;
let renderSeq = 0;
let lastRendered = { key: null, revision: null };

async function loadModule(name) {
  if (!moduleCache.has(name)) moduleCache.set(name, import(`./views/${name}.js`).then((m) => m.default));
  return moduleCache.get(name);
}

function setActiveNav(navPath) {
  document.querySelectorAll(".nav__link, .nav__fly-link").forEach((a) => {
    if ((a.dataset.navHref ?? a.dataset.flyHref) === navPath) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function runCleanup() {
  if (cleanup) {
    try {
      cleanup();
    } catch {
      /* ignore */
    }
    cleanup = null;
  }
}

function swapView(view) {
  els.view.replaceWith(view);
  els.view = view;
}

async function renderView({ force = false } = {}) {
  const { path, query } = parseHash();
  let m = null;
  try {
    m = match(path);
  } catch {
    m = null; // a malformed route renders the not-found view, never the previous page
  }
  const state = store.get();
  const key = location.hash || "#/";
  if (!force && lastRendered.key === key && lastRendered.revision === state.snapshot?.revision) return;
  const seq = ++renderSeq;
  const sameRoute = (lastRendered.key ?? "").split("?")[0] === key.split("?")[0];
  const scrollTop = els.main.scrollTop;

  if (!m) {
    setActiveNav(null);
    runCleanup();
    const view = document.createElement("div");
    view.className = "view";
    view.id = "view";
    view.dataset.route = path;
    view.dataset.module = "not-found";
    view.innerHTML = String(html`<div class="empty" data-empty-state="not-found"><div class="empty__title">Unknown route</div><div class="empty__reason">${path}</div></div>`);
    swapView(view);
    $("crumbs").innerHTML = String(html`<span>SENTRY</span><span class="sep">/</span><b>Unknown route</b>`);
    document.title = "Unknown route · SENTRY Command Centre";
    lastRendered = { key, revision: state.snapshot?.revision };
    return;
  }
  const navPath = typeof m.route.nav === "function" ? m.route.nav(m.params) : m.route.nav ?? m.route.path.replace(/:slot/, m.params.slot ?? "");
  setActiveNav(navPath);

  let mod;
  try {
    mod = await loadModule(m.route.module);
  } catch (err) {
    els.view.innerHTML = String(html`<div class="error-box">View module "${m.route.module}" failed to load: ${String(err)}</div>`);
    return;
  }
  if (seq !== renderSeq) return;

  const ctx = {
    snap: state.snapshot,
    params: m.params,
    query,
    props: m.route.props ?? {},
    route: m.route,
    now: Date.now(),
    extra: null,
  };
  try {
    if (mod.load) ctx.extra = await mod.load(ctx);
    if (seq !== renderSeq) return;
    runCleanup();
    const title = typeof mod.title === "function" ? mod.title(ctx) : mod.title;
    $("crumbs").innerHTML = String(html`<span>SENTRY</span><span class="sep">/</span><span>${m.route.group}</span><span class="sep">/</span><b>${title ?? ""}</b>`);
    document.title = `${title ?? "SENTRY"} · SENTRY Command Centre`;
    const view = document.createElement("div");
    view.className = "view";
    view.id = "view";
    view.dataset.route = m.route.path;
    view.dataset.module = m.route.module;
    if (!state.snapshot) {
      view.innerHTML = String(html`<div class="empty" data-empty-state="no-snapshot"><div class="empty__title">${state.error ? "Command Centre API unreachable" : "Loading state snapshot"}</div><div class="empty__reason">${state.error ?? ""}</div></div>`);
    } else {
      view.innerHTML = String(mod.render(ctx));
    }
    swapView(view);
    // Restore/reset scroll before mount() so a view may scroll a focused element into view.
    els.main.scrollTop = sameRoute ? scrollTop : 0;
    const cleanups = [];
    if (state.snapshot) {
      if (mod.mount) cleanups.push(mod.mount(view, ctx));
      cleanups.push(mountCharts(view));
      cleanups.push(mountGraph(view));
    }
    cleanup = () => cleanups.forEach((c) => typeof c === "function" && c());
    lastRendered = { key, revision: state.snapshot?.revision };
  } catch (err) {
    console.error(err);
    els.view.innerHTML = String(html`<div class="error-box" data-view-error="${m.route.module}">View "${m.route.module}" failed to render: ${String(err && err.message ? err.message : err)}</div>`);
    lastRendered = { key, revision: state.snapshot?.revision };
  }
}

/* ------------------------------------------------------------------ boot */

function boot() {
  renderSidebar();
  renderTopbar();
  updateClock();
  setInterval(updateClock, 1000);

  els.main.addEventListener("click", (ev) => {
    const row = ev.target.closest("tr[data-href]");
    if (row && !ev.target.closest("a,button")) location.hash = row.dataset.href.replace(/^#/, "");
  });

  store.subscribe((state) => {
    updateShell(state);
    renderView();
  });
  window.addEventListener("hashchange", () => renderView({ force: true }));
  updateShell(store.get());
  refreshSnapshot().then(() => renderView({ force: true }));
  startPolling(4000);

  // Re-render relative ages periodically without refetching.
  setInterval(() => {
    document.querySelectorAll("[data-age]").forEach((el) => {
      el.textContent = fmtAge(el.dataset.age);
    });
  }, 15000);
}

boot();
void raw;
