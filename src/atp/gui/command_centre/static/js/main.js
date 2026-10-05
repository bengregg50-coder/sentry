// SENTRY Command Centre shell: sidebar, topbar, banners, status bar, routing.

import { html, raw, cx } from "./core/html.js";
import { store } from "./core/store.js";
import { refreshSnapshot, startPolling } from "./core/api.js";
import { parseHash, match } from "./core/router.js";
import { fmtTime, humanize, fmtAge } from "./core/format.js";
import { toneOf } from "./core/tones.js";
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
      const collapsed = els.app.dataset.nav === "collapsed";
      els.app.dataset.nav = collapsed ? "expanded" : "collapsed";
      prefs.set("navCollapsed", !collapsed);
    }
  });
  if (prefs.get("navCollapsed", false)) els.app.dataset.nav = "collapsed";
}

function renderTopbar() {
  els.topbar.innerHTML = String(html`
    <div class="crumbs" id="crumbs"><span>SENTRY</span></div>
    <div class="topbar__status" id="sys-pills"></div>
    <div class="topbar__right">
      <span id="alert-chip"></span>
      <span class="ro-chip" title="The Command Centre has no write, order or deployment capability">${icon("lock", "icon")}READ-ONLY</span>
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
      (s) => html`<a class="sys-pill" href="${pillHref(s.key)}" title="${s.label}: ${humanize(s.state)}" data-subsystem="${s.key}" data-state="${s.state}">${dot(s.state, { pulse: toneOf(s.state) === "info" })}<span class="pill-label">${s.label}</span></a>`,
    )}`,
  );

  // alerts
  const counts = d?.alert_counts ?? {};
  const crit = counts.CRITICAL ?? 0;
  const warn = counts.WARNING ?? 0;
  $("alert-chip").innerHTML = snap
    ? String(
        html`<a class="${cx("alert-chip", crit ? "tone-bad" : warn ? "tone-warn" : "")}" href="#/governance" title="Consistency findings">${icon("shield", "icon")}${crit ? `${crit} CRITICAL` : warn ? `${warn} WARNING` : "NO FINDINGS"}</a>`,
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
    if (gov) gov.innerHTML = crit ? String(dot("CRITICAL")) : warn ? String(dot("WARNING")) : "";
  }

  // status bar
  const srcs = snap ? Object.values(snap.sources) : [];
  const ok = srcs.filter((s) => s.status === "OK").length;
  els.statusbar.innerHTML = String(html`
    <span class="seg">${dot(state.error ? "ERROR" : snap ? "CONNECTED" : "PENDING", { pulse: !state.error && !!snap })}<b>${state.error ? "API ERROR" : snap ? "API LINKED" : "CONNECTING"}</b></span>
    <span class="seg">CONTRACT <b>v${snap?.contract_version ?? "?"}</b></span>
    <span class="seg">PROVIDER <b>${snap?.provider.kind ?? "—"}</b></span>
    <span class="seg">STATE <b>${snap?.provider.location ?? "not configured"}</b></span>
    <span class="seg">SOURCES <b>${snap ? `${ok}/${srcs.length} OK` : "—"}</b></span>
    <span class="seg">EVENTS <b>${snap ? humanize(snap.events_source.status) : "—"}</b></span>
    <span class="seg push">REV <b>${snap?.revision ?? "—"}</b></span>
    <span class="seg">POLL <b>${state.lastFetchAt ? fmtTime(state.lastFetchAt) : "—"}</b></span>
    <span class="seg">LAT <b>${state.latencyMs ?? "—"}ms</b></span>
    <span class="seg">APP <b>${snap?.app_version ?? "—"}</b></span>`);
}

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
  document.querySelectorAll(".nav__link").forEach((a) => {
    if (a.dataset.navHref === navPath) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

async function renderView({ force = false } = {}) {
  const { path, query } = parseHash();
  const m = match(path);
  const state = store.get();
  const key = location.hash || "#/";
  if (!force && lastRendered.key === key && lastRendered.revision === state.snapshot?.revision) return;
  const seq = ++renderSeq;
  const sameRoute = lastRendered.key === key;
  const scrollTop = els.main.scrollTop;

  if (!m) {
    setActiveNav(null);
    els.view.innerHTML = String(html`<div class="empty" data-empty-state="not-found"><div class="empty__title">Unknown route</div><div class="empty__reason">${path}</div></div>`);
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
    if (cleanup) {
      try {
        cleanup();
      } catch {
        /* ignore */
      }
      cleanup = null;
    }
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
    els.view.replaceWith(view);
    els.view = view;
    const cleanups = [];
    if (state.snapshot) {
      if (mod.mount) cleanups.push(mod.mount(view, ctx));
      cleanups.push(mountCharts(view));
      cleanups.push(mountGraph(view));
    }
    cleanup = () => cleanups.forEach((c) => typeof c === "function" && c());
    if (sameRoute) els.main.scrollTop = scrollTop;
    else els.main.scrollTop = 0;
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
