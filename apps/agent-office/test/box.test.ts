import { expect, test } from "bun:test";
import { dockerArgs, edit, limits, parsePerms, proxyArgs } from "../sandbox/box.ts";
import { allowed, connectTarget } from "../sandbox/proxy.ts";

const host = { cpus: 10, memBytes: 16 * 2 ** 30 };
const joined = (a: string[]) => a.join(" ");

test("a permission set makes a locked-down box that mounts only what it lists", () => {
  const args = dockerArgs(parsePerms({ repos: [{ path: "/code/app", access: "rw" }, { path: "/code/docs" }], env: ["ANTHROPIC_API_KEY"] }), host);
  const text = joined(args);
  expect(text).toContain("-v /code/app:/work/app:rw");
  expect(text).toContain("-v /code/docs:/work/docs:ro"); // read-only unless asked otherwise
  expect(text).toContain("--network agent-office-box-net"); // no route out but the proxy
  expect(text).not.toContain("-p "); // the proxy publishes the port, on the host's loopback, never the LAN
  expect(joined(proxyArgs(parsePerms({})))).toContain("-p 127.0.0.1:4600:4600");
  expect(text).toContain("-e OFFICE_FLOOR=/work/app"); // the first writable repo is the floor
  expect(text).toContain("--cap-drop ALL");
  expect(args.filter((a) => a === "-v")).toHaveLength(3); // two repos and the home volume
  expect(text).toContain("-e ANTHROPIC_API_KEY"); // a name only: the value never shows on the command line
});

test("offline publishes nothing and cuts the network", () => {
  const text = joined(dockerArgs(parsePerms({ network: "offline" }), host));
  expect(text).toContain("--network none");
  expect(text).not.toContain("-p ");
});

test("the allowlist names the model, GitHub and the registry, and the proxy gets exactly that list", () => {
  const perms = parsePerms({});
  expect(perms.network).toBe("allowlist");
  expect(perms.allow).toEqual(expect.arrayContaining(["api.anthropic.com", "github.com", "registry.npmjs.org"]));
  expect(joined(dockerArgs(perms, host))).toContain("HTTPS_PROXY=http://agent-office-box-proxy:3128");
  expect(joined(proxyArgs(parsePerms({ allow: ["a.example.com", "*.b.dev"] })))).toContain("ALLOW=a.example.com,*.b.dev");
  expect(joined(dockerArgs(parsePerms({ network: "open" }), host))).toContain("-p 127.0.0.1:4600:4600");
  expect(edit(perms, { allow: { host: "Pkg.Example.com", on: true } }, () => true).allow).toContain("pkg.example.com");
  expect(edit(perms, { allow: { host: "github.com", on: false } }, () => true).allow).not.toContain("github.com");
  expect(() => parsePerms({ allow: ["not a host"] })).toThrow("allow[0]");
});

test("the proxy tunnels HTTPS to listed hosts and refuses the rest", () => {
  const list = ["github.com", "*.npmjs.org"];
  expect(allowed("github.com", list)).toBe(true);
  expect(allowed("registry.npmjs.org", list)).toBe(true);
  expect(allowed("evil-github.com", list)).toBe(false);
  expect(allowed("github.com.evil.io", list)).toBe(false);
  expect(allowed("npmjs.org", list)).toBe(false); // *.x is subdomains only
  expect(connectTarget("CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n")).toEqual({ host: "github.com", port: 443 });
  expect(connectTarget("GET http://github.com/ HTTP/1.1\r\n\r\n")).toBeNull();
});

test("the box takes a fifth of the machine unless told otherwise", () => {
  expect(limits(parsePerms({}), host)).toEqual({ cpus: 2, memory: "3276m" });
  expect(limits(parsePerms({ cpus: 1, memory: "1g" }), host)).toEqual({ cpus: 1, memory: "1g" });
  expect(joined(dockerArgs(parsePerms({}), host))).toContain("--cpus 2");
});

test("a bad permission set says which field", () => {
  expect(() => parsePerms({ port: "nope" })).toThrow("isn't a port");
  expect(() => parsePerms({ memory: "lots" })).toThrow("512m or 4g");
  expect(() => parsePerms({ network: "lan" })).toThrow('"allowlist", "open" or "offline"');
  expect(() => parsePerms({ repos: [{ path: "/a", access: "all" }] })).toThrow("repos[0].access");
  expect(() => parsePerms({ env: ["BAD NAME"] })).toThrow("variable name");
  expect(() => parsePerms([])).toThrow("JSON object");
  expect(() => dockerArgs(parsePerms({ repos: [{ path: "/a/app" }, { path: "/b/app" }] }), host)).toThrow("both called app");
});

test("the box's page grants, changes and revokes a mount, and saves the set for the next start", async () => {
  const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { boxRoute } = await import("../sandbox/server.ts");
  const dir = mkdtempSync(`${tmpdir()}/box-`);
  mkdirSync(`${dir}/app`);
  writeFileSync(`${dir}/box.example.json`, JSON.stringify({ port: 4700, repos: [], env: [] }));
  const route = boxRoute(() => dir);
  const post = async (q: string) => (await route("POST", new URL(`http://office/__rb/box?${q}`)))!;
  const perms = (r: { body: unknown }) => (r.body as { perms: { repos: unknown[]; network: string; env: string[]; port: number } }).perms;

  expect(perms((await route("GET", new URL("http://office/__rb/box")))!).port).toBe(4700); // the example until there's a box.json
  expect((await post(`do=grant&path=${dir}/app&access=ro`)).status).toBe(200);
  expect((await post(`do=grant&path=${dir}/app&access=rw`)).body).toMatchObject({ perms: { repos: [{ path: `${dir}/app`, access: "rw" }] } }); // same folder: changed, not doubled
  expect(JSON.parse(readFileSync(`${dir}/box.json`, "utf8")).repos).toHaveLength(1);
  expect(perms(await post("do=network&value=offline")).network).toBe("offline");
  expect(perms(await post("do=env&value=GH_TOKEN")).env).toEqual(["GH_TOKEN"]);
  expect(perms(await post("do=env&value=GH_TOKEN&on=0")).env).toEqual([]);
  expect(perms(await post(`do=revoke&path=${dir}/app`)).repos).toEqual([]);

  // mistakes say what's wrong and leave the file alone
  expect((await post(`do=grant&path=${dir}/nope&access=rw`)).body).toMatchObject({ error: expect.stringContaining("isn't a folder") });
  expect((await post("do=grant&path=app&access=rw")).status).toBe(400);
  expect((await post("do=grant&path=/&access=all")).status).toBe(400);
  expect((await post("do=port&value=99999")).status).toBe(400);
  expect(await route("GET", new URL("http://office/__rb/other"))).toBeNull();
});
