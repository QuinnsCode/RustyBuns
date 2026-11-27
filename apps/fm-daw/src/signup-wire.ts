// The sign-up lists, read by both ends: the Lobby (src/lobby.ts) and the pages that post to /signup (the full card,
// src/ui/Full.tsx, and the free-limit card, src/dj/waitlist.ts). No Bun or DOM in here.
import { check, int, obj, opt, str, type Of } from "@rustybuns/util/guard";

/** "full": every room was taken. "paid": someone who hit a free limit and wants the paid plan when it comes. */
export const LISTS = ["full", "paid"] as const;
export type List = (typeof LISTS)[number];

/** What POST /signup answers: your place on that list, or why not. */
export const SignupReply = obj({ place: opt(int(1, 1_000_000)), error: opt(str(200)) });
export type SignupReply = Of<typeof SignupReply>;

/** Put `email` on `list` (once: a second try answers the same place). */
export async function signUp(email: string, room: string, list: List = "full"): Promise<{ place: number } | { error: string }> {
  try {
    const r = await fetch("/signup", { method: "POST", body: JSON.stringify({ email, room, list }) });
    let v: unknown = null;
    try { v = await r.json(); } catch { /* not JSON */ }
    const got = check(SignupReply, v) ?? {};
    if (got.place) return { place: got.place };
    return { error: got.error ?? (r.status === 429 ? "Too many tries, wait a minute" : "That didn't go through") };
  } catch { return { error: "That didn't go through" }; }
}
