import { expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";

// `bun run beasts` twice gives the same GLBs: the decimator used to land vertices a float apart, and in another
// order, from one run to the next. Needs Blender on PATH (CI has none, so there it skips); rebuilds the one sheet,
// which is what the checked-in file already is.
setDefaultTimeout(120_000);
const APP = join(import.meta.dir, "..");

async function build(id: string): Promise<string> {
  const p = Bun.spawn(["blender", "-b", "--factory-startup", "--python-exit-code", "1", "-P", "blender/beast.py", "--", `beasts/${id}.json`], { cwd: APP, stdout: "ignore", stderr: "ignore" });
  expect(await p.exited).toBe(0);
  return new Bun.CryptoHasher("sha256").update(await Bun.file(join(APP, "public", "models", `${id}.glb`)).bytes()).digest("hex");
}

test.skipIf(!Bun.which("blender")).each(["jackalope", "squonk"])("%s builds to the same GLB twice", async (id) => {
  expect(await build(id)).toBe(await build(id));
});
