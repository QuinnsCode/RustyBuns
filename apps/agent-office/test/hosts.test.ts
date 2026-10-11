import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { allowedHosts, guardHost, hostName } from "../live/hosts.ts";
import { unpackPinned } from "./pinned.ts";

setDefaultTimeout(60_000);

test("hostName drops the port, the brackets and a trailing dot", () => {
  expect(hostName("LocalHost:4600")).toBe("localhost");
  expect(hostName("[::1]:4600")).toBe("::1");
  expect(hostName("office.example.")).toBe("office.example");
  expect(hostName(undefined)).toBe("");
});

test("the office answers to its own names and IP literals, not a rebound one", () => {
  const ok = allowedHosts({ host: "127.0.0.1", publicHost: "office.example.com:2222", tailnet: "box.tail1.ts.net" }, { AGENT_OFFICE_ALLOWED_HOSTS: "extra.test, more.test" });
  for (const h of ["localhost:4600", "127.0.0.1:4600", "[::1]:4600", "192.168.1.20:4600", "5173.localhost", "office.example.com",
    "box.tail1.ts.net", "5173.box.tail1.ts.net", "extra.test:1", "more.test", "mac.tail9.ts.net", "a-b-c.trycloudflare.com", `${hostname()}:4600`]) expect(ok(h)).toBe(true);
  for (const h of ["evil.example:4600", "localhost.evil.example", "evilts.net", "trycloudflare.com.evil.example", "", undefined]) expect(ok(h)).toBe(false);
});

test("behind --trust-proxy the proxy routes by name, so any Host passes", () => {
  expect(allowedHosts({ trustProxy: true }, {})("evil.example")).toBe(true);
});

test("guardHost answers 421 to a name it doesn't know", () => {
  const guard = guardHost({ host: "127.0.0.1" });
  let status = 0;
  const res = { writeHead: (s: number) => (status = s), end: () => {} };
  expect(guard({ headers: { host: "localhost:4600" } }, res)).toBe(false);
  expect(guard({ headers: { host: "evil.example" } }, res)).toBe(true);
  expect(status).toBe(421);
});

test("the pinned release still has the request handler and upgrade lines the guard is patched in front of", async () => {
  const srv = path.join(await unpackPinned(), "dist/server/server");
  const script = readFileSync(path.join(import.meta.dir, "../scripts/rustybunsify.ts"), "utf8");
  for (const [file, anchor] of [["http/router.js", "    return async (req, res) => {\n        const { cfg, auth } = ctx;\n"],
    ["ws/upgrade.js", "        socket.on('error', () => socket.destroy());\n"]] as const) {
    expect(readFileSync(path.join(srv, file), "utf8").split(anchor)).toHaveLength(2);
    expect(script).toContain(JSON.stringify(anchor).slice(1, -1));
  }
});
