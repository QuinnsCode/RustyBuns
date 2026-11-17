// Your character, kept here so you wear the same one in every Q app (#4987): GET /me/avatar answers it, PUT /me/avatar
// saves one. Both answer `AvatarReply` from @rustybuns/util/avatar, and a PUT's body goes through its `Avatar` guard.
// eqosys's own picker (app/character.client.ts) calls with the session cookie; a game's page sends its token as a bearer.
import { Avatar, AvatarReply, cleanAvatar, defaultAvatar } from "@rustybuns/util/avatar";
import { Bad, type Of } from "@rustybuns/util/guard";
import { meOf } from "./auth.ts";
import { bearerOf, cors, tokenOf } from "./door.ts";
import { crossSite, json, type Env } from "./env.ts";

/** Their saved avatar, or the default from their name. A row that no longer reads as one (parts renamed) is the default too. */
export async function avatarOf(conf: Env, who: { id: string; name: string }): Promise<Of<typeof AvatarReply>> {
  const row = await conf.DB.prepare("SELECT data FROM avatars WHERE user_id = ?").bind(who.id).first<string>("data");
  const saved = row ? cleanAvatar(JSON.parse(row)) : null;
  return saved ? { avatar: saved, saved: true } : { avatar: defaultAvatar(who.name || who.id), saved: false };
}

/** Whether they ever saved one: someone who never did makes it first when they sign in (the picker's first-visit step). */
export async function savedAvatar(conf: Env, id: string): Promise<boolean> {
  return (await conf.DB.prepare("SELECT 1 AS n FROM avatars WHERE user_id = ?").bind(id).first<number>("n")) === 1;
}

export async function avatarRoute(req: Request, conf: Env): Promise<Response> {
  const head = { ...await cors(req, conf), "access-control-allow-methods": "GET, PUT" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
  if (req.method !== "GET" && req.method !== "PUT") return json({ error: "GET, or PUT an avatar, signed in or with the token as a bearer" }, 405, head);
  const bearer = bearerOf(req);
  if (!bearer && crossSite(req, conf)) return json({ error: "cross-site" }, 403, head);
  const t = bearer ? await tokenOf(req, conf, bearer) : null, me = bearer ? null : await meOf(req, conf);
  const who = t ? t.who : me ? { id: me.id, name: me.name } : null;
  if (!who) return json({ error: "sign in at /login first, or send an app's token as a bearer" }, 401, head);
  if (req.method === "GET") return json(await avatarOf(conf, who) satisfies Of<typeof AvatarReply>, 200, head);
  let avatar: Avatar;
  try { avatar = Avatar(await req.json().catch(() => null)); }
  catch (err) { if (err instanceof Bad) return json({ error: `send ${err.why}` }, 400, head); throw err; }
  await conf.DB.prepare("INSERT INTO avatars (user_id, data, at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET data = ?2, at = ?3")
    .bind(who.id, JSON.stringify(avatar), Date.now()).run();
  return json({ avatar, saved: true } satisfies Of<typeof AvatarReply>, 200, head);
}
