// A game saves, overwrites and reads back through the token: a slot keeps five versions, the reply names the one it replaced,
// a body or a person's total over the cap is refused, and another app's token sees nothing.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { MAX_BODY, QUOTA } from "../src/saves.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });

async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  return (await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { token: string }).token;
}
const save = (method: "PUT" | "GET", slot: string, token: string, body?: Uint8Array, q = "") =>
  handle(new Request(`${ORIGIN}/q/save/${slot}${q}`, { method, headers: { authorization: `Bearer ${token}`, origin: PARK }, body }), conf).then((r) => r!);
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

test("save, overwrite, previous version, drop the oldest, and the caps", async () => {
  const ada = await signUp("Ada", "park-hide-seek", PARK);

  expect((await save("GET", "run", ada)).status).toBe(404);
  expect((await save("PUT", "run", "nonsense", bytes(3, 1))).status).toBe(401);

  const first = await (await save("PUT", "run", ada, bytes(10, 1))).json() as { id: number; previous: unknown };
  expect(first.previous).toBeNull();
  const second = await (await save("PUT", "run", ada, bytes(20, 2))).json() as { id: number; previous: { id: number; at: number } };
  expect(second.previous.id).toBe(first.id);

  const got = await save("GET", "run", ada);
  expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes(20, 2));
  expect(got.headers.get("x-save-id")).toBe(String(second.id));
  // The cloud's older one is still there for "keep the cloud one".
  expect(new Uint8Array(await (await save("GET", "run", ada, undefined, `?v=${first.id}`)).arrayBuffer())).toEqual(bytes(10, 1));

  // A sixth version drops the oldest.
  for (let i = 3; i <= 6; i++) await save("PUT", "run", ada, bytes(5, i));
  expect((await save("GET", "run", ada, undefined, `?v=${first.id}`)).status).toBe(404);
  expect((await save("GET", "run", ada, undefined, `?v=${second.id}`)).status).toBe(200);

  // Over the cap is a 413, nothing kept.
  expect((await save("PUT", "big", ada, bytes(MAX_BODY + 1, 9))).status).toBe(413);
  expect((await save("GET", "big", ada)).status).toBe(404);
  expect((await save("PUT", "bad slot", ada, bytes(1, 1))).status).toBe(400);

  // One app's save is not another app's, nor another person's.
  const other = await signUp("Bo", "qcrm", QCRM);
  expect((await save("GET", "run", other)).status).toBe(404);
  const cy = await signUp("Cy", "park-hide-seek", PARK);
  expect((await save("GET", "run", cy)).status).toBe(404);

  // Quota: a person's total across apps stops at 50 MB (a game alone tops out near 25: 20 slots of 5 versions).
  const adaId = (await conf.DB.prepare(`SELECT user_id FROM saves WHERE app = 'park-hide-seek' AND slot = 'run' LIMIT 1`).first<string>("user_id"))!;
  await conf.DB.prepare(`INSERT INTO saves (user_id, app, slot, at, size, data) VALUES (?, 'qcrm', 'old', 1, ?, x'00')`).bind(adaId, QUOTA - 100).run();
  expect((await save("PUT", "run", ada, bytes(50, 1))).status).toBe(200);
  expect((await save("PUT", "run", ada, bytes(500, 1))).status).toBe(507);
});
