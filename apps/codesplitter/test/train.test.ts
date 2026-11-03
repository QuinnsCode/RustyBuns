import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/**
 * A repo riding the merge train (#3323): checks run here, `test` required, fresh_main on, a `train` lane in its
 * pipeline. Branch `x` edits a.ts; `y` and `z` both edit b.ts, on different lines, so they settle together in one wave.
 * Each branch's own `test` passed before x merges.
 */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (url: string, body: unknown, method = "POST") => call("ryan", url, { method, body: JSON.stringify(body) });
  const get = async (url: string) => (await call("ryan", url)).json() as Promise<any>;
  await send("/api/login", { name: "ryan" });
  await send("/api/repos", { name: "lab" });
  const R = "/api/repos/ryan/lab";
  await send(`${R}/files`, { path: "a.ts", content: "one\ntwo" });
  await send(`${R}/files`, { path: "b.ts", content: "uno\ndos" });
  await send(`${R}/files`, { path: "codesplitter.pipeline.json", content: JSON.stringify({ lanes: [{ name: "tests", cadence: "train" }] }) });
  await send(`${R}/do/commit?path=a.ts`, { message: "first" });
  await send(`${R}/checks/settings`, { required: ["test"], fresh_main: true }, "PUT");
  const edit = async (branch: string, path: string, line: number, text: string) => {
    await send(`${R}/branches`, { name: branch });
    const doc = await get(`${R}/do/file?path=${path}&branch=${branch}`);
    await send(`${R}/do/ops?path=${path}&branch=${branch}`, { ops: [{ kind: "set", line: doc.lines[line].id, text, base: doc.lines[line].rev }] });
    for (const end = performance.now() + 15_000; !(await get(`${R}/checks?ref=${branch}`)).changed_at && performance.now() < end;) await Bun.sleep(10);
  };
  await edit("x", "a.ts", 0, "ONE");
  await edit("y", "b.ts", 0, "UNO");
  await edit("z", "b.ts", 1, "DOS");
  await Bun.sleep(5);
  for (const ref of ["x", "y", "z"]) await send(`${R}/checks`, { ref, sha: "a".repeat(40), name: "test", status: "passed" });
  await send(`${R}/checks/settings`, { where: "here" }, "PUT");
  await Bun.sleep(5);
  expect((await send(`${R}/branches/x/merge`, {})).status).toBe(200);
  const train = () => get(`${R}/train`);
  /** The owner reports a car's run (queued, so a runner would claim it) as `status`. */
  const finish = async (id: number, status: "passed" | "failed") => {
    const run = (await get(`${R}/checks?ref=train:${id}`)).runs[0];
    expect((await send(`${R}/checks/${run.id}`, { status: "running" }, "PUT")).status).toBe(200);
    expect((await send(`${R}/checks/${run.id}`, { status }, "PUT")).status).toBe(200);
  };
  return { R, send, get, train, finish };
}

test("x merging queues one car for the wave of y and z, main with both in; green, it merges whole without a rerun", async () => {
  const { R, send, get, train, finish } = await app();
  const t = await train();
  expect(t.on).toBe(true);
  expect(t.cars).toMatchObject([{ branches: ["y", "z"], status: "queued", runs: [{ name: "test", status: "queued" }] }]);
  const car = t.cars[0].id;

  // The runner's tree: main (x in) with y and z merged into b.ts.
  const tree = await get(`${R}/train/${car}/files`);
  expect(tree).toEqual({ branches: ["y", "z"], files: { "b.ts": "UNO\nDOS\n" } });

  // The car's runs stand in for each branch's own: waiting while it runs, green once it passes.
  expect(await get(`${R}/checks?ref=y`)).toMatchObject({ car: { id: car, branches: ["y", "z"] }, gate: { ok: false, waiting: ["test"] } });
  await finish(car, "passed");
  for (const b of ["y", "z"]) expect((await get(`${R}/checks?ref=${b}`)).gate.ok).toBe(true);

  // Merging y doesn't stale z's ride: the whole car lands, and no new car is queued.
  expect(await (await send(`${R}/merges`, { car })).json()).toEqual({ merged: ["y", "z"], skipped: [] });
  expect((await train()).cars).toHaveLength(1);
  expect((await send(`${R}/merges`, { car: "one" })).status).toBe(400);
});

test("a red car splits in halves till a car of one names the branch to blame; the green half still merges", async () => {
  const { R, send, get, train, finish } = await app();
  const first = (await train()).cars[0].id;
  await finish(first, "failed");
  const halves = (await train()).cars.filter((c: any) => c.parent === first);
  expect(halves.map((c: any) => c.branches)).toEqual([["z"], ["y"]]);
  const [zCar, yCar] = halves.map((c: any) => c.id);

  await finish(yCar, "passed");
  await finish(zCar, "failed");
  const cars = Object.fromEntries((await train()).cars.map((c: any) => [c.id, c]));
  expect([cars[first].blocks, cars[zCar].blocks, cars[yCar].blocks]).toEqual(["z", "z", null]);
  expect((await get(`${R}/checks?ref=z`)).gate).toMatchObject({ ok: false, failed: ["test"] });

  expect(await (await send(`${R}/merges`, { car: first })).json()).toMatchObject({ merged: ["y"], skipped: [{ branch: "z" }] });
});
