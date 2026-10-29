// A person's profile: what they save comes back, and a wrong field takes its default.
import { expect, test } from "bun:test";
import Profile, { CHAT_MAX_H } from "../src/profile.ts";

test("a profile saves your name and chat layout; a bad field falls back, a bad body is refused", async () => {
  const store = new Map<string, unknown>();
  const p = new Profile({ storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } } });
  const put = (body: string) => p.fetch(new Request("https://profile/", { method: "PUT", body }));
  const get = async () => (await p.fetch(new Request("https://profile/"))).json();

  expect(await get()).toEqual({ name: "", chat: { open: true, wide: false, h: 260 } });
  await put(JSON.stringify({ name: "Ryan", chat: { open: false, wide: true, h: 420 } }));
  expect(await get()).toEqual({ name: "Ryan", chat: { open: false, wide: true, h: 420 } });
  await put(JSON.stringify({ name: 7, chat: { open: "yes", wide: true, h: 99999 } }));
  expect(await get()).toEqual({ name: "", chat: { open: true, wide: true, h: CHAT_MAX_H } });
  expect((await put("{nope")).status).toBe(400);
});
