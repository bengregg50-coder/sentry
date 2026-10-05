// The command views' ring is the shared cycleRing (promoted from this module),
// rendered with the .cc-ring wrapper class that v-command.css styles.
import { cycleRing } from "../components/flow.js";

export function ccRing(nodes, opts = {}) {
  return cycleRing(nodes, { ...opts, cls: "cc-ring" });
}
