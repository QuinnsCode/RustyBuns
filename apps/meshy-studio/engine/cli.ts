// The engine without the app:
//   bun engine/cli.ts <workspace>          list what's there and what a send would cost
//   bun engine/cli.ts <workspace> --send   send every new image and wait until all are done
// The key comes from MESHY_API_KEY.

import { Workspace } from "./workspace.ts";

const [dir, flag] = process.argv.slice(2);
if (!dir) { console.error("usage: bun engine/cli.ts <workspace> [--send]"); process.exit(1); }

const ws = new Workspace(dir, () => process.env.MESHY_API_KEY ?? null, Number(process.env.MESHY_MAX_QUEUED) || 10);
await ws.open();

const show = () => {
  for (const j of ws.summary().jobs) {
    const state = j.state === "running" ? `${j.meshyStatus?.toLowerCase()} ${j.progress}%` : j.state;
    console.log(`${state.padEnd(16)} ${j.key.padEnd(40)} ${j.presetLabel.padEnd(12)} ${j.sizeText.padEnd(22)} ${j.origin.padEnd(7)} ~${j.estimate} cr${j.error ? `  ${j.error}` : ""}`);
  }
};

const fresh = [...ws.jobs.values()].filter((j) => j.state === "new");
show();
console.log(`\n${fresh.length} new, about ${fresh.reduce((n, j) => n + j.estimate, 0)} credits to send.`);

if (flag === "--send") {
  if (!process.env.MESHY_API_KEY) { console.error("set MESHY_API_KEY first"); process.exit(1); }
  await ws.send();
  const active = () => [...ws.jobs.values()].some((j) => j.state === "queued" || j.state === "running" || j.state === "downloaded");
  while (active()) {
    await ws.tick();
    if (ws.pause && !ws.pause.until) { console.error(ws.pause.reason); break; }
    await Bun.sleep(3000);
  }
  console.log("");
  show();
}
