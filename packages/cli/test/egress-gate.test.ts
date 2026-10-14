import { expect, test } from "bun:test";
import { refusedSummary, startGate } from "../src/egress-gate.ts";
import { freePort } from "../src/containers.ts";

// The app's own `allowed` and `refused` (apps/codesplitter/src/egress.ts) are what the gate runs; these are the same shape.
const allowed = (host: string, list: readonly string[]) => list.includes(host);
const refused = (host: string) => new Response(`no ${host}\n`, { status: 403 });

test("the gate tunnels an allowed host, answers an off-list one with the app's 403, and logs both", async () => {
  const up = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data(s, d) { s.write(d); } } });
  const port = await freePort(), log: string[] = [];
  const stop = startGate({ allowed, refused, hosts: ["127.0.0.1"], port, log: (l) => log.push(l) });
  try {
    const ask = async (target: string) => {
      let got = "";
      const sock = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data(_s, d) { got += d.toString(); }, close() {} } });
      sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      await Bun.sleep(150);
      return { sock, get: () => got };
    };
    const ok = await ask(`127.0.0.1:${up.port}`);
    expect(ok.get()).toStartWith("HTTP/1.1 200");
    ok.sock.write("ping");
    await Bun.sleep(150);
    expect(ok.get()).toEndWith("ping");
    ok.sock.end();
    const no = await ask("pypi.org:443");
    expect(no.get()).toStartWith("HTTP/1.1 403");
    expect(no.get()).toContain("no pypi.org");
    expect(log.map((l) => l.replace(/\s+/g, " "))).toEqual([`egress ✅ 127.0.0.1 CONNECT :${up.port} 200`, "egress ⛔ pypi.org CONNECT :443 403 not on this binding's list"]);
    expect(refusedSummary(log, "CI_RUNNER")).toContain('add "pypi.org" to CI_RUNNER\'s egress hosts');
  } finally { stop(); up.stop(true); }
});

test("the summary says when nothing was refused", () => {
  expect(refusedSummary(["egress  ✅ a  GET / 200"], "X")).toBe("egress  nothing was refused");
});
