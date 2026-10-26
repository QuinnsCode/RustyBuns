import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cms } from "../src/index.ts";

const start = async (file: unknown) => {
  const dir = await mkdtemp(join(tmpdir(), "cms-"));
  await writeFile(join(dir, "script.json"), JSON.stringify(file));
  return { dir, app: cms({ dir, title: "Test" }) };
};
const post = (app: (r: Request) => Promise<Response>, fields: Record<string, string>) =>
  app(new Request("http://x/script.json", { method: "POST", body: new URLSearchParams(fields) }));

test("a writer edits a line and a list, and the file keeps its shape", async () => {
  const { dir, app } = await start({ radio: { shield: ["one", "two"] }, title: "Old", delay: 3, nested: [1, 2] });
  const html = await (await app(new Request("http://x/script.json"))).text();
  expect(html).toContain("<textarea");
  const res = await post(app, { [JSON.stringify(["title"])]: "New\r\n", [JSON.stringify(["radio", "shield"])]: "one\n\n  three  \n", [JSON.stringify(["delay"])]: "99", [JSON.stringify(["extra"])]: "x" });
  expect(res.status).toBe(303);
  expect(JSON.parse(await readFile(join(dir, "script.json"), "utf8"))).toEqual({ radio: { shield: ["one", "three"] }, title: "New", delay: 3, nested: [1, 2] });
});

test("a cross-site form and a file outside the folder are refused", async () => {
  const { app } = await start({ a: "b" });
  const cross = await app(new Request("http://x/script.json", { method: "POST", headers: { origin: "http://evil" }, body: new URLSearchParams() }));
  expect(cross.status).toBe(403);
  expect((await app(new Request("http://x/..%2Fpackage.json"))).status).toBe(404);
});
