import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { queue } from "./manual-runs-lib.ts";

setDefaultTimeout(20_000);

const issue = (number: number, title: string) => ({ number, title: `MANUAL RUN: ${title}`, body: "steps", url: `https://github.com/x/y/issues/${number}` });
const file = join(tmpdir(), `manual-runs-${process.pid}.json`);
await Bun.write(file, JSON.stringify([{ ...issue(2603, "a token"), labels: [{ name: "manual run" }, { name: "qcrm" }] }, issue(900_001, "feel the skate park"), issue(900_002, "wall screens")]));

const tagsFile = join(tmpdir(), `manual-tags-${process.pid}.json`);
await Bun.write(tagsFile, JSON.stringify({ 900_002: ["office"] }));

const port = 4900 + (process.pid % 90);
const srv = Bun.spawn(["bun", join(import.meta.dir, "manual-runs.ts"), "--port", String(port), "--dry", "--no-apps", "--issues", file, "--tags", tagsFile], { stdout: "pipe", stderr: "inherit" });
afterAll(() => srv.kill());
const url = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50 && !(await fetch(url).then(() => true, () => false)); i++) await Bun.sleep(100);
const post = (path: string, body: unknown) => fetch(url + path, { method: "POST", body: JSON.stringify(body) });

test("loadable runs come first, grouped by app, with their jump links; parked ones stay out", () => {
  const issues = [1, 2, 3, 4].map((n) => ({ ...issue(n, `run ${n}`), labels: [{ name: "manual run" }] }));
  const runs = { 1: { app: "office" as const, links: [{ label: "wall", path: "/?scenario=wall" }] }, 3: { app: "skate" as const, links: [{ label: "Halfpipe", path: "/?level=x" }] } };
  const q = queue(issues, { 3: ["feel"] }, runs, { 4: "roll-up, not a task" });
  expect(q.cards.map((c) => c.number)).toEqual([3, 1, 2]);
  expect(q.cards[0]!.links[0]!.path).toBe("/?level=x");
  expect(q.cards[0]!.tags).toEqual(["feel"]);
  expect(q.cards[2]!.labels).toEqual([]);
  expect(q.parked).toEqual([{ number: 4, why: "roll-up, not a task" }]);
});

test("the owner answers yes and no from the page", async () => {
  const q = await fetch(`${url}/api/queue`).then((r) => r.json());
  expect(q.cards.map((c: { number: number }) => c.number).sort()).toEqual([2603, 900_001, 900_002]);

  const yes = await post("/api/answer", { number: 900_001, yes: true, note: "feels good" }).then((r) => r.json());
  expect(yes.commands.map((c: string[]) => c.slice(0, 3).join(" "))).toEqual(["gh issue comment", "gh issue close"]);
  expect(yes.commands[0].at(-1)).toContain("feels good");
  // Off the public board: every write goes to the private manual-run repo.
  for (const c of yes.commands) expect(c.slice(c.indexOf("--repo"), c.indexOf("--repo") + 2)).toEqual(["--repo", "QuinnsCode/rustybuns-manual"]);
  const no = await post("/api/answer", { number: 2603, yes: false, note: "" }).then((r) => r.json());
  expect(no.commands.map((c: string[]) => c[2])).toEqual(["comment"]);

  expect((await fetch(`${url}/api/queue`).then((r) => r.json())).answered).toEqual({ 900_001: true, 2603: false });
  expect((await post("/api/answer", { number: 900_001, yes: "sure" })).status).toBe(400);
  expect((await post("/api/start", { app: "rm -rf" })).status).toBe(400);
});

test("the owner tags an issue, the tags are kept in the tags file and come back with the queue next to its GitHub labels", async () => {
  const card = async (n: number) => (await fetch(`${url}/api/queue`).then((r) => r.json())).cards.find((c: { number: number }) => c.number === n);
  expect((await card(900_002)).tags).toEqual(["office"]);
  expect((await card(2603)).labels).toEqual(["qcrm"]);

  const r = await post("/api/tags", { number: 2603, tags: ["#Needs Phone", "quick", "quick", " "] }).then((r) => r.json());
  expect(r.tags).toEqual(["needs-phone", "quick"]);
  expect((await card(2603)).tags).toEqual(["needs-phone", "quick"]);
  expect(JSON.parse(await Bun.file(tagsFile).text())).toEqual({ 900_002: ["office"], 2603: ["needs-phone", "quick"] });

  await post("/api/tags", { number: 900_002, tags: [] });
  expect(JSON.parse(await Bun.file(tagsFile).text())).toEqual({ 2603: ["needs-phone", "quick"] });
  expect((await post("/api/tags", { number: 2603, tags: "quick" })).status).toBe(400);
});

test("when gh can't read the issues the queue says why instead of crashing", async () => {
  const bad = join(tmpdir(), `manual-runs-bad-${process.pid}.json`);
  await Bun.write(bad, "");
  const p2 = port + 100;
  const s2 = Bun.spawn(["bun", join(import.meta.dir, "manual-runs.ts"), "--port", String(p2), "--dry", "--no-apps", "--issues", bad, "--tags", tagsFile], { stdout: "pipe", stderr: "inherit" });
  try {
    for (let i = 0; i < 50 && !(await fetch(`http://127.0.0.1:${p2}`).then(() => true, () => false)); i++) await Bun.sleep(100);
    const r = await fetch(`http://127.0.0.1:${p2}/api/queue`);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toContain("JSON");
    expect((await fetch(`http://127.0.0.1:${p2}/api/apps`)).status).toBe(200);
  } finally { s2.kill(); }
});
