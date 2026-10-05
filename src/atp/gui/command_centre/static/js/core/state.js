// Accessors over the snapshot. Views use these instead of poking at JSON so
// that "not connected" is handled identically everywhere.

/** The validated payload of a document, or null if its source is not OK. */
export function doc(ctx, key) {
  const snap = ctx.snap;
  if (!snap) return null;
  return snap.documents?.[key] ?? null;
}

export function source(ctx, key) {
  if (key === "agent_events") return ctx.snap?.events_source ?? null;
  return ctx.snap?.sources?.[key] ?? null;
}

export function derived(ctx, key) {
  return ctx.snap?.derived?.[key] ?? null;
}

/** Display state for a source: OK | MISSING | INVALID | UNREADABLE | NOT_CONFIGURED | NO_SNAPSHOT */
export function sourceState(src) {
  if (!src) return "NO_SNAPSHOT";
  return src.status;
}

/** Plain-language reason a document is unavailable. */
export function sourceReason(src) {
  if (!src) return "Waiting for the Command Centre API.";
  switch (src.status) {
    case "OK":
      return null;
    case "NOT_CONFIGURED":
      return `No SENTRY state directory is configured, so ${src.file} is not connected.`;
    case "MISSING":
      return `${src.file} has not been produced in the state directory.`;
    case "INVALID":
      return `${src.file} does not conform to the state contract: ${src.error ?? "validation failed"}.`;
    case "UNREADABLE":
      return `${src.file} could not be read: ${src.error ?? "unreadable"}.`;
    default:
      return `${src.file}: ${src.status}`;
  }
}

/** Label shown in place of a value whose source is unavailable. */
export function sourceShort(src) {
  if (!src) return "NO SNAPSHOT";
  return {
    OK: "CONNECTED",
    NOT_CONFIGURED: "NOT CONNECTED",
    MISSING: "NOT PRODUCED",
    INVALID: "CONTRACT ERROR",
    UNREADABLE: "UNREADABLE",
  }[src.status] ?? src.status;
}

/** Origin of a document envelope (ORIGINAL / RECONSTRUCTED / SYNTHETIC_FIXTURE) or null. */
export function docOrigin(ctx, key) {
  return ctx.snap?.sources?.[key]?.meta?.origin ?? null;
}

export function findStrategy(ctx, id) {
  return doc(ctx, "strategies")?.strategies?.find((s) => s.strategy_id === id) ?? null;
}

export function currentVersion(strategy) {
  return strategy?.versions?.find((v) => v.version === strategy.current_version) ?? null;
}

export function findMemory(ctx, id) {
  return doc(ctx, "memory")?.memories?.find((m) => m.memory_id === id) ?? null;
}

export function handoffFor(ctx, id) {
  return derived(ctx, "handoffs")?.find((h) => h.strategy_id === id) ?? null;
}

export function agentSlot(ctx, slot) {
  return derived(ctx, "agent_slots")?.find((s) => s.slot === Number(slot)) ?? null;
}

export function findingsFor(ctx, section) {
  const all = derived(ctx, "consistency") ?? [];
  return section ? all.filter((f) => f.section === section) : all;
}

/** Accurate empty-state title for a source, e.g. sourceTitle(src, "Strategy registry"). */
export function sourceTitle(src, what) {
  switch (src?.status) {
    case "MISSING":
      return `${what} not produced`;
    case "INVALID":
      return `${what} rejected by the contract`;
    case "UNREADABLE":
      return `${what} unreadable`;
    case "OK":
      return what;
    default:
      return `${what} not connected`;
  }
}
