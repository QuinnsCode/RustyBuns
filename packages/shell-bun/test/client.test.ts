import { test, expect } from "bun:test";
import { wireVersion, resilientSocket } from "../src/client.ts";

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

test("resilientSocket: a server restart is reconnecting, then online again, and send says whether it went out", async () => {
  const mk = (port: number) => Bun.serve({ port, fetch: (r, srv) => (srv.upgrade(r) ? undefined : new Response("no", { status: 400 })), websocket: { message: (w, m) => w.send(`echo ${m}`), open: (w) => w.send("hi") } });
  let s = mk(0);
  const port = s.port;
  const seen: string[] = [], got: string[] = [];
  const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await Bun.sleep(25); expect(f()).toBe(true); };
  const sock = resilientSocket(() => new WebSocket(`ws://127.0.0.1:${port}`), { onMessage: (d) => got.push(String(d)), onState: (st) => { if (seen.at(-1) !== st) seen.push(st); } }, { delay: () => 50 });
  try {
    expect(sock.send("early")).toBe(false);
    await until(() => sock.state === "online");
    expect(sock.send("a")).toBe(true);
    await until(() => got.includes("echo a"));
    s.stop(true);
    await until(() => sock.state === "reconnecting");
    expect(sock.send("lost")).toBe(false);
    s = mk(port);
    await until(() => sock.state === "online");
    expect(seen).toEqual(["connecting", "online", "reconnecting", "online"]);
    expect(got.filter((m) => m === "hi")).toHaveLength(2);
  } finally { sock.close(); s.stop(true); }
});
