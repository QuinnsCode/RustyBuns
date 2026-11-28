// The show desk's parsers and its control map (src/control/, #6474): DMX on the wire, OSC messages, obs-websocket v5,
// what the bridge and page say to each other, and a message from outside reaching a control.
import { describe, expect, test } from "bun:test";
import { artDmx, enttecFrame, litAt, parseArtDmx, sacnPacket, slot } from "../src/control/dmx.ts";
import { decodeOsc, encodeOsc, oscSignal, type OscMessage } from "../src/control/osc.ts";
import { identify, obsAuth, obsRequest, parseObs } from "../src/control/obs.ts";
import { readWire } from "../src/control/wire.ts";
import { controlMap, learnedMap, type Control } from "../src/control/map.ts";
import { midiSignal } from "../src/control/midi.ts";

describe("DMX", () => {
  const channels = Uint8Array.from([255, 10, 20, 30, 128, 64]);

  test("an Art-Net packet reads back as it was written", () => {
    const p = artDmx(0x0102, channels, 7);
    expect([...p.slice(0, 18)]).toEqual([...new TextEncoder().encode("Art-Net\0"), 0x00, 0x50, 0, 14, 7, 0, 0x02, 0x01, 0, 6]);
    expect(parseArtDmx(p)).toEqual({ universe: 0x0102, sequence: 7, data: channels });
  });

  test.each([
    ["cut short", artDmx(0, channels).slice(0, 21)],
    ["another opcode", Uint8Array.from(artDmx(0, channels), (b, i) => (i === 9 ? 0x20 : b))],
    ["not Art-Net", new Uint8Array(40)],
  ])("a packet %s isn't ArtDmx", (_, p) => expect(parseArtDmx(p)).toBeNull());

  test("an sACN packet carries its universe and channels where E1.31 puts them", () => {
    const p = sacnPacket(1, channels, 9, new Uint8Array(16).fill(0xab)), view = new DataView(p.buffer);
    expect(p.length).toBe(132);
    expect([view.getUint16(16), view.getUint16(38), view.getUint16(115)]).toEqual([0x7000 | 116, 0x7000 | 94, 0x7000 | 17]);
    expect([p[108], p[111], view.getUint16(113), view.getUint16(123), p[125]]).toEqual([100, 9, 1, 7, 0]);
    expect(p.slice(126)).toEqual(channels);
  });

  test("an Enttec dongle's frame holds at least 24 channels", () => {
    const f = enttecFrame(channels);
    expect([...f.slice(0, 5)]).toEqual([0x7e, 6, 25, 0, 0]);
    expect(f.slice(5, 11)).toEqual(channels);
    expect(f.length).toBe(30);
    expect(f.at(-1)).toBe(0xe7);
  });

  test("a fixture the desk hasn't touched is left alone", () => {
    const u = new Uint8Array(512);
    u[slot(1, "red")] = 200;
    expect(litAt(u, 0)).toBeNull();
    expect(litAt(u, 1)).toEqual({ dimmer: 0, red: 200, green: 0, blue: 0, pan: 0, tilt: 0 });
  });
});

describe("OSC", () => {
  test.each<[string, OscMessage]>([
    ["a float", { address: "/qollab/light/1/dimmer", args: [0.5] }],
    ["no value", { address: "/go", args: [] }],
    ["text, an int and a yes", { address: "/cue/1", args: ["house", { int: 3 }, true, false] }],
  ])("a message with %s reads back", (_, m) => {
    const p = encodeOsc(m);
    expect(p.length % 4).toBe(0);
    expect(decodeOsc(p)).toEqual([m]);
  });

  test("a bundle gives each of its messages", () => {
    const parts = [encodeOsc({ address: "/a", args: [1] }), encodeOsc({ address: "/b", args: [] })];
    const bundle = [...new TextEncoder().encode("#bundle\0"), 0, 0, 0, 0, 0, 0, 0, 1, ...parts.flatMap((p) => [0, 0, 0, p.length, ...p])];
    expect(decodeOsc(Uint8Array.from(bundle)).map((m) => m.address)).toEqual(["/a", "/b"]);
  });

  test.each([
    ["not an address", new TextEncoder().encode("hello\0\0\0")],
    ["cut short", encodeOsc({ address: "/a", args: [0.5] }).slice(0, 9)],
    ["a type it can't read", new TextEncoder().encode("/a\0\0,m\0\0abcd")],
  ])("%s gives nothing", (_, p) => expect(decodeOsc(p)).toEqual([]));

  test("a /qollab/ address names its control; any other is a key to learn", () => {
    expect(oscSignal({ address: "/qollab/scene/warm", args: [] })).toMatchObject({ to: "scene.warm", value: 1, down: true, momentary: true });
    expect(oscSignal({ address: "/1/fader1", args: [{ int: 0 }] })).toEqual({ source: "osc", key: "/1/fader1", value: 0, down: false, momentary: false });
  });
});

describe("obs-websocket v5", () => {
  test("the password answers the challenge as OBS does it", async () => {
    // base64(sha256(base64(sha256(password + salt)) + challenge)), worked out apart from this code
    const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("base64");
    const want = sha(sha("pw" + "salt") + "challenge");
    expect(await obsAuth("pw", "salt", "challenge")).toBe(want);
    expect(JSON.parse(await identify({ rpcVersion: 1, authentication: { challenge: "challenge", salt: "salt" } }, "pw"))).toEqual({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 4, authentication: want } });
    expect(JSON.parse(await identify({ rpcVersion: 1 }, ""))).toEqual({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 4 } });
  });

  test("a request", () => {
    expect(JSON.parse(obsRequest("SetCurrentProgramScene", "3", { sceneName: "Room" }))).toEqual({ op: 6, d: { requestType: "SetCurrentProgramScene", requestId: "3", requestData: { sceneName: "Room" } } });
  });

  test.each<[object, string | undefined]>([
    [{ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1 } }, "hello"],
    [{ op: 2, d: { negotiatedRpcVersion: 1 } }, "identified"],
    [{ op: 5, d: { eventType: "CurrentProgramSceneChanged", eventIntent: 4 } }, "event"],
    [{ op: 7, d: { requestType: "ToggleRecord", requestId: "1", requestStatus: { result: true, code: 100 } } }, "response"],
  ])("reads %o", (m, want) => expect<string | undefined>(parseObs(JSON.stringify(m))?.op).toBe(want));

  test.each(["not json", `{"op":7,"d":{}}`, `{"d":1}`, `{"op":9,"d":{}}`])("drops %s", (text) => expect(parseObs(text)).toBeNull());
});

test("the bridge and page read only well-formed messages", () => {
  expect(readWire({ t: "dmx", data: [0, 255] })).toEqual({ t: "dmx", data: [0, 255] });
  expect(readWire({ t: "osc", address: "/a", args: [1, "b", { int: 2 }] })).toEqual({ t: "osc", address: "/a", args: [1, "b", { int: 2 }] });
  for (const wrong of [{ t: "dmx", data: [256] }, { t: "dmx", data: [] }, { t: "osc", address: "a", args: [] }, { t: "osc", address: "/a", args: [null] }]) expect(readWire(wrong)).toBeNull();
});

describe("the control map", () => {
  function desk() {
    const did: [string, number][] = [];
    const make = (id: string, kind: Control["kind"]): Control => ({ id, label: id, kind, drive: (v) => { did.push([id, v]); return null; } });
    const controls = [make("light.1.dimmer", "level"), make("scene.warm", "press")];
    return { did, map: controlMap(() => controls, learnedMap("test:map")) };
  }
  const cc = (v: number) => midiSignal("Desk", [0xb0, 7, v])!;

  test("learn a MIDI fader, and it drives the control it was paired with", () => {
    const { did, map } = desk();
    expect(map.handle(cc(127))).toBeNull();
    map.arm("light.1.dimmer");
    map.handle(cc(10));
    expect(map.armed()).toBeNull();
    map.handle(cc(127));
    expect(did).toEqual([["light.1.dimmer", 1]]);
  });

  test("a pad held presses once; an OSC message with no value presses every time", () => {
    const { did, map } = desk();
    map.arm("scene.warm");
    map.handle(cc(127));
    map.handle(cc(0));
    for (const v of [127, 127, 0, 127]) map.handle(cc(v));
    for (let i = 0; i < 2; i++) map.handle(oscSignal({ address: "/qollab/scene/warm", args: [] }));
    expect(did.length).toBe(4);
  });
});
