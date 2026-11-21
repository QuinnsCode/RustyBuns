import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { r2 } from "@rustybuns/shell-bun";
import { local as boot } from "./app-kit.ts";
import { CPU_MS } from "../src/codemode.ts";

// Charts from code mode (#5402): a program reads rows through a tool, draws them with mpl, saves the PNG with
// save_chart, and only the link comes back; the link serves the picture to a person and nothing else.
const TIMES = readFileSync(join(import.meta.dir, "../test-times.json"), "utf8");

const PROGRAM = `
const f = await tools.read_file({ owner: "ryan", repo: "lab", path: "test-times.json" });
const times = JSON.parse(f.lines.map((l) => l.text).join("\\n"));
const top = Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, 12).reverse();
const [fig, ax] = mpl.subplots({ figsize: [8, 5] });
ax.barh(top.map(([n]) => n.replace("test/", "")), top.map(([, ms]) => ms / 1000));
ax.set_xlabel("seconds");
ax.set_title("The slowest test files");
fig.tight_layout();
const png = fig.toPNGSync();
const saved = await tools.save_chart({ body: { name: "Slowest tests", png: btoa(Array.from(png, (b) => String.fromCharCode(b)).join("")) } });
return { files: Object.keys(times).length, slowest: top.at(-1)[0], url: saved.url, bytes: saved.bytes };
`;

test("a program charts rows from a tool, saves the PNG, and the link it gets back serves it", async () => {
  const CHARTS = r2(mkdtempSync(join(tmpdir(), "cs-charts-")));
  const call = await boot({ GH_CLI: "off", LOADER: true, CHARTS });
  const send = (url: string, b: unknown) => call("ryan", url, { method: "POST", body: JSON.stringify(b) });
  await send("/api/login", { name: "ryan" });
  await send("/api/repos", { name: "lab", visibility: "private" });
  expect((await send("/api/repos/ryan/lab/files", { path: "test-times.json", content: TIMES })).status).toBe(201);
  const { token } = (await (await send("/api/tokens", { label: "mcp", scope: "write" })).json()) as { token: string };
  const execute = async (code: string) => {
    const r = (await (await call(null, "/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute", arguments: { code } } }) })).json()) as any;
    return { isError: r.result.isError as boolean, out: JSON.parse(r.result.content[0].text) };
  };

  const cpu = process.cpuUsage(), wall = performance.now();
  const { isError, out } = await execute(PROGRAM);
  const used = process.cpuUsage(cpu), ms = (used.user + used.system) / 1000;
  expect(isError).toBe(false);
  const slowest = Object.entries(JSON.parse(TIMES) as Record<string, number>).sort((a, b) => b[1] - a[1])[0]![0];
  expect(out.result).toMatchObject({ files: Object.keys(JSON.parse(TIMES)).length, slowest });
  // Bun isn't one of mpl's tested runtimes, and the local loader has no CPU limit: this is the number to hold against the edge's.
  console.log(`chart program under Bun: ${ms.toFixed(0)} ms CPU (the whole process, the program's thread with it), ${(performance.now() - wall).toFixed(0)} ms wall, against CPU_MS ${CPU_MS}; PNG ${out.result.bytes} bytes`);

  // The link: a PNG to anyone holding it, until it runs out; a changed signature or a lapsed link is a 404.
  const url = new URL(out.result.url);
  const got = await call(null, url.pathname + url.search);
  expect(got.status).toBe(200);
  expect(got.headers.get("content-type")).toBe("image/png");
  const bytes = new Uint8Array(await got.arrayBuffer());
  expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.length).toBe(out.result.bytes);
  const forged = new URL(url); forged.searchParams.set("exp", String(Number(url.searchParams.get("exp")) + 86_400_000));
  expect((await call(null, forged.pathname + forged.search)).status).toBe(404);

  // A program that sends something that isn't a PNG is told so, with the tool's tag.
  const bad = await execute(`return await tools.save_chart({ body: { name: "x", png: btoa("not a png") } });`);
  expect(bad.isError).toBe(true);
  expect(bad.out.error).toMatch(/^400: .*BadInput/);
});
