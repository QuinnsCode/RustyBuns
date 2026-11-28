// The jam room's social panel and what you hear by where you stand (#6551), in headless Chrome over CDP: someone on a
// phone and someone on a laptop in one gathering, signed out, joined through the real World (world-kit.ts, behind a
// socket here: plain vite has none). The phone opens the panel from its one symbol on the HUD,
// reads what needs sign-in, types a line (the letters walk nobody) and the laptop gets it. Then, with the walk-through's
// test set on the PA, walking off makes it quieter, and tuned in to the stage it stays at full level wherever they stand.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until } from "../../../scripts/chrome.ts";
import { fadeSlice } from "../src/studio/hear.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";
import { setup, useWorld, type Sock } from "./world-kit.ts";

setDefaultTimeout(240_000); // two jam rooms in software GL on CI's runners
useBrowser("--autoplay-policy=no-user-gesture-required");
useWorld();

/** The room's World behind a real socket: each page's /ws is sent here. */
let room: ReturnType<typeof setup> | null = null;
let joined: Promise<unknown> = Promise.resolve(), people = 0;
const bridge = Bun.serve<{ query: string; sock: Promise<Sock> | null }, never>({
  port: 0, hostname: "127.0.0.1",
  fetch: (req, server) => (server.upgrade(req, { data: { query: new URL(req.url).search.slice(1), sock: null } }) ? undefined : new Response("no", { status: 400 })),
  websocket: {
    open(ws) {
      // one join at a time: the newest socket the World holds is this one
      ws.data.sock = joined.then(async () => {
        const { join } = await (room ??= setup({}, "social-hear")), { ws: sock } = await join({ "X-User-Id": `u${++people}` }, "", ws.data.query);
        for (const m of sock.sent) ws.send(JSON.stringify(m));
        sock.send = (m: string) => void ws.send(m);
        return sock;
      });
      joined = ws.data.sock;
    },
    async message(ws, raw) { const sock = await ws.data.sock; if (sock && room) (await room).world.webSocketMessage(sock, typeof raw === "string" ? raw : new Uint8Array(raw).buffer); },
    async close(ws) { const sock = await ws.data.sock; if (sock && room) (await room).leave(sock); },
  },
});
afterAll(() => void bridge.stop(true));

type Social = { open: boolean; unread: number; lines: { mine: boolean; text: string }[] };
type Me = { x: number; z: number };

test.skipIf(!hasChrome)("chat from the one panel, then walk away from the stage and tune back in", async () => {
  const phone = await openTab(chrome.cdp, { w: 390, h: 844 }, true), laptop = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
  try {
    const url = `${vite.url}jam.html?room=social-hear&studio=desert-gathering&quality=low&walk=1`;
    const walkIn = async (tab: typeof phone) => {
      // nothing here looks at the picture, and two rooms drawing every frame in software GL held a page past a look's 60 s (#6638)
      await tab.call("Page.addScriptToEvaluateOnNewDocument", { source: "for (const f of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) WebGL2RenderingContext.prototype[f] = () => {};" });
      await tab.call("Page.addScriptToEvaluateOnNewDocument", { source: `{ const W = WebSocket; window.WebSocket = class extends W { constructor(u, p) { const url = new URL(u); if (url.pathname === "/ws") url.host = "127.0.0.1:${bridge.port}"; super(url, p); } }; }` });
      await load(chrome.cdp, tab, url, 0);
      await until(tab, "!!window.qjam && !!window.qjam.state().me.wearing && qjam.state().net === 'online'", "the room", 90_000);
      await tab.eval("(qjam.start(), true)");
    };
    await walkIn(phone);
    await walkIn(laptop);
    const page = <T>(tab: typeof phone, expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    const click = (tab: typeof phone, sel: string) => page(tab, `(document.querySelector(${JSON.stringify(sel)}).click(), true)`);

    // one symbol opens it; signed out it says what needs signing in, and the link is still there to copy
    await click(phone, "#social-open");
    expect(await page<string>(phone, "document.querySelector('#social .social-need').textContent")).toContain("link and chat work");
    const box = await page<{ left: number; right: number; bottom: number; link: number }>(phone,
      "(() => { const r = document.querySelector('#social').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, link: document.querySelector('#social-link').getBoundingClientRect().height }; })()");
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(390);
    expect(box.bottom).toBeLessThanOrEqual(844);
    expect(box.link).toBeGreaterThanOrEqual(44);

    // a line typed there: W is a letter, not a step
    await until(phone, "!document.querySelector('#social input').disabled", "the chat", 30_000);
    const before = await page<Me>(phone, "qjam.state().you");
    await page(phone, "(document.querySelector('#social input').focus(), true)");
    await phone.call("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyW", key: "w", text: "w" });
    await page(phone, "new Promise((r) => setTimeout(r, 400))");
    await phone.call("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyW", key: "w" });
    await phone.call("Input.insertText", { text: "ho there" });
    expect(await page<Me>(phone, "qjam.state().you")).toMatchObject({ x: before.x, z: before.z });
    await click(phone, "#social [aria-label=Send]");
    await until(laptop, "qjam.social().unread === 1", "the line on the laptop", 30_000);
    await click(laptop, "#social-open");
    expect((await page<Social>(laptop, "qjam.social()")).lines).toMatchObject([{ mine: false, text: "who there" }]);
    expect(await page<string>(laptop, "document.querySelector('#social .social-log').textContent")).toContain("who there");
    await click(phone, "#social header [aria-label=Close]");
    expect((await page<Social>(phone, "qjam.social()")).open).toBe(false);

    // the set as the laptop hears it, in dB against the floor in front of the stage
    const level = "10 * Math.log10(qjam.state().pa.heard.reduce((t, v) => t + 10 ** (v.db / 10), 0))";
    await click(laptop, "#social header [aria-label=Close]");
    await until(laptop, "qjam.state().audio && qjam.state().pa.heard?.[0]?.db !== undefined", "the PA", 60_000);
    await page(laptop, "(qjam.walkTo(1000, 1000), true)");
    await until(laptop, `${level} < -6`, "the set fading as you walk off", 30_000);
    await click(laptop, "#tune-in");
    await until(laptop, `Math.abs(${level}) < 0.5`, "tuned in at full level", 30_000);
    await page(laptop, "(qjam.walkTo(-1000, 1000), true)");
    await page(laptop, "new Promise((r) => setTimeout(r, 500))");
    expect(Math.abs(await page<number>(laptop, level))).toBeLessThan(0.5);
    await click(laptop, "#tune-in");
    await until(laptop, `${level} < -6`, "back to hearing it from where you stand", 30_000);
  } finally {
    await phone.close();
    await laptop.close();
  }
});

// the default way of listening, a loop late, has no panner: its slices are faded on their way to the speakers
test("a slice from someone far off is quieter, and the one Rec holds is untouched", () => {
  const pcm = new Float32Array([0.5, -0.5]), slice = { t: "sound", peer: 7, track: 1, at: 0, pcm } as const;
  expect(fadeSlice(slice, [1, 0], { x: 0, z: 0 })).toBe(slice);
  const far = fadeSlice(slice, [20, 0], { x: 0, z: 0 });
  expect(far.t === "sound" && far.pcm[0]).toBeLessThan(0.1);
  expect([...pcm]).toEqual([0.5, -0.5]);
});
