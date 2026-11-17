// The DJ booth on the page: the table, the decks' moving parts (the platter at 33 1/3 rpm and the tonearm tracking in,
// the jog ring lit and the screen's waveform, the mixer's meters and faders), a card with the decks and the patch, and
// the decks as the sound source (audio/decks.ts) through the speakers you wired. main.ts calls `djBoothView` once per
// world, `key` for a key, `tick(dt)` each frame, and hands `audio` to the sound system.
import * as THREE from "three";
import { esc } from "@rustybuns/util";
import { gearParts } from "@rustybuns/models/gear";
import { type BoothJudged, boothOf, judgeBoothCables } from "./dj-booth.ts";
import { rig } from "./dive-bar.ts";
import type { Answer, World } from "../sim.ts";
import type { Cables } from "../cables/cables.ts";
import { type DeckSound, type Decks, type Mix, PITCH_RANGE, TRACKS, TRACK_BEATS, bpmOf, deckSound, mix, newDecks, play, setCross, setFader, setPitch, tickDecks } from "../audio/decks.ts";

/** 33 1/3 turns a minute, in radians a second. */
const RPM33 = ((100 / 3) * 2 * Math.PI) / 60;
const KEYS = ["deck-1", "deck-2"] as const;

export type DjBoothView = ReturnType<typeof djBoothView>;

export function djBoothView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World, getCables: () => Cables, meshOf: (key: string) => THREE.Object3D | undefined, say: (a: Answer) => unknown = () => {}) {
  const b = boothOf(getWorld().level), decks = newDecks();
  // The monitor stands and the tops' stands stand at their heights (the dive bar's stand store, which draw() reads).
  Object.assign(rig(getWorld()).stand, b.stands);
  let j: BoothJudged = judgeBoothCables(getWorld(), getCables()), m: Mix = mix(decks, KEYS, j.routing, j.hum), sound: DeckSound | null = null;

  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.7 }), black = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(b.table.w, 0.04, b.table.d), wood);
  top.position.set(b.table.x, b.table.h - 0.02, b.table.z);
  // A booth front: a skirt on the crowd's side and both ends, open on the DJ's side for knees and cables.
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(b.table.w, b.table.h - 0.04, 0.03), black);
  skirt.position.set(b.table.x, (b.table.h - 0.04) / 2, b.table.z + b.table.d / 2 - 0.015);
  group.add(top, skirt);
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.03, b.table.h - 0.04, b.table.d), black);
    end.position.set(b.table.x + s * (b.table.w / 2 - 0.015), (b.table.h - 0.04) / 2, b.table.z);
    group.add(end);
  }
  scene.add(group);

  // Each media deck's screen: a canvas with its track's waveform scrolling under the playhead.
  const screens = KEYS.map(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex, mat: new THREE.MeshBasicMaterial({ map: tex }), ring: new THREE.MeshBasicMaterial({ color: 0x202833 }) };
  });
  const dressed = new Set<THREE.Object3D>();
  const partsOf = (key: string) => {
    const g = meshOf(key);
    if (!g) return null;
    const parts = gearParts(g);
    if (!dressed.has(g)) {
      dressed.add(g);
      const i = KEYS.indexOf(key as (typeof KEYS)[number]);
      const paint = (name: string, mat: THREE.Material) => parts.get(name)?.traverse((o) => { if (o instanceof THREE.Mesh) o.material = mat; });
      if (i >= 0) paint("screen", screens[i]!.mat), paint("ring", screens[i]!.ring);
      for (const p of parts.values()) p.userData.home ??= p.position.clone();
    }
    return { g, parts };
  };

  function drawScreen(i: number) {
    const { canvas, tex } = screens[i]!, c = canvas.getContext("2d");
    if (!c) return;
    const k = decks.deck[i]!, n = i + 1;
    c.fillStyle = "#05070a";
    c.fillRect(0, 0, 256, 128);
    // The waveform: a bar per sixteenth, the kick's on the beat tall, scrolling past the playhead in the middle.
    for (let x = 0; x < 256; x += 2) {
      const at = k.beat + (x - 128) / 32, sixteenth = Math.floor(at * 4);
      if (at < 0 || at > TRACK_BEATS) continue;
      const h = (sixteenth % 4 === 0 ? 0.9 : sixteenth % 2 === 0 ? 0.45 : 0.3) * (0.75 + 0.25 * Math.sin(sixteenth * 1.7 + n));
      c.fillStyle = x < 128 ? "#2f6fb3" : "#7fc6ff";
      c.fillRect(x, 64 - h * 34, 2, h * 68);
    }
    c.fillStyle = "#ffffff";
    c.fillRect(127, 18, 2, 92);
    c.font = "bold 16px system-ui, sans-serif";
    c.fillText(`${n}  ${TRACKS[i]!.name}`, 8, 16);
    c.textAlign = "right";
    c.fillText(`${bpmOf(decks, n).toFixed(1)} BPM  ${k.pitch >= 0 ? "+" : ""}${k.pitch.toFixed(1)}%`, 248, 122);
    c.textAlign = "left";
    tex.needsUpdate = true;
  }

  function animate(dt: number) {
    const beatPulse = (i: number) => 0.75 + 0.25 * Math.cos(decks.deck[i]!.beat * 2 * Math.PI);
    KEYS.forEach((key, i) => {
      const p = partsOf(key), k = decks.deck[i]!;
      if (!p) return;
      const platter = p.parts.get("platter"), arm = p.parts.get("tonearm"), angles = p.g.userData.arm as { rest: number; outer: number; inner: number } | undefined;
      // Clockwise seen from above, at 33 1/3 moved by the pitch fader.
      if (platter && k.playing) platter.rotation.y -= RPM33 * (1 + k.pitch / 100) * dt;
      if (arm && angles) {
        const want = k.beat > 0 ? angles.outer + (angles.inner - angles.outer) * Math.min(1, k.beat / TRACK_BEATS) : angles.rest;
        arm.rotation.y += (want - arm.rotation.y) * Math.min(1, dt * 3);
      }
      if (p.parts.has("screen")) {
        screens[i]!.ring.color.setHex(k.playing ? 0x37a8ff : j.routing[key] ? 0x1d4f7a : 0x202833);
        drawScreen(i);
      }
    });
    const mx = partsOf("mixer");
    if (!mx) return;
    const travel = (mx.g.userData.faderTravel as number | undefined) ?? 0.06, crossTravel = (mx.g.userData.crossTravel as number | undefined) ?? 0.05;
    for (let ch = 1; ch <= 4; ch++) {
      const meter = mx.parts.get(`meter-${ch}`), fader = mx.parts.get(`fader-${ch}`);
      const deck = KEYS.findIndex((k) => j.routing[k] === ch);
      if (meter) meter.scale.y = Math.max(0.001, m.meter[ch - 1]! * (deck >= 0 && decks.deck[deck]!.playing ? beatPulse(deck) : 1));
      // Up is away from the DJ: the model's -z.
      if (fader) fader.position.z = (fader.userData.home as THREE.Vector3).z - (decks.fader[ch - 1]! - 0.5) * travel;
    }
    const cross = mx.parts.get("cross");
    if (cross) cross.position.x = (cross.userData.home as THREE.Vector3).x + (decks.cross * crossTravel) / 2;
  }

  const card = document.createElement("div");
  card.className = "bar-card";
  hud.append(card);
  let last = "";
  const atBooth = () => { const y = getWorld().you; return Math.abs(y.x - b.head.x) < 1 && Math.abs(y.z - b.head.z) < 0.7; };

  const view = {
    /** Hand this to the sound system: the decks' sound, made once the page's audio has started. */
    audio: (ctx: AudioContext) => (sound?.stop(), (sound = deckSound(ctx)).node),
    /** At the decks: 1 and 2 start and stop a deck, Z and X move the crossfader. */
    key(code: string): boolean {
      if (!atBooth()) return false;
      if (code === "Digit1" || code === "Digit2") return say(view.decks.play(code === "Digit1" ? 1 : 2)), true;
      if (code === "KeyZ" || code === "KeyX") return view.decks.cross(decks.cross + (code === "KeyZ" ? -0.25 : 0.25)), true;
      return false;
    },
    tick(dt: number): BoothJudged {
      j = judgeBoothCables(getWorld(), getCables());
      // A deck with no power stops where it is.
      KEYS.forEach((key, i) => { if (j.dead.includes(key)) decks.deck[i]!.playing = false; });
      tickDecks(decks, dt);
      m = mix(decks, KEYS, j.routing, j.hum);
      sound?.update(decks, m, KEYS, j.distort);
      animate(dt);
      const deckLine = (i: number) => {
        const key = KEYS[i]!, k = decks.deck[i]!, ch = j.routing[key];
        const warn = j.hum.includes(key) ? ' <span class="trip">hum: no ground wire</span>' : j.distort.includes(key) ? ' <span class="trip">distorting: phono input</span>' : "";
        return `Deck ${i + 1} ${k.playing ? "playing" : "stopped"}, ${bpmOf(decks, i + 1).toFixed(1)} BPM, ${ch ? `channel ${ch}` : "not wired in"}${warn}`;
      };
      const lines = [
        `<b>DJ booth (${b.kind === "vinyl" ? "turntables" : "media players"})</b>`,
        deckLine(0), deckLine(1),
        `Crossfader ${decks.cross === 0 ? "centre" : decks.cross < 0 ? `${Math.round(-decks.cross * 100)}% to A` : `${Math.round(decks.cross * 100)}% to B`}, master ${j.live ? "to the speakers" : "goes nowhere yet"}`,
        j.problems[0] ? `<small>${esc(j.problems[0].message)}</small>` : "<small>At the decks: 1 / 2 play, Z / X crossfader</small>",
      ];
      const html = lines.map((l) => `<div>${l}</div>`).join("");
      if (html !== last) card.innerHTML = last = html;
      return j;
    },
    hint: () => (atBooth() ? "1 / 2 start or stop a deck, Z / X crossfader" : null),
    /** What the harness reads as `state().decks`. */
    state: () => ({
      kind: b.kind,
      decks: decks.deck.map((k, i) => ({ deck: i + 1, track: TRACKS[i]!.name, playing: k.playing, pitch: k.pitch, bpm: Math.round(bpmOf(decks, i + 1) * 10) / 10, beat: Math.round(k.beat * 10) / 10, channel: j.routing[KEYS[i]!] ?? null })),
      fader: [...decks.fader], cross: decks.cross, mix: m.gain, meter: m.meter, hum: j.hum, distort: j.distort, live: j.live,
      problems: j.problems.map((p) => p.message),
    }),
    /** The harness's hands on the decks. */
    decks: {
      play: (n: number, on?: boolean): Answer => {
        const key = KEYS[n - 1];
        if (!key) return { ok: false, why: "deck 1 or 2" };
        j = judgeBoothCables(getWorld(), getCables());
        if (on !== false && j.dead.includes(key)) return { ok: false, why: `${key} has no power` };
        play(decks, n, on ?? !decks.deck[n - 1]!.playing);
        return { ok: true };
      },
      fader: (ch: number, v: number) => setFader(decks, ch, v),
      cross: (v: number) => setCross(decks, v),
      pitch: (n: number, pct: number) => setPitch(decks, n, pct),
      range: PITCH_RANGE,
    },
    dispose() {
      sound?.stop();
      sound = null;
      scene.remove(group);
      card.remove();
      for (const s of screens) s.tex.dispose();
    },
  };
  return view;
}
