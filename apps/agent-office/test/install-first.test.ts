// #4470: a tell sent while a hired worker's worktree was still installing opened a second session in that worktree.
import { expect, setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installFirst } from "../scripts/install-first.ts";
import { beforePinned, pinnedTest, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(30_000);

let WorkerManager: { prototype: object };
let installed: () => void = () => {};
beforePinned(async () => {
  const manager = path.join(await unpackPinned(), "dist/server/server/workers/manager.js");
  // the release's node_modules aren't installed here: drop its imports, and hand the methods the few names they use
  writeFileSync(manager, installFirst(readFileSync(manager, "utf8")).replace(/^import .*$/gm, ""));
  Object.assign(globalThis, {
    clockWork: () => {},
    truncate: (s: string, n: number) => s.slice(0, n),
    DESK_BY_ID: new Map(),
    // the worktree's bun install, finished when the test says so
    __rbInstall: () => new Promise<undefined>((done) => (installed = () => done(undefined))),
  });
  ({ WorkerManager } = await import(manager));
});

/** Byte, just hired at Desk 4 with a task, its worktree's install under way. */
function hiring() {
  const launched: (string | undefined)[] = [], typed: string[] = [];
  const info = { id: "w1", name: "Byte", kind: "agent", deskId: "d4", status: "starting" };
  const w: { info: typeof info; pty?: { write(s: string): void } } = { info };
  const manager = Object.assign(Object.create(WorkerManager.prototype), {
    workers: new Map([["w1", w]]),
    events: { toast: () => {}, update: () => {}, data: () => {} },
    tasks: { notePrompt: () => {} },
    worktrees: { checkLost: () => false },
    persist: () => {},
    emitUpdate: () => {},
    // the real one spawns claude in the worktree with this as its first message
    launch: (_w: unknown, prompt: string | undefined) => {
      launched.push(prompt);
      w.pty = { write: (s: string) => typed.push(s) };
    },
  });
  /** What `office-workers tell` does: type it, or wake the worker with it when it isn't running. */
  const tell = (text: string) => {
    const err = manager.prompt("w1", text, "Lead");
    return err === "Worker is not running" ? manager.resume("w1", text) : err;
  };
  manager.__rbBoot(w, "Run round 7 of #4460", "/tmp/byte-a1e6");
  return { tell, launched, typed };
}

pinnedTest("a tell while the worker installs waits for its one session; a tell once it runs is typed into it", async () => {
  const byte = hiring();
  expect(byte.tell("one more note for the round")).toBeUndefined();
  expect(byte.tell("and post the score on the issue")).toBeUndefined();
  expect(byte.launched).toEqual([]);

  installed();
  await Bun.sleep(0);
  expect(byte.launched).toEqual(["Run round 7 of #4460\n\none more note for the round\n\nand post the score on the issue"]);

  expect(byte.tell("rebase onto main")).toBeUndefined();
  expect(byte.launched).toHaveLength(1);
  expect(byte.typed).toEqual(["\x1b[200~rebase onto main\x1b[201~"]);
});
