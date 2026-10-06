// Single source of truth for state -> colour semantics.
// Green (ok) ONLY for genuinely passed/validated/approved states.
// Amber (warn) for uncertainty, pending, blocked, reconstructed, DIFFERS.
// Red (bad) for failure, rejection, risk, violations, broken sources.
// Cyan (info) for active/operational states; blue (accent) for sealed/frozen records.
// Anything unknown is muted — never green by default.
//
// "COMPLETE" is NOT a pass: a research programme can complete with a null result.
// It is neutral (info) here; deployment-handoff steps use stepTone(), where a
// COMPLETE step is defined as "every gate up to and including this one passed".

const OK = ["PASS", "VALIDATED", "APPROVED", "MATCH", "OK", "ELIGIBLE"];

const WARN = [
  "PENDING", "BLOCKED", "BLOCKED_BY_DATA", "WARN", "WARNING", "DIFFERS", "RECONSTRUCTED", "DEGRADED",
  "INCONCLUSIVE", "PROVISIONAL", "REVIEW", "UNVERIFIED", "PAUSED", "PARTIAL", "SPEC_DRAFT", "STALE",
  "MEDIUM", "LOW", "LOST", "EVIDENCE_LOST", "SOURCE_MISSING", "STARTING", "PROPOSED_CHANGE",
];

const BAD = [
  "FAIL", "FAILED", "REJECTED", "ERROR", "HALTED", "BREACH", "TRIPPED", "CRITICAL", "VIOLATION",
  "INVALID", "UNREADABLE", "CONTRADICTED", "DISCONNECTED", "REVOKED", "SOURCE_ERROR", "VOID",
  "DANGEROUS_FEATURE", "CONTRADICTS",
];

const INFO = [
  "RUNNING", "ACTIVE", "LIVE", "SIMULATING", "PAPER", "TESTING", "ONLINE", "CONNECTED", "REPORTING",
  "IN_PROGRESS", "IN_RESEARCH", "PREREGISTERED", "WORKING", "CANDIDATE", "IN_VALIDATION", "DEPLOYED_SIM",
  "DEPLOYED_LIVE", "SCALED", "STANDBY", "ARMED", "SIM", "LONG", "SHORT", "FILLED", "HIGH", "RETAIN",
  "SUPPORTS", "ORIGINAL", "RELEASED_AS_VERSION", "SPEC_FROZEN", "FROZEN", "VERIFIED", "COMPLETE",
  "IN_SIMULATION",
];

const ACCENT = ["SEALED", "LOCKED"];

const MAP = new Map();
for (const s of OK) MAP.set(s, "ok");
for (const s of WARN) MAP.set(s, "warn");
for (const s of BAD) MAP.set(s, "bad");
for (const s of INFO) MAP.set(s, "info");
for (const s of ACCENT) MAP.set(s, "accent");

export function toneOf(state) {
  if (state === null || state === undefined) return "muted";
  return MAP.get(String(state).toUpperCase()) ?? "muted";
}

export function toneClass(state) {
  return `tone-${toneOf(state)}`;
}

/** Severity strings used by consistency findings and alerts. */
export function severityTone(sev) {
  return { CRITICAL: "bad", WARNING: "warn", INFO: "info" }[sev] ?? "muted";
}

/**
 * Step states of derived.handoffs (and other step flows). A handoff step is COMPLETE only
 * when it and every earlier gate passed, so here — and only here — COMPLETE is green.
 * RUNNING (an ongoing simulation) is cyan; NOT_REACHED / WITHDRAWN / NOT_STARTED are muted.
 */
const STEP = {
  COMPLETE: "ok",
  BLOCKED: "warn",
  NOT_REACHED: "muted",
  WITHDRAWN: "muted",
  NOT_STARTED: "muted",
  UNKNOWN: "muted",
  VIOLATION: "bad",
};

export function stepTone(state) {
  if (state === null || state === undefined) return "muted";
  return STEP[String(state).toUpperCase()] ?? toneOf(state);
}

export function stepToneClass(state) {
  return `tone-${stepTone(state)}`;
}

export const TONE_TABLE = { OK, WARN, BAD, INFO, ACCENT, STEP };
