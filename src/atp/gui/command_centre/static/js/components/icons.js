// Inline line-icon set (24x24, stroke). Trusted constants only.
import { raw } from "../core/html.js";

const P = {
  command: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M17.5 14v7"/>',
  map: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8M18 8l-5 8"/>',
  research: '<path d="M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3"/><path d="M7.5 15h9"/>',
  overview: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  discovery: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M11 8v6M8 11h6"/>',
  hypothesis: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  experiment: '<path d="M4 4h16v6H4zM4 14h7v6H4zM14 14h6v6h-6z"/>',
  backtest: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  robustness: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="M9 12h6M12 9v6"/>',
  oos: '<path d="M3 12h18"/><path d="M12 3v18" stroke-dasharray="2 2"/><path d="m6 8 3 4-3 4M15 8h4v8h-4"/>',
  validation: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  agents: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  agent: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>',
  strategies: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".5"/>',
  candidates: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>',
  validated: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  deployed: '<path d="M5 19 19 5M19 5h-7M19 5v7"/><path d="M5 12v7h7" opacity=".5"/>',
  retired: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  memory: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="12" cy="19" r="2"/><path d="M12 7v10M7 12h10M6.5 10.5l4-4M13.5 6.5l4 4M17.5 13.5l-4 4M10.5 17.5l-4-4"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><circle cx="19" cy="18" r="1.5"/><path d="m8.3 7 7.4.6M7 8.3l1.5 7.2M11.3 17.3l6.2.6M17.6 10.4l1.1 6.1"/>',
  findings: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  lessons: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h13v4H6a2 2 0 0 1-2-2zM9 7h6"/>',
  evidence: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/>',
  agentmem: '<rect x="3" y="11" width="8" height="9" rx="1"/><path d="m5 15 1.5 1.5L5 18"/><circle cx="17" cy="6" r="2"/><circle cx="17" cy="16" r="2"/><path d="M11 15h4M17 8v6"/>',
  portfolio: '<path d="M21 12A9 9 0 1 1 12 3v9h9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5z"/>',
  risk: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  execution: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 15.5a5 5 0 0 0 0-7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 18.4a9 9 0 0 0 0-12.8"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  sources: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/>',
  governance: '<path d="M12 3v18M5 21h14"/><path d="M3 7h18"/><path d="m6 7-3 7a3 3 0 0 0 6 0L6 7zM18 7l-3 7a3 3 0 0 0 6 0l-3-7z"/>',
  insights: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  empty: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6 18.4 18.4"/>',
  sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  collapse: '<path d="M15 6l-6 6 6 6"/>',
  expand: '<path d="M9 6l6 6-6 6"/>',
  play: '<path d="M7 4v16l13-8L7 4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  assign: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  version: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 8v8M18 11c0 4-6 3-12 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5z"/><path d="M14 3v5h5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  flow: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10"/><path d="m14 9 3 3-3 3"/>',
};

export function icon(name, cls = "icon") {
  const body = P[name] ?? P.empty;
  return raw(
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`,
  );
}

export const BRAND_MARK = raw(
  `<svg class="brand__mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M16 2 28 9v14l-12 7L4 23V9l12-7z" stroke="currentColor" stroke-width="1.4"/>
    <path d="M16 8 23 12v8l-7 4-7-4v-8l7-4z" stroke="currentColor" stroke-width="1" opacity=".55"/>
    <circle cx="16" cy="16" r="2.4" fill="currentColor"/>
    <path d="M16 2v6M28 9l-5 3M28 23l-5-3M16 30v-6M4 23l5-3M4 9l5 3" stroke="currentColor" stroke-width=".8" opacity=".5"/>
  </svg>`,
);
