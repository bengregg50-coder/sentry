// API client. Read-only: only GET requests exist.

import { store } from "./store.js";

const BASE = "/api/cc";

async function getJSON(path) {
  const res = await fetch(BASE + path, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export async function refreshSnapshot() {
  const t0 = performance.now();
  try {
    const snapshot = await getJSON("/snapshot");
    store.set({
      snapshot,
      error: null,
      lastFetchAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - t0),
      revision: snapshot.revision,
    });
  } catch (err) {
    store.set({ error: String(err.message || err), lastFetchAt: new Date().toISOString() });
  }
}

let timer = null;

/** Poll the cheap revision endpoint; fetch a full snapshot only when sources change. */
export function startPolling(intervalMs = 4000) {
  stopPolling();
  const tick = async () => {
    try {
      const { revision } = await getJSON("/revision");
      if (revision !== store.get().revision || store.get().error) await refreshSnapshot();
      else store.set({ lastFetchAt: new Date().toISOString(), error: null });
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
