import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { nightlyLine, statusLine } from "../builder/page.ts";
import { builderRoute } from "../builder/server.ts";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); delete process.env.BUILDER_SSH; });

/** An office serving the card's route, with an `ssh` that is a script: it prints `out` and exits `code`. */
function office(host: string | undefined, code: number, out = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "rb-builder-"));
  dirs.push(dir);
  const fake = path.join(dir, "ssh");
  writeFileSync(fake, `#!/bin/sh\ncat <<'EOF_'\n${out}\nEOF_\nexit ${code}\n`);
  chmodSync(fake, 0o755);
  process.env.BUILDER_SSH = fake;
  const route = builderRoute(undefined, () => host);
  const server = Bun.serve({ port: 0, async fetch(req) { const r = await route(req.method, new URL(req.url)); return Response.json(r?.body ?? {}, { status: r?.status ?? 404 }); } });
  return { get: async () => (await fetch(`http://127.0.0.1:${server.port}/__rb/builder`)).json() as Promise<any>, stop: () => server.stop(true) };
}

const nightly = JSON.stringify({ at: "2026-10-28T03:00:00Z", commit: "74915d0e", results: [{ app: "hono-example", target: "all", ok: true, seconds: 40 }, { app: "fm-daw", target: "arm64", ok: false, seconds: 90 }] });

test("a reachable builder shows last night's results; an unreachable or unset one shows the setup line", async () => {
  const up = office("q@Mac.local", 0, nightly);
  const ok = await up.get();
  up.stop();
  expect(ok.connections).toEqual([{ id: "builder", kind: "builder", account: "q@Mac.local", status: "ok", access: "read" }]);
  expect(statusLine(ok)).toBe("q@Mac.local answers");
  expect(nightlyLine(ok.nightly)).toContain("1 of 2 built, failed: fm-daw");

  const fresh = office("q@Mac.local", 0, ""); // reachable, but no nightly run yet
  const none = await fresh.get();
  fresh.stop();
  expect(none.connections[0].status).toBe("ok");
  expect(nightlyLine(none.nightly)).toBe("No nightly results yet");

  const down = office("q@Mac.local", 255);
  const gone = await down.get();
  down.stop();
  expect(gone.connections[0].status).toBe("down");
  expect(gone.setup).toContain("builder-setup.sh");

  const unset = office(undefined, 0);
  const no = await unset.get();
  unset.stop();
  expect(no.connections[0].status).toBe("unset");
  expect(statusLine(no)).toContain("BUILDER_HOST");
});

test("a results file of the wrong shape is no results", async () => {
  const o = office("q@Mac.local", 0, JSON.stringify({ at: 5, results: "x" }));
  const body = await o.get();
  o.stop();
  expect(body.nightly).toBeNull();
});
