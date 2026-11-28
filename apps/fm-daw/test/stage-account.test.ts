// The Stage Builder on your account (#6583): a laptop's build and order are on a phone signed in to the same account,
// through the real Worker (a token eqosys signed) and the account's Durable Object.
import { afterAll, expect, test } from "bun:test";
import Profile from "../src/profile.ts";
import worker from "../src/worker.ts";
import { APP } from "../src/account.ts";
import { stageAccount } from "../src/studio/stage-account.ts";
import { lockIn, newArena, startBuild, type Store } from "../src/studio/stage-build.ts";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";

const EQ = "https://eqosys.stage.test", HERE = "https://fm-daw.test";
const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const token = await sign(signer, EQ, { app: APP, user: { id: "u1", email: "a@b.test", name: "Ana" }, source: "password", access: [] });

const objects = new Map<string, Profile>();
function profile(name: string) {
  let p = objects.get(name);
  if (!p) {
    const kept = new Map<string, unknown>();
    objects.set(name, p = new Profile({ storage: { get: async (k) => kept.get(k), put: async (k, v) => { kept.set(k, structuredClone(v)); } } }));
  }
  return p;
}
const env = { EQOSYS_URL: EQ, PROFILE: { idFromName: (n: string) => n, get: (id: unknown) => profile(String(id)) } } as unknown as Parameters<typeof worker.fetch>[1];

const real = globalThis.fetch;
let down = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  if (req.url.startsWith(EQ)) return Response.json(await jwksOf(signer));
  if (down) throw new TypeError("offline");
  return worker.fetch(req, env);
}) as typeof fetch;
afterAll(() => { globalThis.fetch = real; });

/** One browser: its storage kept between visits. A visit signs in (or not) and takes what the account has. */
function browser() {
  const saved = new Map<string, string>();
  const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => { saved.set(k, v); }, removeItem: (k: string) => { saved.delete(k); } };
  let store: Store = { builds: [], orders: [] };
  return {
    get store() { return store; },
    async visit(signedIn = true) {
      const account = stageAccount(HERE, () => (signedIn ? token : null), store, storage, 1);
      store = (await account.follow(() => store)) ?? store;
      await Bun.sleep(30); // the save goes a moment later
      return { change: async (f: (s: Store) => Store) => { store = f(store); account.keep(store); await Bun.sleep(30); } };
    },
  };
}

const build = (name: string, at: number) => (s: Store) => lockIn(startBuild(s, { ...newArena({ outdoor: true, w: 60, d: 40 }), name }, at), name, at);
const names = (s: Store) => ({ builds: s.builds.map((b) => b.name), orders: s.orders.map((o) => o.name) });

test("a build made on a laptop is on a phone, a thrown-away order stays gone, and offline work isn't lost", async () => {
  const laptop = browser(), phone = browser();
  // made signed out, then taken up by the account on sign-in
  await (await laptop.visit(false)).change(build("Friday", 1000));
  await laptop.visit();
  await phone.visit();
  expect(names(phone.store)).toEqual({ builds: ["Friday"], orders: ["Friday"] });

  // the phone throws the order away: the laptop's next visit has it gone
  await (await phone.visit()).change((s) => ({ ...s, orders: [] }));
  await laptop.visit();
  expect(names(laptop.store)).toEqual({ builds: ["Friday"], orders: [] });

  // the laptop builds with no network while the phone builds too: both are kept
  const offline = await laptop.visit();
  down = true;
  await offline.change(build("Train", 2000));
  down = false;
  await (await phone.visit()).change(build("Bus", 3000));
  await laptop.visit();
  await phone.visit();
  expect(names(laptop.store)).toEqual({ builds: ["Bus", "Train", "Friday"], orders: ["Bus", "Train"] });
  expect(names(phone.store)).toEqual(names(laptop.store));
});

test("the account refuses what isn't a store, and anyone signed out", async () => {
  const at = `${HERE}/stage-builds`;
  expect((await fetch(at)).status).toBe(401);
  expect((await fetch(`${at}?token=${token}`, { method: "PUT", body: JSON.stringify({ builds: "none" }) })).status).toBe(400);
});
