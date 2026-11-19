// The guitar line's pure half (src/guitar.ts): Opus set for a guitar, the lag in words, which track a guitar goes into.
// The World passing a call's setup is in world.test.ts; the call itself, sound and all, is scripts/guitar-check.ts.
// The Worker handing a call its servers (a TURN relay pass, or STUN alone) is GET /ice.
import { expect, test } from "bun:test";
import { check } from "@rustybuns/util/guard";
import { capture, decodeRtcClient, feel, guitarSettings, guitarTrack, IceReply, inputAt, inputTrack, lagMs, lagWords, sendWet, STUN, tuneOpus, type Feel } from "../src/guitar.ts";
import worker, { ICE_TTL_S } from "../src/worker.ts";
import { TrackAmp } from "../src/amp/track-amp.ts";
import { demoProject } from "../src/presets.ts";
import { apply } from "../src/project.ts";

const CHROME_OFFER = [
  "v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9", "a=mid:0", "a=sendonly",
  "a=rtpmap:111 opus/48000/2", "a=rtcp-fb:111 transport-cc", "a=fmtp:111 minptime=10;useinbandfec=1", "a=rtpmap:63 red/48000/2", "",
].join("\r\n");

test("Opus is set for a guitar: one channel at 128 kb/s, no silence suppression, the rest of the offer as it was", () => {
  for (const sdp of [CHROME_OFFER, CHROME_OFFER.replace("a=fmtp:111 minptime=10;useinbandfec=1\r\n", "")]) {
    const out = tuneOpus(sdp);
    const fmtp = /a=fmtp:111 (.*)\r\n/.exec(out)?.[1].split(";") ?? [];
    expect(fmtp).toEqual(expect.arrayContaining(["stereo=0", "maxaveragebitrate=128000", "useinbandfec=1", "usedtx=0"]));
    if (sdp.includes("minptime")) expect(fmtp).toContain("minptime=10");
    expect(out.replace(/a=fmtp:111 .*\r\n/, "")).toBe(sdp.replace(/a=fmtp:111 .*\r\n/, ""));
  }
  expect(tuneOpus("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n")).toBe("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n");
});

test("the lag: half the round trip, the jitter buffer and the codec, and how playing together feels at it", () => {
  const rows: [Parameters<typeof lagMs>[0], number | null, Feel | null][] = [
    [{}, null, null],                                                 // still connecting
    [{ rtt: 8, jitterBuffer: 0 }, 29, "tight"],                       // across town
    [{ rtt: 30, jitterBuffer: 20 }, 60, "loose"],
    [{ rtt: 120, jitterBuffer: 40 }, 125, "late"],                    // across an ocean
  ];
  for (const [trip, ms, f] of rows) {
    expect(lagMs(trip)).toBe(ms);
    if (ms !== null) expect(feel(ms)).toBe(f!);
  }
  // past the budget the room says how to play together anyway; a loop late, the call's lag doesn't count
  expect(lagWords("Ben", 125)).toBe("Ben's guitar 125 ms behind, too far to play tight: C hears the band a loop late, in time");
  expect(lagWords("Ben", 125, "guitar", false)).toBe("Ben's guitar a loop late, in time");
});

test("a machine over its budget hears the heaviest friend's guitar as their amp's output, never its own", () => {
  const rows: [string, [number | "me", number][], number[], number | null][] = [
    ["under budget: every amp runs here", [["me", 0.1], [2, 0.15], [3, 0.2]], [], null],
    ["over: the heaviest dry friend", [["me", 0.3], [2, 0.15], [3, 0.2]], [], 3],
    ["still over with 3 wet: the next one", [["me", 0.3], [2, 0.15], [3, 0.1]], [3], 2],
    ["only your own left to run here: nobody", [["me", 0.6], [2, 0.01]], [2], null],
  ];
  for (const [why, loads, wet, pick] of rows) expect([why, sendWet(new Map(loads), new Set(wet))]).toEqual([why, pick]);
  // the ask goes through the World like the rest of a call's setup
  expect(decodeRtcClient({ t: "rtc", to: 1, line: "in", s: { k: "wet" } })?.s).toEqual({ k: "wet" });
});

test("a call's servers from GET /ice: Cloudflare's TURN pass when the key is set (no port 53), else STUN alone", async () => {
  const stub = { fetch: async () => new Response("") };
  const place = { idFromName: (n: string) => n, get: () => stub };
  const env: Parameters<typeof worker.fetch>[1] = { ASSETS: stub, WORLD: place, LOBBY: place, PROFILE: place };
  const ask = async (e: typeof env, ip: string) => {
    const r = await worker.fetch(new Request("https://fm-daw.test/ice", { headers: { "CF-Connecting-IP": ip } }), e);
    return { status: r.status, cache: r.headers.get("Cache-Control"), body: check(IceReply, await r.json().catch(() => null)) };
  };
  const real = globalThis.fetch;
  const asked: { url: string; auth: string | null; body: unknown }[] = [];
  let cloudflare = (): Response => Response.json({ iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u1", credential: "c1" },
  ] });
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), auth: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body)) });
    return cloudflare();
  }, { preconnect: real.preconnect });
  try {
    // no TURN key (the desktop, a local run): STUN, and nothing to keep, so the next call asks again
    expect(await ask(env, "1.1.1.1")).toEqual({ status: 200, cache: expect.stringContaining("no-store"), body: { iceServers: STUN, ttl: 0 } });
    expect(asked).toEqual([]);

    const keyed = { ...env, TURN_KEY_ID: "key1", TURN_KEY_API_TOKEN: "tok" };
    const got = await ask(keyed, "1.1.1.2");
    expect(asked).toEqual([{ url: "https://rtc.live.cloudflare.com/v1/turn/keys/key1/credentials/generate-ice-servers", auth: "Bearer tok", body: { ttl: ICE_TTL_S } }]);
    expect(got.body).toEqual({ ttl: ICE_TTL_S, iceServers: [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u1", credential: "c1" },
    ] });

    // Cloudflare down or answering nonsense: the call still gets STUN
    for (const down of [() => new Response("nope", { status: 503 }), () => Response.json({ iceServers: "x" })]) {
      cloudflare = down;
      expect((await ask(keyed, "1.1.1.3")).body).toEqual({ iceServers: STUN, ttl: 0 });
    }

    // one address asking over and over is turned away within the minute
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await ask(keyed, "9.9.9.9")).status);
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  } finally { globalThis.fetch = real; }
});

test("a guitar goes into the seat's track when it has an amp, else the first track with one, else straight in", () => {
  let p = demoProject();
  expect(guitarTrack(p, 2)).toBe(-1);                                 // no amps anywhere: heard dry
  expect(guitarSettings(undefined).bypass).toBe(true);
  const amp = TrackAmp({ amp: "lead", gain: 8 });
  p = apply(p, { t: "amp", track: 4, amp });
  expect(guitarTrack(p, 2)).toBe(4);
  expect(guitarTrack(p, -1)).toBe(4);
  p = apply(p, { t: "amp", track: 2, amp });
  expect(guitarTrack(p, 2)).toBe(2);
  expect(guitarSettings(p.tracks[2].amp)).toMatchObject({ amp: "lead", bypass: false, oversample: 2, pedal: null, knobs: { gain: 8, noise: 0 } });
});

test("in the vocal booth your input is the mic: straight in past every amp, its echo cancelled, said as a mic", () => {
  const p = apply(demoProject(), { t: "amp", track: 2, amp: TrackAmp({ amp: "lead" }) });
  for (const [seat, input, track, echo] of [["bass", "guitar", 2, false], [undefined, "guitar", 2, false], ["booth", "mic", -1, true]] as const) {
    const got = inputAt(seat);
    expect(got).toBe(input);
    expect(inputTrack(got, p, 2)).toBe(track);
    expect(capture(got)).toEqual({ echoCancellation: echo, noiseSuppression: false, autoGainControl: false, channelCount: 1 });
  }
  expect(lagWords("Amy", 20, "mic")).toBe("Amy's mic 20 ms behind, tight");
  expect(lagWords("Amy", null)).toBe("Amy's guitar: connecting");
});
