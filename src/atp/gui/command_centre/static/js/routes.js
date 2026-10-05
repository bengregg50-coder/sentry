// Route table. Views are loaded lazily so a fault in one view cannot take
// down the shell. `nav` is the sidebar href highlighted for the route.

export const ROUTES = [
  { path: "/", module: "command-centre", group: "COMMAND" },
  { path: "/system", module: "system-map", group: "COMMAND" },

  { path: "/research", module: "research-overview", group: "RESEARCH" },
  { path: "/research/discovery", module: "research-discovery", group: "RESEARCH" },
  { path: "/research/hypotheses", module: "research-hypotheses", group: "RESEARCH" },
  { path: "/research/experiments", module: "research-experiments", group: "RESEARCH" },
  { path: "/research/backtests", module: "research-backtests", group: "RESEARCH" },
  { path: "/research/robustness", module: "research-robustness", group: "RESEARCH" },
  { path: "/research/oos", module: "research-oos", group: "RESEARCH" },
  { path: "/research/validation", module: "research-validation", group: "RESEARCH" },
  { path: "/research/history", module: "research-history", group: "RESEARCH" },

  { path: "/agents", module: "agents-overview", group: "TRADING FLOOR" },
  { path: "/agents/:slot", module: "agent-terminal", group: "TRADING FLOOR" },
  { path: "/agents/:slot/activity", module: "agent-activity", group: "TRADING FLOOR", nav: (p) => `/agents/${p.slot}` },

  { path: "/strategies", module: "strategies-library", group: "STRATEGIES", props: { filter: "all" } },
  { path: "/strategies/candidates", module: "strategies-library", group: "STRATEGIES", props: { filter: "candidates" } },
  { path: "/strategies/validated", module: "strategies-library", group: "STRATEGIES", props: { filter: "validated" } },
  { path: "/strategies/deployed", module: "strategies-library", group: "STRATEGIES", props: { filter: "deployed" } },
  { path: "/strategies/retired", module: "strategies-library", group: "STRATEGIES", props: { filter: "retired" } },
  { path: "/strategy/:id", module: "strategy-detail", group: "STRATEGIES", nav: () => "/strategies" },

  { path: "/memory", module: "memory-overview", group: "MEMORY" },
  { path: "/memory/graph", module: "memory-graph", group: "MEMORY" },
  { path: "/memory/findings", module: "memory-list", group: "MEMORY", props: { kind: "findings" } },
  { path: "/memory/lessons", module: "memory-list", group: "MEMORY", props: { kind: "lessons" } },
  { path: "/memory/evidence", module: "memory-evidence", group: "MEMORY" },
  { path: "/memory/agents", module: "memory-agents", group: "MEMORY" },
  { path: "/memory/item/:id", module: "memory-detail", group: "MEMORY", nav: () => "/memory" },

  { path: "/portfolio", module: "portfolio", group: "OPERATIONS" },
  { path: "/risk", module: "risk", group: "OPERATIONS" },
  { path: "/execution", module: "execution", group: "OPERATIONS" },
  { path: "/live", module: "live-engine", group: "OPERATIONS" },

  { path: "/data", module: "data", group: "DATA" },
  { path: "/data/sources", module: "data-sources", group: "DATA" },

  { path: "/governance", module: "governance", group: "OVERSIGHT" },
  { path: "/insights", module: "insights", group: "OVERSIGHT" },
];
