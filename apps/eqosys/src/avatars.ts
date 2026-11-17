// Your character, kept on your account so every Q app dresses you the same (#4987): GET /me/avatar and PUT /me/avatar,
// for the session cookie (the picker on the Account tab) or an app's token as a bearer (Qollab Studio's front door).
// The body is read through `Avatar` and the reply is `AvatarReply`, both from @rustybuns/util/avatar, which apps import too.
import { Avatar, AvatarReply, cleanAvatar, defaultAvatar } from "@rustybuns/util/avatar";
import { check } from "@rustybuns/util/guard";
import { parseJson } from "@rustybuns/util/http";
import { crossSite, json, type Env } from "./env.ts";
import { meOf } from "./auth.ts";
import { bearerOf, cors, tokenOf } from "./door.ts";

/** The avatar someone wears: the one they picked, or the one their name gives them. */
export async function avatarOf(conf: Env, who: { id: string; name: string }): Promise<AvatarReply> {
  const row = await conf.DB.prepare("SELECT look FROM avatars WHERE user_id = ?").bind(who.id).first<string>("look");
  const kept = row ? cleanAvatar(parseJson(row)) : null;
  return kept ? { avatar: kept, chosen: true } : { avatar: defaultAvatar(who.name), chosen: false };
}

export async function keepAvatar(conf: Env, userId: string, a: Avatar) {
  await conf.DB.prepare("INSERT INTO avatars (user_id, look, at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET look = ?2, at = ?3")
    .bind(userId, JSON.stringify(a), Date.now()).run();
}

export async function avatarRoute(req: Request, conf: Env): Promise<Response> {
  const head = { ...await cors(req, conf), "access-control-allow-methods": "GET, PUT", "access-control-allow-headers": "authorization, content-type" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
  if (req.method !== "GET" && req.method !== "PUT") return json({ error: "GET, or PUT the avatar, signed in or with the token as a bearer" }, 405, head);
  const bearer = bearerOf(req);
  if (!bearer && req.method === "PUT" && crossSite(req, conf)) return json({ error: "cross-site" }, 403, head);
  const t = bearer ? await tokenOf(req, conf, bearer) : null, me = bearer ? null : await meOf(req, conf);
  const who = t ? t.who : me ? { id: me.id, name: me.name } : null;
  if (!who) return json({ error: "sign in at /login first, or send an app's token as a bearer" }, 401, head);
  if (req.method === "GET") return json(await avatarOf(conf, who) satisfies AvatarReply, 200, head);
  const a = check(Avatar, await req.json().catch(() => null));
  if (!a) return json({ error: "send an avatar: every part one of PARTS in @rustybuns/util/avatar, colours as #rrggbb" }, 400, head);
  await keepAvatar(conf, who.id, a);
  return json({ avatar: a, chosen: true } satisfies AvatarReply, 200, head);
}

/** A first sign-in: the account is minutes old and has no character yet, so home opens on the picker (`/?tab=account&first=1`). */
export async function firstVisit(conf: Env, userId: string) {
  const row = await conf.DB.prepare(`SELECT u."createdAt" AS made, a.user_id AS kept FROM "user" u LEFT JOIN avatars a ON a.user_id = u.id WHERE u.id = ?`)
    .bind(userId).first<{ made: string | number; kept: string | null }>();
  const made = typeof row?.made === "number" ? row.made : Date.parse(String(row?.made));
  return !!row && !row.kept && Date.now() - made < 15 * 60_000;
}
