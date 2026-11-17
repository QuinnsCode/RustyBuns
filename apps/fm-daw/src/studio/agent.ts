// An agent in the jam room: the tools it plays with, one list for both doors. On the page they are WebMCP tools
// (and the Cmd/Ctrl+K palette's commands) that move the page's own player; from the CLI, scripts/studio-mcp.ts
// joins the sesh as its own player with an avatar and serves the same list over MCP. Either way the agent is a
// player in the sesh like a person, so the leader's grants (src/grants.ts) hold for it and the World checks them:
// without a grant its notes and edits go nowhere, and it raises its hand instead.
import { arr, check, int, num, obj, oneOf, opt, str, type Guard } from "@rustybuns/util/guard";
import type { Command } from "@rustybuns/util/commands";
import type { Avatar } from "@rustybuns/util/avatar";
import { apply, decodeServer, type ClientMsg, type Live, type Op, type Project } from "../project.ts";
import { decodeChatServer, type ChatClient } from "../chat.ts";
import { decodeGrantServer, may as granted, noGrants, type Can, type GrantClient, type Grants } from "../grants.ts";
import { RUNG, RUNGS, rungName, type Rung } from "../rewind.ts";
import type { FloorState } from "../ui/net.ts";
import { P } from "../engine/params.ts";
import { DRUM_KEYS, body, gone, hear, keyNote, newJam, sit, snapshot, spotOf, stand, trackFor, type Jam } from "./jam.ts";
import { MakeArgs, makeInstrument, roomWith } from "./instrument.ts";
import type { StudioDef } from "./room.ts";

/** Who may do what, as the sesh last said: the floor, the leader's grants and who this player is (its person id). */
export interface Rights { floor: FloorState | null; grants: Grants | null; me: string | null; asked: Can | null }

/** What a player lends the tools: its jam, the groove, its rights, and its wires into the sesh. */
export interface Player {
  jam: Jam;
  /** The room as built, before anything was made in it. */
  base: StudioDef;
  name: string;
  project(): Project | null;
  rights(): Rights;
  live(e: Live): void;
  /** An edit: sent to the World and applied here, as the page does with its own. */
  edit(op: Op): void;
  /** A raised hand: ask the leader for this. */
  ask(can: Can): void;
  /** The groove as it was `ago` minutes back, for this player alone (null: the sesh doesn't go back that far). */
  rewind(ago: Rung): Promise<{ at: number; project: Project | null } | null>;
  wait(ms: number): Promise<void>;
}

/** A player's look backs: `rewind` asks the sesh and waits up to 5 s for `answer`, the sesh's `rewound`. */
export function lookBack(send: (ago: Rung) => void) {
  type Got = { at: number; project: Project | null } | null;
  const looks = new Map<Rung, (v: Got) => void>();
  return {
    rewind: (ago: Rung) => new Promise<Got>((done) => {
      looks.get(ago)?.(null);
      looks.set(ago, done);
      send(ago);
      setTimeout(() => { if (looks.get(ago) === done) { looks.delete(ago); done(null); } }, 5000);
    }),
    answer: (ago: Rung, at: number, project: Project | null) => { const done = looks.get(ago); looks.delete(ago); done?.({ at, project }); },
  };
}

/** The room as the groove has it now: its made instruments are seats too. */
export const syncRoom = (pl: Pick<Player, "jam" | "base" | "project">) => { pl.jam.def = roomWith(pl.base, pl.project()); };

/** What this player may do, by the same rule the World checks. A sesh with no leader (the desktop): everything. */
export function may(pl: Pick<Player, "rights">): Record<Can, boolean> {
  const r = pl.rights();
  const one = (can: Can) => !r.floor || granted(r.grants ?? noGrants(), r.floor.state, r.me ?? undefined, r.floor.host, can);
  return { play: one("play"), edit: one("edit"), mix: one("mix"), lead: one("lead") };
}

const MAX_BEATS = 32;
const Note = obj({ n: int(0, 127), at: num(0, MAX_BEATS, 0), len: num(0.05, 8, 0.5), vel: num(0.05, 1, 0.8) });
const PlayArgs = obj({ notes: arr(Note, 64, { min: 1 }) });
const SitArgs = obj({ spot: str(24) });
const AskArgs = obj({ can: opt(oneOf(["play", "edit", "mix"])) });
const BackArgs = obj({ ago: RUNG });
const read = <T>(g: Guard<T>, v: unknown, what: string): T | { error: string } => check(g, v) ?? { error: `Those aren't ${what}. The tool's inputSchema says what it takes.` };

const tracksOf = (p: Project) => p.tracks.map((t, i) => ({ i, name: t.name, kind: t.kind, voice: t.params[P.MODE] ? "analog" : "fm", notes: t.notes.length }));

/** The jam as an agent reads it: who is where, the seats and what they play, what you may do, the tempo, the tracks. */
export function state(pl: Player) {
  syncRoom(pl);
  const p = pl.project(), s = snapshot(pl.jam, p), r = pl.rights();
  return {
    you: { name: pl.name, ...s.you, may: may(pl), asked: r.asked },
    floor: r.floor?.state ?? "free",
    bpm: p?.bpm ?? null, bars: p?.bars ?? null,
    spots: s.spots.map((x) => ({ ...x, label: spotOf(pl.jam, x.id)?.label ?? x.id, plays: p && x.track >= 0 ? p.tracks[x.track].name : null })),
    others: s.others,
    tracks: p ? tracksOf(p) : [],
    made: p?.instruments ?? [],
  };
}

/** The tools, as WebMCP takes them and the CLI's MCP lists them. */
export function studioTools(pl: Player): Command[] {
  const no = (why: string) => ({ ok: false, why });
  const nope = (can: Can) => no(`The leader hasn't let you ${can === "edit" ? "change the groove" : can}: studio_ask_to_play raises your hand${can === "play" ? "" : ` (can: "${can}")`}`);
  return [
    { name: "studio_state", title: "Look around the jam room", annotations: { readOnlyHint: true },
      description: "Who is in the room and where, which seat each sits at, every spot and the track it plays, what you may do (play, edit, mix, lead: the leader's grants, or the floor's), the tempo, the groove's tracks and the instruments made here.",
      execute: () => state(pl) },
    { name: "studio_sit", title: "Sit at a spot", ask: "spot id (studio_state lists them)",
      description: "Walk up to a spot (keys, drums, bass, a made instrument, the desk, the couch) and sit: what you play then goes to that spot's track.",
      inputSchema: { type: "object", properties: { spot: { type: "string", description: "A spot's id from studio_state" } }, required: ["spot"] },
      execute: (a) => {
        const args = read(SitArgs, a, "a spot");
        if ("error" in args) return args;
        syncRoom(pl);
        const s = spotOf(pl.jam, args.spot);
        if (!s) return no(`There's no ${args.spot} here. Spots: ${pl.jam.def.spots.map((x) => x.id).join(", ")}`);
        if (pl.jam.me.seat && pl.jam.me.seat !== s.id) stand(pl.jam);
        if (pl.jam.me.seat !== s.id) Object.assign(pl.jam.me, { x: s.at[0], z: s.at[1] });
        const r = sit(pl.jam, s.id);
        pl.live(body(pl.jam));
        return r.ok ? { ok: true, at: s.label, plays: state(pl).you.plays } : r;
      } },
    { name: "studio_stand", title: "Stand up",
      description: "Stand up from your seat, so someone else can sit there.",
      execute: () => { stand(pl.jam); pl.live(body(pl.jam)); return { ok: true }; } },
    { name: "studio_play", title: "Play notes", palette: false,
      description: "Play notes at the seat you sit at, heard by everyone in the sesh at its tempo. Each note: n (a MIDI note; at the kit, the drum's number in studio_state's tracks order, 0 the kick), at and len in beats from now, vel 0..1. Up to 64 notes over 32 beats; it answers when the last one ends.",
      inputSchema: { type: "object", properties: { notes: { type: "array", items: { type: "object", properties: {
        n: { type: "integer" }, at: { type: "number" }, len: { type: "number" }, vel: { type: "number" } }, required: ["n"] } } }, required: ["notes"] },
      execute: async (a) => {
        const args = read(PlayArgs, a, "notes");
        if ("error" in args) return args;
        syncRoom(pl);
        const p = pl.project(), s = spotOf(pl.jam, pl.jam.me.seat);
        if (!p) return no("The sesh hasn't sent its groove yet");
        if (!s) return no("Sit at an instrument first (studio_sit)");
        if (!may(pl).play) return nope("play");
        const hits = args.notes.flatMap((x) => {
          const k = s.kind === "drums" ? keyNote(pl.jam, p, DRUM_KEYS[x.n] ?? "", 0) : trackFor(s, p) >= 0 ? { track: trackFor(s, p), midi: x.n } : null;
          return k ? [{ ...k, ...x }] : [];
        });
        if (!hits.length) return no(`Nothing to play at ${s.label}`);
        const beat = 60_000 / p.bpm, events = hits.flatMap((h) => [
          { ms: h.at * beat, e: { t: "on", track: h.track, midi: h.midi, vel: h.vel } satisfies Live },
          { ms: (h.at + h.len) * beat, e: { t: "off", track: h.track, midi: h.midi } satisfies Live },
        ]).sort((x, y) => x.ms - y.ms || (x.e.t === "off" ? -1 : 1));
        let now = 0;
        for (const ev of events) { if (ev.ms > now) { await pl.wait(ev.ms - now); now = ev.ms; } pl.live(ev.e); }
        return { ok: true, played: hits.length, at: s.label, track: p.tracks[hits[0].track].name, seconds: Math.round(now) / 1000 };
      } },
    { name: "studio_ask_to_play", title: "Ask to play",
      description: "Raise your hand: ask the sesh's leader to let you play (or, with can, to edit the groove or mix the desk). The leader answers Yes or No; studio_state's you.may says when it's yes.",
      inputSchema: { type: "object", properties: { can: { type: "string", enum: ["play", "edit", "mix"] } } },
      execute: (a) => {
        const args = read(AskArgs, a, "an ask");
        if ("error" in args) return args;
        const can = args.can ?? "play";
        if (may(pl)[can]) return { ok: true, why: `You may ${can} already` };
        pl.ask(can);
        return { ok: true, asked: can, why: "Your hand is up; the leader answers Yes or No" };
      } },
    { name: "studio_make_instrument", title: "Make an instrument", ask: "a name for it",
      description: "Make a new instrument: a free FM DAW track gets the patch and the name, and a synth you can walk up to and play stands at a clear spot in the room (near `spot`, another spot's id or {x, z}, or else near you). voice: fm or analog. patch: a sound to start from (a sound bank name such as \"Wobble bass\" or a kit synth such as \"Bells\") and knobs over it: attack, decay, sustain, release (seconds), ratio and brightness (FM), cutoff, res, detune, sub, drive, glide (analog, 0..1), gain, send, root (MIDI). It needs the edit grant. Answers with its spot id: studio_sit there to play it.",
      inputSchema: { type: "object", properties: {
        name: { type: "string" }, voice: { type: "string", enum: ["fm", "analog"] },
        patch: { type: "object", properties: Object.fromEntries(["sound", "attack", "decay", "sustain", "release", "ratio", "brightness", "cutoff", "res", "detune", "sub", "drive", "glide", "gain", "send", "root"].map((k) => [k, { type: k === "sound" ? "string" : "number" }])) },
        spot: { description: "A spot's id to stand it near, or { x, z } in metres" } }, required: ["name"] },
      execute: (a) => {
        const args = read(MakeArgs, a, "an instrument (a name, a voice, a patch)");
        if ("error" in args) return args;
        const p = pl.project();
        if (!p) return no("The sesh hasn't sent its groove yet");
        if (!may(pl).edit) return nope("edit");
        const made = makeInstrument(p, pl.base, args, [pl.jam.me.x, pl.jam.me.z]);
        if (!made.ok) return made;
        pl.edit(made.op);
        syncRoom(pl);
        return { ok: true, spot: made.inst.id, track: made.inst.track, name: made.inst.name, voice: made.inst.voice, at: made.inst.at };
      } },
    { name: "studio_wind_back", title: "Wind back (preview)", ask: `minutes back: ${RUNGS.join(", ")}`, annotations: { readOnlyHint: true },
      description: `Look at the groove as it was some minutes back (${RUNGS.join(", ")}), for you alone: a preview, nothing changes for anyone. Only the leader brings everyone back there, from FM DAW's Wind back.`,
      inputSchema: { type: "object", properties: { ago: { type: "integer", enum: [...RUNGS] } }, required: ["ago"] },
      execute: async (a) => {
        const args = read(BackArgs, a, `minutes back (${RUNGS.join(", ")})`);
        if ("error" in args) return args;
        const got = await pl.rewind(args.ago);
        if (!got) return no("The sesh didn't answer");
        if (!got.project) return no(`The sesh doesn't go back ${rungName(args.ago)} yet`);
        return { ok: true, ago: rungName(args.ago), at: new Date(got.at).toISOString(), bpm: got.project.bpm, bars: got.project.bars, tracks: tracksOf(got.project) };
      } },
  ];
}

/**
 * A player that is only a socket into the sesh (the CLI's MCP, a test): it keeps its jam, the groove and its rights
 * from what the World sends, and says who it is (its avatar and name) on joining and when someone new comes in.
 * `hear` takes each message off the socket, as text or already parsed.
 */
export function remotePlayer(o: {
  base: StudioDef; name: string; avatar: Avatar;
  send: (m: ClientMsg | ChatClient | GrantClient) => void; wait?: (ms: number) => Promise<void>;
}) {
  let project: Project | null = null, peers = 0;
  const rights: Rights = { floor: null, grants: null, me: null, asked: null };
  const back = lookBack((ago) => o.send({ t: "rewind", ago }));
  const jam = newJam(o.base);
  const key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const wait = o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const player: Player = {
    jam, base: o.base, name: o.name,
    project: () => project, rights: () => rights,
    live: (e) => o.send({ t: "live", e }),
    edit: (op) => { if (project) project = apply(project, op); o.send({ t: "op", op }); },
    ask: (can) => o.send({ t: "ask", can }),
    rewind: back.rewind,
    wait,
  };
  const wear = () => { o.send({ t: "live", e: { t: "wear", avatar: o.avatar, name: o.name } }); o.send({ t: "live", e: body(jam) }); };
  o.send({ t: "hello", key, name: o.name });
  wear();
  function heard(raw: unknown) {
    let v = raw;
    if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return; } }
    const c = decodeChatServer(v);
    if (c) { if (c.t === "chat") rights.me = c.you; return; }
    const g = decodeGrantServer(v);
    if (g) { rights.grants = g.grants; rights.asked = (rights.me && g.asks[rights.me]) || null; return; }
    const m = decodeServer(v);
    if (!m) return;
    if (m.t === "snapshot") project = m.project;
    else if (m.t === "op" && project) project = apply(project, m.op);
    else if (m.t === "live") hear(jam, m.from, m.e);
    else if (m.t === "gone") gone(jam, m.from);
    else if (m.t === "floor") rights.floor = { state: m.state, host: m.host };
    else if (m.t === "peers") { if (m.n > peers) wear(); peers = m.n; }
    else if (m.t === "rewound") { back.answer(m.ago, m.at, m.project); return; }
    else return;
    syncRoom(player);
  }
  return { player, hear: heard };
}
