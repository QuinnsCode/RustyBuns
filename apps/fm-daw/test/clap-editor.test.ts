// A hosted plugin's own editor (#5267): the host side (open it, pump it, the knobs it turns coming back, closing it)
// is tried in the crate's own tests (native/crates/fm_daw/src/clap/gui.rs), where Test Tone gets a pretend editor
// swapped in; nothing from Bun can hand a plugin one. This runs them. Skips (with a note) without cargo.
import { test, setDefaultTimeout } from "bun:test";
import { join } from "node:path";

setDefaultTimeout(300_000); // the first run compiles the crate's tests

test("a plugin's editor opens, turns knobs the host hears, and closes", () => {
  if (!Bun.which("cargo")) return console.log("  (skipped: no cargo)");
  const r = Bun.spawnSync(["cargo", "test", "--quiet", "--manifest-path", "native/Cargo.toml", "--lib", "clap::"], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`cargo test failed:\n${r.stdout.toString()}\n${r.stderr.toString()}`);
});
