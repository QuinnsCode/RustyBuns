import { test, expect } from "bun:test";
import { wireVersion } from "../src/client.ts";

test("wireVersion: the guest version this page's host checks, undefined when the check is off", async () => {
  let version: string | null = "1.2.0+abc123";
  const s = Bun.serve({ port: 0, fetch: () => Response.json({ version: "1.2.0+abc123", guests: { open: false, connected: 0, max: 2, version } }) });
  try {
    expect(await wireVersion(`${s.url}__rb/info`)).toBe("1.2.0+abc123");
    version = null;
    expect(await wireVersion(`${s.url}__rb/info`)).toBeUndefined();
  } finally { s.stop(true); }
});

test("wireVersion: a failed info request throws instead of sending no version", async () => {
  const s = Bun.serve({ port: 0, fetch: () => new Response("no", { status: 401 }) });
  try { await expect(wireVersion(`${s.url}__rb/info`)).rejects.toThrow("401"); }
  finally { s.stop(true); }
});
