// The guitar line's pure half (src/guitar.ts): Opus set for a guitar, the lag in words, which track a guitar goes into.
// The World passing a call's setup is in world.test.ts; the call itself, sound and all, is scripts/guitar-check.ts.
import { expect, test } from "bun:test";
import { feel, guitarSettings, guitarTrack, lagMs, tuneOpus, type Feel } from "../src/guitar.ts";
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
