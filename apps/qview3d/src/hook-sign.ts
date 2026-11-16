// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The webhook signature, both ends: QView3D signs each send, and a shop's receiver checks it. The header is
// `QView3D-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" under the webhook's secret>`, the way
// Stripe signs its own. The time is in what's signed, so a send caught and replayed later is refused.
import { hmacHex, hmacSigned } from "@rustybuns/util/bytes";

export const SIGNATURE = "QView3D-Signature";
/** How old a signature a receiver takes: five minutes, for clocks that drift. */
export const TOLERANCE_S = 300;

/** The header's value for `body` sent at `t` (unix seconds). */
export const signHook = async (secret: string, body: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;

/** Whether `header` signs `body` under `secret`, within `tolerance` seconds of `now`. */
export async function verifyHook(secret: string, header: string | null, body: string, now = Date.now() / 1000, tolerance = TOLERANCE_S): Promise<boolean> {
  const t = Number(header?.match(/(?:^|,)t=(\d+)/)?.[1]);
  const sigs = [...(header ?? "").matchAll(/(?:^|,)v1=([0-9a-f]{64})/g)].map((m) => m[1]!);
  if (!Number.isFinite(t) || Math.abs(now - t) > tolerance) return false;
  for (const s of sigs) if (await hmacSigned(secret, `${t}.${body}`, s)) return true;
  return false;
}
