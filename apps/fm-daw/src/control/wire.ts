// What the page and the local bridge (scripts/show-bridge.ts) say to each other, as JSON on a WebSocket.
import { arr, check, int, num, obj, oneOf, str, type Guard } from "@rustybuns/util/guard";
import { UNIVERSE } from "./dmx.ts";
import type { OscArg } from "./osc.ts";

const Int32 = obj({ int: int(-2147483648, 2147483647) });
const Arg: Guard<OscArg> = (v) => typeof v === "string" ? str(2000)(v) : typeof v === "boolean" ? v : typeof v === "number" ? num(-3.4e38, 3.4e38)(v) : Int32(v);
/** An OSC message, either way. */
const OscSaid = obj({ t: oneOf(["osc"]), address: str(300, { re: /^\// }), args: arr(Arg, 32) });
/** The desk's DMX channels from address 1: to the lights, and on to any other page on the bridge (the stream view). */
const DmxSaid = obj({ t: oneOf(["dmx"]), data: arr(int(0, 255), UNIVERSE, { min: 1 }) });
export type Wire = ReturnType<typeof OscSaid> | ReturnType<typeof DmxSaid>;

export const readWire = (v: unknown): Wire | null => check(DmxSaid, v) ?? check(OscSaid, v);
