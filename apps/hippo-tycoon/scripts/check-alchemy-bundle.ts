// Bundles src/worker.ts the way `rustybuns deploy` will (Alchemy's rolldown source: same
// plugins, same output options), runs that exact bundle in workerd, and plays the online
// smoke round against it. Needs no Cloudflare login and creates nothing in the cloud.
// Run `bun run build` first so dist/client exists.
//   bun scripts/check-alchemy-bundle.ts
import { $ } from "bun";
import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import config from "../rustybuns.config.ts";

const worker = config.worker!;
if (!worker.main) throw new Error("rustybuns.config.ts has no worker.main to bundle");
const outDir = resolve(".alchemy/bundle-check");
const req = createRequire(import.meta.resolve("alchemy/package.json"));
const { rolldown } = await import(req.resolve("rolldown"));
const { esmExternalRequirePlugin } = await import(req.resolve("rolldown/plugins"));
const cloudflareRolldown = (await import(req.resolve("@alchemy.run/cloudflare-runtime/rolldown"))).default;

// Alchemy rebuilds this builtin plugin with its own rolldown copy (lib/Cloudflare/Workers/Sources/Rolldown.js).
const rebind = (p: any) =>
  p && typeof p === "object" && p.name === "builtin:esm-external-require" && "_options" in p ? esmExternalRequirePlugin(p._options) : p;

await rm(outDir, { recursive: true, force: true });
const bundle = await rolldown({
  input: resolve(worker.main),
  external: ["lightningcss", "fsevents"],
  plugins: [cloudflareRolldown({ compatibilityDate: worker.compatibilityDate, compatibilityFlags: worker.compatibilityFlags ?? [] })].flat().map(rebind),
  checks: { unresolvedImport: false, ineffectiveDynamicImport: false },
});
const { output } = await bundle.write({ format: "esm", sourcemap: "hidden", minify: true, keepNames: true, strictExecutionOrder: true, dir: outDir });
for (const c of output) console.log(c.type === "chunk" ? `bundled ${c.fileName} (${(c.code.length / 1024).toFixed(1)} KB), exports: ${c.exports.join(", ")}` : `bundled ${c.fileName} (${(c.source.length / 1024).toFixed(1)} KB)`);

// workerd runs the bundle as-is (no_bundle), with the same bindings the stack declares.
const doBindings = Object.entries(config.bindings ?? {}).filter(([, b]) => b.type === "durable_object") as [string, { className: string }][];
await Bun.write(`${outDir}/wrangler.json`, JSON.stringify({
  name: `${config.name}-bundle-check`,
  main: output.find((c: any) => c.type === "chunk" && c.isEntry)!.fileName,
  no_bundle: true,
  find_additional_modules: true,   // the bundled hippo_sim.wasm, as its own module
  compatibility_date: worker.compatibilityDate,
  compatibility_flags: worker.compatibilityFlags ?? [],
  assets: { binding: "ASSETS", directory: resolve(worker.assets!) },
  durable_objects: { bindings: doBindings.map(([name, b]) => ({ name, class_name: b.className })) },
  migrations: [{ tag: "v1", new_sqlite_classes: doBindings.map(([, b]) => b.className) }],
}));

// A free port, so an already running `wrangler dev` is never the one tested.
const probe = Bun.serve({ port: 0, fetch: () => new Response() });
const port = probe.port;
probe.stop(true);

const dev = Bun.spawn(["bunx", "wrangler", "dev", "--local", "-c", `${outDir}/wrangler.json`, "--port", String(port)], { stdout: "pipe", stderr: "pipe" });
let code = 1;
try {
  const end = Date.now() + 30_000;
  while (!(await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok, () => false))) {
    if (Date.now() > end || dev.exitCode !== null) throw new Error(`workerd did not start:\n${await new Response(dev.stderr).text()}`);
    await Bun.sleep(250);
  }
  code = (await $`bun scripts/smoke-online.ts http://127.0.0.1:${port}`.nothrow()).exitCode;
} finally {
  dev.kill();
}
process.exit(code);
