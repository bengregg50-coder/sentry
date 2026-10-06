// API client. Read-only: only GET requests exist.

import { store } from "./store.js";

const BASE = "/api/cc";

/** Minimum spacing of snapshot refetches caused ONLY by agent-event appends (documents unchanged). */
export const EVENTS_ONLY_REFRESH_MS = 15000;

async function getJSON(path) {
  const res = await fetch(BASE + path, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/**
 * The server sends the agent payload once (documents.agents); views read it per slot as
 * derived.agent_slots[i].agent, so it is joined here. Nothing is invented: a slot the runtime
 * did not report stays null.
 */
function joinAgents(snapshot) {
  const agents = snapshot?.documents?.agents?.agents ?? null;
  for (const slot of snapshot?.derived?.agent_slots ?? []) {
    if (!("agent" in slot)) slot.agent = agents?.find((a) => a.slot === slot.slot) ?? null;
  }
  return snapshot;
}

export async function refreshSnapshot() {
  const t0 = performance.now();
  try {
    const snapshot = joinAgents(await getJSON("/snapshot"));
    store.set({
      snapshot,
      error: null,
      lastFetchAt: new Date().toISOString(),
      lastSnapshotAt: Date.now(),
      latencyMs: Math.round(performance.now() - t0),
      revision: snapshot.revision,
      revisions: snapshot.revisions ?? null,
      pendingEvents: false,
    });
  } catch (err) {
    store.set({ error: String(err.message || err), lastFetchAt: new Date().toISOString() });
  }
}

let timer = null;

/**
 * Poll the cheap revision endpoint; fetch a full snapshot only when sources change.
 * Document changes refetch immediately. Changes to the append-only agent event stream alone
 * refetch at most every EVENTS_ONLY_REFRESH_MS, so a chatty agent cannot keep the UI re-rendering.
 */
export function startPolling(intervalMs = 4000) {
  stopPolling();
  const tick = async () => {
    try {
      const rev = await getJSON("/revision");
      const st = store.get();
      if (rev.revision === st.revision && !st.error) {
        store.set({ lastFetchAt: new Date().toISOString(), error: null });
        return;
      }
      const docsChanged = !st.revisions || rev.documents !== st.revisions.documents;
      const due = Date.now() - (st.lastSnapshotAt ?? 0) >= EVENTS_ONLY_REFRESH_MS;
      if (st.error || docsChanged || due) await refreshSnapshot();
      else store.set({ lastFetchAt: new Date().toISOString(), pendingEvents: true });
    } catch (err) {
      store.set({ error: String(err.message || err), lastFetchAt: new Date().toISOString() });
    }
  };
  timer = setInterval(tick, intervalMs);
}

export function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function fetchEvents({ slot, limit = 200, kind } = {}) {
  const q = new URLSearchParams();
  if (slot) q.set("slot", slot);
  if (limit) q.set("limit", limit);
  if (kind) q.set("kind", kind);
  return getJSON(`/events?${q}`);
}
