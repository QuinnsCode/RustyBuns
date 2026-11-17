import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

setDefaultTimeout(20_000);

const issue = (number: number, title: string) => ({ number, title: `MANUAL RUN: ${title}`, body: "steps", url: `https://github.com/x/y/issues/${number}` });
const file = join(tmpdir(), `manual-runs-${process.pid}.json`);
await Bun.write(file, JSON.stringify([{ ...issue(2603, "a token"), labels: [{ name: "manual run" }, { name: "qcrm" }] }, issue(2486, "feel the skate park"), issue(609, "roll-up"), issue(2425, "wall screens")]));

const tagsFile = join(tmpdir(), `manual-tags-${process.pid}.json`);
await Bun.write(tagsFile, JSON.stringify({ 2425: ["office"] }));

const port = 4900 + (process.pid % 90);
const srv = Bun.spawn(["bun", join(import.meta.dir, "manual-runs.ts"), "--port", String(port), "--dry", "--no-apps", "--issues", file, "--tags", tagsFile], { stdout: "pipe", stderr: "inherit" });
afterAll(() => srv.kill());
const url = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50 && !(await fetch(url).then(() => true, () => false)); i++) await Bun.sleep(100);
const post = (path: string, body: unknown) => fetch(url + path, { method: "POST", body: JSON.stringify(body) });

test("the owner gets loadable runs first with their jump links, answers yes and no, and parked ones stay out", async () => {
  const q = await fetch(`${url}/api/queue`).then((r) => r.json());
  expect(q.cards.map((c: { number: number }) => c.number)).toEqual([2486, 2425, 2603]);
  expect(q.cards[0].links[0].path).toBe("/?level=el-capitan");
  expect(q.cards[1].links.map((l: { label: string }) => l.label)).toContain("wall-ester-running");
  expect(q.parked).toEqual([{ number: 609, why: "roll-up, not a task" }]);

  const yes = await post("/api/answer", { number: 2486, yes: true, note: "feels good" }).then((r) => r.json());
  expect(yes.commands.map((c: string[]) => c.slice(0, 3).join(" "))).toEqual(["gh issue comment", "gh issue close"]);
  expect(yes.commands[0].at(-1)).toContain("feels good");
  const no = await post("/api/answer", { number: 2603, yes: false, note: "" }).then((r) => r.json());
  expect(no.commands.map((c: string[]) => c[2])).toEqual(["comment"]);

  expect((await fetch(`${url}/api/queue`).then((r) => r.json())).answered).toEqual({ 2486: true, 2603: false });
  expect((await post("/api/answer", { number: 2486, yes: "sure" })).status).toBe(400);
  expect((await post("/api/start", { app: "rm -rf" })).status).toBe(400);
});

test("the owner tags an issue, the tags are kept in the tags file and come back with the queue next to its GitHub labels", async () => {
  const card = async (n: number) => (await fetch(`${url}/api/queue`).then((r) => r.json())).cards.find((c: { number: number }) => c.number === n);
  expect((await card(2425)).tags).toEqual(["office"]);
  expect((await card(2603)).labels).toEqual(["qcrm"]);

  const r = await post("/api/tags", { number: 2603, tags: ["#Needs Phone", "quick", "quick", " "] }).then((r) => r.json());
  expect(r.tags).toEqual(["needs-phone", "quick"]);
  expect((await card(2603)).tags).toEqual(["needs-phone", "quick"]);
  expect(JSON.parse(await Bun.file(tagsFile).text())).toEqual({ 2425: ["office"], 2603: ["needs-phone", "quick"] });

  await post("/api/tags", { number: 2425, tags: [] });
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
