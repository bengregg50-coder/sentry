// STUB — to be replaced by the full view implementation.
import { html } from "../core/html.js";
import { pageHeader, emptyState } from "../components/ui.js";

export default {
  title: "Research Overview",
  render() {
    return html`${pageHeader({ kicker: "SENTRY", title: "Research Overview" })}${emptyState({ title: "View not yet implemented", code: "stub" })}`;
  },
};
