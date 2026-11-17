// A made instrument, as the sesh keeps it beside the groove: which FM DAW track it plays, where it stands in the
// jam room and the seed its model grows from (`synth` in @rustybuns/models). One guard, read by the World, the page
// and an agent's tools alike. Imports only guards, so project.ts can take it without a cycle.
import { arr, int, num, obj, oneOf, str, type Of } from "@rustybuns/util/guard";
import { TRACKS } from "../engine/params.ts";
import { ROOM_M } from "../studio.ts";

/** At most this many made instruments in one sesh: a newer one on the same track takes its place. */
export const MAX_MADE = 6;
export const VOICES = ["fm", "analog"] as const;

export const Instrument = obj({
  /** Its seat's id on the live line (`body.seat`), so lowercase letters, digits and dashes. */
  id: str(24, { re: /^[a-z0-9-]+$/ }),
  name: str(24),
  voice: oneOf(VOICES),
  track: int(0, TRACKS - 1),
  /** The seat (x, z in metres) and the way you face sitting at it; the synth stands just in front. */
  at: arr(num(-ROOM_M, ROOM_M), 2, { min: 2 }),
  yaw: num(-Math.PI * 2, Math.PI * 2),
  seed: int(0, 2 ** 31),
});
export type Instrument = Of<typeof Instrument>;
