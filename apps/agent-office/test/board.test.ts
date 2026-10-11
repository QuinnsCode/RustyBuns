import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { openNewFirstClient } from "../scripts/board.ts";
import { askOf, read, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

let pkg = "";
beforeAll(async () => { pkg = await unpackPinned(); });

// the patched columns function, lifted out of the bundle with a stand-in store
function columns(js: string, tasks: Record<number, object>) {
  const src = js.match(/function Sm\(e\)\{.*?max:40\}\]\}/)![0];
  const _m = (e: { assignees: string[] }) => e.assignees.length > 0;
  const bm = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);
  const r = { taskForIssue: (n: number) => tasks[n] };
  return new Function("r", "_m", "bm", `${src};return Sm`)(r, _m, bm);
}

const issue = (number: number, assignees: string[] = []) => ({ number, state: "OPEN", assignees, updatedAt: "" });

test("issues handed to a worker sink to the bottom of Open, the rest keep GitHub's order", () => {
  const Sm = columns(openNewFirstClient(read(askOf(pkg))), { 9: { status: "queued" }, 7: { status: "done", pr: { number: 1 } } });
  const [open, progress] = Sm([issue(10), issue(9), issue(8), issue(7), issue(6), issue(5, ["me"])]);
  expect(open.items.map((i: { number: number }) => i.number)).toEqual([10, 8, 6, 9, 7]);
  expect(progress.items.map((i: { number: number }) => i.number)).toEqual([5]);
});

test("the patch still parses, and a moved target fails loudly", () => {
  const patched = openNewFirstClient(read(askOf(pkg)));
  expect(() => new Bun.Transpiler({ loader: "js" }).scan(patched)).not.toThrow();
  expect(() => openNewFirstClient(patched)).toThrow(/patch target moved/);
  expect(() => openNewFirstClient("")).toThrow(/Agent Office changed/);
});
