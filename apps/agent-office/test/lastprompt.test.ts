// #4753: a worker's last prompt is kept whole through a restart, and `office-workers show` reads it back to hand its task on.
import { expect, setDefaultTimeout } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { lastPromptBin, lastPromptHooks, lastPromptPersist, lastPromptTasks } from "../scripts/lastprompt.ts";
import { beforePinned, pinnedTest, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(30_000);

let srv = "";
let bin = "";
beforePinned(async () => {
  const pkg = await unpackPinned();
  srv = path.join(pkg, "dist/server/server");
  bin = path.join(pkg, "bin/office-workers.js");
  const change = (file: string, f: (js: string) => string) => writeFileSync(file, f(readFileSync(file, "utf8")));
  // tasks.js's imports start the task namer's Claude: it gets the few names notePrompt uses instead
  change(path.join(srv, "workers/tasks.js"), (js) => lastPromptTasks(js).replace(/^import .*$/gm, ""));
  Object.assign(globalThis, { officePrompt: () => "", providerAdapter: () => undefined, TaskNamer: class {}, fallbackTask: (s: string) => s });
  change(path.join(srv, "workers/persist.js"), lastPromptPersist);
  change(path.join(srv, "hooks/office-workers.js"), lastPromptHooks);
  change(bin, lastPromptBin);
});

pinnedTest("a long prompt told to a worker outlives a restart, and office-workers show prints it whole", async () => {
  const { WorkerTasks } = await import(path.join(srv, "workers/tasks.js"));
  const { saveWorkers, restoreWorkers } = await import(path.join(srv, "workers/persist.js"));
  const { officeWorkers } = await import(path.join(srv, "hooks/office-workers.js"));
  const { DESK_BY_ID } = await import(path.join(srv, "../shared/layout.js"));
  const { main } = await import(bin);
  const desk = [...DESK_BY_ID.keys()][0];

  // Sprocket is hired, then told a task far past its 80-character activity line
  const info = { id: "w2", name: "Sprocket", kind: "agent", provider: "claude", deskId: desk, prompt: "fix the board", createdAt: 1 };
  const sprocket = { info, prompts: [] as string[] };
  const tasks = new WorkerTasks({ workers: new Map() }, undefined, {});
  tasks.notePrompt(sprocket, info.prompt);
  const told = `Work issue #4753.\r\n${"Keep the whole thing. ".repeat(900)}\nThen open the PR.`;
  tasks.notePrompt(sprocket, told);
  tasks.notePrompt(sprocket, "/compact");
  expect(JSON.stringify(info)).not.toContain("Keep the whole thing"); // not in what every update broadcasts

  // the office goes down and comes back
  const file = path.join(mkdtempSync(path.join(tmpdir(), "rb-lastprompt-")), "workers.json");
  saveWorkers(file, [sprocket], true);
  const restored = new Map();
  restoreWorkers(file, restored, "claude", () => false);
  expect(restored.get("w2").lastPrompt.text).toBe(told.replace("\r\n", "\n").slice(0, 20_000));

  // another worker asks for it, through the command and the endpoint
  const me = { id: "w1", name: "Pixel", kind: "agent", deskId: "", viewers: [] };
  const floor = {
    id: "f", def: { name: "RustyBuns" }, github: { pulls: { items: [] } }, queue: { state: () => ({ tasks: [] }) },
    workers: { workers: restored, authenticate: (id: string) => (id === "w1" ? me : undefined), list: () => [me, ...[...restored.values()].map((w) => w.info)] },
  };
  const fetch = async (href: string, init: { method: string; headers: Record<string, string> }) => {
    let status = 0, body = "";
    const res = { writeHead: (s: number) => void (status = s), end: (j: string) => void (body = j) };
    await officeWorkers({ workerFloor: () => floor }, Object.assign(Readable.from([]), init), res, new URL(href));
    return new Response(body, { status });
  };
  const run = async (...argv: string[]) => {
    const out: string[] = [], err: string[] = [];
    const env = { AGENT_OFFICE_HOOK_URL: "http://127.0.0.1:1", AGENT_OFFICE_WORKER_ID: "w1", AGENT_OFFICE_HOOK_TOKEN: "t" };
    const code = await main(argv, { env, fetch, out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };

  const shown = await run("show", "sprocket");
  expect(shown.code).toBe(0);
  expect(shown.out).toBe(told.replace("\r\n", "\n").slice(0, 20_000));
  expect(shown.err).toStartWith("Sprocket's last prompt, ");
  expect(JSON.parse((await run("show", "w2", "--json")).out).worker).toEqual({ id: "w2", name: "Sprocket" });

  // a desk nobody sits at says so
  const nobody = await run("show", "Bolt");
  expect(nobody.code).toBe(1);
  expect(nobody.err).toContain("office-workers:");
});

pinnedTest("a workers.json from before keeps the hire prompt as the last one", async () => {
  const { restoreWorkers } = await import(path.join(srv, "workers/persist.js"));
  const { DESK_BY_ID } = await import(path.join(srv, "../shared/layout.js"));
  const file = path.join(mkdtempSync(path.join(tmpdir(), "rb-lastprompt-")), "workers.json");
  writeFileSync(file, JSON.stringify([{ id: "w3", name: "Bolt", kind: "agent", deskId: [...DESK_BY_ID.keys()][0], prompt: "build the dock", createdAt: 5 }]));
  const restored = new Map();
  restoreWorkers(file, restored, "claude", () => false);
  expect(restored.get("w3").lastPrompt).toEqual({ text: "build the dock", at: 5 });
});
