import { afterAll, beforeAll, expect, test } from "bun:test";
import { STORE_SHELL_UA, UPDATE_CLOSE, Update, appStoreUrl, clientVersion, inStoreShell, pv, tooOld, updateNotice } from "../src/protocol.ts";

class Sock {
  sent: string[] = []; closed: [number, string] | null = null;
  accept() {}
  send(s: string) { this.sent.push(s); }
  close(code: number, reason: string) { this.closed = [code, reason]; }
}
let last: FakePair;
class FakePair { 0 = new Sock(); 1 = new Sock(); constructor() { last = this; } }
let real: unknown;
beforeAll(() => { real = (globalThis as any).WebSocketPair; (globalThis as any).WebSocketPair = FakePair; });
afterAll(() => { (globalThis as any).WebSocketPair = real; });

const floor = { min: 2, store: "https://store.example/app" };
const at = (q: string) => new URL(`https://x.test/ws?${q}`);

test("a client's version is its pv; none, or junk, is 0", () => {
  expect([clientVersion(at("pv=3")), clientVersion(at("")), clientVersion(at("pv=abc")), clientVersion(at("pv=-1"))]).toEqual([3, 0, 0, 0]);
});

test("a client at or above the floor is served; an old build gets the update reply", async () => {
  expect(tooOld(at("pv=2"), floor)).toBeNull();
  expect(tooOld(at("pv=9"), floor)).toBeNull();
  for (const q of ["pv=1", ""]) {
    const old = tooOld(at(q), floor)!;
    const res = old.http();
    expect(res.status).toBe(426);
    expect(Update(await res.json())).toEqual({ update: 2, store: floor.store });
  }
});

test("an old socket is accepted, told, and closed with the update code", () => {
  const res = tooOld(at("pv=1"), floor)!.socket();
  expect(res.status).toBe(101);
  expect(last[1].sent.map((m) => JSON.parse(m))).toEqual([{ update: 2, store: floor.store }]);
  expect(last[1].closed).toEqual([UPDATE_CLOSE, "update"]);
});

test("a client's query carries its version, and the store link and notice read the same everywhere", () => {
  expect(clientVersion(new URL(`https://x/ws?${new URLSearchParams(pv(3))}`))).toBe(3);
  expect(appStoreUrl(123)).toBe("https://apps.apple.com/app/id123");
  expect(updateNotice("https://s")).toBe("Update to keep playing: https://s");
});

test("a page knows it runs in the store shell from the user-agent token", () => {
  const chrome = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
  expect(inStoreShell(chrome)).toBe(false);
  expect(inStoreShell(`${chrome} ${STORE_SHELL_UA}/1.2.0`)).toBe(true);
  expect(inStoreShell(`${chrome} ${STORE_SHELL_UA}`)).toBe(true);
  expect(inStoreShell(`${chrome} Not${STORE_SHELL_UA}/1`)).toBe(false);
  expect(inStoreShell("")).toBe(false);
});
