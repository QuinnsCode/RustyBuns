// Effect UI DevTools, in `bun run dev` only: package.json's `#devtools` is this file, and devtoolsOff.ts under
// `--conditions production` (bun run build), so none of it is in dist. The overlay is a button in a corner: the log of
// every message, Command and mount, the Model at each one, and time travel.
// An agent can read that log too, only when the person asks for it: `bun run devtools` runs the MCP server (this
// machine only, 127.0.0.1:4774; `--dispatch` lets it send messages, off without it) and `?devtools=mcp` on the page's
// link connects the page to it. WebMCP stays off: the page's own document.modelContext tools are for the agent
// building the world, and a debugger's don't belong among them.
import { DevTools } from "@effect/ui-devtools";

export const devtools = () => DevTools.layer({
  position: "BottomLeft",
  webMcp: false,
  ...(new URLSearchParams(location.search).get("devtools") === "mcp" ? { server: "http://127.0.0.1:4774" } : {}),
});
