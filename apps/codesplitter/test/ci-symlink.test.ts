import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localMachine } from "../src/ci-runner.ts";

test("a check's junit.xml and the branch overlay never follow a symlink out of the clone", async () => {
  const outside = mkdtempSync(join(tmpdir(), "cs-symlink-test-"));
  const secret = join(outside, "owner-only.txt");
  writeFileSync(secret, "owner's secret");
  const m = await localMachine(undefined);
  try {
    // The command leaves junit.xml as a link to a file only the owner reads, and a folder link to somewhere the owner writes.
    await m.exec(["sh", "-c", `ln -s '${secret}' junit.xml && ln -s '${outside}' out`], () => {});
    expect(await m.read("junit.xml")).toBeUndefined();
    await expect(m.write({ "out/planted.txt": "x" })).rejects.toThrow("symlink");
    await expect(m.write({ "junit.xml": "x" })).rejects.toThrow("symlink");
    expect(readFileSync(secret, "utf8")).toBe("owner's secret");

    await m.exec(["sh", "-c", "rm junit.xml && echo '<testsuite/>' > junit.xml"], () => {});
    expect(await m.read("junit.xml")).toContain("<testsuite/>");
    await m.write({ "src/a.ts": "ok" });
    expect(await m.read("src/a.ts")).toBe("ok");
  } finally {
    await m.dispose();
    rmSync(outside, { recursive: true, force: true });
  }
});
