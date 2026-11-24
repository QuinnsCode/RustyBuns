// MIDI on the decks: one press connects every controller (and any plugged in later), the button counts them, and a
// second button shows the connections: a see-through tag on each control a controller drives ("DDJ-400 · CC 33 ch1"),
// floating over the decks and the mixer in a layer of its own, so nothing on them moves. With the tags shown the page
// learns: click a control, move one on the controller, and that is the pairing, kept in this browser by the
// controller's name (the tag's x forgets it). A message nothing learned goes to the jogs as player.ts `midiJog` reads
// it, the common layout. A learned control is driven as a hand drives it (a press, a fader's input, a knob's drag), so
// the decks' and mixer's own code stays as it is.
import "./midi.css";
import { check, rec, str } from "@rustybuns/util/guard";
import { button, el, svg } from "./dom.ts";
import { midiJog, TICKS_PER_TURN } from "./player.ts";
import type { Jog } from "./player-panel.ts";

// ---- messages

/** A note or a CC off a controller: its channel (0 to 15), number and value (0 to 127; a note off is 0). */
export interface MidiMsg { type: "note" | "cc"; ch: number; n: number; v: number }
export function parseMidi(data: ArrayLike<number>): MidiMsg | null {
  if (data.length < 3) return null;
  const kind = data[0]! & 0xf0, ch = data[0]! & 0x0f, n = data[1]!, v = data[2]!;
  if (kind === 0x90 || kind === 0x80) return { type: "note", ch, n, v: kind === 0x80 ? 0 : v };
  if (kind === 0xb0) return { type: "cc", ch, n, v };
  return null;
}
/** The key a learned pairing is kept under ("cc:0:33"), and how a tag says it ("CC 33 ch1"). */
export const msgKey = (m: MidiMsg) => `${m.type}:${m.ch}:${m.n}`;
export function keyLabel(key: string): string {
  const [type, ch, n] = key.split(":");
  return `${type === "cc" ? "CC" : "Note"} ${n} ch${Number(ch) + 1}`;
}

// ---- the learned map, kept in this browser: controller name -> message key -> control id

const KEY = "qdj.midi.map";
const MidiMap = rec(rec(str(200), 512), 64);
export type MidiMap = Record<string, Record<string, string>>;
function loadMap(): MidiMap { try { const s = localStorage.getItem(KEY); return (s && check(MidiMap, JSON.parse(s))) || {}; } catch { return {}; } }
function saveMap(m: MidiMap) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private window: this visit only */ } }

// ---- the controls a controller can drive

type Kind = "button" | "range" | "dial" | "jog";
interface Control { id: string; kind: Kind; el: HTMLElement; side: 0 | 1 | null }
const PICK = "button, input[type=range], [role=slider], canvas.dj-wheel";
const kindOf = (e: Element): Kind => e instanceof HTMLButtonElement ? "button" : e instanceof HTMLInputElement ? "range" : e instanceof HTMLCanvasElement ? "jog" : "dial";

/** Every control on the two decks and the mixer, each with an id that stays put between visits (where it is and its name). */
function controlsIn(root: HTMLElement): Control[] {
  const out: Control[] = [];
  const scopes: [Element, string, 0 | 1 | null][] = [...root.querySelectorAll(".dj-deck")].map((d, i) => [d, i ? "B" : "A", i ? 1 : 0] as [Element, string, 0 | 1]);
  const mx = root.querySelector(".mx");
  if (mx) scopes.push([mx, "mixer", null]);
  for (const [scope, name, side] of scopes) {
    const seen = new Map<string, number>();
    for (const e of scope.querySelectorAll<HTMLElement>(PICK)) {
      const said = (e.getAttribute("aria-label") || e.title || e.textContent || "?").trim().slice(0, 120);
      const n = (seen.get(said) ?? 0) + 1;
      seen.set(said, n);
      out.push({ id: `${name}: ${said}${n > 1 ? ` #${n}` : ""}`, kind: kindOf(e), el: e, side });
    }
  }
  return out;
}

/** What a controller does: the decks' jogs, the root the decks and mixer sit in, and the page's flash line. */
export function mountMidi(o: { root: HTMLElement; jogs: () => readonly [Jog, Jog]; flash: (text: string) => void }) {
  const { root, flash } = o, jogs = (side: 0 | 1) => o.jogs()[side];
  let map = loadMap();
  let access: MIDIAccess | null = null;
  /** Controllers fed by hand (the probe's), as if plugged in. */
  const fakes = new Set<string>();
  /** Every controller seen this visit, and whether it's still here. */
  const seen = new Map<string, boolean>();
  let shown = false, armed: string | null = null, driving = false;
  /** Buttons held down by a controller, so a CC stream presses once. */
  const down = new Set<string>();

  const ICON_MIDI = svg('<circle cx="12" cy="12" r="10"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="10" r="1"/><path d="M9 15h6"/>');
  const ICON_CABLE = svg('<path d="M17 21v-2a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1"/><path d="M19 15V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V9"/><path d="M21 21v-2h-4"/><path d="M3 5h4V3"/><path d="M7 5a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1V3"/>');
  const ICON_X = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 12);
  const connectB = button(`${ICON_MIDI}<span class="dj-count">0</span>`, "MIDI: connect your controllers (they join when plugged in)", "dj-midi");
  const showB = button(ICON_CABLE, "Show MIDI connections: a tag on each control a controller drives; click a control, then move one on the controller, to pair them", "dj-midi-show");
  connectB.addEventListener("click", () => void connect().then(flash));
  showB.addEventListener("click", () => show(!shown));

  // the layer the tags float in: over the decks, out of their flow
  const layer = el("div", { class: "dj-midi-layer", "aria-hidden": "true" });
  const hint = el("div", { class: "dj-midi-hint" });
  const ring = el("div", { class: "dj-midi-armed" });
  layer.append(hint, ring);
  layer.hidden = true;
  root.append(layer);
  const tags = new Map<string, HTMLElement>();

  const devices = () => [...seen].map(([name, connected]) => ({ name, connected }));
  const here = () => devices().filter((d) => d.connected).map((d) => d.name);
  function paintButton() {
    const n = here().length;
    connectB.querySelector(".dj-count")!.textContent = String(n);
    connectB.classList.toggle("on", n > 0);
    const t = n ? `MIDI: ${here().join(", ")}` : access ? "MIDI is on: plug a controller in, it joins when it appears" : "MIDI: connect your controllers (they join when plugged in)";
    connectB.title = t; connectB.setAttribute("aria-label", t);
  }

  /** Who's plugged in now, from the browser's list and the fakes; says who came and went. */
  function refresh() {
    const now = new Set<string>(fakes);
    if (access) for (const i of access.inputs.values()) if (i.state === "connected") { now.add(i.name ?? "a controller"); i.onmidimessage = (e) => { if (e.data) feed(i.name ?? "a controller", e.data); }; }
    for (const [name, was] of seen) if (was && !now.has(name)) { seen.set(name, false); flash(`${name} unplugged`); }
    for (const name of now) if (!seen.get(name)) { if (seen.has(name)) flash(`${name} is back`); seen.set(name, true); }
    paintButton();
  }

  async function connect(): Promise<string> {
    if (!access) {
      if (!("requestMIDIAccess" in navigator)) return "This browser has no MIDI";
      try { access = await navigator.requestMIDIAccess({ sysex: false }); } catch { return "MIDI wasn't allowed"; }
      access.onstatechange = refresh;
    }
    refresh();
    const n = here();
    return n.length ? `MIDI: ${n.join(", ")}` : "No MIDI controller found: plug one in, it joins when it appears";
  }

  // ---- a message in

  function feed(device: string, data: ArrayLike<number>) {
    if (!seen.get(device)) { seen.set(device, true); paintButton(); }
    const m = parseMidi(data);
    if (!m) return;
    const key = msgKey(m);
    if (armed && (m.type === "cc" || m.v > 0)) {
      const mine = (map[device] ??= {});
      for (const k of Object.keys(mine)) if (mine[k] === armed) delete mine[k];
      mine[key] = armed;
      saveMap(map);
      flash(`${device} · ${keyLabel(key)} now drives ${armed}`);
      armed = null;
      return;
    }
    const id = map[device]?.[key];
    const c = id ? controlsIn(root).find((x) => x.id === id) : undefined;
    if (c) { drive(c, m); return; }
    const j = midiJog(data);
    if (!j) return;
    if ("touch" in j) jogs(j.side).touch(j.touch); else jogs(j.side).turn(j.part, j.turns);
  }

  /** Move a control as a hand would: a press and let go, a fader's input, a knob's drag. */
  function drive(c: Control, m: MidiMsg) {
    driving = true;
    try {
      const at = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1 };
      if (c.kind === "button") {
        const on = m.type === "note" ? m.v > 0 : m.v >= 64;
        if (on === down.has(c.id)) return;
        if (on) { down.add(c.id); c.el.dispatchEvent(new PointerEvent("pointerdown", at)); }
        else { down.delete(c.id); c.el.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0 })); c.el.click(); }
      } else if (c.kind === "range" && c.el instanceof HTMLInputElement) {
        const lo = Number(c.el.min), hi = Number(c.el.max);
        c.el.value = String(lo + (m.v / 127) * (hi - lo));
        c.el.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (c.kind === "dial") {
        // the knob's own drag: 150 px up turns it the whole way
        const lo = Number(c.el.getAttribute("aria-valuemin")), hi = Number(c.el.getAttribute("aria-valuemax")), span = hi - lo;
        const target = lo + (m.v / 127) * span, now = Number(c.el.getAttribute("aria-valuenow") ?? target);
        c.el.dispatchEvent(new PointerEvent("pointerdown", { ...at, clientY: 0 }));
        c.el.dispatchEvent(new PointerEvent("pointermove", { ...at, clientY: -((target - now) / span) * 150 }));
        c.el.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0 }));
        c.el.releasePointerCapture?.(1);
        c.el.setAttribute("aria-valuenow", target.toFixed(4)); // the face reads it next frame; a burst reads this
      } else if (c.kind === "jog" && c.side !== null) {
        const jog = jogs(c.side);
        if (m.type === "note") jog.touch(m.v > 0);
        else { const ticks = m.v < 64 ? m.v : m.v - 128; if (ticks) jog.turn(jog.state().touched ? "top" : "ring", ticks / TICKS_PER_TURN); }
      }
    } finally { driving = false; }
  }

  // ---- learning: with the tags shown, a click on a control picks it instead of pressing it

  const pick = (e: Event) => {
    if (!shown || driving || !(e.target instanceof Element)) return;
    const hit = e.target.closest(PICK);
    if (!hit || !hit.closest(".dj-deck, .mx")) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type !== "pointerdown") return;
    armed = controlsIn(root).find((c) => c.el === hit)?.id ?? null;
  };
  for (const t of ["pointerdown", "pointerup", "click", "dblclick"]) root.addEventListener(t, pick, true);

  function show(on: boolean) {
    shown = on; armed = null;
    layer.hidden = !on;
    showB.classList.toggle("on", on);
    if (on) requestAnimationFrame(paint);
  }

  /** The tags: each learned pairing on its control, the jogs' own layout on each wheel, and the hint with the controllers. */
  function paint() {
    if (!shown) return;
    requestAnimationFrame(paint);
    const box = root.getBoundingClientRect();
    const ox = box.left + root.clientLeft, oy = box.top + root.clientTop;
    const cs = controlsIn(root);
    const lines = new Map<string, { text: string; device: string; key: string | null; gone: boolean }[]>();
    for (const [device, keys] of Object.entries(map)) for (const [key, id] of Object.entries(keys)) {
      const l = lines.get(id) ?? []; l.push({ text: `${device} · ${keyLabel(key)}`, device, key, gone: !seen.get(device) }); lines.set(id, l);
    }
    for (const c of cs) if (c.kind === "jog" && c.side !== null) for (const d of here()) {
      const l = lines.get(c.id) ?? []; l.push({ text: `${d} · CC 33/34, Note 54 ch${c.side + 1}`, device: d, key: null, gone: false }); lines.set(c.id, l);
    }
    const live = new Set<string>();
    for (const c of cs) {
      const l = lines.get(c.id);
      const r = c.el.getBoundingClientRect();
      if (!l || !r.width || r.right < box.left || r.left > box.right) continue;
      live.add(c.id);
      let tag = tags.get(c.id);
      if (!tag) { tag = el("div", { class: "dj-midi-tag" }); layer.append(tag); tags.set(c.id, tag); }
      const sig = JSON.stringify(l);
      if (tag.dataset.sig !== sig) {
        tag.dataset.sig = sig;
        tag.replaceChildren(...l.map((x) => {
          const row = el("span", { class: x.gone ? "gone" : "" });
          row.textContent = x.gone ? `${x.text} (gone)` : x.text;
          if (x.key) {
            const forget = button(ICON_X, `Forget ${x.text}`, "dj-midi-forget");
            forget.addEventListener("click", (e) => { e.stopPropagation(); clear(x.device, x.key!); });
            row.append(forget);
          }
          return row;
        }));
      }
      tag.style.transform = `translate(${Math.round(r.left - ox)}px, ${Math.round(r.top - oy)}px)`;
    }
    for (const [id, tag] of tags) if (!live.has(id)) { tag.remove(); tags.delete(id); }
    const a = armed ? cs.find((c) => c.id === armed) : undefined;
    ring.hidden = !a;
    if (a) { const r = a.el.getBoundingClientRect(); Object.assign(ring.style, { transform: `translate(${r.left - ox - 3}px, ${r.top - oy - 3}px)`, width: `${r.width + 6}px`, height: `${r.height + 6}px` }); }
    const said = armed ? `Now move a control on the controller for ${armed}` : "Click a knob, fader, button or jog, then move one on your controller";
    const devs = devices().map((d) => `${d.name}${d.connected ? "" : " (gone)"}`).join(", ") || "no controller yet: press MIDI";
    const text = `${said} · ${devs}`;
    if (hint.textContent !== text) hint.textContent = text;
  }

  function clear(device: string, key: string) {
    if (!map[device]?.[key]) return false;
    delete map[device][key];
    if (!Object.keys(map[device]).length) delete map[device];
    saveMap(map);
    return true;
  }

  return {
    buttons: [connectB, showB] as const,
    connect,
    /** The controllers, the learned pairings, whether the tags show and which control waits for a message. */
    state: () => ({ devices: devices(), mappings: structuredClone(map), shown, armed, tags: [...tags.keys()] }),
    show,
    /** The controls a controller can drive: their ids and kinds. */
    controls: () => controlsIn(root).map((c) => ({ id: c.id, kind: c.kind })),
    /** Pick a control to pair, as a click on it with the tags shown (null: none). */
    learn: (id: string | null) => { armed = id && controlsIn(root).some((c) => c.id === id) ? id : null; return armed; },
    /** A message as controller `device` sends it (a fake one plugs it in). */
    feed: (device: string, data: number[]) => { if (!access || ![...access.inputs.values()].some((i) => i.name === device)) fakes.add(device); feed(device, data); },
    /** Plug a fake controller in or pull it out. */
    plug: (device: string, on: boolean) => { if (on) fakes.add(device); else fakes.delete(device); refresh(); },
    clear,
  };
}
export type MidiPanel = ReturnType<typeof mountMidi>;
