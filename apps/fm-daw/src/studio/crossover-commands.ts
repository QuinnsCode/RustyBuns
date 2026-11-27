// The rig's crossover, by hand (#6473): a Cmd+K command and WebMCP tool to read each amp channel's band as its preset
// has it (from the makers' sheets, @rustybuns/gear crossover.ts) and to move one: its split points, gain, delay and
// polarity. What it answers says what the move did: the sum's deepest hole and each driver's warnings, so a sub set
// out of polarity reads as the hole you hear at the split.
import type { Command } from "@rustybuns/util/commands";
import { check, int, num, obj, oneOf, opt } from "@rustybuns/util/guard";
import { crossoverCheck, type Band, type ChannelDsp } from "@rustybuns/gear/crossover";

export interface CrossoverDeps {
  /** The rig's preset bands (what each feeds, its sheet), or none indoors. */
  preset(): readonly Band[];
  /** The bands as set now, or null with no rig. */
  bands(): readonly ChannelDsp[] | null;
  set(bands: readonly ChannelDsp[]): boolean;
}

const SetArgs = obj({
  band: int(0, 7),
  hp: opt(num(20, 20000)), lp: opt(num(20, 20000)),
  gainDb: opt(num(-24, 24)), delayMs: opt(num(0, 50)), polarity: opt(oneOf([1, -1] as const)),
});

/** The rig's crossover as it stands: each band's box, way, DSP and sheet, and what the sum and the drivers say. */
export function crossoverState(d: CrossoverDeps) {
  const preset = d.preset(), now = d.bands();
  if (!now || !preset.length) return null;
  const bands = preset.map((b, i) => ({ ...b, dsp: now[i] ?? b.dsp }));
  return { bands: bands.map((b, i) => ({ band: i, box: b.box, way: b.way, ...b.dsp, ref: b.ref, ...(b.guess ? { guess: b.guess } : {}) })), ...crossoverCheck(bands, preset.map((b) => b.dsp)) };
}

/** Move one band; the answer is the crossover after it. */
export function setCrossover(d: CrossoverDeps, args: unknown) {
  const a = check(SetArgs, args), now = d.bands();
  if (!a) return { ok: false, error: "band 0-7 with any of hp, lp (Hz, 20 to 20000), gainDb, delayMs (0 to 50), polarity (1 or -1)" };
  if (!now?.[a.band]) return { ok: false, error: now ? `this rig has bands 0 to ${now.length - 1}` : "no rig here: the crossover is an open-air rig's" };
  const b = now[a.band]!;
  const next: ChannelDsp = {
    ...b,
    ...(a.hp !== undefined && b.hp ? { hp: { ...b.hp, hz: a.hp } } : a.hp !== undefined ? { hp: { hz: a.hp, slope: 24, type: "lr" } } : {}),
    ...(a.lp !== undefined && b.lp ? { lp: { ...b.lp, hz: a.lp } } : a.lp !== undefined ? { lp: { hz: a.lp, slope: 24, type: "lr" } } : {}),
    ...(a.gainDb !== undefined ? { gainDb: a.gainDb } : {}),
    ...(a.delayMs !== undefined ? { delayMs: a.delayMs } : {}),
    ...(a.polarity !== undefined ? { polarity: a.polarity } : {}),
  };
  d.set(now.map((x, i) => (i === a.band ? next : x)));
  return { ok: true, ...crossoverState(d) };
}

export function crossoverCommands(d: CrossoverDeps): Command[] {
  return [
    { name: "studio_crossover", title: "Crossover", group: "Sound", icon: "audio-lines", annotations: { readOnlyHint: true },
      description: "The open-air rig's crossover as its amps' DSP has it: each band's box, high-pass and low-pass (Hz, slope, Linkwitz-Riley or Butterworth), gain, delay, polarity and the maker's sheet it came from; the sum's deepest hole (dipDb at dipHz) and any driver warnings.",
      execute: () => crossoverState(d) ?? { ok: false, error: "no rig here: the crossover is an open-air rig's" } },
    { name: "studio_crossover_set", title: "Set the crossover", group: "Sound", icon: "sliders-horizontal", palette: false,
      description: "Move one band of the rig's crossover: band (studio_crossover's index), and any of hp, lp (Hz), gainDb, delayMs (0 to 50), polarity (1 or -1). Heard at once; answers with the crossover after the move.",
      inputSchema: { type: "object", properties: { band: { type: "integer" }, hp: { type: "number" }, lp: { type: "number" }, gainDb: { type: "number" }, delayMs: { type: "number" }, polarity: { type: "integer", enum: [1, -1] } }, required: ["band"] },
      execute: (a) => setCrossover(d, a) },
    { name: "studio_crossover_flip_sub", title: "Flip the sub's polarity", group: "Sound", icon: "flip-vertical",
      description: "Flip the lowest band's polarity: out of polarity, the sub cancels the tops at the split and leaves a hole there. Answers with the crossover after it.",
      execute: () => { const b = d.bands()?.[0]; return b ? setCrossover(d, { band: 0, polarity: -b.polarity }) : { ok: false, error: "no rig here" }; } },
    { name: "studio_crossover_reset", title: "Crossover back to its preset", group: "Sound", icon: "rotate-ccw",
      description: "Every band back to the rig's preset from the makers' sheets.",
      execute: () => { const p = d.preset(); return p.length && d.set(p.map((b) => b.dsp)) ? { ok: true, ...crossoverState(d) } : { ok: false, error: "no rig here" }; } },
  ];
}
