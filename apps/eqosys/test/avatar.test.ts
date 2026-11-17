// Your character on eqosys (#4987): made from your name until you pick one, kept with PUT /me/avatar from the picker,
// and read back by any Q app with its token, the way Qollab Studio's front door dresses you.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AvatarReply, defaultAvatar, randomAvatar } from "@rustybuns/util/avatar";
import { check, obj, str } from "@rustybuns/util/guard";
import { newKey } from "@rustybuns/util/token";
import { mulberry32 } from "@rustybuns/util";
import { firstVisit } from "../src/avatars.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);

test("sign up, pick a character, save it, and a game reads it back with its token; a wrong shape is a 400", async () => {
  const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
  const up = await call("/do/signup", { form: { name: "Ada", email: "ada@example.com", password: PASSWORD } });
  const reply = async (r: Response) => check(AvatarReply, await r.json());
  const userId = (await conf.DB.prepare(`SELECT id FROM "user"`).first<string>("id"))!;

  // Never picked: she wears the one her name gives her, and home opens on the picker.
  expect(await reply((await call("/me/avatar", { cookie: up.cookie })).res)).toEqual({ avatar: defaultAvatar("Ada"), chosen: false });
  expect(await firstVisit(conf, userId)).toBe(true);

  // The picker saves her pick (the page's own PUT, with the cookie).
  const mine = { ...randomAvatar(mulberry32(7)), hair: "space-buns", hat: "headphones", top: "hoodie" };
  const saved = await call("/me/avatar", { method: "PUT", json: mine, cookie: up.cookie });
  expect(saved.res.status).toBe(200);
  expect(await reply(saved.res)).toEqual({ avatar: mine, chosen: true });
  expect(await firstVisit(conf, userId)).toBe(false);

  // A part that isn't one, a colour that isn't one, or no body: refused, and what was kept stays.
  for (const bad of [{ ...mine, hat: "fez" }, { ...mine, skin: "pink" }, "hoodie", null])
    expect((await call("/me/avatar", { method: "PUT", json: bad, cookie: up.cookie })).res.status).toBe(400);
  // Another site can't change it with her cookie.
  expect((await call("/me/avatar", { method: "PUT", json: mine, cookie: up.cookie, origin: "https://evil.example" })).res.status).toBe(403);

  // A game she signs in to reads it with the token it traded for: the same character everywhere.
  const park = await asks("park-hide-seek", PARK);
  const on = await call("/do/continue", { form: park.form, cookie: up.cookie });
  const { token } = check(obj({ token: str(4000) }), await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(on.to), verifier: park.verifier }, origin: PARK })).res.json())!;
  const fromGame = await call("/me/avatar", { bearer: token, origin: PARK });
  expect(fromGame.res.headers.get("access-control-allow-origin")).toBe(PARK);
  expect(await reply(fromGame.res)).toEqual({ avatar: mine, chosen: true });
  expect((await call("/me/avatar", { bearer: "not-a-token", origin: PARK })).res.status).toBe(401);

  // It is in her data download.
  expect(await (await call("/api/privacy/export", { cookie: up.cookie })).res.text()).toContain("space-buns");
});
