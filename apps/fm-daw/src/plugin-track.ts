// A track played by a hosted CLAP plugin (#5265), as the project keeps it: which `.clap`, which plugin in it, and the
// sliders the player moved. The page, the world and the host read it, so it imports no Bun and no DOM. The plugin
// itself runs on the desktop host (src/engine/plugins.ts); its sound reaches the worklet as blocks (src/ui/plugins.ts).
import { arr, Bad, bool, check, int, num, obj, oneOf, opt, str, type Guard, type Of } from "@rustybuns/util/guard";

/** One plugin a `.clap` holds, as the track menu lists it. */
export const PluginInfo = obj({ id: str(500), name: str(500), vendor: str(500, { min: 0 }), version: str(200, { min: 0 }), features: arr(str(200, { min: 0 }), 32) });
export type PluginInfo = Of<typeof PluginInfo>;
/** One of a running plugin's parameters: a slider, so MIDI learn works on it. */
export const PluginParam = obj({
  id: int(0, 2 ** 32 - 1), name: str(500), module: str(2000, { min: 0 }),
  min: num(-1e300, 1e300), max: num(-1e300, 1e300), default: num(-1e300, 1e300), value: num(-1e300, 1e300), stepped: bool(),
});
export type PluginParam = Of<typeof PluginParam>;

/** Plugin sliders kept per track: the ones moved off their default. */
export const MAX_PLUGIN_VALUES = 256;

export const PluginValue = obj({ id: int(0, 2 ** 32 - 1), v: num(-1e300, 1e300) });
export type PluginValue = Of<typeof PluginValue>;

export const TrackPlugin = obj({
  /** The `.clap` on the host's disk (a file, or a macOS bundle folder). */
  path: str(4096),
  /** Which plugin inside it (a `.clap` can hold several). */
  index: int(0, 255),
  name: str(200),
  values: arr(PluginValue, MAX_PLUGIN_VALUES, { drop: true }),
});
export type TrackPlugin = Of<typeof TrackPlugin>;

/** The plugin with slider `id` at `v`: the last move wins, and a new slider joins at the end. */
export function withValue(p: TrackPlugin, id: number, v: number): TrackPlugin {
  const values = p.values.filter((x) => x.id !== id);
  return { ...p, values: [...values, { id, v }].slice(-MAX_PLUGIN_VALUES) };
}

/**
 * What the worklet and the host trade for a plugin track. The worklet asks for `frames` more of its sound and says
 * which notes it played since it last asked; the host plays them into the plugin, renders, and the page hands the
 * block (interleaved stereo at the context's rate) back. `on` with `vel` 0..1, `off`; `set` moves a slider.
 */
export type PluginEvent = { t: "on"; key: number; vel: number } | { t: "off"; key: number } | { t: "set"; id: number; v: number };

const KEY = int(0, 127), ID = int(0, 2 ** 32 - 1);
const EVENTS: Guard<PluginEvent>[] = [
  obj({ t: oneOf(["on"]), key: KEY, vel: num(0, 1) }),
  obj({ t: oneOf(["off"]), key: KEY }),
  obj({ t: oneOf(["set"]), id: ID, v: num(-1e300, 1e300) }),
];
/** A note or slider move off the page: one of PluginEvent's three, or refused. */
export const PluginEvent: Guard<PluginEvent> = (v) => {
  for (const g of EVENTS) { const e = check(g, v); if (e) return e; }
  throw new Bad("a note or a slider move");
};
/** A block asks for this many frames at most (a page asking for a minute at once is refused). */
export const MAX_PLUGIN_FRAMES = 8192;
export const PluginAskArgs = obj({ track: int(0, 63), frames: int(1, MAX_PLUGIN_FRAMES), events: arr(PluginEvent, 4096) });

// What the host's actions answer (src/actions/plugins.ts), read on the page through these.
/** One plugin the track menu offers: the `.clap` it's in, its place there, and its name. */
export const PluginChoice = obj({ path: str(4096), index: int(0, 255), name: str(500), vendor: str(500, { min: 0 }) });
export type PluginChoice = Of<typeof PluginChoice>;
export const PluginChoices = arr(PluginChoice, 1024);
/** A plugin started on a track: its sliders, or why it wouldn't start. */
export const StartReply = obj({ params: arr(PluginParam, 4096), error: opt(str(2000, { min: 0 })) });
export type StartReply = Of<typeof StartReply>;
/** A block of a plugin's sound, base64 of little-endian f32 interleaved stereo; `ok` false once it has failed. */
export const BlockReply = obj({ pcm: str(4 * MAX_PLUGIN_FRAMES * 3, { min: 0 }), ok: bool(), error: opt(str(2000, { min: 0 })) });
export type BlockReply = Of<typeof BlockReply>;
