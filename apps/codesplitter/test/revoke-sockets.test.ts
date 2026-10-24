import { expect, test } from "bun:test";
import { storage } from "@rustybuns/shell-bun";
import { FileDurableObject } from "../src/file-do.ts";

/** A file DO holding one open socket per name. */
async function withSockets(names: string[]) {
  let ready: Promise<void> = Promise.resolve();
  const closed: string[] = [];
  const sockets = names.map((user) => ({ deserializeAttachment: () => ({ user }), close: () => { closed.push(user); }, send: () => {} }));
  const ctx = { storage: storage(":memory:"), blockConcurrencyWhile: (f: () => Promise<void>) => { ready = f(); }, getWebSockets: () => sockets };
  const o = new FileDurableObject(ctx, {} as any);
  await ready;
  const revoke = async (q: string) => (await (await o.fetch(new Request(`http://do/revoke${q}`, { method: "POST" }))).json()) as { closed: number };
  return { closed, revoke };
}

test("taking access back closes the open sockets: one person's, or everyone's but the crew", async () => {
  const one = await withSockets(["ana", "bob", "anon"]);
  expect(await one.revoke("?user=bob")).toEqual({ closed: 1 });
  expect(one.closed).toEqual(["bob"]);

  const flip = await withSockets(["ana", "bob", "anon", "cy"]);
  expect(await flip.revoke("?keep=ana,bob")).toEqual({ closed: 2 });
  expect(flip.closed).toEqual(["anon", "cy"]);
});
