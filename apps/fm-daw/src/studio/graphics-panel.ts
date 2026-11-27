// The page side of the graphics settings (graphics.ts, #6475): Settings' Graphics tab, a Cmd+K command (and WebMCP
// tool) for each knob, and the watch that feeds music first's step-down rule from the frames and the audio clock.
import type { Command } from "@rustybuns/util/commands";
import { check, int, num, obj, oneOf } from "@rustybuns/util/guard";
import {
  audioStress, CAPS, calm, govern, PRESETS, preset, PRIORITIES, SHADOWS, stepped, tweak,
  type Govern, type Graphics, type Preset, type Running,
} from "./graphics.ts";

const PRESET_LINES: Record<Preset, string> = {
  low: "A weak laptop or a phone: no post, four lights",
  medium: "Bloom on the lights, eight of them, no cast shadows",
  high: "Every light, cast shadows, the camera's lens",
  ultra: "High at your screen's full sharpness, a bigger crowd",
};
const SCALES = [0.5, 0.75, 1, 1.5, 2] as const;
const LIGHTS = [4, 8, 16, 64] as const;
const CROWDS = [0, 6, 12, 18] as const;
const SHADOW_WORDS: Record<Graphics["shadows"], string> = { off: "Off", contact: "Contact only", full: "Full" };
const capWords = (c: number) => (c === 0 ? "Uncapped" : `${c} fps`);
const PRIORITY_WORDS: Record<Graphics["priority"], string> = { music: "Music first", picture: "Picture first" };
const PRIORITY_LINES: Record<Graphics["priority"], string> = {
  music: "The sound never drops out: the picture steps down when it must",
  picture: "The picture stays as set: the sound gets a bigger buffer, a little more delay",
};

export interface GraphicsDeps {
  now(): Graphics;
  /** Keep `g` and load the room again with it (the lights, shadows and post are built once). */
  set(g: Graphics): void;
  /** What's running now (stepped down or not), for the status line. */
  running(): Running & { level: number };
}

function chip(name: string, on: boolean, pick: () => void, title?: string) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "set-chip"; b.setAttribute("aria-pressed", String(on)); b.textContent = name;
  if (title) b.title = title;
  b.addEventListener("click", pick);
  return b;
}
function col(title: string, ...kids: HTMLElement[]) {
  const c = document.createElement("div"); c.className = "set-col";
  const h = document.createElement("h4"); h.textContent = title;
  const r = document.createElement("div"); r.className = "set-chip-row"; r.setAttribute("aria-label", title); r.append(...kids);
  c.append(h, r);
  return c;
}

/** Fill Settings' Graphics tab: the presets as rows, the knobs as chips, music first vs picture first. */
export function renderGraphics(presets: HTMLElement, knobs: HTMLElement, d: GraphicsDeps, row: (name: string, line: string, on: boolean, pick: () => void) => HTMLElement) {
  const g = d.now(), set = (change: Partial<Omit<Graphics, "preset">>) => d.set(tweak(g, change));
  presets.replaceChildren(...PRESETS.map((p) => row(p[0]!.toUpperCase() + p.slice(1), PRESET_LINES[p], g.preset === p, () => d.set(preset(p, g.priority)))));
  const r = d.running();
  knobs.replaceChildren(
    col("Music or picture", ...PRIORITIES.map((p) => chip(PRIORITY_WORDS[p], g.priority === p, () => set({ priority: p }), PRIORITY_LINES[p]))),
    col("Render scale", ...SCALES.map((s) => chip(`${s}×`, g.scale === s, () => set({ scale: s })))),
    col("Shadows", ...SHADOWS.map((s) => chip(SHADOW_WORDS[s], g.shadows === s, () => set({ shadows: s })))),
    col("Post", chip("Bloom", g.bloom, () => set({ bloom: !g.bloom })), chip("Lens", g.lens, () => set({ lens: !g.lens }), "Depth of field, fringing, vignette, grain"), chip("Filmic tone", g.tone, () => set({ tone: !g.tone }))),
    col("Lit lights", ...LIGHTS.map((n) => chip(n >= 64 ? "All" : String(n), g.lights === n, () => set({ lights: n })))),
    col("Crowd out of doors", ...CROWDS.map((n) => chip(n === 0 ? "None" : String(n), g.crowd === n, () => set({ crowd: n })))),
    col("Frame cap", ...CAPS.map((c) => chip(capWords(c), g.cap === c, () => set({ cap: c })))),
  );
  const note = document.createElement("p"); note.className = "keys set-wide";
  note.textContent = r.level ? `Stepped down for the music now: ${r.scale}× render scale${r.freezeShadows ? ", shadows held still" : ""}${r.cap ? `, ${capWords(r.cap)}` : ""}.` : g.preset === "custom" ? "Your own mix of settings." : "";
  knobs.append(note);
}

const PresetArgs = obj({ preset: oneOf(PRESETS) });
const ScaleArgs = obj({ scale: num(0.5, 2) });
const ShadowArgs = obj({ shadows: oneOf(SHADOWS) });
const CapArgs = obj({ fps: oneOf(CAPS) });
const LightArgs = obj({ lights: int(1, 64) });
const CrowdArgs = obj({ crowd: int(0, 24) });
const no = (why: string) => ({ ok: false, error: why });

/** A Cmd+K command (and WebMCP tool) for each knob; each keeps the setting and loads the room again with it. */
export function graphicsCommands(d: GraphicsDeps): Command[] {
  const take = <T>(guard: (v: unknown) => T, a: unknown, then: (v: T) => Graphics) => {
    const v = check(guard, a);
    if (!v) return no("Wrong argument: studio_graphics lists the choices");
    d.set(then(v));
    return { ok: true };
  };
  const g = () => d.now(), group = "Graphics";
  const toggle = (name: string, title: string, k: "bloom" | "lens" | "tone"): Command => ({
    name, title, group, icon: "sparkles", description: `${title}: on if off, off if on. The room loads again with it.`,
    execute: () => { d.set(tweak(g(), { [k]: !g()[k] })); return { ok: true }; },
  });
  return [
    { name: "studio_graphics", title: "Graphics settings", group, icon: "monitor", annotations: { readOnlyHint: true },
      description: "The 3D room's graphics settings (preset, render scale, shadows, post, lit lights, crowd, frame cap, music first or picture first) and what runs now: whether music first has stepped the picture down.",
      execute: () => ({ settings: g(), running: d.running() }) },
    { name: "studio_graphics_preset", title: "Graphics preset", group, icon: "monitor", ask: "low, medium, high or ultra",
      description: "Pick a graphics preset: low, medium, high or ultra. The room loads again with it.",
      inputSchema: { type: "object", properties: { preset: { type: "string", enum: [...PRESETS] } }, required: ["preset"] },
      execute: (a) => take(PresetArgs, a, (v) => preset(v.preset, g().priority)) },
    { name: "studio_music_first", title: "Music first", group, icon: "music",
      description: "Music first (the default): the sound never drops out, and the picture steps down when frames run slow or the audio falls behind.",
      execute: () => { d.set(tweak(g(), { priority: "music" })); return { ok: true }; } },
    { name: "studio_picture_first", title: "Picture first", group, icon: "image",
      description: "Picture first: the picture never steps down; the sound gets a bigger buffer (a little more delay) instead.",
      execute: () => { d.set(tweak(g(), { priority: "picture" })); return { ok: true }; } },
    { name: "studio_render_scale", title: "Render scale", group, icon: "scaling", ask: "0.5 to 2",
      description: "The render's pixel ratio, 0.5 to 2 (your screen's own caps it). The room loads again with it.",
      inputSchema: { type: "object", properties: { scale: { type: "number" } }, required: ["scale"] },
      execute: (a) => take(ScaleArgs, a, (v) => tweak(g(), { scale: v.scale })) },
    { name: "studio_shadows", title: "Shadows", group, icon: "sun", ask: "off, contact or full",
      description: "Shadows: off, contact (the shade baked under things) or full (the lights cast them too).",
      inputSchema: { type: "object", properties: { shadows: { type: "string", enum: [...SHADOWS] } }, required: ["shadows"] },
      execute: (a) => take(ShadowArgs, a, (v) => tweak(g(), { shadows: v.shadows })) },
    toggle("studio_bloom", "Bloom", "bloom"),
    toggle("studio_lens", "Camera lens", "lens"),
    toggle("studio_tone", "Filmic tone", "tone"),
    { name: "studio_lit_lights", title: "Lit lights", group, icon: "lightbulb", ask: "how many, 1 to 64 (64: all)",
      description: "How many of the ceiling's downlights light the room (the rest still glow), 1 to 64.",
      inputSchema: { type: "object", properties: { lights: { type: "integer" } }, required: ["lights"] },
      execute: (a) => take(LightArgs, a, (v) => tweak(g(), { lights: v.lights })) },
    { name: "studio_crowd", title: "Crowd size", group, icon: "users", ask: "dancers, 0 to 24",
      description: "How many dancers stand on an open-air floor, 0 to 24.",
      inputSchema: { type: "object", properties: { crowd: { type: "integer" } }, required: ["crowd"] },
      execute: (a) => take(CrowdArgs, a, (v) => tweak(g(), { crowd: v.crowd })) },
    { name: "studio_frame_cap", title: "Frame cap", group, icon: "gauge", ask: "30, 60 or 0 (uncapped)",
      description: "Frames a second at most: 30, 60 or 0 for uncapped.",
      inputSchema: { type: "object", properties: { fps: { type: "integer", enum: [...CAPS] } }, required: ["fps"] },
      execute: (a) => take(CapArgs, a, (v) => tweak(g(), { cap: v.fps })) },
  ];
}

/** Underruns the browser has counted on this context, where it says (Chrome's playbackStats), else null. */
const Stats = obj({ underrunEvents: num(0, Number.MAX_SAFE_INTEGER) });
function underruns(ctx: AudioContext): number | null {
  const stats: unknown = "playbackStats" in ctx ? ctx.playbackStats : undefined;
  return check(Stats, stats)?.underrunEvents ?? null;
}

/**
 * Music first's watch: call `frame` every animation frame; every half second it averages the frame time, reads the
 * audio clock against the wall clock (and the browser's underrun count), runs the step-down rule and hands the new
 * level to `apply` when it changes.
 */
export function watchPicture(g: Graphics, ctx: () => AudioContext | null, apply: (r: Running, level: number) => void) {
  let gov: Govern = calm(performance.now()), t0 = performance.now(), frames = 0;
  let clock: { wall: number; audio: number; under: number } | null = null;
  return {
    frame() {
      const now = performance.now();
      frames++;
      if (now - t0 < 500) return;
      // a hidden tab draws nothing for a while: that gap is no slow frame, so start the window again
      if (now - t0 > 2000) { t0 = now; frames = 0; clock = null; return; }
      const frameMs = (now - t0) / frames;
      t0 = now; frames = 0;
      const c = ctx();
      let audio = 0;
      if (c && c.state === "running") {
        const at = { wall: now, audio: c.currentTime * 1000, under: underruns(c) ?? 0 };
        if (clock) audio = audioStress(at.wall - clock.wall, at.audio - clock.audio, at.under - clock.under);
        clock = at;
      } else clock = null;
      const next = govern(gov, { now, frameMs, audio }, g.priority);
      if (next.level !== gov.level) apply(stepped(g, next.level), next.level);
      gov = next;
    },
    state: () => gov,
  };
}
