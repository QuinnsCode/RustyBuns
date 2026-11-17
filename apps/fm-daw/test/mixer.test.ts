// FM DAW's desk as a player uses it in the gear room: Q Spring cabled between the desk's aux-send-2 and aux-return-2,
// a guitar note on your channel sent to it and to Space on aux 1, and each reverb's tail coming back only on its
// return's fader (and the channel's mute stopping its sends too).
import { expect, test } from "bun:test";
import { deskFor, Mixer, RigReturn, SpaceReturn, UNITY, withChannel, withReturn, withSend, type Desk } from "../src/mixer.ts";
import { lead, listen, newRoom, plug } from "../src/room/room.ts";

const SR = 48000;

test("a send to a reverb return comes back on its fader", () => {
  // In the room: the desk's aux 2 out to Q Spring and back. Half cabled, the return says why it is silent.
  const r = newRoom();
  expect(lead(r, ["desk", "aux-send-2"])).toEqual({ ok: true });
  expect(plug(r, ["spring", "in"])).toEqual({ ok: true });
  expect(listen(r.studio.patch).returns).toMatchObject([{ aux: 2, whole: false, problems: ["nothing plugged into FM DAW desk's aux-return-2"] }]);
  expect(lead(r, ["spring", "out"])).toEqual({ ok: true });
  expect(plug(r, ["desk", "aux-return-2"])).toEqual({ ok: true });
  const [ret] = listen(r.studio.patch).returns;
  expect(ret).toMatchObject({ aux: 2, whole: true, chain: ["desk", "spring", "desk"], running: ["spring"], problems: [] });

  // The desk: your channel, Space on aux 1 and the spring on aux 2.
  const note = new Float32Array(128 * 560); // 1.5 s in whole blocks
  for (let i = 0; i < 4800; i++) note[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR) * (1 - i / 4800);
  /** The desk's output for one note: its peak, and its loudest after the note has stopped (the reverb's tail). */
  const play = (d: Desk) => {
    const m = new Mixer(SR);
    m.setReturn(1, new SpaceReturn(SR));
    m.setReturn(2, new RigReturn(SR, ret.settings!));
    m.set(d);
    const out = new Float32Array(note.length * 2), block = 128, buf = new Float32Array(block * 2), ins = new Map<string, Float32Array>();
    for (let at = 0; at < note.length; at += block) {
      ins.set("you", note.subarray(at, at + block));
      m.process(ins, buf, block);
      out.set(buf, at * 2);
    }
    const tail = out.subarray(9600 * 2);
    return { peak: Math.max(...out.map(Math.abs)), tail: Math.max(...tail.map(Math.abs)) };
  };

  const dry = deskFor([{ id: "you", name: "You: guitar", source: "player" }]);
  expect(dry.returns.map((x) => [x.aux, x.fx, x.fader])).toEqual([[1, "space", UNITY], [2, "cabled", UNITY]]);
  const base = play(dry);
  expect(base.peak).toBeGreaterThan(0.3);
  expect(base.tail).toBeLessThan(1e-4); // no sends: the note stops, nothing rings

  for (const aux of [1, 2]) {
    const sent = withSend(dry, "you", aux, 1);
    const wet = play(sent);
    expect(wet.tail).toBeGreaterThan(0.005); // it rings after the note, on the return
    expect(play(withReturn(sent, aux, { fader: 0 })).tail).toBeLessThan(1e-4); // the return's fader down: gone
    expect(play(withReturn(sent, aux, { fader: 1 })).tail).toBeGreaterThan(wet.tail * 1.5); // up to +6 dB: louder
    expect(play(withReturn(sent, aux, { mute: true })).tail).toBeLessThan(1e-4);
    expect(play(withChannel(sent, "you", { mute: true })).peak).toBeLessThan(1e-6); // a muted channel sends nothing either
  }
});
