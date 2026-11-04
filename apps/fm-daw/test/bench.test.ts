import { expect, setDefaultTimeout, test } from "bun:test";
import { SONGS } from "../src/songs.ts";

setDefaultTimeout(30_000);

test("bun run bench races TypeScript (and Rust when built) on every song", async () => {
  const run = Bun.spawn(["bun", "run", "bench", "1"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(run.stdout).text(), run.exited]);
  expect(code).toBe(0);
  for (const song of SONGS) {
    const row = out.split("\n").find((l) => l.startsWith(song.name));
    expect(row).toMatch(/Rust (\d+x realtime|not built)\s+TypeScript \d+x realtime/);
  }
});
