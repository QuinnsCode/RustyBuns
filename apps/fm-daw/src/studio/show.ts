// The jam room's show desk (#6474): the room's lights as DMX fixtures, a few faders and scenes, and the four doors
// into one control map (../control/map.ts): MIDI, OSC (through the local bridge, scripts/show-bridge.ts), the desk's
// own buttons with Cmd+K and WebMCP, and OBS, which the same controls switch. DMX goes out through the bridge
// (Art-Net, sACN) or a USB dongle (Web Serial). The lights are this browser's: others in the room don't see the desk.
// Opened with ?view=stream (an OBS browser source), it only mirrors the lights another desk sends through the bridge.
import "./show.css";
import { hex } from "@rustybuns/util/bytes";
import { PORTS } from "@rustybuns/util/ports";
import { connectSocket, type Link } from "@rustybuns/util/socket";
import type { Command } from "@rustybuns/util/commands";
import { check, num, obj, str } from "@rustybuns/util/guard";
import { icon } from "../amp/icons.ts";
import { CHANNELS, enttecFrame, FOOTPRINT, litAt, slot, UNIVERSE, type Channel } from "../control/dmx.ts";
import { fixturesIn, type Fixture } from "../control/fixtures.ts";
import { controlMap, learnedMap, type Control, type Drove, type Signal } from "../control/map.ts";
import { keyLabel, midiSignal } from "../control/midi.ts";
import { oscAddress, oscSignal, type OscArg } from "../control/osc.ts";
import { connectObs, OBS_URL, type Obs } from "../control/obs.ts";
import { readWire, type Wire } from "../control/wire.ts";
import { MASTER_MIN } from "../project.ts";
import { LESSONS } from "./lessons.ts";

const BRIDGE_URL = `ws://127.0.0.1:${PORTS.showBridge}`;

/** Web Serial, as far as a DMX dongle needs it. */
interface DmxPort { open(o: { baudRate: number }): Promise<void>; readonly writable: WritableStream<Uint8Array> | null }
type WithSerial = Navigator & { serial?: { requestPort(): Promise<DmxPort> } };

export interface ShowDeps {
  scene: { traverse(f: (o: object) => void): void };
  /** ?view=stream: no desk, only the lights the bridge hands on. */
  stream: boolean;
  /** The room's level in dB, MASTER_MIN to 0; `set` answers why not, or null. */
  master: { value(): number; set(db: number): string | null };
  /** Start a setup lesson, or leave it (null): why not, or null. */
  lesson(id: string | null): string | null;
  say(text: string): void;
  onOpen(): void;
}

const SCENES = { full: null, warm: [255, 170, 90], cool: [90, 150, 255], blackout: null, release: null } as const;
type Scene = keyof typeof SCENES;
const COLOURS = ["red", "green", "blue"] as const;
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function mountShow(o: ShowDeps) {
  const universe = new Uint8Array(UNIVERSE);
  let found: Fixture[] = [];
  const lamps = () => (found.length ? found : (found = fixturesIn(o.scene)));
  /** What each fixture last got, so one the desk never touched is left alone. */
  const shown: string[] = [];
  let bridge: Link<Wire> | null = null, bridgeUp = false;
  let serial: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let obs: Obs | null = null;

  // ---- the lights

  function apply() {
    lamps().forEach((f, i) => {
      const lit = litAt(universe, i), key = lit ? JSON.stringify(lit) : "";
      if (key === (shown[i] ?? "")) return;
      shown[i] = key;
      f.set(lit);
    });
  }
  const channels = () => universe.slice(0, lamps().length * FOOTPRINT);
  function out() {
    apply();
    if (!lamps().length) return;
    const data = channels();
    bridge?.send({ t: "dmx", data: [...data] });
    void serial?.write(enttecFrame(data)).catch(() => { serial = null; o.say("The DMX dongle stopped answering"); paint(); });
  }
  /** The first touch of a fixture starts it at full, in its own colour, pointed straight ahead. */
  function take(i: number) {
    if (!litAt(universe, i)) universe.set([255, ...lamps()[i]!.home, 128, 128], i * FOOTPRINT);
  }
  function setChannel(which: number[], ch: Channel, v: number) {
    for (const i of which) { take(i); universe[slot(i, ch)] = Math.round(v * 255); }
    out();
  }
  function scene(name: Scene) {
    lamps().forEach((f, i) => {
      if (name === "release") return void universe.fill(0, i * FOOTPRINT, (i + 1) * FOOTPRINT);
      take(i);
      universe[slot(i, "dimmer")] = name === "blackout" ? 0 : 255;
      const colour = SCENES[name] ?? (name === "full" ? f.home : null);
      if (colour) universe.set(colour, slot(i, "red"));
    });
    out();
  }

  // ---- what can be driven

  const level = (id: string, label: string, drive: (v: number) => string | null, value: () => number): Control => ({ id, label, kind: "level", drive, value });
  const press = (id: string, label: string, drive: () => string | null): Control => ({ id, label, kind: "press", drive: () => drive() });
  const lightControls = (prefix: string, label: string, which: number[]) => CHANNELS.map((ch) => level(`${prefix}.${ch}`, `${label}: ${ch}`, (v) => { setChannel(which, ch, v); return null; },
      () => (litAt(universe, which[0]!) ? universe[slot(which[0]!, ch)]! / 255 : ch === "dimmer" ? 1 : ch === "pan" || ch === "tilt" ? 0.5 : lamps()[which[0]!]!.home[COLOURS.indexOf(ch)]! / 255)));
  const obsDo = (type: string, data?: Record<string, string>) => () => (obs ? (obs.send(type, data), null) : "OBS isn't connected: the show desk connects it");

  function controls(): Control[] {
    const l = lamps(), all = l.map((_, i) => i);
    return [
      ...(l.length ? [
        ...lightControls("lights", "All lights", all),
        ...l.flatMap((f, i) => lightControls(`light.${i + 1}`, f.name, [i])),
        ...(Object.keys(SCENES) as Scene[]).map((s) => press(`scene.${s}`, `Lights: ${cap(s)}`, () => { scene(s); return null; })),
      ] : []),
      level("room.level", "Room level", (v) => o.master.set(Math.round(MASTER_MIN * (1 - v))), () => 1 - o.master.value() / MASTER_MIN),
      ...LESSONS.map((x) => press(`lesson.${x.id}`, `Lesson: ${x.title}`, () => o.lesson(x.id))),
      press("lesson.leave", "Leave the lesson", () => o.lesson(null)),
      press("obs.record", "OBS: record, or stop", obsDo("ToggleRecord")),
      press("obs.record.start", "OBS: start recording", obsDo("StartRecord")),
      press("obs.record.stop", "OBS: stop recording", obsDo("StopRecord")),
      press("obs.stream", "OBS: stream, or stop", obsDo("ToggleStream")),
      press("obs.stream.start", "OBS: start the stream", obsDo("StartStream")),
      press("obs.stream.stop", "OBS: stop the stream", obsDo("StopStream")),
      ...(obs?.scenes() ?? []).map((name) => press(`obs.scene.${name}`, `OBS scene: ${name}`, obsDo("SetCurrentProgramScene", { sceneName: name }))),
    ];
  }

  const learned = learnedMap("qollab-studio:control-map");
  const map = controlMap(controls, learned);

  // ---- the doors

  const sendOsc = (address: string, args: OscArg[]) => bridgeUp && !!bridge?.send({ t: "osc", address, args });
  /** What was just driven, said back over OSC, so a TouchOSC fader or a mixer follows (never back to who sent it). */
  function drove(r: Drove | null, fromOsc = false) {
    if (r?.ok && !fromOsc) sendOsc(oscAddress(r.id), [r.value]);
    if (r && !r.ok) o.say(r.why);
    paint();
    return r;
  }
  const drive = (id: string, value = 1) => drove(map.drive(id, value))!;
  const door = (s: Signal) => {
    const was = map.armed(), r = drove(map.handle(s), s.source === "osc");
    if (was && !map.armed()) o.say(`${s.source === "osc" ? s.key : `${s.source} ${keyLabel(s.key)}`} now drives ${was}`);
    return r;
  };

  const midi = (device: string, data: ArrayLike<number>) => { const s = midiSignal(device, data); return s && door(s); };
  let access: MIDIAccess | null = null;
  async function connectMidi(): Promise<string> {
    if (!("requestMIDIAccess" in navigator)) return "This browser has no MIDI";
    if (!access) {
      try { access = await navigator.requestMIDIAccess({ sysex: false }); } catch { return "MIDI wasn't allowed"; }
      const heard = new WeakSet<MIDIInput>();
      const listen = () => {
        for (const input of access!.inputs.values()) {
          if (heard.has(input)) continue;
          heard.add(input);
          // beside the room's own listener (ui/input.ts), which plays the notes
          input.addEventListener("midimessage", (e) => { if (e instanceof MIDIMessageEvent && e.data) midi(input.name ?? "a controller", e.data); });
          void input.open();
        }
      };
      access.addEventListener("statechange", listen);
      listen();
    }
    const names = [...access.inputs.values()].map((i) => i.name ?? "a controller");
    return names.length ? `MIDI: ${names.join(", ")}` : "No MIDI controller found: plug one in, it joins when it appears";
  }

  function connectBridge(url = BRIDGE_URL): Promise<boolean> {
    bridge?.close();
    bridgeUp = false;
    return new Promise((done) => {
      bridge = connectSocket<Wire, Wire>(url, {
        decode: readWire,
        onMessage(m) {
          if (m.t === "osc") { if (!o.stream) door(oscSignal(m)); }
          else if (o.stream) { universe.fill(0); universe.set(m.data); apply(); }
        },
        onOpen() { bridgeUp = true; done(true); if (!o.stream && shown.some(Boolean)) out(); paint(); },
        onClose({ seen, tries }) {
          bridgeUp = false;
          done(false);
          paint();
          // a bridge that was never there isn't asked for again, but the stream view waits for one
          return o.stream || seen || tries < 3 ? 2000 : null;
        },
      });
    });
  }

  async function connectSerial(): Promise<string> {
    const api = (navigator as WithSerial).serial;
    if (!api) return "This browser has no Web Serial: use Chrome or Edge, or the bridge";
    try {
      const port = await api.requestPort();
      await port.open({ baudRate: 57600 });
      serial = port.writable?.getWriter() ?? null;
    } catch { return "The dongle didn't open"; }
    out();
    paint();
    return serial ? "DMX dongle connected" : "The dongle didn't open";
  }

  async function obsConnect(url: string, password: string): Promise<string> {
    obs?.close();
    obs = null;
    try {
      obs = await connectObs(url, password, { changed: () => paint(true), said: o.say, closed: () => { obs = null; paint(true); o.say("OBS went away"); } });
    } catch (e) { return e instanceof Error ? e.message : "No OBS there"; }
    paint(true);
    return "OBS connected";
  }

  // ---- the desk

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: { [name: string]: string | boolean } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag), plain: HTMLElement = e;
    Object.assign(plain, props);
    plain.append(...kids);
    return e;
  };
  const button = (text: string, act: () => void) => { const b = el("button", { type: "button" }, text); b.addEventListener("click", act); return b; };
  const row = (...kids: (Node | string)[]) => el("div", { className: "sd-row" }, ...kids);
  const status = el("p", { className: "sd-status" });
  const note = (text: string) => { status.textContent = text; };

  const faders: { id: string; input: HTMLInputElement }[] = [];
  const swatches: { prefix: string; input: HTMLInputElement }[] = [];
  function fader(id: string, label: string) {
    const input = el("input", { type: "range", min: "0", max: "1", step: "0.01" });
    input.setAttribute("aria-label", label);
    input.dataset.control = id;
    input.addEventListener("input", () => drive(id, Number(input.value)));
    faders.push({ id, input });
    return input;
  }
  function swatch(prefix: string, label: string) {
    const input = el("input", { type: "color" });
    input.setAttribute("aria-label", `${label}: colour`);
    input.addEventListener("input", () => COLOURS.forEach((c, i) => drive(`${prefix}.${c}`, parseInt(input.value.slice(1 + i * 2, 3 + i * 2), 16) / 255)));
    swatches.push({ prefix, input });
    return input;
  }

  const lightRows = el("div"), pick = el("select"), pairs = el("ul"), obsLive = el("div");
  const learnButton = button("Learn", () => { map.arm(map.armed() ? null : pick.value); paint(); });
  const bridgeUrl = el("input", { type: "text", value: BRIDGE_URL, spellcheck: false });
  bridgeUrl.setAttribute("aria-label", "Bridge address");
  const obsUrl = el("input", { type: "text", value: OBS_URL, spellcheck: false });
  obsUrl.setAttribute("aria-label", "OBS address");
  const obsPass = el("input", { type: "password", placeholder: "OBS password", autocomplete: "off" });
  obsPass.setAttribute("aria-label", "OBS password");
  const close = button("", () => { box.hidden = true; });
  close.append(icon("x")); close.title = "Close"; close.setAttribute("aria-label", "Close the show desk");
  const box = el("section", { id: "show-desk", hidden: true },
    el("header", {}, el("h2", {}, "Show desk"), close),
    lightRows,
    el("h3", {}, "Room"), row(el("span", {}, "Level"), fader("room.level", "Room level")),
    el("h3", {}, "From outside"),
    row(button("MIDI", () => void connectMidi().then(note)), button("USB DMX", () => void connectSerial().then(note))),
    row(bridgeUrl, button("Bridge", () => void connectBridge(bridgeUrl.value).then((ok) => note(ok ? "Bridge connected: OSC, Art-Net and sACN go through it" : "No bridge there: bun scripts/show-bridge.ts in apps/fm-daw")))),
    row(pick, learnButton),
    pairs,
    el("h3", {}, "OBS"), row(obsUrl), row(obsPass, button("Connect", () => void obsConnect(obsUrl.value, obsPass.value).then(note))),
    obsLive,
    status);
  box.setAttribute("aria-label", "Show desk");
  // typing and fader keys here aren't walking or playing
  for (const t of ["keydown", "keyup"]) box.addEventListener(t, (e) => { if (e instanceof KeyboardEvent && e.code !== "Escape") e.stopPropagation(); });
  if (!o.stream) document.body.append(box);

  /** The parts that follow the room and OBS: built when the desk opens, and again when OBS's scenes change. */
  function build() {
    const l = lamps();
    faders.splice(0, faders.length, ...faders.filter((f) => f.id === "room.level"));
    swatches.length = 0;
    lightRows.replaceChildren(el("h3", {}, "Lights"), ...(l.length ? [
      row(el("span", {}, "All"), fader("lights.dimmer", "All lights: dimmer"), swatch("lights", "All lights")),
      row(el("span", {}, "Pan"), fader("lights.pan", "All lights: pan")),
      row(el("span", {}, "Tilt"), fader("lights.tilt", "All lights: tilt")),
      ...l.map((f, i) => row(el("span", {}, f.name), fader(`light.${i + 1}.dimmer`, `${f.name}: dimmer`), swatch(`light.${i + 1}`, f.name))),
      row(...(Object.keys(SCENES) as Scene[]).map((s) => button(cap(s), () => drive(`scene.${s}`)))),
    ] : [el("p", {}, "This room has no lamps the desk can run.")]));
    pick.setAttribute("aria-label", "Control to pair with MIDI or OSC");
    const was = pick.value;
    pick.replaceChildren(...controls().map((c) => el("option", { value: c.id }, c.label)));
    if (was) pick.value = was;
    obsLive.replaceChildren(...(obs ? [
      row(...obs.scenes().map((name) => { const b = button(name, () => drive(`obs.scene.${name}`)); b.setAttribute("aria-pressed", String(name === obs?.current())); return b; })),
      row(button("Record", () => drive("obs.record")), button("Stream", () => drive("obs.stream"))),
    ] : []));
  }

  function paint(again = false) {
    if (box.hidden) return;
    if (again) build();
    const all = controls();
    const at = (id: string) => all.find((c) => c.id === id)?.value?.() ?? 0;
    for (const f of faders) if (document.activeElement !== f.input) f.input.value = String(at(f.id));
    for (const s of swatches) s.input.value = `#${hex(Uint8Array.from(COLOURS, (c) => Math.round(at(`${s.prefix}.${c}`) * 255)))}`;
    learnButton.textContent = map.armed() ? "Move a control…" : "Learn";
    learnButton.setAttribute("aria-pressed", String(!!map.armed()));
    pairs.replaceChildren(...Object.entries(learned.all()).flatMap(([source, keys]) => Object.entries(keys).map(([key, id]) => {
      const said = source === "osc" ? key : `${source} ${keyLabel(key)}`;
      const forget = button("", () => { learned.forget(source, key); paint(); });
      forget.append(icon("x", 14)); forget.title = `Forget ${said}`; forget.setAttribute("aria-label", forget.title);
      return el("li", {}, el("span", {}, `${said} → ${all.find((c) => c.id === id)?.label ?? id}`), forget);
    })));
  }
  function open() {
    if (o.stream) return;
    box.hidden = false;
    o.onOpen();
    paint(true);
  }

  // ---- Cmd+K and WebMCP: the same drive

  const DriveArgs = obj({ control: str(300), value: num(0, 1, 1) });
  const ControlArg = obj({ control: str(300) });
  const OscArgs = obj({ address: str(300, { re: /^\// }), value: num(-1e9, 1e9, 1) });
  const bad = { ok: false, why: "Those aren't the tool's arguments. Its inputSchema says what it takes." };
  const press_ = (name: string, title: string, id: string): Command => ({ name, title, group: "Show", description: `${title} (the show desk's ${id}).`, execute: () => drive(id) });
  const commands: Command[] = o.stream ? [] : [
    { name: "studio_show_desk", group: "Show", title: "Show desk: lights, MIDI, OSC, OBS", description: "Open the show desk.", execute: () => open() },
    { name: "studio_show_controls", group: "Show", title: "List the show desk's controls", palette: false, annotations: { readOnlyHint: true },
      description: "Every control the show desk can drive (id, label, level or press, a level's value 0 to 1), the OSC address each answers to is /qollab/ and its id with slashes.",
      execute: () => ({ controls: controls().map((c) => ({ id: c.id, label: c.label, kind: c.kind, ...(c.value ? { value: Math.round(c.value() * 1000) / 1000 } : {}) })) }) },
    { name: "studio_show_drive", group: "Show", title: "Drive a show control", ask: "control id and value 0 to 1",
      description: "Set a level (value 0 to 1) or press a button on the show desk: light.1.dimmer, lights.red, scene.warm, room.level, lesson.pa, obs.record.",
      inputSchema: { type: "object", properties: { control: { type: "string" }, value: { type: "number", description: "0 to 1; left out: 1" } }, required: ["control"] },
      execute: (a) => { const args = check(DriveArgs, a); return args ? drive(args.control, args.value) : bad; } },
    { name: "studio_show_learn", group: "Show", title: "Pair a control with MIDI or OSC", ask: "control id",
      description: "The next MIDI or OSC message that comes in drives this control from now on.",
      inputSchema: { type: "object", properties: { control: { type: "string" } }, required: ["control"] },
      execute: (a) => { const args = check(ControlArg, a); if (!args) return bad; const armed = map.arm(args.control); paint(); return armed ? { ok: true, armed } : { ok: false, why: `No control ${args.control}` }; } },
    { name: "studio_osc_send", group: "Show", title: "Send an OSC message", ask: "address, such as /cue/1/start", palette: false,
      description: "Send one OSC message through the local bridge to its --osc-out targets (a mixer, QLab, TouchOSC).",
      inputSchema: { type: "object", properties: { address: { type: "string" }, value: { type: "number" } }, required: ["address"] },
      execute: (a) => { const args = check(OscArgs, a); if (!args) return bad; return sendOsc(args.address, [args.value]) ? { ok: true } : { ok: false, why: "No bridge: connect it on the show desk" }; } },
    press_("studio_lights_warm", "Lights: warm", "scene.warm"),
    press_("studio_lights_cool", "Lights: cool", "scene.cool"),
    press_("studio_lights_blackout", "Lights: blackout", "scene.blackout"),
    press_("studio_lights_release", "Lights: back to the room's own", "scene.release"),
    press_("studio_obs_record", "OBS: record, or stop", "obs.record"),
    press_("studio_obs_stream", "OBS: stream, or stop", "obs.stream"),
  ];

  if (o.stream) {
    document.body.classList.add("stream-view");
    const port = Number(new URLSearchParams(location.search).get("bridge"));
    void connectBridge(port > 0 && port < 65536 ? `ws://127.0.0.1:${port}` : BRIDGE_URL);
  }

  return {
    commands, open, drive, midi, connectBridge, obsConnect,
    learn: (id: string | null) => { const armed = map.arm(id); paint(); return armed; },
    /** The fixtures as they burn, the channels as sent, the pairings and what's connected. */
    state: () => ({ fixtures: lamps().map((f) => ({ name: f.name, ...f.seen() })), dmx: [...channels()], learned: structuredClone(learned.all()), armed: map.armed(), bridge: bridgeUp, obs: obs ? { scenes: obs.scenes(), current: obs.current() } : null }),
  };
}
