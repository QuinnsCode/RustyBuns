// The fixed "build me a world" session the token budget is held to (tokens.test.ts): look, read the starter, write a
// small world, look, one fix, look. Change it only to follow how an AI is told to work, and note it in the README.
import type { Ask } from "../../../scripts/mcp-session.ts";

export const WORLD = await Bun.file(new URL("./fixtures/rain-city.js", import.meta.url)).text();

export const SESSION: readonly Ask[] = [
  { name: "page_read", args: {} },
  { name: "page_read_file", args: { path: "index.html" } },
  { name: "page_read_file", args: { path: "world.js" } },
  { name: "page_write_file", args: { path: "world.js", text: WORLD } },
  { name: "page_read", args: {} },
  { name: "page_edit_file", args: { path: "world.js", find: "world({ orbit: 0.05 })", replace: "world({ orbit: 0.05, distance: 170 })" } },
  { name: "page_read", args: {} },
];
