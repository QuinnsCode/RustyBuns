// #5762: server/workers/terminal.js takes its snapshotScreen from live/screen.ts (built to server/rb-screen.js), which
// reads only the rows whose cells changed. Upstream's own copy stays in the file, renamed, for nothing to call.
import { once } from "./once.ts";

/** server/workers/terminal.js with flushScreens and fullScreens calling our snapshotScreen. */
export function screenTerminal(js: string) {
  js = once(js, "workers/terminal.js", "export function snapshotScreen(term, last) {", "function __rbUpstreamSnapshot(term, last) {");
  return "import { snapshotScreen } from '../rb-screen.js';\nexport { snapshotScreen };\n" + js;
}
