import { expect, test } from "bun:test";
import { dockerArgs, parsePerms } from "../sandbox/box.ts";

const joined = (a: string[]) => a.join(" ");

test("a permission set makes a locked-down box that mounts only what it lists", () => {
  const args = dockerArgs(parsePerms({ repos: [{ path: "/code/app", access: "rw" }, { path: "/code/docs" }], env: ["ANTHROPIC_API_KEY"] }));
  const text = joined(args);
  expect(text).toContain("-v /code/app:/home/office/projects/local/app:rw");
  expect(text).toContain("-v /code/docs:/home/office/projects/local/docs:ro"); // read-only unless asked otherwise
  expect(text).toContain("-p 127.0.0.1:4600:4600"); // the host's loopback, never the LAN
  expect(text).toContain("--cap-drop ALL");
  expect(args.filter((a) => a === "-v")).toHaveLength(3); // two repos and the home volume
  expect(text).toContain("-e ANTHROPIC_API_KEY"); // a name only: the value never shows on the command line
});

test("offline publishes nothing and cuts the network", () => {
  const text = joined(dockerArgs(parsePerms({ network: "offline" })));
  expect(text).toContain("--network none");
  expect(text).not.toContain("-p ");
});

test("a bad permission set says which field", () => {
  expect(() => parsePerms({ port: "nope" })).toThrow("isn't a port");
  expect(() => parsePerms({ memory: "lots" })).toThrow("512m or 4g");
  expect(() => parsePerms({ network: "lan" })).toThrow('"open" or "offline"');
  expect(() => parsePerms({ repos: [{ path: "/a", access: "all" }] })).toThrow("repos[0].access");
  expect(() => parsePerms({ env: ["BAD NAME"] })).toThrow("variable name");
  expect(() => parsePerms([])).toThrow("JSON object");
  expect(() => dockerArgs(parsePerms({ repos: [{ path: "/a/app" }, { path: "/b/app" }] }))).toThrow("both called app");
});
