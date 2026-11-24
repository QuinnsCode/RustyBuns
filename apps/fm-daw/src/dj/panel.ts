// The decks on screen (engine.ts plays them): deck A on the left, deck B on the right, the mixer between, the two
// zoomed waveforms stacked across the top on one time scale so you can see the kicks line up, all on one screen (a
// carousel of the three on a narrow one). Music comes from each deck's upload button (on its player and its lane of the
// close-up), the header's Add music and Folder (PRELOAD tracks read ahead), a file dropped on a deck or lane, or a
// YouTube link sent to A or B (youtube.ts); the library pop-over lists what came this visit, to send to either deck. Each deck is a club media player
// (player-panel.ts: the screen, the jog wheel in VINYL or CD, a big CUE and PLAY, the tempo fader); the close-up
// zooms from a quarter second to sixteen either side of the playhead, drawn from peak levels (player.ts).
// The mixer is mixer-panel.ts's four channels, master and twin filters. Keys while it's open: Q/P play A/B, W/O cue,
// 1 to 4 and 7 to 0 hot cues, A/S and K/L nudge, Z/X and comma/period the 10× nudge held, the arrows slide the
// crossfader, Esc closes it; Settings (the cog, prefs.ts) changes the keys, the nudge amount, the locks and the waveform.
// The close-up is coloured by its sound (bass one end of each deck's gradient, highs the other: A fire, B blue-green to a
// whitish purple), and a press on it grabs that deck's track like a record: drag to scratch, let go to play on.
// Icons after lucide (ISC), the word as the tooltip.
// In a room (`room`), the decks are the booth's (booth.ts): a deck someone else loaded shows here as they play it
// (its waveform, key, tempo, where it is on the room's clock) and its play, cue, sync, hot cues and jumps go to them;
// yours go out to the room the same way, and your master plays to the room's PA while you have a track on. The
// people button lists who may play the decks: the leader adds a DJ with one press, anyone else asks.
import "./panel.css";
import { peaks, type Grid } from "./analyze.ts";
import { Booth, changed, farView, HOTS, hotOf, JOG_LOST_MS, JOG_SEND_MS, JogOut, mixOf, posAt, sayOf, SAY_EVERY_MS, tubeSayOf, waveFrom, waveOf, type DeckPress, type JogPressed, type DeckSay, type DeckView, type MixSay, type Press } from "./booth.ts";
import { Decks, type Beside, type Side, type Track } from "./engine.ts";
import { DECK_CHANNEL } from "./mixer.ts";
import { mountMixer } from "./mixer-panel.ts";
import { DEMOS, demoTrack } from "./demo.ts";
import { bars, overTone, peakLevels, ZOOM_START, ZOOMS, type Level } from "./player.ts";
import { ACTION_LABEL, ACTIONS, actionOf, bindKey, deckAction, DEFAULT_PREFS, FAST_TIMES, keyName, keysOf, loadPrefs, NUDGE_MS, savePrefs, TONE_LUT, TONE_STEPS, type Action, type Prefs } from "./prefs.ts";
import { connectMidiJog, Jog, playerFace } from "./player-panel.ts";
import { button, el, svg } from "./dom.ts";
import { TubeDeck, tubeTitle, tubeVolume, videoId } from "./youtube.ts";
import { fileKey, FROM_LABEL, readCollection, settle, type Tempo } from "./tags.ts";

/** The waveforms' colours: deck A fire, deck B blue, what's played greyed, the cue and the four hot cues. */
const LOOKS_DECK = { wave: ["#ff9a3c", "#4aa8ff"] as const, played: "#5b5f68", cue: "#ffd23c", hot: ["#ff4a6a", "#4affa0", "#4ab8ff", "#d84aff"] };

const ICON = {
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>'),
  folder: svg('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  midi: svg('<circle cx="12" cy="12" r="10"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="10" r="1"/><path d="M9 15h6"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  ban: svg('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'),
  shield: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
  tube: svg('<path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M12 17v4"/><path d="M8 21h8"/><rect x="2" y="3" width="20" height="14" rx="2"/>'),
  list: svg('<path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/>'),
  mixer: svg('<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>'),
  magnet: svg('<path d="m12 15 4 4"/><path d="M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282z"/><path d="m5 8 4 4"/>'),
  cog: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  hand: svg('<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
};

/** A sound file by its name, for a folder's tracks (the rest of a folder is cover art, playlists and notes). */
const AUDIO = /\.(mp3|wav|m4a|aac|mp4|ogg|oga|opus|flac|aiff?|webm)$/i;
/** How many of a folder's tracks are read ahead into the library; the rest are read when one is sent to a deck. */
export const PRELOAD = 12;

/** A track in the library: what's been loaded this visit, decoded once. */
interface Shelf { track: Track; overview: Float32Array }

/** One person in the room, for the DJ list: whether they may play the decks, and whether the leader can change it. */
export interface Dj { id: string; name: string; on: boolean; you: boolean; /** Refused the decks (src/spin.ts). */ refused?: boolean; /** A moderator the host named. */ mod?: boolean }
/** The room the decks are in: its booth, its shared clock, the live line, and who may play. */
export interface DeckRoom {
  booth: Booth;
  /** The room's shared clock now, ms (src/clock.ts: the leader's time). */
  now(): number;
  send(e: DeckSay | DeckPress | MixSay): void;
  /** Whether you may touch the decks (the play grant), and why not. */
  may(): { ok: true } | { ok: false; why: string };
  /** The name of the player behind a peer number. */
  nameOf(peer: number): string;
  /** Your master to the room's PA (null: stop), with what's on. */
  toPa(stream: MediaStream | null, name: string): void;
  /** Everyone here, for the DJ list; `lead`: you lead, so you can add and drop DJs. */
  djs(): { lead: boolean; people: Dj[] };
  setDj(id: string, on: boolean): void;
  /** Raise your hand to play. */
  ask(): void;
  /** The lineup card (src/studio/spin-card.ts), shown in the header. */
  card?: HTMLElement;
  /** You run the decks (you lead, or you moderate): refuse people the decks. */
  runs?(): boolean;
  refuse?(id: string, on: boolean): void;
  /** The leader names a moderator. */
  setMod?(id: string, on: boolean): void;
}

export type { DeckView };

export interface DecksPanel {
  decks: Decks;
  /** A press on deck `side`, here or sent to its player (the 3D booth's buttons, the keys). */
  press(side: Side, press: Press, x?: number): void;
  /** Someone's deck event off the live line (a press is for you: the page checked `to`). */
  heard(from: number, e: DeckSay | DeckPress): void;
  view(side: Side): DeckView;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Load bytes (a file, or a fetched URL) onto a deck, and into the library. */
  load(side: Side, name: string, bytes: ArrayBuffer): Promise<Track>;
  library(): string[];
  /** A folder's tracks not read yet (PRELOAD read ahead, the rest when sent to a deck), and the one being read. */
  waiting(): { names: string[]; reading: string | null };
  /** The two demo tracks, one on each deck. */
  demos(): void;
  /** The two players' jog wheels (player-panel.ts). */
  jogs: readonly [Jog, Jog];
  /** The close-up's zoom: an index into ZOOMS (player.ts), and the seconds either side it shows. */
  zoom(i?: number): { at: number; seconds: number };
  /** A YouTube link (or id) onto deck `side`: true once YouTube's player is ready on it. */
  tube(side: Side, link: string): Promise<boolean>;
  /** Each deck's YouTube video, or null: its id, title, where it is, and the volume and speed the deck gives it. */
  tubes(): ({ id: string; title: string; pos: number; playing: boolean } | null)[];
  /** The DJ's settings (prefs.ts), changed by `to` when given (and kept in this browser). */
  prefs(to?: Partial<Prefs>): Prefs;
  /** A nudge on deck `side`: a tap back or on, or the fast one held (0 lets go). */
  nudge(side: Side, kind: "tap" | "hold", dir: -1 | 0 | 1): void;
}

/** Mount the decks on the page, closed. `ctx` is the page's audio; `onToggle` hears it open and close. */
export function mountDecks(o: { ctx: AudioContext; parent?: HTMLElement; onToggle?: (open: boolean) => void; startOpen?: boolean; room?: DeckRoom }): DecksPanel {
  const decks = new Decks(o.ctx), room = o.room ?? null;
  /** Someone else's deck on `side`, or null when it's yours or free. */
  const far = (side: Side) => room?.booth.sides[side] ?? null;
  const shelf: Shelf[] = [];
  /** Tempos from collection files the DJ dropped, by file name. */
  const known = new Map<string, Tempo>();
  /** Each track's peaks at a few resolutions (player.ts), so the close-up draws a few hundred bars at any zoom. */
  const fine = new Map<Track, Level[]>(), over = new Map<Track, Float32Array>(), overTones = new Map<Track, Float32Array>();
  /** The DJ's settings, kept in this browser. */
  let prefs = loadPrefs();
  const root = el("section", { id: "dj", role: "dialog", "aria-label": "The decks" });
  root.hidden = true;
  const head = el("header");
  const title = el("h2", {}, "QDJs <small>+ Qone mixer</small>");
  const closeB = button(ICON.x, "Back to the room (Esc)", "dj-close");
  const peopleB = button(`${ICON.users}<span>DJs</span>`, "Who may play the decks: add the DJ for the night", "dj-people-open");
  const people = el("div", { class: "dj-people", role: "dialog", "aria-label": "Who may play the decks" });
  people.hidden = true;
  peopleB.hidden = !room;
  peopleB.addEventListener("click", () => { people.hidden = !people.hidden; drawPeople(); });
  const tools = el("div", { class: "dj-head-tools" });
  const midiB = button(`${ICON.midi}<span>MIDI</span>`, "Play the jog wheels from a MIDI controller", "dj-midi");
  midiB.addEventListener("click", () => void connectMidiJog(jogs).then((said) => { flash(said); midiB.classList.toggle("on", said.startsWith("MIDI jog")); }));
  // the two ways music comes on: a file from this computer, or a YouTube link (played in YouTube's own player)
  const src = el("div", { class: "dj-src" });
  const add = button(`${ICON.upload}<span>Add music</span>`, "Add music from this computer (mp3, wav, m4a, ogg, flac): it stays on this computer", "dj-add");
  const tubeIn = el("input", { type: "url", class: "dj-tube", placeholder: "Paste a YouTube link", "aria-label": "A YouTube link to play on a deck", enterkeyhint: "go" });
  const tubeA = button(`${ICON.tube}<span>A</span>`, "Play the YouTube link on deck A"), tubeB = button(`${ICON.tube}<span>B</span>`, "Play the YouTube link on deck B");
  tubeA.addEventListener("click", () => void tubeFrom(0)); tubeB.addEventListener("click", () => void tubeFrom(1));
  tubeIn.addEventListener("keydown", (e) => { if (e.key === "Enter") void tubeFrom(decks.decks[0].track || tubes[0] ? 1 : 0); });
  const addDir = button(`${ICON.folder}<span>Folder</span>`, `Add a folder of music: every track in it goes in the library, the first ${PRELOAD} read ahead so they load at once`, "dj-add-dir");
  src.append(add, addDir, tubeIn, tubeA, tubeB);
  const libB = button(`${ICON.list}<span class="dj-count">0</span>`, "The library: what you've added this visit, to send to A or B", "dj-lib-open");
  const prefsB = button(ICON.cog, "Settings: the nudge amount, locks, the waveform and the keys", "dj-prefs-open");
  const prefsBox = el("div", { class: "dj-people dj-prefs", role: "dialog", "aria-label": "Deck settings" });
  prefsBox.hidden = true;
  prefsB.addEventListener("click", () => { prefsBox.hidden = !prefsBox.hidden; prefsB.classList.toggle("on", !prefsBox.hidden); listening = null; drawPrefs(); });
  tools.append(libB, midiB, prefsB, peopleB, closeB);
  head.append(title, src, ...(room?.card ? [room.card] : []), tools, people, prefsBox);
  const zoom = el("canvas", { class: "dj-zoom", width: "1200", height: "150", "aria-label": "Both decks' waveforms, around the playheads" });
  // the close-up's zoom: right in to watch a kick race past, out to see the phrase
  let zoomAt: number = ZOOM_START;
  const zoomS = () => ZOOMS[zoomAt]!;
  const setZoom = (i: number) => { zoomAt = Math.min(ZOOMS.length - 1, Math.max(0, Math.round(i))); };
  const zoomBar = el("div", { class: "dj-zoombar" });
  const zoomIn = button(ICON.plus, "Zoom the waveform in"), zoomOut = button(ICON.minus, "Zoom the waveform out"), zoomLabel = el("span");
  zoomIn.addEventListener("click", () => setZoom(zoomAt - 1)); zoomOut.addEventListener("click", () => setZoom(zoomAt + 1));
  zoomBar.append(zoomOut, zoomLabel, zoomIn);
  zoom.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); setZoom(zoomAt + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
  // a press on a deck's lane of the close-up grabs its track: VINYL holds it under your hand and drags it (a scratch),
  // SLIDE moves it and lets it play on
  let held: { id: number; side: Side; x: number; vinyl: boolean } | null = null;
  zoom.addEventListener("pointerdown", (e) => {
    if (held || prefs.lockWave) return;
    const r = zoom.getBoundingClientRect(), side: Side = e.clientY - r.top < r.height / 2 ? 0 : 1, d = decks.decks[side];
    if (!d.track && !far(side) && !tubes[side]) return loadInto(side);
    if (!d.track || far(side) || tubes[side]) return;
    e.preventDefault();
    try { zoom.setPointerCapture(e.pointerId); } catch { /* a pointer that has already gone */ }
    held = { id: e.pointerId, side, x: e.clientX, vinyl: prefs.grab === "vinyl" };
    if (held.vinyl) jogs[side].touch(true, true);
  });
  zoom.addEventListener("pointermove", (e) => {
    if (!held || e.pointerId !== held.id) return;
    const r = zoom.getBoundingClientRect(), d = decks.decks[held.side];
    // the waveform runs right to left as it plays, so dragging it left moves the track on
    const ds = (-(e.clientX - held.x) * (zoom.width / Math.max(1, r.width))) / (zoom.width / (2 * zoomS() * d.rate()));
    held.x = e.clientX;
    if (held.vinyl) jogs[held.side].scrub(ds); else d.seek(d.pos() + ds);
  });
  const letGoWave = (e: PointerEvent) => { if (!held || e.pointerId !== held.id) return; if (held.vinyl) jogs[held.side].touch(false); held = null; };
  zoom.addEventListener("pointerup", letGoWave);
  zoom.addEventListener("pointercancel", letGoWave);
  // each lane's load button, down the close-up's left edge: A (fire) on top, B (blue) under it
  const lanes = el("div", { class: "dj-lanes" });
  for (const side of [0, 1] as const) {
    const b = button(`${ICON.upload}<span>${side ? "B" : "A"}</span>`, `Load a track onto deck ${side ? "B" : "A"}`, `dj-lane-load dj-lane-${side ? "b" : "a"}`);
    b.addEventListener("click", () => loadInto(side));
    lanes.append(b);
  }
  // a file dropped on a lane goes on that lane's deck
  const laneAt = (y: number): Side => (y - zoom.getBoundingClientRect().top < zoom.getBoundingClientRect().height / 2 ? 0 : 1);
  zoom.addEventListener("dragover", (e) => e.preventDefault());
  zoom.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer?.files[0]; if (f) void fromFile(laneAt(e.clientY), f); });
  const zoomBox = el("div", { class: "dj-zoombox" });
  zoomBox.append(zoom, lanes, zoomBar);
  // on a phone or a narrow window the three pieces are a carousel: swipe across, or press A, the mixer or B
  const tabs = el("nav", { class: "dj-tabs", "aria-label": "Deck A, the mixer, deck B" });
  const tabBs = (["A", "mixer", "B"] as const).map((t, i) => {
    const b = button(t === "mixer" ? ICON.mixer : t, t === "mixer" ? "The mixer" : `Deck ${t}`, i === 1 ? "on" : "");
    b.addEventListener("click", () => { const pane = row.children[i]; if (pane instanceof HTMLElement) row.scrollTo({ left: pane.offsetLeft - row.offsetLeft, behavior: "smooth" }); });
    tabs.append(b);
    return b;
  });
  const row = el("div", { class: "dj-row" });
  row.addEventListener("scroll", () => { const i = Math.round(row.scrollLeft / Math.max(1, row.clientWidth)); tabBs.forEach((b, j) => b.classList.toggle("on", j === i)); }, { passive: true });
  const lib = el("div", { class: "dj-lib", role: "dialog", "aria-label": "The library" });
  lib.hidden = true;
  libB.addEventListener("click", () => { lib.hidden = !lib.hidden; libB.classList.toggle("on", !lib.hidden); });
  const count = libB.querySelector(".dj-count")!;
  const note = el("p", { class: "dj-note", role: "status" });
  root.append(head, lib, zoomBox, tabs, row, note);
  (o.parent ?? document.body).append(root);

  // ---- the mixer (mixer-panel.ts): a deck someone else plays dims its channel
  const quant = button(ICON.magnet, "Quantize: cues and loops land on the beat", "dj-quant on");
  quant.addEventListener("click", () => { decks.quantize = !decks.quantize; });
  const mixer = mountMixer(decks.mixer, { far: (ch) => DECK_CHANNEL.some((c, side) => c === ch && !!far(side as Side)), extra: [quant] });

  // ---- the two players (player-panel.ts)
  const jogs = [new Jog(decks.decks[0], o.ctx), new Jog(decks.decks[1], o.ctx)] as const;
  const players = ([0, 1] as const).map((side) => playerFace({
    side, deck: decks.decks[side], jog: jogs[side],
    press: (p, x) => press(side, p, x),
    touch: (on) => { const t = far(side); if (t) jogOut(side, t.owner)?.touch(on, performance.now()); else if (!tubes[side]) jogs[side].touch(on); },
    turn: (part, turns) => { const t = far(side), tube = tubes[side]; if (t) jogOut(side, t.owner)?.turn(part, turns, performance.now()); else if (tube) tube.turn(turns); else jogs[side].turn(part, turns); },
    theirs: () => (far(side) ? view(side) : null),
    tube: () => tubes[side]?.view() ?? null,
    paintOverview: (c, v) => { if (v) drawWave(c, v.wave, v.len, v.pos, v.cue, [], null, side); else { const s = decks.decks[side].state(); drawOverview(c, decks.decks[side].track, s.pos, s.cue, s.hot, s.loop, side); } },
    drop: (f) => void fromFile(side, f),
    upload: () => loadInto(side),
    quantize: () => decks.quantize,
    prefs: () => prefs,
    nudge: (kind, dir) => nudge(side, kind, dir),
  }));
  /** A nudge on a deck here: a tap moves it `prefs.nudgeMs`, the fast one held drifts it. Your own decks only. */
  function nudge(side: Side, kind: "tap" | "hold", dir: -1 | 0 | 1) {
    if (far(side) || tubes[side]) { if (dir) flash(far(side) ? "The nudge works on your own decks: ask whoever has this one" : "The nudge needs a file: on YouTube, ride the pitch fader"); return; }
    if (kind === "tap") { if (dir) jogs[side].tapNudge(dir, prefs.nudgeMs); } else jogs[side].holdNudge(dir, prefs.nudgeMs);
  }
  row.append(players[0].box, mixer.root, players[1].box);
  // start on the mixer in the carousel (a no-op when all three fit)
  requestAnimationFrame(() => { row.scrollLeft = mixer.root.offsetLeft - row.offsetLeft; });

  // ---- YouTube on a deck (youtube.ts): the video plays in YouTube's player on the deck, the deck drives it
  const tubes: [TubeDeck | null, TubeDeck | null] = [null, null];
  /** Videos sent to a deck this visit, for the library. */
  const tubeShelf: { id: string; title: string }[] = [];
  function dropTube(side: Side) { tubes[side]?.destroy(); tubes[side] = null; players[side].video.hidden = true; players[side].video.replaceChildren(); }
  async function tubeFrom(side: Side) {
    const id = videoId(tubeIn.value);
    if (!id) return flash("That isn't a YouTube link: paste one from the address bar or Share");
    tubeIn.value = "";
    await putTube(side, id);
  }
  async function putTube(side: Side, id: string, title?: string): Promise<boolean> {
    if (!canLoad(side)) return false;
    if (decks.decks[side].track) { decks.decks[side].unload(); room?.booth.sides.splice(side, 1, null); }
    dropTube(side);
    const v = players[side].video;
    v.hidden = false;
    const t = new TubeDeck(id, v, title ?? tubeShelf.find((s) => s.id === id)?.title ?? "YouTube");
    tubes[side] = t;
    if (!tubeShelf.some((s) => s.id === id)) tubeShelf.push({ id, title: t.title });
    drawList();
    flash(room ? "The room hears YouTube in each listener's own player, kept on the room's clock: the PA, EQ and filters don't reach it" : `Deck ${side ? "B" : "A"}: YouTube's player. EQ, filters and scratch need a file`);
    if (!title) void tubeTitle(id).then((name) => { if (!name) return; t.title = name; const s = tubeShelf.find((x) => x.id === id); if (s) s.title = name; drawList(); });
    return t.ready.then(() => true, (e: unknown) => { flash(e instanceof Error ? e.message : "YouTube's player didn't load"); dropTube(side); return false; });
  }

  // ---- the library
  const pick = el("input", { type: "file", accept: "audio/*,.xml,.nml,.dat,.ext", multiple: "", hidden: "" });
  add.addEventListener("click", () => pick.click());
  pick.addEventListener("change", () => { for (const f of pick.files ?? []) void fromFile(null, f); pick.value = ""; });
  // one track straight onto a deck: its upload button, or a press on its empty lane
  const pickOne = el("input", { type: "file", accept: "audio/*", hidden: "" });
  let pickTo: Side = 0;
  function loadInto(side: Side) { pickTo = side; pickOne.click(); }
  pickOne.addEventListener("change", () => { const f = pickOne.files?.[0]; if (f) void fromFile(pickTo, f); pickOne.value = ""; });
  // a whole folder: every track in the library, the first PRELOAD read ahead (the empty decks get the first ones)
  const pickDir = el("input", { type: "file", webkitdirectory: "", multiple: "", hidden: "" });
  addDir.addEventListener("click", () => pickDir.click());
  pickDir.addEventListener("change", () => { void fromFolder([...(pickDir.files ?? [])]); pickDir.value = ""; });
  const list = el("ul", { class: "dj-list" });
  lib.append(pick, pickOne, pickDir, list);
  for (const t of [lib, head]) {
    t.addEventListener("dragover", (e) => e.preventDefault());
    t.addEventListener("drop", (e) => { e.preventDefault(); for (const f of e.dataTransfer?.files ?? []) void fromFile(null, f); });
  }
  let noteUntil = 0;
  function flash(text: string) { note.textContent = text; noteUntil = performance.now() + 3500; }

  /** A folder's tracks not read yet, and the one being read now. */
  const waiting: File[] = [];
  let reading: File | null = null, readAhead = 0, preloading = false;
  async function fromFolder(files: File[]) {
    const path = (f: File) => f.webkitRelativePath || f.name;
    files.sort((a, b) => path(a).localeCompare(path(b), undefined, { numeric: true }));
    // the DJ software's collection first, so the tracks get its tempos as they're read
    for (const f of files) if (/\.(xml|nml)$/i.test(f.name)) await fromFile(null, f);
    const have = new Set([...shelf.map((s) => s.track.name), ...waiting.map((f) => f.name)]);
    const tracks = files.filter((f) => (AUDIO.test(f.name) || f.type.startsWith("audio/")) && !have.has(f.name));
    if (!tracks.length) return flash("No music in that folder (mp3, wav, m4a, ogg, flac, aiff)");
    waiting.push(...tracks);
    readAhead = 0;
    lib.hidden = false; libB.classList.add("on");
    flash(`${tracks.length} track${tracks.length === 1 ? "" : "s"} from the folder${tracks.length > PRELOAD ? `: reading the first ${PRELOAD}, the rest when you send one to a deck` : ""}`);
    drawList();
    void preload();
  }
  /** Read the folder's tracks into the library one at a time, PRELOAD of them, in the background. */
  async function preload() {
    if (preloading) return;
    preloading = true;
    while (waiting.length && readAhead < PRELOAD) {
      reading = waiting.shift()!; readAhead++;
      drawList();
      await fromFile(null, reading).catch(() => {});
    }
    reading = null; preloading = false;
    drawList();
  }
  /** A folder track not read yet, sent to a deck: read it now, onto that deck. */
  function sendWaiting(side: Side, f: File) {
    const i = waiting.indexOf(f);
    if (i >= 0) waiting.splice(i, 1);
    drawList();
    void fromFile(side, f);
  }

  function shelve(t: Track) {
    if (!fine.has(t)) fine.set(t, peakLevels(t.mono, t.buffer.sampleRate));
    over.set(t, peaks(t.mono, 600));
    overTones.set(t, overTone(fine.get(t)!, 600, t.buffer.duration));
    if (!shelf.some((s) => s.track === t)) shelf.push({ track: t, overview: over.get(t)! });
    drawList();
  }
  function drawList() {
    list.replaceChildren();
    for (const s of shelf) {
      const li = el("li"), n = el("span", { title: s.track.name }), bpm = el("small");
      n.textContent = s.track.name;
      bpm.textContent = s.track.grid ? `${s.track.grid.bpm} BPM` : "no beat found";
      if (s.track.from) bpm.title = `Tempo: ${FROM_LABEL[s.track.from]}`;
      const toA = button("A", `Load on deck A`), toB = button("B", `Load on deck B`);
      toA.addEventListener("click", () => put(0, s.track)); toB.addEventListener("click", () => put(1, s.track));
      li.append(n, bpm, toA, toB);
      list.append(li);
    }
    for (const s of tubeShelf) {
      const li = el("li", { class: "tube" }, ICON.tube), n = el("span", { title: s.title });
      n.textContent = s.title;
      const toA = button("A", "Play on deck A"), toB = button("B", "Play on deck B");
      toA.addEventListener("click", () => void putTube(0, s.id, s.title)); toB.addEventListener("click", () => void putTube(1, s.id, s.title));
      li.append(n, el("small", {}, "YouTube"), toA, toB);
      list.append(li);
    }
    for (const f of reading ? [reading, ...waiting] : waiting) {
      const li = el("li", { class: "waiting" }), n = el("span", { title: f.webkitRelativePath || f.name }), what = el("small");
      n.textContent = f.name;
      what.textContent = f === reading ? "reading…" : "not read yet";
      li.append(n, what);
      if (f !== reading) {
        const toA = button("A", "Load on deck A"), toB = button("B", "Load on deck B");
        toA.addEventListener("click", () => sendWaiting(0, f)); toB.addEventListener("click", () => sendWaiting(1, f));
        li.append(toA, toB);
      }
      list.append(li);
    }
    count.textContent = String(shelf.length + tubeShelf.length + waiting.length + (reading ? 1 : 0));
    if (!shelf.length && !waiting.length && !reading) {
      const li = el("li", { class: "none" }, "<span>Add music, or drop files here or on a deck. Your files stay on this computer; the room hears your set as you play it.</span>");
      const demo = button("Demo tracks", "Two short tracks made here, to try the decks");
      demo.addEventListener("click", () => demos());
      li.append(demo);
      list.append(li);
    }
  }
  /** The two demo tracks (demo.ts), one on each deck. */
  function demos() {
    const rate = decks.ctx.sampleRate;
    DEMOS.forEach((d, i) => { const t = decks.fromSamples(d.name, demoTrack(d, rate), rate); shelve(t); put(i === 0 ? 0 : 1, t); });
  }
  drawList();
  /** Whether this deck can take a track: free, yours, or someone else's that's stopped (theirs goes). */
  function canLoad(side: Side): boolean {
    const r = room?.booth.mayLoad(side);
    if (r && !r.ok) { flash(r.why); return false; }
    if (prefs.lockLoad && (decks.decks[side].playing || tubes[side]?.isPlaying())) { flash(`Deck ${side ? "B" : "A"} is playing and loading onto a playing deck is locked (Settings)`); return false; }
    return true;
  }
  function put(side: Side, t: Track) { if (canLoad(side)) { dropTube(side); decks.put(side, t); room?.booth.sides.splice(side, 1, null); } }
  async function load(side: Side, name: string, bytes: ArrayBuffer): Promise<Track> {
    if (!canLoad(side)) throw new Error(`deck ${side ? "B" : "A"} is busy`);
    flash(`Reading ${name}…`);
    const t = await decks.load(side, name, bytes, known.get(fileKey(name))).catch((e: unknown) => { flash(`Couldn't read ${name}: ${e instanceof Error ? e.message : "not a sound file this browser knows"}`); throw e; });
    shelve(t);
    dropTube(side);
    room?.booth.sides.splice(side, 1, null);
    flash(t.grid ? `${name}: ${t.grid.bpm} BPM${t.key ? `, ${t.key.camelot} ${t.key.name}` : ""}` : `${name}: no steady beat found, so sync and loops are off for it`);
    return t;
  }
  async function fromFile(side: Side | null, f: File) {
    // a collection file from DJ software: tempos for tracks by name, now and for what comes later
    if (/\.(xml|nml|dat|ext)$/i.test(f.name)) {
      const got = readCollection(new Uint8Array(await f.arrayBuffer()));
      for (const [k, v] of got) known.set(k, v);
      for (const { track: t } of shelf) { const k = got.get(fileKey(t.name)); if (k && t.from !== "grid") Object.assign(t, settle(k, () => t.grid)); }
      drawList();
      flash(got.size ? `${f.name}: tempos for ${got.size} track${got.size === 1 ? "" : "s"}` : `${f.name}: no tempos in it`);
      return;
    }
    // a library add goes on whichever deck is empty, else just into the library
    const empty = decks.decks.findIndex((d, i) => !d.track && !tubes[i] && !far(i === 0 ? 0 : 1));
    const to = side ?? (empty >= 0 ? (empty as Side) : null);
    if (to === null) {
      const t = await decks.decode(f.name, await f.arrayBuffer(), known.get(fileKey(f.name))).catch(() => null);
      if (!t) { flash(`Couldn't read ${f.name}`); return; }
      shelve(t);
      flash(t.grid ? `${f.name}: ${t.grid.bpm} BPM` : `${f.name}: no steady beat found`);
      return;
    }
    await load(to, f.name, await f.arrayBuffer()).catch(() => {});
  }

  // ---- drawing
  function drawOverview(c: HTMLCanvasElement, t: Track | null, pos: number, cue: number, hot: (number | null)[], loop: { start: number; end: number } | null, side: Side) {
    if (!t) { c.getContext("2d")?.clearRect(0, 0, c.width, c.height); return; }
    drawWave(c, over.get(t) ?? peaks(t.mono, 600), t.buffer.duration, pos, cue, hot, loop, side, overTones.get(t));
  }
  function drawWave(c: HTMLCanvasElement, p: Float32Array, dur: number, pos: number, cue: number, hot: (number | null)[], loop: { start: number; end: number } | null, side: Side, tone?: Float32Array) {
    const lut = prefs.wave === "tone" && tone?.length === p.length ? TONE_LUT[side]! : null;
    const g = c.getContext("2d"); if (!g) return;
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    if (!dur) return;
    const at = (pos / dur) * w;
    // no peaks (a YouTube video): a bar, played and to come
    if (!p.length) { g.fillStyle = LOOKS_DECK.played; g.fillRect(0, h / 2 - 3, at, 6); g.fillStyle = LOOKS_DECK.wave[side]; g.fillRect(at, h / 2 - 3, w - at, 6); }
    for (let i = 0; i < p.length; i++) {
      const x = (i / p.length) * w, v = p[i]! * (h / 2 - 2);
      g.fillStyle = x < at ? LOOKS_DECK.played : lut ? lut[Math.round(tone![i]! * (TONE_STEPS - 1))]! : LOOKS_DECK.wave[side];
      g.fillRect(x, h / 2 - v, Math.max(1, w / p.length), v * 2);
    }
    if (loop) { g.fillStyle = "rgba(90, 220, 120, 0.25)"; g.fillRect((loop.start / dur) * w, 0, ((loop.end - loop.start) / dur) * w, h); }
    g.fillStyle = LOOKS_DECK.cue; g.fillRect((cue / dur) * w - 1, 0, 2, h);
    hot.forEach((v, i) => { if (v == null) return; g.fillStyle = LOOKS_DECK.hot[i]!; g.fillRect((v / dur) * w - 1, 0, 3, 10); });
    g.fillStyle = "#fff"; g.fillRect(at - 1, 0, 2, h);
  }
  const bins: number[][] = Array.from({ length: TONE_STEPS }, () => []);
  function drawZoom() {
    const g = zoom.getContext("2d"); if (!g) return;
    const w = zoom.width, h = zoom.height, lane = h / 2;
    g.fillStyle = "#0d0e11"; g.fillRect(0, 0, w, h);
    decks.decks.forEach((d, side) => {
      const t = d.track, y0 = side * lane, mid = y0 + lane / 2, theirs = far(side === 0 ? 0 : 1);
      if (theirs) { const v = view(side === 0 ? 0 : 1); gridLines(g, theirs.say.grid, v.pos, zoomS() * theirs.say.rate, w / (2 * zoomS() * theirs.say.rate), y0, lane); return; }
      if (!t) {
        if (tubes[side]) return;
        g.font = '500 22px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = LOOKS_DECK.wave[side as Side]; g.globalAlpha = 0.55;
        g.fillText(`Deck ${side ? "B" : "A"}: press here or drop a track`, w / 2, mid);
        g.globalAlpha = 1;
        return;
      }
      const s = d.state(), levels = fine.get(t) ?? [];
      // the deck's own seconds, scaled by its rate, so two decks at one tempo show their beats the same distance apart
      const span = zoomS() * s.rate, pxPerS = w / (2 * span), amp = lane / 2 - 3;
      // each bar in its colour: one path per step of the deck's gradient (bass one end, highs the other)
      const tone = prefs.wave === "tone";
      for (const b of bins) b.length = 0;
      bars(levels, s.pos, span, w, (x, bw, v, t) => { bins[tone ? Math.round(t * (TONE_STEPS - 1)) : 0]!.push(x, mid - v * amp, Math.max(1, bw - (bw > 3 ? 1 : 0)), v * amp * 2); });
      bins.forEach((b, k) => {
        if (!b.length) return;
        g.fillStyle = tone ? TONE_LUT[side]![k]! : LOOKS_DECK.wave[side as Side];
        g.beginPath();
        for (let i = 0; i < b.length; i += 4) g.rect(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
        g.fill();
      });
      gridLines(g, s.grid, s.pos, span, pxPerS, y0, lane);
      if (s.loop) { g.fillStyle = "rgba(90, 220, 120, 0.2)"; g.fillRect(w / 2 + (s.loop.start - s.pos) * pxPerS, y0, (s.loop.end - s.loop.start) * pxPerS, lane); }
    });
    g.fillStyle = "#ff6b4a"; g.fillRect(w / 2 - 1, 0, 2, h);
  }

  /** A deck's beats across the zoomed view, the bar lines brighter. */
  function gridLines(g: CanvasRenderingContext2D, grid: Grid | null, pos: number, span: number, pxPerS: number, y0: number, lane: number) {
    if (!grid) return;
    const w = zoom.width, per = 60 / grid.bpm, first = grid.offset + Math.ceil((pos - span - grid.offset) / per) * per;
    for (let b = first; b < pos + span; b += per) {
      const x = w / 2 + (b - pos) * pxPerS, n = Math.round((b - grid.offset) / per);
      g.fillStyle = n % 4 === 0 ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)";
      g.fillRect(x, y0 + 2, 1, lane - 4);
    }
  }

  // ---- the booth: presses here or to the deck's player, what's on yours to the room, and the DJ list
  /** Where the other deck is, for sync, wherever it plays. */
  function beside(side: Side): Beside | undefined {
    const other: Side = side === 0 ? 1 : 0, theirs = far(other);
    return theirs && room ? { grid: theirs.say.grid, rate: theirs.say.rate, playing: theirs.say.playing, pos: posAt(theirs.say, room.now()) } : undefined;
  }
  function press(side: Side, p: Press, x?: number) {
    const theirs = far(side);
    if (theirs && room) {
      const may = room.may();
      if (!may.ok) return flash(may.why);
      room.send({ t: "press", to: theirs.owner, side, press: p, ...(x === undefined ? {} : { x }) });
      return;
    }
    pressHere(side, p, x);
  }
  /** Do a press on a deck here (yours, or someone in the booth pressed it). */
  function pressHere(side: Side, p: Press, x?: number) {
    const d = decks.decks[side], hot = hotOf(p), tube = tubes[side];
    if (tube) { if (p === "sync") flash("Sync needs a beat: a YouTube deck has none, so match it by ear on the pitch fader"); else tube.press(p, x); return; }
    if (!d.track) return;
    if (p === "play") d.toggle();
    else if (p === "cueDown") d.cueDown(decks.quantize);
    else if (p === "cueUp") d.cueUp();
    else if (p === "sync") { if (!decks.sync(side, beside(side))) flash("Both decks need a track with a beat to sync"); }
    else if (hot >= 0) d.hotCue(hot, decks.quantize);
    else if (p === "back" || p === "fwd") d.jump(p === "back" ? -4 : 4);
    else if (p === "seek" && x !== undefined) d.seek(x * d.track.buffer.duration);
    say(true);
  }
  // the jog wheel on a deck someone else plays: gathered here (JogOut), run there through its Jog
  const jogsOut: [{ to: number; out: JogOut } | null, { to: number; out: JogOut } | null] = [null, null];
  function jogOut(side: Side, to: number): JogOut | null {
    if (!room) return null;
    const may = room.may();
    if (!may.ok) { flash(may.why); return null; }
    const had = jogsOut[side];
    if (had?.to === to) return had.out;
    const out = new JogOut((j) => room.send({ t: "press", to, side, press: "jog", mode: jogs[side].mode, ...j }));
    jogsOut[side] = { to, out };
    return out;
  }
  /** Who holds each of your platters from their page, and when they last said so (this page's clock). */
  const heldFar: [{ from: number; at: number } | null, { from: number; at: number } | null] = [null, null];
  function jogHere(from: number, e: JogPressed) {
    const jog = jogs[e.side], now = performance.now();
    if (!decks.decks[e.side].track) return;
    if (jog.mode !== e.mode) jog.setMode(e.mode);
    if (e.touch !== undefined) { jog.touch(e.touch); heldFar[e.side] = e.touch ? { from, at: now } : null; }
    if (e.turns) jog.turn(e.part, e.turns, now, JOG_SEND_MS * 3);
    if (heldFar[e.side]?.from === from) heldFar[e.side]!.at = now;
    say();
  }
  function view(side: Side): DeckView {
    const theirs = far(side);
    if (theirs && room) return farView(theirs, room.now(), room.nameOf(theirs.owner), waveIn(theirs.say.wave));
    const tube = tubes[side];
    if (tube) return tube.view();
    const s = decks.decks[side].state(), t = decks.decks[side].track;
    return { name: s.name, who: null, bpm: s.bpm, key: s.key ? `${s.key.camelot} ${s.key.name}` : null, pos: s.pos, len: s.length, playing: s.playing, cue: s.cue, wave: t ? (over.get(t) ?? new Float32Array(0)) : new Float32Array(0) };
  }
  const wavesIn = new Map<string, Float32Array>();
  function waveIn(w: string) { let f = wavesIn.get(w); if (!f) { if (wavesIn.size > 8) wavesIn.clear(); f = waveFrom(w); wavesIn.set(w, f); } return f; }
  const wavesOut = new Map<Track, string>();
  const said: [DeckSay | null, DeckSay | null] = [null, null], saidAt = [0, 0];
  let onPa = false;
  /** The mixer as last said (at first as it came up, so a mixer nobody touched says nothing). */
  let saidMix = JSON.stringify(mixOf(decks.mixer.state()));
  /** What's on your decks to the room: on a change, and every SAY_EVERY_MS while a track is on. `now`: right away. */
  function say(now = false) {
    if (!room) return;
    const t = room.now();
    // the mixer's faders and knobs: on a change only, at most once a say tick (the room's 3D mixer and your hand on it)
    const mix = mixOf(decks.mixer.state()), mixed = JSON.stringify(mix);
    if (mixed !== saidMix) { saidMix = mixed; room.send(mix); }
    for (const side of [0, 1] as const) {
      const d = decks.decks[side], tr = d.track, tube = tubes[side];
      if (tube) {
        // a YouTube deck: its video, where it is and its speed, for each listener's page to play (room-tube.ts)
        if (!tube.isReady()) continue;
        const v = tube.view(), m = decks.mixer;
        const next = tubeSayOf(side, { id: tube.id, name: tube.title, len: v.len, pos: v.pos, cue: v.cue, playing: v.playing, rate: tube.rate(), vol: tubeVolume(m.channels[DECK_CHANNEL[side]]!.s, m.xfader, m.curve, m.master) }, t);
        if (!now && !changed(said[side], next) && t - saidAt[side]! < SAY_EVERY_MS) continue;
        room.send(next);
        said[side] = next; saidAt[side] = t;
        continue;
      }
      if (!tr && !said[side]?.name) continue;
      if (tr && !wavesOut.has(tr)) wavesOut.set(tr, waveOf(over.get(tr) ?? peaks(tr.mono, 600)));
      const next = sayOf(side, d.state(), tr ? wavesOut.get(tr)! : "", t);
      if (!now && !changed(said[side], next) && t - saidAt[side]! < SAY_EVERY_MS) continue;
      room.send(next);
      said[side] = next; saidAt[side] = t;
    }
    // your master to the room's PA while you have a track on and one has played
    const on = decks.decks.some((d) => d.track && (d.playing || d.state().pos > 0));
    if (on !== onPa) { onPa = on; room.toPa(on ? decks.stream : null, decks.decks.find((d) => d.playing)?.track?.name ?? ""); }
  }
  if (room) setInterval(() => {
    const now = performance.now();
    room.booth.sweep(now);
    for (const side of [0, 1] as const) {
      jogs[side].tick(now); jogsOut[side]?.out.tick(now);
      // a platter held from a page that went quiet lets go
      const h = heldFar[side];
      if (h && now - h.at > JOG_LOST_MS) { heldFar[side] = null; jogs[side].touch(false); }
    }
    say();
  }, 250);
  function heard(from: number, e: DeckSay | DeckPress) {
    if (!room) return;
    if (e.t === "press") return void (e.press === "jog" ? jogHere(from, e) : pressHere(e.side, e.press, e.x));
    if (room.booth.heard(from, e, performance.now(), !!decks.decks[e.side].track || !!tubes[e.side])) {
      // they loaded onto a deck you had: yours comes off
      decks.decks[e.side].unload(); dropTube(e.side);
      said[e.side] = null;
      flash(`${room.nameOf(from)} took deck ${e.side ? "B" : "A"}`);
    }
  }
  function drawPeople() {
    if (!room || people.hidden) return;
    const { lead, people: list } = room.djs();
    people.replaceChildren(el("h3", {}, "On the decks"));
    const ul = el("ul");
    for (const p of list) {
      const li = el("li"), n = el("span");
      n.textContent = p.you ? `${p.name} (you)` : p.name;
      li.append(n);
      if (lead && !p.you) {
        const b = button(p.on ? "On" : "Off", p.on ? `Take ${p.name} off the decks` : `Let ${p.name} play the decks`, p.on ? "on" : "");
        b.addEventListener("click", () => { room.setDj(p.id, !p.on); setTimeout(drawPeople, 300); });
        li.append(b);
      } else li.append(el("small", {}, p.refused ? "refused" : p.on ? "may play" : "listening"));
      if (!p.you && room.runs?.()) {
        const r = button(ICON.ban, p.refused ? `Let ${p.name} back on the decks` : `Refuse ${p.name} the decks (they still dance and listen)`, p.refused ? "on" : "");
        r.addEventListener("click", () => { room.refuse?.(p.id, !p.refused); setTimeout(drawPeople, 300); });
        li.append(r);
      }
      if (!p.you && lead && room.setMod) {
        const m = button(ICON.shield, p.mod ? `${p.name} moderates: take it back` : `Make ${p.name} a moderator`, p.mod ? "on" : "");
        m.addEventListener("click", () => { room.setMod?.(p.id, !p.mod); setTimeout(drawPeople, 300); });
        li.append(m);
      }
      ul.append(li);
    }
    if (!list.length) ul.append(el("li", {}, "<small>Nobody's in the room yet: invite a friend, then let them on here.</small>"));
    people.append(ul);
    if (!room.may().ok) { const ask = button(`${ICON.hand}<span>Ask to play</span>`, "Raise your hand: the leader lets you on the decks"); ask.addEventListener("click", () => { room.ask(); flash("Hand up: the leader sees it"); }); people.append(ask); }
    if (lead) people.append(el("p", {}, "You lead this room: press a name to let them play the decks."));
  }

  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (root.hidden) return;
    const now = performance.now();
    players[0].draw(now); players[1].draw(now); drawZoom();
    jogsOut[0]?.out.tick(now); jogsOut[1]?.out.tick(now);
    zoomLabel.textContent = `±${zoomS()} s`;
    mixer.draw();
    const m = decks.mixer;
    for (const side of [0, 1] as const) tubes[side]?.follow(decks.decks[side].rate(), tubeVolume(m.channels[DECK_CHANNEL[side]]!.s, m.xfader, m.curve, m.master));
    quant.classList.toggle("on", decks.quantize);
    if (performance.now() > noteUntil && note.textContent) note.textContent = "";
  }
  raf = requestAnimationFrame(frame);

  // ---- keys, while it's open (prefs.ts has the map; Settings changes it)
  const downKeys = new Set<string>();
  /** The action waiting for a key in Settings. */
  let listening: Action | null = null;
  function key(e: KeyboardEvent) {
    if (root.hidden || e.target instanceof HTMLInputElement && e.target.type !== "range") return;
    if (listening) {
      if (e.code !== "Escape") setPrefs(bindKey(prefs, listening, e.code));
      listening = null; drawPrefs();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (e.code === "Escape") { if (!prefsBox.hidden) { prefsBox.hidden = true; prefsB.classList.remove("on"); } else close(); e.preventDefault(); return; }
    const a = actionOf(prefs, e.code);
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    // a key held down repeats: only the crossfader slides on with it, so a nudge is one move a press
    if (e.repeat && a !== "xLeft" && a !== "xRight") return;
    if (a === "xLeft" || a === "xRight") return void decks.cross(decks.xfader + (a === "xLeft" ? -0.1 : 0.1));
    const da = deckAction(a)!;
    downKeys.add(e.code);
    if (da.what === "play") press(da.side, "play");
    else if (da.what === "cue") press(da.side, "cueDown");
    else if (da.what.startsWith("hot")) { const h = HOTS[Number(da.what.slice(3)) - 1]; if (h) press(da.side, h); }
    else if (da.what === "nudgeBack" || da.what === "nudgeOn") nudge(da.side, "tap", da.what === "nudgeBack" ? -1 : 1);
    else if (da.what === "fastBack" || da.what === "fastOn") nudge(da.side, "hold", da.what === "fastBack" ? -1 : 1);
  }
  function keyUp(e: KeyboardEvent) {
    if (!downKeys.delete(e.code)) return;
    const a = actionOf(prefs, e.code), da = a && deckAction(a);
    if (!da) return;
    if (da.what === "cue") press(da.side, "cueUp");
    else if (da.what === "fastBack" || da.what === "fastOn") nudge(da.side, "hold", 0);
    e.preventDefault(); e.stopPropagation();
  }
  window.addEventListener("keydown", key, true);
  window.addEventListener("keyup", keyUp, true);

  // ---- Settings: the nudge amount, the locks, the waveform, the keys
  function setPrefs(p: Prefs) { prefs = p; savePrefs(p); }
  function drawPrefs() {
    if (prefsBox.hidden) return;
    prefsBox.replaceChildren(el("h3", {}, "Settings"));
    const row = (label: string, ...kids: HTMLElement[]) => { const r = el("div", { class: "dj-prefs-row" }), l = el("span"); l.textContent = label; r.append(l, ...kids); return r; };
    const amt = el("input", { type: "number", min: String(NUDGE_MS.min), max: String(NUDGE_MS.max), step: "1", value: String(prefs.nudgeMs), "aria-label": "Nudge amount, ms a press", class: "dj-prefs-ms" });
    amt.addEventListener("change", () => { const v = Math.round(Number(amt.value)); setPrefs({ ...prefs, nudgeMs: Number.isFinite(v) ? Math.min(NUDGE_MS.max, Math.max(NUDGE_MS.min, v)) : NUDGE_MS.start }); drawPrefs(); });
    prefsBox.append(row("Nudge, ms a press", amt), el("p", {}, `The ${FAST_TIMES}× nudge is held: the deck drifts ${FAST_TIMES * prefs.nudgeMs} ms a second while you hold it.`));
    const pick = <K extends "wave" | "grab">(label: string, k: K, opts: readonly [Prefs[K], string, string][]) => row(label, ...opts.map(([v, word, tip]) => {
      const b = button(word, tip, prefs[k] === v ? "on" : "");
      b.addEventListener("click", () => { setPrefs({ ...prefs, [k]: v }); drawPrefs(); });
      return b;
    }));
    prefsBox.append(
      pick("Waveform", "wave", [["tone", "Sound", "Coloured by its sound: bass one end of the deck's colours, claps and hats the other"], ["plain", "Plain", "One colour a deck"]]),
      pick("Grab the waveform", "grab", [["vinyl", "Vinyl", "Holds the track under your hand: drag to scratch, let go and it plays on"], ["slide", "Slide", "Drag to move the track; it keeps playing"]]),
    );
    const locks = el("div", { class: "dj-prefs-locks" });
    for (const [k, word, tip] of [["lockPitch", "Pitch faders", "The tempo faders don't move (sync and the keys still do)"], ["lockJog", "Jog wheels", "The jog wheels ignore the mouse and the scroll wheel"], ["lockWave", "Waveform grab", "A press on the close-up does nothing"], ["lockLoad", "Load while playing", "A track can't go onto a playing deck"]] as const) {
      const b = button(word, `Lock: ${tip}`, prefs[k] ? "on" : "");
      b.addEventListener("click", () => { setPrefs({ ...prefs, [k]: !prefs[k] }); drawPrefs(); });
      locks.append(b);
    }
    prefsBox.append(el("h4", {}, "Locks"), locks, el("h4", {}, "Keys"));
    const keys = keysOf(prefs), list = el("div", { class: "dj-prefs-keys" });
    for (const a of ACTIONS) {
      const n = el("span"); n.textContent = ACTION_LABEL[a];
      const b = button(listening === a ? "Press a key…" : keyName(keys[a]), `${ACTION_LABEL[a]}: press, then the key (Esc keeps it)`, listening === a ? "on" : "");
      b.addEventListener("click", () => { listening = listening === a ? null : a; drawPrefs(); });
      list.append(n, b);
    }
    const reset = button("Reset keys", "Every key back to how it started");
    reset.addEventListener("click", () => { setPrefs({ ...prefs, keys: {} }); drawPrefs(); });
    const all = button("Reset all", "Every setting back to how it started");
    all.addEventListener("click", () => { setPrefs({ ...DEFAULT_PREFS }); drawPrefs(); });
    prefsBox.append(list, row("", reset, all));
  }

  function open() { if (!root.hidden) return; root.hidden = false; void o.ctx.resume(); o.onToggle?.(true); }
  function close() { if (root.hidden) return; root.hidden = true; o.onToggle?.(false); }
  closeB.addEventListener("click", close);
  if (o.startOpen) open();
  void raf;
  return { decks, press, heard, view, open, close, isOpen: () => !root.hidden, load: (side, name, bytes) => load(side, name, bytes), library: () => shelf.map((s) => s.track.name), waiting: () => ({ names: waiting.map((f) => f.name), reading: reading?.name ?? null }), demos, jogs,
    zoom: (i) => { if (i !== undefined) setZoom(i); return { at: zoomAt, seconds: zoomS() }; },
    tube: (side, link) => { const id = videoId(link); return id ? putTube(side, id) : Promise.resolve(false); },
    tubes: () => tubes.map((t) => (t ? { id: t.id, title: t.title, pos: t.pos(), playing: t.isPlaying() } : null)),
    prefs: (to) => { if (to) { setPrefs({ ...prefs, ...to }); drawPrefs(); } return prefs; },
    nudge };
}
