// A player's own Audio Unit, hosted by the Rust engine behind the CLAP and VST3 hosts' surface (#5517). Every Mac
// has Apple's DLS synth, so it is found the way the track menu finds one (the system's list, by its `au:` name),
// opened, started, played and moved from here exactly as a CLAP is. The host's own pieces (an effect fed silence,
// the codes read back) are tried in the crate's tests, run at the end. Skips (with a note) off macOS or unbuilt.
import { test, expect, setDefaultTimeout } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { candidates } from "@rustybuns/native";
import { openBundle, systemPlugins } from "../src/engine/plugins.ts";

setDefaultTimeout(300_000); // the cargo run compiles the crate's tests the first time

const built = candidates("fm_daw", {}).find(existsSync);
const DLS = "au:aumu:dls :appl";

test("an Audio Unit macOS lists plays notes and its sliders move, as a CLAP does", async () => {
  if (process.platform !== "darwin") return console.log("  (skipped: Audio Units are macOS's)");
  if (!built) return console.log("  (skipped: cdylib not built; run `bun run build:native`)");
  expect(await systemPlugins()).toContain(DLS);

  const b = await openBundle(DLS);
  if (typeof b === "string") throw new Error(b);
  expect(b.plugins.map((p) => [p.id, p.vendor, p.features])).toEqual([["aumu:dls :appl", "Apple", ["instrument"]]]);
  const p = b.make(0, 48000);
  if (typeof p === "string") throw new Error(p);
  b.close();

  const peak = () => { const out = new Float32Array(2 * 9600); expect(p.render(out, 9600)).toBe(true); return out.reduce((m, x) => Math.max(m, Math.abs(x)), 0); };
  expect(peak()).toBe(0);
  p.noteOn(60, 1);
  expect(peak()).toBeGreaterThan(0.01);
  const [first] = p.params();
  if (!first) throw new Error("no parameters");
  p.setParam(first.id, first.min);
  expect(p.params()[0]!.value).toBe(first.min);

  expect(p.editor).toBeNull();
  expect(p.openEditor("DLS, track 1")).toContain("doesn't open here yet");
  p.free();
  expect(p.render(new Float32Array(2), 1)).toBe(false);
  expect(await openBundle("au:aumu:nope:nope")).toContain("no Audio Unit");
});

test("the host's own Audio Unit pieces pass the crate's tests", () => {
  if (!Bun.which("cargo")) return console.log("  (skipped: no cargo)");
  const r = Bun.spawnSync(["cargo", "test", "--quiet", "--manifest-path", "native/Cargo.toml", "--lib", "--", "au::", "hosted::"], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`cargo test failed:\n${r.stdout.toString()}\n${r.stderr.toString()}`);
});
