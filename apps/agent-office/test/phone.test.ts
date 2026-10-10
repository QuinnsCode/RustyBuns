import { expect, test } from "bun:test";
import { liteUrl, plan, quickTunnelUrl, tailnetHost } from "../scripts/phone.ts";

test("Tailscale is the default, on the office's port", () => {
  expect(plan([])).toEqual({ via: "tailscale", port: 4600, off: false });
  expect(plan(["--port", "4700", "--off"])).toEqual({ via: "tailscale", port: 4700, off: true });
  expect(() => plan(["--port", "nope"])).toThrow("isn't a port");
});

test("a Cloudflare quick tunnel has to be asked for as public", () => {
  expect(() => plan(["--cloudflare"])).toThrow("--public");
  expect(plan(["--cloudflare", "--public"])).toEqual({ via: "cloudflare", port: 4600, tunnel: undefined, hostname: undefined });
  expect(plan(["--cloudflare", "--tunnel", "office", "--hostname", "office.example.com"]))
    .toEqual({ via: "cloudflare", port: 4600, tunnel: "office", hostname: "office.example.com" });
  expect(() => plan(["--cloudflare", "--tunnel", "office"])).toThrow("go together");
  expect(() => plan(["--cloudflare", "--tunnel", "--hostname", "x"])).toThrow("--tunnel needs a value");
});

test("the phone link is the office's 2D view", () => {
  expect(liteUrl("https://mac.tail1234.ts.net/")).toBe("https://mac.tail1234.ts.net/lite");
  expect(tailnetHost({ Self: { DNSName: "mac.tail1234.ts.net." } })).toBe("mac.tail1234.ts.net");
  expect(tailnetHost({})).toBeUndefined();
  expect(quickTunnelUrl("INF |  https://calm-otter-42.trycloudflare.com  |")).toBe("https://calm-otter-42.trycloudflare.com");
  expect(quickTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com...")).toBeUndefined();
});
