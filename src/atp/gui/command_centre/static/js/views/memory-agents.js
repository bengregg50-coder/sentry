// STUB — to be replaced by the full view implementation.
import { html } from "../core/html.js";
import { pageHeader, emptyState } from "../components/ui.js";

export default {
  title: "Agent Memories",
  render() {
    return html`${pageHeader({ kicker: "SENTRY", title: "Agent Memories" })}${emptyState({ title: "View not yet implemented", code: "stub" })}`;
  },
};
