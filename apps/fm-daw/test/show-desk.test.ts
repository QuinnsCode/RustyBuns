// The show desk's journey (#6474), in headless Chrome with the real bridge: a MIDI fader, learned on the desk, and an
// OSC message off the network both move the same lamp in the room, and what the desk sets leaves as Art-Net. Then
// obs-websocket v5 against a stand-in OBS: signed in with the password, its scenes listed, one switched.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";
import { showBridge } from "../scripts/show-bridge.ts";
import { parseArtDmx } from "../src/control/dmx.ts";
import { obsAuth } from "../src/control/obs.ts";
import { encodeOsc } from "../src/control/osc.ts";

setDefaultTimeout(240_000); // a jam room in software GL on CI's runners
/** Wait for something on this side of the page: a packet, a request. */
async function came(ok: () => boolean, what: string) {
  for (const end = Date.now() + 15_000; !ok(); await Bun.sleep(50)) if (Date.now() > end) throw new Error(`never came: ${what}`);
}
useBrowser("--autoplay-policy=no-user-gesture-required");

test("the bridge lets in the studio's pages and no other site's, whatever name the site gives itself", async () => {
  const bridge = await showBridge({ port: 0, oscIn: 0 });
  const as = async (origin: string, host?: string) => (await fetch(bridge.url.replace("ws:", "http:"), { headers: { origin, ...(host ? { host } : {}) } })).status;
  try {
    expect(await as("http://localhost:5173")).toBe(200);
    expect(await as("https://fm-daw.notryanquinn.workers.dev")).toBe(200);
    expect(await as("https://evil.example")).toBe(403);
    expect(await as("http://evil.example:5392", "evil.example:5392")).toBe(403);
  } finally { bridge.stop(); }
});

test.skipIf(!hasChrome)("a MIDI fader and an OSC message move the same room light, out to Art-Net too; OBS switches scene", async () => {
  // the lights: a UDP socket standing in for an Art-Net node
  const frames: Uint8Array[] = [];
  const node = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: { data(_, p) { const a = parseArtDmx(p); if (a) frames.push(a.data); } } });
  const bridge = await showBridge({ port: 0, oscIn: 0, artnet: [{ host: "127.0.0.1", port: node.port }] });
  const asked: string[] = [];
  const obs = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req, { data: undefined, headers: { "Sec-WebSocket-Protocol": "obswebsocket.json" } }) ? undefined : new Response("no")),
    websocket: {
      open(ws) { ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1, authentication: { challenge: "c", salt: "s" } } })); },
      async message(ws, raw) {
        const m = JSON.parse(String(raw)) as { op: number; d: { authentication?: string; requestType: string; requestId: string; requestData?: { sceneName: string } } };
        if (m.op === 1) return m.d.authentication === (await obsAuth("pw", "s", "c")) ? void ws.send(`{"op":2,"d":{"negotiatedRpcVersion":1}}`) : ws.close(4009);
        asked.push(`${m.d.requestType} ${m.d.requestData?.sceneName ?? ""}`.trim());
        ws.send(JSON.stringify({ op: 7, d: { requestType: m.d.requestType, requestId: m.d.requestId, requestStatus: { result: true, code: 100 }, ...(m.d.requestType === "GetSceneList" ? { responseData: { currentProgramSceneName: "Desk", scenes: [{ sceneName: "Room" }, { sceneName: "Desk" }] } } : {}) } }));
      },
    },
  });
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  const osc = await Bun.udpSocket({});
  try {
    await load(chrome.cdp, tab, `${vite.url}jam.html?room=show-desk&studio=live-room&quality=low`, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    await pageUntil(tab, "!!window.qjam && !!window.qjam.state().me.wearing", "the room", 60_000);
    type Can = { name: string; level: number; color: string; aim: [number, number] };
    const head = () => page<Can>("qjam.show().state().fixtures[0]");
    const built = await head();
    expect(built).toMatchObject({ name: "Can 1", level: 1 });
    expect(await page<boolean>(`qjam.show().connectBridge(${JSON.stringify(bridge.url)})`)).toBe(true);

    // learn a fader: arm the lamp's dimmer, move the fader once, then it drives it
    await page(`qjam.show().learn("light.1.dimmer")`);
    await page(`qjam.show().midi("Fader box", [0xb0, 7, 1])`);
    await page(`qjam.show().midi("Fader box", [0xb0, 7, 64])`);
    expect((await head()).level).toBeCloseTo(128 / 255, 2);
    await came(() => frames.at(-1)?.[0] === 129, "the MIDI fader's level on Art-Net");

    // the same lamp over OSC, off the network
    osc.send(encodeOsc({ address: "/qollab/light/1/dimmer", args: [0.2] }), bridge.oscPort, "127.0.0.1");
    await pageUntil(tab, "Math.abs(qjam.show().state().fixtures[0].level - 0.2) < 0.01", "the OSC message", 30_000);
    await came(() => frames.at(-1)?.[0] === 51, "the OSC level on Art-Net");

    // the desk's own scenes, and letting the room's lights go back as they were built
    await page(`qjam.show().drive("scene.blackout")`);
    expect((await head()).level).toBe(0);
    await page(`qjam.show().drive("light.1.red", 0)`);
    await page(`qjam.show().drive("light.1.pan", 1)`);
    const moved = await head();
    expect(moved.color).not.toBe(built.color);
    expect(moved.aim[0]).toBeGreaterThan(built.aim[0] + 1);
    await page(`qjam.show().drive("scene.release")`);
    expect(await head()).toEqual(built);

    // OBS
    expect(await page<string>(`qjam.show().obsConnect("ws://127.0.0.1:${obs.port}", "nope")`)).toBe("OBS didn't take that password");
    expect(await page<string>(`qjam.show().obsConnect("ws://127.0.0.1:${obs.port}", "pw")`)).toBe("OBS connected");
    await pageUntil(tab, `qjam.show().state().obs?.scenes.length === 2`, "OBS's scenes", 30_000);
    await page(`qjam.show().drive("obs.scene.Room")`);
    await came(() => asked.includes("SetCurrentProgramScene Room"), "the scene switch");
  } finally {
    await tab.close();
    osc.close();
    node.close();
    bridge.stop();
    void obs.stop(true);
  }
});
