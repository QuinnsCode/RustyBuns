import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ours } from "../scripts/update.ts";

/** A stand-in office: something at office/bin/agent-office.js in `dir`, listening on a free port. */
async function fakeOffice(dir: string) {
  mkdirSync(path.join(dir, "office/bin"), { recursive: true });
  const bin = path.join(dir, "office/bin/agent-office.js");
  writeFileSync(bin, `const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port);`);
  const child = Bun.spawn(["bun", "office/bin/agent-office.js"], { cwd: dir, stdout: "pipe" });
  const reader = child.stdout.getReader();
  const port = Number(new TextDecoder().decode((await reader.read()).value).trim());
  return { child, port };
}

test("office:update swaps only this checkout's office, and knows when office:mama is minding it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "office-update-"));
  const { child, port } = await fakeOffice(dir);
  try {
    expect(await ours(port, dir)).toEqual({ pid: child.pid, mama: false });
    expect(await ours(port, mkdtempSync(path.join(tmpdir(), "other-checkout-")))).toBeNull();
  } finally {
    child.kill();
  }
  await child.exited;
  expect(await ours(port, dir)).toBeNull();
});
