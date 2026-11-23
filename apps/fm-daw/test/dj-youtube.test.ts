// A YouTube link onto a deck (src/dj/youtube.ts): the links people paste from the address bar, Share and the app all
// give the video, and the deck's channel sets the player's volume (the player itself is in YouTube's frame, so the
// page test can't hear it; `qdecks.tube` drives it in a browser with the network).
import { expect, test } from "bun:test";
import { tubeVolume, videoId } from "../src/dj/youtube.ts";
import type { ChannelState } from "../src/dj/mixer.ts";

test("the links people paste give the video; anything else is refused", () => {
  const id = "M7lc1UVf-VE";
  const pasted: [string, string | null][] = [
    [`https://www.youtube.com/watch?v=${id}`, id],
    [`https://www.youtube.com/watch?v=${id}&list=PL123&t=42s`, id],
    [`https://youtu.be/${id}?si=abc`, id],
    [`youtube.com/watch?v=${id}`, id],
    [`https://m.youtube.com/watch?v=${id}`, id],
    [`https://music.youtube.com/watch?v=${id}`, id],
    [`https://www.youtube.com/shorts/${id}`, id],
    [`https://www.youtube.com/live/${id}?feature=share`, id],
    [`https://www.youtube.com/embed/${id}`, id],
    [`  ${id}  `, id],
    ["https://vimeo.com/123456", null],
    ["https://www.youtube.com/@somechannel", null],
    ["not a link", null],
  ];
  expect(pasted.map(([p]) => videoId(p))).toEqual(pasted.map(([, want]) => want));
});

test("the deck's channel sets the video's volume: full at the defaults, down with the fader, out on the crossfader", () => {
  const ch = (o: Partial<ChannelState> = {}): ChannelState => ({ trim: 0, high: 0, hiMid: 0, loMid: 0, low: 0, send1: 0, send2: 0, fader: 0.8, filter: 0, cue: false, xf: "x", ...o });
  expect([
    tubeVolume(ch(), 0, "smooth", 0.8),
    tubeVolume(ch({ fader: 0.4 }), 0, "smooth", 0.8),
    tubeVolume(ch({ fader: 0 }), 0, "smooth", 0.8),
    tubeVolume(ch(), 1, "smooth", 0.8),
    tubeVolume(ch({ xf: "off" }), 1, "smooth", 0.8),
    tubeVolume(ch({ fader: 1, trim: 1 }), 0, "smooth", 1),
  ]).toEqual([100, 25, 0, 0, 100, 100]);
});
