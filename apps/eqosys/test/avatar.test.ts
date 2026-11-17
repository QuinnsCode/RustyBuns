// Your character, kept on eqosys (#4987): someone new signs up and lands on the picker, reads the avatar made from their
// name, picks parts and makes the face (#5009: its shape, facial hair, the sliders) and saves, and reads it back, from
// eqosys's own page and from a game with its token. A save from before the face maker still reads. A wrong shape is a 400
// and changes nothing; signed out is a 401; deleting the account takes the avatar with it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { AvatarReply, defaultAvatar, PARTS, type Avatar } from "@rustybuns/util/avatar";
import { check, obj, str } from "@rustybuns/util/guard";
import { handle } from "../src/handle.ts";
import { deleteAccount } from "../src/members.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });

const avatar = async (method: "GET" | "PUT", who: { cookie?: string; bearer?: string; origin?: string }, body?: unknown) => {
  const headers = new Headers({ origin: who.origin ?? ORIGIN });
  if (who.cookie) headers.set("cookie", who.cookie);
  if (who.bearer) headers.set("authorization", `Bearer ${who.bearer}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  const res = (await handle(new Request(`${ORIGIN}/me/avatar`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), conf))!;
  return { status: res.status, body: check(AvatarReply, await res.json().catch(() => null)), cors: res.headers.get("access-control-allow-origin") };
};

test("sign up, make your character, save it, and every app reads the same one", async () => {
  const up = await call("/do/signup", { form: { name: "Ada", email: "ada@example.com", password: PASSWORD } });
  expect(up.to).toBe("/?tab=account&new=1");
  const me = { cookie: up.cookie };

  // before saving: the one made from their name, not saved yet
  expect(await avatar("GET", me)).toMatchObject({ status: 200, body: { avatar: defaultAvatar("Ada"), saved: false } });

  // pick parts (a hat, the round build, a colour typed in capitals), make the face, and save
  const picked: Avatar = { ...defaultAvatar("Ada"), hat: "headphones", build: "round", topColor: "#3A6BD8", glasses: "round", face: "heart", beard: "mustache", eyeSize: 2, mouthHeight: -3 };
  const put = await avatar("PUT", me, picked);
  expect(put.status).toBe(200);
  expect(put.body).toEqual({ avatar: { ...picked, topColor: "#3a6bd8" }, saved: true });
  expect((await avatar("GET", me)).body).toEqual(put.body);

  // a wrong shape is a 400 that names what to send, and the saved one stays
  for (const bad of [{ ...picked, hat: "sombrero" }, { ...picked, skin: "pink" }, { ...picked, face: "triangle" }, { ...picked, eyeSize: 9 }, { ...picked, eyeGap: 0.5 }, { ...picked, nose: 2 }, { hair: "short" }, "nope", null]) {
    const r = await avatar("PUT", me, bad);
    expect(r.status).toBe(400);
  }
  expect((await avatar("GET", me)).body).toEqual(put.body);

  // signed out, or a write from another site riding the cookie: refused
  expect((await avatar("GET", {})).status).toBe(401);
  expect((await avatar("PUT", { ...me, origin: "https://evil.example" }, picked)).status).toBe(403);

  // a game reads (and may change) the same one with its token, its page allowed by CORS
  const park = await asks("park-hide-seek", PARK);
  const go = await call("/do/continue", { form: park.form, cookie: up.cookie });
  const traded = check(obj({ token: str(4000) }), await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(go.to), verifier: park.verifier } })).res.json())!;
  const game = await avatar("GET", { bearer: traded.token, origin: PARK });
  expect(game).toMatchObject({ status: 200, body: put.body, cors: PARK });

  // a save from before the face maker (the first eleven parts only) still reads: the face's first choices, sliders at 0
  const id = (await conf.DB.prepare("SELECT user_id FROM avatars").first<string>("user_id"))!;
  const old = Object.fromEntries(Object.keys(PARTS).map((k) => [k, picked[k as keyof typeof PARTS]]));
  await conf.DB.prepare("UPDATE avatars SET data = ? WHERE user_id = ?").bind(JSON.stringify(old), id).run();
  expect((await avatar("GET", me)).body).toEqual({ avatar: { ...picked, topColor: "#3a6bd8", face: "round", brows: "soft", nose: "button", beard: "none", cheeks: "none", eyeSize: 0, eyeGap: 0, eyeHeight: 0, browHeight: 0, noseSize: 0, mouthSize: 0, mouthHeight: 0, height: 0 }, saved: true });

  // deleting the account deletes the avatar
  expect(await deleteAccount(conf, id, ORIGIN)).toBe(true);
  expect(await conf.DB.prepare("SELECT count(*) AS n FROM avatars").first<number>("n")).toBe(0);
});
