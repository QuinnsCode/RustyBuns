import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hookTokensManager, hookTokensPersist, hookTokensUtil } from "../scripts/hooktokens.ts";
import { unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

let workers = "";
let manager = "";
beforeAll(async () => {
  workers = path.join(await unpackPinned(), "dist/server/server/workers");
  manager = readFileSync(path.join(workers, "manager.js"), "utf8");
  for (const [rel, change] of [["util.js", hookTokensUtil], ["persist.js", hookTokensPersist], ["manager.js", hookTokensManager]] as const)
    writeFileSync(path.join(workers, rel), change(readFileSync(path.join(workers, rel), "utf8")));
});

const TOKEN = "0123456789abcdef0123456789abcdef";
const info = (id: string) => ({ id, kind: "agent", provider: "claude", deskId: "", name: "Pixel", worktree: undefined });

test("workers.json keeps a hash of each hook token, and a worker picked back up after a restart still signs in with its token", async () => {
  const { saveWorkers, restoreWorkers } = await import(path.join(workers, "persist.js"));
  const { __rbHookOk } = await import(path.join(workers, "util.js"));
  const { DESK_BY_ID } = await import(path.join(workers, "../../shared/layout.js"));
  const desk = [...DESK_BY_ID.keys()][0];
  const file = path.join(mkdtempSync(path.join(tmpdir(), "rb-hooks-")), "workers.json");

  saveWorkers(file, [{ info: { ...info("w1"), deskId: desk }, hookToken: TOKEN, pty: { id: "p1" } }], false);
  const saved = readFileSync(file, "utf8");
  expect(saved).not.toContain(TOKEN);
  expect(JSON.parse(saved)[0].hookToken).toBeUndefined();
  expect(JSON.parse(saved)[0].hookHash).toMatch(/^[0-9a-f]{64}$/);

  const restored = new Map();
  restoreWorkers(file, restored, "claude", () => false);
  const w = restored.get("w1");
  expect(w.hookToken).not.toBe(TOKEN);
  expect(__rbHookOk(w, TOKEN)).toBe(true);
  expect(__rbHookOk(w, "f".repeat(32))).toBe(false);
  expect(__rbHookOk(w, w.hookToken)).toBe(false);
  expect(__rbHookOk(w, "")).toBe(false);

  // saved again before it's launched, it keeps the same hash, not one of the unused token it was given
  saveWorkers(file, restored.values(), false);
  expect(JSON.parse(readFileSync(file, "utf8"))[0].hookHash).toBe(JSON.parse(saved)[0].hookHash);
});

test("an older workers.json's plaintext token is hashed on the way in and never written back", async () => {
  const { saveWorkers, restoreWorkers } = await import(path.join(workers, "persist.js"));
  const { __rbHookOk } = await import(path.join(workers, "util.js"));
  const { DESK_BY_ID } = await import(path.join(workers, "../../shared/layout.js"));
  const file = path.join(mkdtempSync(path.join(tmpdir(), "rb-hooks-")), "workers.json");
  writeFileSync(file, JSON.stringify([{ ...info("w2"), deskId: [...DESK_BY_ID.keys()][0], hookToken: TOKEN }]));

  const restored = new Map();
  restoreWorkers(file, restored, "claude", () => false);
  expect(__rbHookOk(restored.get("w2"), TOKEN)).toBe(true);
  saveWorkers(file, restored.values(), false);
  expect(readFileSync(file, "utf8")).not.toContain(TOKEN);
});

test("a fresh worker signs in with its in-memory token, and a launch drops the old hash", async () => {
  const { newWorker } = await import(path.join(workers, "worker.js"));
  const { __rbHookOk } = await import(path.join(workers, "util.js"));
  const w = newWorker(info("w3"), {});
  expect(__rbHookOk(w, w.hookToken)).toBe(true);
  expect(__rbHookOk(w, TOKEN)).toBe(false);

  const js = hookTokensManager(manager);
  expect(js).toContain("AGENT_OFFICE_HOOK_TOKEN: w.hookToken,\n        });\n        w.hookHash = undefined;\n");
  expect(js).not.toContain("safeEq(token, w.hookToken)");
  expect(js.split("__rbHookOk(w, token)").length).toBe(3); // authenticate and handleProviderHook
  expect(() => hookTokensManager(js)).toThrow(/patch target moved/);
});
