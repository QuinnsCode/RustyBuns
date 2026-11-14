import { expect, test } from "bun:test";
import { PORTS, portArg } from "../src/ports.ts";

test("no two services share a port", () => {
  const seen = new Map<number, string>();
  for (const [name, port] of Object.entries(PORTS)) {
    expect(`${name}: ${port}`).toBe(`${name}: ${seen.has(port) ? `taken by ${seen.get(port)}` : port}`);
    seen.set(port, name);
  }
});

test("--port takes a number or a name, and falls back to the service's own", () => {
  expect([portArg("5000", "manual"), portArg("cmsMythic", "manual"), portArg(undefined, "manual"), portArg("toString", "manual")])
    .toEqual([5000, PORTS.cmsMythic, PORTS.manual, PORTS.manual]);
});
