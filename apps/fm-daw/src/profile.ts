// A person's own settings: the name they chat under and how they like the chat sized.
// Online it's a Durable Object per person (keyed by the id from their browser's key), so it
// waits for them in any sesh; the page also keeps a copy in localStorage, which is all the
// desktop has. A sign-in can later point more than one key at the same profile.
import { bool, check, int, obj, opt, str } from "@rustybuns/util/guard";
import { json } from "@rustybuns/util/http";
import { NAME_MAX } from "./chat.ts";

export const CHAT_MIN_H = 140;
export const CHAT_MAX_H = 900;
export type ChatLayout = { open: boolean; wide: boolean; h: number };
export type Me = { name: string; chat: ChatLayout };
const LAYOUT = obj({ open: bool(true), wide: bool(false), h: int(CHAT_MIN_H, CHAT_MAX_H, 260) });
export const defaultMe = (): Me => ({ name: "", chat: { open: true, wide: false, h: 260 } });

/** Whatever was stored or sent, as a profile: a missing or wrong field takes its default. */
export function sanitizeMe(v: unknown): Me {
  const o = check(obj({ name: opt(str(NAME_MAX, { min: 0, dflt: "" })), chat: opt(LAYOUT) }), v);
  return { name: o?.name ?? "", chat: o?.chat ?? defaultMe().chat };
}

/** Bytes a saved profile may take on the way in. */
const BODY_MAX = 2048;

interface Ctx { storage: { get(k: string): Promise<unknown>; put(k: string, v: unknown): Promise<void> } }

export default class Profile {
  constructor(private ctx: Ctx) {}

  async fetch(req: Request): Promise<Response> {
    if (req.method === "GET") return json(sanitizeMe(await this.ctx.storage.get("me")));
    if (req.method !== "PUT") return json({ error: "GET or PUT" }, 405);
    const text = await req.text();
    if (text.length > BODY_MAX) return json({ error: "too big" }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: "not JSON" }, 400); }
    const me = sanitizeMe(body);
    await this.ctx.storage.put("me", me);
    return json(me);
  }
}
