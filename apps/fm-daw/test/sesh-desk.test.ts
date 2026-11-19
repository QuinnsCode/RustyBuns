// The sesh's desk beyond its tracks, as a band uses it. In the gear room someone cables Q Spring between the desk's
// aux-send-2 and aux-return-2, and the room goes into the sesh's World step by step. A guitarist plugs in and plays one
// note on the live line. On FM DAW's page (a loop late, its own audio thread) the note is on that player's channel:
// whoever mixes sends it to aux 2, and the spring's tail comes back only on the aux 2 return's fader. A track's send
// to aux 2 comes back the same way in the bounce.
import { expect, test } from "bun:test";
import { b64url } from "@rustybuns/util/bytes";
import { SR, processor, run, useWorklet } from "./worklet-kit.ts";
import { deskOps, playerId, seshDesk, trackId, withChannel, withReturn, withSend, type Desk } from "../src/mixer.ts";
import { auxGear, lead, newRoom, plug } from "../src/room/room.ts";
import { applyStudio, decodeStudioClient, emptyStudio, patchOps } from "../src/studio.ts";
import { apply, decodeOp, decodeServer, sanitize, type Live, type Project } from "../src/project.ts";
import { opNeeds } from "../src/grants.ts";
import { demoProject } from "../src/presets.ts";
import { Band } from "../src/studio/band.ts";
import { FarSound } from "../src/studio/plugin-line.ts";
import { DeskFeed, loadMsg } from "../src/ui/load.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { renderProject } from "../src/engine/offline.ts";
import { P } from "../src/engine/params.ts";
import { TAKE_RATE } from "../src/take.ts";

useWorklet();

const BPM = 120, LOOP = 8, START = 1000, PEER = 7, WHO = "0a1b2c3d4e5f", SLICE = 2400;
const PLAYERS = [{ who: WHO, name: "Mo" }];

/** The sesh's gear room with Q Spring on aux 2, as the World holds it after the room's steps came over the wire. */
function gearRoom() {
  const r = newRoom();
  for (const a of [lead(r, ["desk", "aux-send-2"]), plug(r, ["spring", "in"]), lead(r, ["spring", "out"]), plug(r, ["desk", "aux-return-2"])]) expect(a).toEqual({ ok: true });
  const world = patchOps(r.studio.patch).reduce((s, step) => {
    const m = decodeStudioClient(JSON.parse(JSON.stringify({ t: "studio", op: step })));
    if (!m) throw new Error(`the World turned ${step.t} away`);
    return applyStudio(s, PEER, m.op);
  }, emptyStudio());
  expect(world.patch).toEqual(r.studio.patch);
  expect(world.held).toEqual({});
  return world.patch;
}

/** The groove with every track silent, so all that sounds is the player. */
const quiet = (): Project => { const p = demoProject(); return { ...p, space: 0, tracks: p.tracks.map((t) => ({ ...t, notes: [], auto: [] })) }; };
/** Move the desk as a hand on the Mixer tab does, and the project its edits (off the wire) leave. */
const mix = (p: Project, move: (d: Desk) => Desk) => deskOps(p, move(seshDesk(p, PLAYERS))).reduce((q, e) => apply(q, decodeOp(JSON.parse(JSON.stringify(e)))!), p);

/** The guitarist's note on the live line: plugged straight in, then a tenth of a second of 220 Hz in slices on the beat. */
function played(): Live[] {
  const out: Live[] = [{ t: "guitar", track: -1 }];
  for (let k = 0; k < 4; k++) {
    const pcm = Int16Array.from({ length: SLICE }, (_, i) => { const n = k * SLICE + i; return n < SLICE ? Math.round(16000 * Math.sin((2 * Math.PI * 220 * n) / TAKE_RATE) * (1 - n / SLICE)) : 0; });
    out.push(Band.slice(-1, START + (k * SLICE * BPM) / 60 / TAKE_RATE, pcm, b64url));
  }
  return out;
}

/** FM DAW's page a loop behind the player, in this sesh: the note's peak, and the loudest after it stopped (a reverb's tail). */
async function page(project: Project, patch: ReturnType<typeof gearRoom>) {
  const { p, say } = processor();
  say(loadMsg({ ...project, bpm: BPM, bars: LOOP / 4 }));
  say({ t: "master", gain: 1 });
  say({ t: "grid", ctx: 0, beat: START + LOOP });
  const band = new Band(() => ({ bpm: BPM, loopBeats: LOOP }), () => 1e12);
  band.leading(true);
  const far = new FarSound(band, say), feed = new DeskFeed(say);
  for (const e of played()) {
    const m = decodeServer({ t: "live", from: PEER, e });
    if (m?.t !== "live" || !far.heard(PEER, m.e)) throw new Error(`the live line turned ${e.t} away`);
  }
  expect(far.players()).toEqual([PEER]);
  feed.sync(project, far.players().map((peer) => ({ peer, who: WHO, name: "Mo" })), auxGear(patch).settings);
  const out = await run(p, 1.4);
  const abs = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  return { peak: abs(out.subarray(0, SR * 0.2)), tail: abs(out.subarray(SR * 0.3)) };
}

test("a player's channel sent to the aux 2 return comes back on its fader", async () => {
  const patch = gearRoom();
  expect(auxGear(patch)).toMatchObject({ label: "Q Spring" });
  const p0 = quiet(), id = playerId(WHO);
  expect(seshDesk(p0, PLAYERS).channels.at(-1)).toMatchObject({ id, name: "Mo", source: "player" });

  const dry = await page(p0, patch);
  expect(dry.peak).toBeGreaterThan(0.2);   // the note, on their channel at 0 dB
  expect(dry.tail).toBeLessThan(1e-4);     // nothing sent: nothing rings

  // the mix is the sesh's: one edit, which needs the mix grant, and a saved project keeps it
  const [edit] = deskOps(p0, withSend(seshDesk(p0, PLAYERS), id, 2, 1));
  expect(edit).toMatchObject({ t: "desk", player: { id, sends: [0, 1] } });
  expect(opNeeds(edit)).toBe("mix");
  const sent = mix(p0, (d) => withSend(d, id, 2, 1));
  expect(sanitize(JSON.parse(JSON.stringify(sent)))?.desk).toEqual(sent.desk);

  const wet = await page(sent, patch);
  expect(wet.tail).toBeGreaterThan(0.001);                                                                // the spring rings on
  expect((await page(mix(sent, (d) => withReturn(d, 2, { fader: 0 })), patch)).tail).toBeLessThan(1e-4);    // the return down: gone
  expect((await page(mix(sent, (d) => withReturn(d, 2, { fader: 1 })), patch)).tail).toBeGreaterThan(wet.tail * 1.3); // up: louder
  expect((await page(mix(sent, (d) => withReturn(d, 2, { mute: true })), patch)).tail).toBeLessThan(1e-4);
  expect((await page(sent, { ...patch, cables: [] })).tail).toBeLessThan(1e-4);                             // the spring unplugged: silent

  // their fader, their mute, and a solo on a track (which leaves only the soloed strips)
  expect((await page(mix(sent, (d) => withChannel(d, id, { fader: 0.5 })), patch)).peak).toBeLessThan(wet.peak * 0.4);
  expect((await page(mix(sent, (d) => withChannel(d, id, { mute: true })), patch)).peak).toBeLessThan(1e-4);
  expect((await page(mix(sent, (d) => withChannel(d, trackId(0), { solo: true })), patch)).peak).toBeLessThan(1e-4);

  // back to a new channel, the sesh keeps nothing for them
  expect(mix(sent, (d) => withSend(d, id, 2, 0)).desk).toBeUndefined();
});

test("a track's send to aux 2 comes back through the cabled gear in the bounce", () => {
  const patch = gearRoom(), p0 = quiet(), clap = p0.tracks.findIndex((t) => t.name === "Clap");
  const one: Project = { ...p0, tracks: p0.tracks.map((t, i) => (i === clap ? { ...t, notes: [{ s: 0, l: 0.25, m: t.root, v: 1 }] } : t)) };
  const bounce = (p: Project, gear = auxGear(patch).settings) => renderProject(new TsEngine(SR), p, SR, 2, 1, undefined, gear);
  /** What the aux 2 return adds to the bounce: the most any sample moves from the same groove with nothing cabled in. */
  const back = (p: Project) => { const dry = bounce(p, null); return bounce(p).reduce((m, x, i) => Math.max(m, Math.abs(x - dry[i])), 0); };
  expect(bounce(one, null).reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeGreaterThan(0.02); // the clap itself
  expect(back(one)).toBe(0);                                                                     // nothing sent: the gear adds nothing
  const sent = mix(one, (d) => withSend(d, trackId(clap), 2, 1));
  expect(sent.tracks[clap].params[P.SEND2]).toBe(1);
  const wet = back(sent);
  expect(wet).toBeGreaterThan(0.002);
  expect(back(mix(sent, (d) => withReturn(d, 2, { fader: 1 })))).toBeGreaterThan(wet * 1.3);      // the return up: more of it
  expect(back(mix(sent, (d) => withReturn(d, 2, { mute: true })))).toBe(0);
});
