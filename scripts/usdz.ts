// Turn the games' glTF models into USDZ, the format iOS reads natively (RealityKit, SceneKit, Quick Look):
//   bun run usdz                      every apps/*/public/models/*.glb into dist/ios/<app>/
//   bun run usdz mythic-masters       one app
// Headless Blender does the work (scripts/usdz/convert.py); BLENDER_PATH picks a Blender other than the one on PATH.
import { existsSync, readdirSync } from "node:fs";

const blender = process.env.BLENDER_PATH ?? Bun.which("blender") ?? "/Applications/Blender.app/Contents/MacOS/Blender";
if (!existsSync(blender) && !Bun.which(blender)) throw new Error("no Blender: install it or set BLENDER_PATH");

const named = Bun.argv.slice(2);
const apps = (named.length ? named : readdirSync("apps")).filter((app) => existsSync(`apps/${app}/public/models`));
if (!apps.length) throw new Error(`no public/models in ${named.join(", ") || "apps/*"}`);

for (const app of apps) {
  const glbs = readdirSync(`apps/${app}/public/models`).filter((f) => f.endsWith(".glb")).map((f) => `apps/${app}/public/models/${f}`);
  if (!glbs.length) continue;
  const out = `dist/ios/${app}`;
  const p = Bun.spawn([blender, "-b", "--factory-startup", "--python-exit-code", "1", "-P", "scripts/usdz/convert.py", "--", out, ...glbs], { stdout: "pipe", stderr: "pipe" });
  const log = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  if ((await p.exited) !== 0) throw new Error(`blender failed on ${app}:\n${log.split("\n").filter((l) => /Error|Traceback|line \d+/.test(l)).join("\n")}`);
  const baked = log.split("\n").filter((l) => / baked=[1-9]/.test(l)).length;
  console.log(`${app}: ${glbs.length} models -> ${out}/${baked ? ` (${baked} painted with vertex colours, baked to textures)` : ""}`);
}
