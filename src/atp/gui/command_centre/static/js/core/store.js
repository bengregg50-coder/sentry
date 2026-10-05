// Minimal observable store for the latest snapshot.

let state = {
  snapshot: null,
  error: null,
  lastFetchAt: null,
  latencyMs: null,
  revision: null,
};

const subs = new Set();

export const store = {
  get() {
    return state;
  },
  set(patch) {
    state = { ...state, ...patch };
    for (const fn of subs) fn(state);
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};
