// STUB — to be replaced by the full view implementation.
import { html } from "../core/html.js";
import { pageHeader, emptyState } from "../components/ui.js";

export default {
  title: "State Sources",
  render() {
    return html`${pageHeader({ kicker: "SENTRY", title: "State Sources" })}${emptyState({ title: "View not yet implemented", code: "stub" })}`;
  },
};
