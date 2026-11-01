// Two players of one app join the same party code and each sees the other; a token for another app is refused.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { Party, type PartyOut } from "../src/party.ts";
import { asks, boot, codeIn, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.PARTY = durableObject(Party as never, conf) as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
afterAll(() => shell.stop());

async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { token: string };
  return who.token;
}

function join(code: string, token: string, origin: string) {
  const got: PartyOut[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${shell.port}/q/party/${code}?token=${token}`, { headers: { origin } } as never);
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
  return { ws, names: () => got.at(-1)?.members.map((m) => m.name).sort() };
}
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };
const knock = (code: string, token: string, origin: string) => fetch(`http://127.0.0.1:${shell.port}/q/party/${code}?token=${token}`, {
  headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13", origin },
});

test("two players join one code and see each other; another app's token is a 403", async () => {
  const ada = await signUp("Ada", "park-hide-seek", PARK);
  const bo = await signUp("Bo", "park-hide-seek", PARK);
  const cy = await signUp("Cy", "qcrm", QCRM);

  const a = join("KRTZ", ada, PARK);
  await until(() => a.names()?.join() === "Ada");
  const b = join("krtz", bo, PARK);
  await until(() => a.names()?.join() === "Ada,Bo" && b.names()?.join() === "Ada,Bo");

  expect((await knock("KRTZ", cy, QCRM)).status).toBe(403);
  expect((await knock("KRTZ", "nope", PARK)).status).toBe(401);
  expect((await knock("no", ada, PARK)).status).toBe(400);

  b.ws.close();
  await until(() => a.names()?.join() === "Ada");
  a.ws.close();
});
