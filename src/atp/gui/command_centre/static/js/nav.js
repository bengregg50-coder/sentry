// Sidebar navigation model.

export const NAV = [
  {
    key: "command",
    label: "Command",
    items: [
      { href: "/", label: "Command Centre", icon: "command" },
      { href: "/system", label: "System Map", icon: "map" },
    ],
  },
  {
    key: "research",
    label: "Research",
    items: [
      { href: "/research", label: "Research Overview", icon: "research" },
      { href: "/research/discovery", label: "Discovery", icon: "discovery", sub: true },
      { href: "/research/hypotheses", label: "Hypotheses", icon: "hypothesis", sub: true },
      { href: "/research/experiments", label: "Experiments", icon: "experiment", sub: true },
      { href: "/research/backtests", label: "Backtests", icon: "backtest", sub: true },
      { href: "/research/robustness", label: "Robustness", icon: "robustness", sub: true },
      { href: "/research/oos", label: "Out-of-Sample", icon: "oos", sub: true },
      { href: "/research/validation", label: "Validation", icon: "validation", sub: true },
      { href: "/research/history", label: "Research History", icon: "history" },
    ],
  },
  {
    key: "floor",
    label: "Trading Floor",
    items: [
      { href: "/agents", label: "Agent Overview", icon: "agents" },
      { href: "/agents/1", label: "Agent 01", icon: "agent", sub: true, slot: 1 },
      { href: "/agents/2", label: "Agent 02", icon: "agent", sub: true, slot: 2 },
      { href: "/agents/3", label: "Agent 03", icon: "agent", sub: true, slot: 3 },
      { href: "/agents/4", label: "Agent 04", icon: "agent", sub: true, slot: 4 },
      { href: "/agents/5", label: "Agent 05", icon: "agent", sub: true, slot: 5 },
    ],
  },
  {
    key: "strategies",
    label: "Strategies",
    items: [
      { href: "/strategies", label: "Strategy Library", icon: "strategies" },
      { href: "/strategies/candidates", label: "Candidates", icon: "candidates", sub: true },
      { href: "/strategies/validated", label: "Validated", icon: "validated", sub: true },
      { href: "/strategies/deployed", label: "Deployed", icon: "deployed", sub: true },
      { href: "/strategies/retired", label: "Retired", icon: "retired", sub: true },
    ],
  },
  {
    key: "memory",
    label: "Memory",
    items: [
      { href: "/memory", label: "Memory Overview", icon: "memory" },
      { href: "/memory/graph", label: "Knowledge Graph", icon: "graph", sub: true },
      { href: "/memory/findings", label: "Findings", icon: "findings", sub: true },
      { href: "/memory/lessons", label: "Lessons", icon: "lessons", sub: true },
      { href: "/memory/evidence", label: "Evidence", icon: "evidence", sub: true },
      { href: "/memory/agents", label: "Agent Memories", icon: "agentmem", sub: true },
    ],
  },
  {
    key: "operations",
    label: "Operations",
    items: [
      { href: "/portfolio", label: "Portfolio", icon: "portfolio" },
      { href: "/risk", label: "Risk", icon: "risk" },
      { href: "/execution", label: "Execution", icon: "execution" },
      { href: "/live", label: "Live Engine", icon: "live" },
    ],
  },
  {
    key: "data",
    label: "Data",
    items: [
      { href: "/data", label: "Datasets", icon: "data" },
      { href: "/data/sources", label: "State Sources", icon: "sources", sub: true },
    ],
  },
  {
    key: "oversight",
    label: "Oversight",
    items: [
      { href: "/governance", label: "Governance", icon: "governance" },
      { href: "/insights", label: "Insights", icon: "insights" },
    ],
  },
];
