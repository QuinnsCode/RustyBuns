import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refusedSummary, sessionCerts, startGate } from "../src/egress-gate.ts";
import { freePort } from "../src/containers.ts";

// The app's own `allowed` and `refused` (apps/codesplitter/src/egress.ts) are what the gate runs; these are the same shape.
const allowed = (host: string, list: readonly string[]) => list.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));
const refused = (host: string) => new Response(`no ${host}\n`, { status: 403 });

test("the gate decrypts an allowed host's HTTPS with the session CA, logs its path, and refuses an off-list one at CONNECT", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-gate-test-"));
  const certs = sessionCerts(dir, ["registry.npmjs.org", "*.github.com"]);
  const port = await freePort(), log: string[] = [], seen: string[] = [];
  const upstream = async (r: Request) => { seen.push(`${r.method} ${r.url}`); return new Response(`hello from ${new URL(r.url).hostname}`); };
  const stop = startGate({ allowed, refused, hosts: ["registry.npmjs.org", "*.github.com"], port, log: (l) => log.push(l), upstream,
    tls: { cert: readFileSync(certs.cert, "utf8"), key: readFileSync(certs.key, "utf8") } });
  // What a container does: HTTPS_PROXY to the gate, trusting only the CA mounted at the runtime's path.
  const get = (url: string) => fetch(url, { proxy: `http://127.0.0.1:${port}`, tls: { ca: readFileSync(certs.ca, "utf8") } });
  try {
    const r = await get("https://registry.npmjs.org/effect");
    expect(await r.text()).toBe("hello from registry.npmjs.org");
    expect(await (await get("https://codeload.github.com/a/b")).text()).toBe("hello from codeload.github.com");
    expect(await (await get("http://registry.npmjs.org/plain")).text()).toBe("hello from registry.npmjs.org");
    expect(seen).toEqual(["GET https://registry.npmjs.org/effect", "GET https://codeload.github.com/a/b", "GET http://registry.npmjs.org/plain"]);
    await expect(get("https://pypi.org/simple")).rejects.toThrow();
    expect(log.map((l) => l.replace(/\s+/g, " ").trim())).toEqual([
      "egress ✅ registry.npmjs.org GET /effect 200",
      "egress ✅ codeload.github.com GET /a/b 200",
      "egress ✅ registry.npmjs.org GET /plain 200",
      "egress ⛔ pypi.org CONNECT :443 403 not on this binding's list",
    ]);
    expect(refusedSummary(log, "CI_RUNNER")).toContain('add "pypi.org" to CI_RUNNER\'s egress hosts');
  } finally { stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("the summary says when nothing was refused", () => {
  expect(refusedSummary(["egress  ✅ a  GET / 200"], "X")).toBe("egress  nothing was refused");
});
