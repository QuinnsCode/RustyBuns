// GDPR, the way a person meets it: someone in Germany and someone in the US sign up through a game and keep a save. The German's
// vault is made in the EU, their save is sealed in D1 and opens only through it, they download everything eqosys holds, and
// deleting the account shreds the vault, so a backup copy of the save never opens again.
import { expect, setDefaultTimeout, test } from "bun:test";
import { durableObject } from "@rustybuns/shell-bun";
import { newKey } from "@rustybuns/util/token";
import { unseal } from "@rustybuns/util/privacy";
import { handle } from "../src/handle.ts";
import { HOLDERS } from "../src/privacy.ts";
import { Space } from "../src/qollab/space.ts";
import { Vault, type Vaults } from "../src/vault.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
// The local namespace has no jurisdictions: an "eu" slice is a second namespace, so the test sees which one each vault landed in.
const world = durableObject(Vault as never, conf), eu = durableObject(Vault as never, conf);
const vaults: Vaults = { idFromName: (n) => world.idFromName(n), get: (id) => world.get(id as never), jurisdiction: () => ({ idFromName: (n) => eu.idFromName(n), get: (id) => eu.get(id as never) }) };
conf.VAULT = vaults;
conf.SPACE = durableObject(Space as never, conf) as never;

async function signUp(name: string, country: string) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD }, cf: { country } });
  return (await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json()) as { token: string; user: { id: string } };
}
// kit's call only POSTs a body, so a save's PUT goes straight at the route.
const put = (token: string, body: string) => handle(new Request(`${ORIGIN}/q/save/run`, { method: "PUT", headers: { authorization: `Bearer ${token}`, origin: PARK }, body }), conf);

test("an EU sign-up gets an EU vault, a sealed save, a full download, and erasure that shreds it", async () => {
  const ada = await signUp("Ada", "DE"), bo = await signUp("Bo", "US");
  await put(ada.token, "level 7, 3 lives");
  await put(bo.token, "level 1");

  // Ada's vault is in the EU slice, Bo's in the world one; both saves are sealed in D1 and come back as they went in.
  const row = await conf.DB.prepare("SELECT data, sealed FROM saves WHERE user_id = ?").bind(ada.user.id).first<{ data: ArrayLike<number>; sealed: number }>();
  const backup = Uint8Array.from(row!.data);
  expect(row!.sealed).toBe(1);
  expect(new TextDecoder().decode(backup)).not.toContain("level 7");
  expect(await (await call("/q/save/run", { bearer: ada.token, origin: PARK })).res.text()).toBe("level 7, 3 lives");
  const keyOf = (ns: typeof eu, id: string) => ns.get(ns.idFromName(id)).fetch(new Request("https://vault/key")).then((r) => r.json()).then((j: { key: string }) => j.key);
  const adaKey = await keyOf(eu, ada.user.id);
  expect(await unseal(adaKey, backup, `${ada.user.id}/park-hide-seek/run`)).not.toBeNull();
  expect((await call("/api/privacy", { bearer: bo.token, origin: PARK })).res.status).toBe(200);
  expect(await (await call("/api/privacy", { bearer: ada.token, origin: PARK })).res.json()).toMatchObject({ region: "eu", vault: { region: "eu" } });

  // The download: one file, every holder's section, the save readable, no password hash, and the request logged in the vault.
  const got = await call("/api/privacy/export", { bearer: ada.token, origin: PARK });
  expect(got.res.headers.get("content-disposition")).toMatch(/^attachment; filename="eqosys-data-\d{4}-\d\d-\d\d\.json"$/);
  const file = await got.res.json() as { sections: { id: string; data: unknown }[] };
  const part = (id: string) => file.sections.find((s) => s.id === id)?.data;
  expect(file.sections.map((s) => s.id)).toEqual(HOLDERS.map((h) => h.id));
  expect(part("account")).toMatchObject({ user: { email: "ada@example.com" }, sign_ins: [{ provider: "credential" }] });
  expect(JSON.stringify(part("account"))).not.toContain("password\":\"");
  expect(part("apps")).toMatchObject({ member: { source: "park-hide-seek", region: "eu" }, apps: [{ app: "park-hide-seek" }] });
  expect(part("saves")).toMatchObject([{ slot: "run", base64: btoa("level 7, 3 lives") }]);
  expect(part("privacy")).toMatchObject({ log: [{ kind: "export" }] });
  expect(JSON.stringify(file)).not.toContain("bo@example.com");
  expect((await call("/api/privacy/export")).res.status).toBe(401);

  // Erasure: the account goes, the vault's key with it, and the backup copy of the save stays shut for good.
  expect(await (await call("/api/account/delete", { json: {}, bearer: ada.token, origin: PARK })).res.json()).toEqual({ ok: true });
  expect(await conf.DB.prepare("SELECT 1 FROM saves WHERE user_id = ?").bind(ada.user.id).first()).toBeNull();
  const fresh = await keyOf(eu, ada.user.id);
  expect(fresh).not.toBe(adaKey);
  expect(await unseal(fresh, backup, `${ada.user.id}/park-hide-seek/run`)).toBeNull();
  expect(await (await call("/q/save/run", { bearer: bo.token, origin: PARK })).res.text()).toBe("level 1");
});
