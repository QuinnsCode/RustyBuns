import { expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { findBlender, runBlender, warmBlender } from "@rustybuns/cli/blender";

// The warm Blender (#3941): a build through it is byte for byte a cold one, and the MCP in front of it answers
// load, stats and render and refuses what it shouldn't. Needs Blender (CI has none, so there it skips).
setDefaultTimeout(180_000);
const APP = join(import.meta.dir, "..");
const GLB = join(APP, "public", "models", "jackalope.glb");
const sha = async () => new Bun.CryptoHasher("sha256").update(await Bun.file(GLB).bytes()).digest("hex");

test.skipIf(!findBlender())("a warm build is byte for byte a cold one, twice over, and a bad call doesn't stop it", async () => {
  await runBlender({ script: "blender/beast.py", args: ["beasts/jackalope.json"], cwd: APP, threads: 8 });
  const cold = await sha();
  await using b = await warmBlender({ cwd: APP, threads: 8 });
  for (let i = 0; i < 2; i++) {
    await b.call("build", { script: "blender/beast.py", args: ["beasts/jackalope.json"] });
    expect(await sha()).toBe(cold);
  }
  await expect(b.call("build", { script: "../../.env.schema" })).rejects.toThrow("outside");
  // @ts-expect-error: not a call, and the wire refuses it too
  await expect(b.call("exec", { code: "print(1)" })).rejects.toThrow("no call 'exec'");
  expect(await b.call("ping")).toMatchObject({ blender: expect.any(String) });
});

test.skipIf(!findBlender())("the MCP loads a beast, counts a part, renders a view, and says what's wrong with a bad ask", async () => {
  const p = Bun.spawn(["bun", join(APP, "scripts", "blender-mcp.ts"), "--local"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const calls: [string, Record<string, unknown>][] = [
    ["blender_load", { beast: "jackalope" }],
    ["blender_stats", { part: "antler" }],
    ["blender_render", { view: "left", size: 128 }],
    ["blender_load", { glb: "../../.env.schema" }],
    ["blender_stats", { part: "wing" }],
  ];
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }) + "\n");
  calls.forEach(([name, args], i) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name, arguments: args } }) + "\n"));
  p.stdin.end();
  const replies = (await new Response(p.stdout).text()).trim().split("\n").map((l) => JSON.parse(l));
  const [init, load, stats, render, outside, missing] = replies;
  expect(init.result.capabilities.tools).toBeDefined();
  expect(load.result.content[0].text).toContain("jackalope");
  expect(JSON.parse(stats.result.content[0].text)[0].materials).toEqual([expect.objectContaining({ material: "antler", triangles: expect.any(Number) })]);
  const png = Buffer.from(render.result.content[0].data, "base64");
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(outside.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("outside") }] });
  expect(missing.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("antler") }] });
  expect(await p.exited).toBe(0);
});
