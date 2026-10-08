// Just the headless xterm parse that the pty host does on every byte, no pty, no sockets.
// Runs under both, from ./office's packages:  node bench/parse.mjs <file>  ·  bun bench/parse.mjs <file>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../office/package.json", import.meta.url));
const headless = require("@xterm/headless");
const serialize = require("@xterm/addon-serialize");
const data = readFileSync(process.argv[2], "utf8");
const chunks = []; for (let i = 0; i < data.length; i += 4096) chunks.push(data.slice(i, i + 4096));
const term = new headless.Terminal({ cols: 120, rows: 40, scrollback: 3000, allowProposedApi: true });
const ser = new serialize.SerializeAddon(); term.loadAddon(ser);
const t0 = performance.now();
await new Promise((r) => { chunks.forEach((c, i) => term.write(c, i === chunks.length - 1 ? r : undefined)); });
const parse = performance.now() - t0;
const t1 = performance.now(); const snap = ser.serialize({ scrollback: 3000 }); const s = performance.now() - t1;
console.log(JSON.stringify({ runtime: typeof Bun !== "undefined" ? "bun" : "node", parseMs: Math.round(parse), MBps: +(data.length / 1e6 / (parse / 1000)).toFixed(1), snapshotMs: Math.round(s), snapKB: Math.round(snap.length / 1024) }));
