import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@rustybuns/shell-bun";
import { desktop, pairCode, pairLink, plan, quickTunnelUrl, tailnetHost } from "../scripts/phone.ts";
import { qr, qrSvg, qrText } from "../src/qr.ts";

const shells: { stop(): Promise<void> }[] = [];
afterAll(async () => { for (const s of shells) await s.stop(); });

test("Tailscale is the default; a Cloudflare quick tunnel has to be asked for as public", () => {
  expect(plan([])).toEqual({ via: "tailscale", off: false });
  expect(plan(["--off"])).toEqual({ via: "tailscale", off: true });
  expect(() => plan(["--cloudflare"])).toThrow("--public");
  expect(plan(["--cloudflare", "--public"])).toEqual({ via: "cloudflare", tunnel: undefined, hostname: undefined });
  expect(plan(["--cloudflare", "--tunnel", "cs", "--hostname", "cs.example.com"])).toEqual({ via: "cloudflare", tunnel: "cs", hostname: "cs.example.com" });
  expect(() => plan(["--cloudflare", "--tunnel", "cs"])).toThrow("go together");
});

test("addresses: the tailnet name, the quick tunnel's, and the link the phone opens", () => {
  expect(tailnetHost({ Self: { DNSName: "mac.tail1234.ts.net." } })).toBe("mac.tail1234.ts.net");
  expect(tailnetHost({})).toBeUndefined();
  expect(quickTunnelUrl("INF |  https://calm-otter-42.trycloudflare.com  |")).toBe("https://calm-otter-42.trycloudflare.com");
  expect(pairLink("https://mac.tail1234.ts.net/", "abc")).toBe("https://mac.tail1234.ts.net/?rb_launch=abc");
});

test("the desktop's file finds it, and a file left behind by a stopped one doesn't", () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-phone-"));
  const file = join(dir, "desktop.json");
  expect(() => desktop(file)).toThrow("isn't running");
  writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:1", token: "t", pid: 2 ** 22 + 7 }));
  expect(() => desktop(file)).toThrow("left its file behind");
  writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:1", token: "t", pid: process.pid }));
  expect(desktop(file).token).toBe("t");
});

test("a pairing code comes from the desktop's shell, and trades for its cookie once", async () => {
  const token = "launch-token-for-the-test";
  const shell = serve({ port: 0, token });
  shells.push(shell);
  shell.mount({ fetch: () => new Response("app") } as never, {});
  const code = await pairCode({ url: shell.url, token, pid: process.pid });
  const first = await fetch(`${shell.url}/?rb_launch=${code}`, { redirect: "manual" });
  expect(first.headers.get("set-cookie")).toContain(token);
  expect((await fetch(`${shell.url}/?rb_launch=${code}`, { redirect: "manual" })).status).toBe(403);
  await expect(pairCode({ url: shell.url, token: "wrong", pid: process.pid })).rejects.toThrow("403");
});

test("the QR code: finder patterns in three corners, and the SVG and terminal forms of it", () => {
  const m = qr(pairLink("https://mac.tail1234.ts.net", "x".repeat(43)));
  const n = m.length;
  expect((n - 17) % 4).toBe(0);
  for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    expect(m[y]!.slice(x, x + 7)).toEqual([true, true, true, true, true, true, true]);
    expect(m[y + 1]!.slice(x, x + 7)).toEqual([true, false, false, false, false, false, true]);
  }
  expect(qr("hi").length).toBe(21);
  expect(qrSvg("hi")).toStartWith("<svg");
  expect(qrText("hi").split("\n")).toHaveLength(13);
});
