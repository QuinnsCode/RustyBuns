// The friends journey against a live eqosys, so nobody clicks through it by hand before a go-live (Part of #3898):
// two throwaway accounts sign up through a game, become friends, see each other online on the hub socket (eqosys's
// front door into Qollab), meet in a party by code, unfriend, and are deleted again, so it is safe on production too.
//   bun apps/eqosys/scripts/live-check.ts --url https://eqosys-preview.qntbr.com
// One line a step; the first failure says where and exits 1 (the accounts are still deleted).
import { check, num, obj, oneOf, str, type Guard } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import { ExchangeReply, PartyMsg, SOCKET_PROTOCOL } from "@rustybuns/util/eqosys";
import { HubState } from "../src/qollab/hub.ts";
import { challengeOf } from "../src/members.ts";
import { appOf } from "../src/apps.ts";

const flag = process.argv.indexOf("--url");
const BASE = (flag > 0 ? process.argv[flag + 1] : undefined)?.replace(/\/+$/, "");
if (!BASE) { console.error("usage: bun apps/eqosys/scripts/live-check.ts --url https://eqosys-preview.qntbr.com"); process.exit(2); }
const WS = BASE.replace(/^http/, "ws");
// A game, so the party is its own: the token's app is the one whose pages may open its sockets.
const APP = "park-hide-seek", ORIGIN = appOf(APP)!.origins[0]!;
const WAIT = 15_000;

class Failed extends Error {}
const ok = (step: string) => console.log(`ok    ${step}`);
async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try { const v = await run(); ok(name); return v; } catch (e) {
    console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`);
    throw new Failed(name);
  }
}
const until = async (what: string, f: () => boolean | Promise<boolean>) => {
  const end = Date.now() + WAIT;
  while (!(await f())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(100); }
};

type Person = { name: string; email: string; id: string; token: string };
const tag = crypto.randomUUID().slice(0, 8);
const PASSWORD = `live-check ${crypto.randomUUID()}`;

/** Sign up through the game's handoff, as its page does: /do/signup back to the game with a code, the code traded for a token. */
async function signUp(name: string): Promise<Person> {
  const email = `livecheck+${tag}-${name.toLowerCase()}@example.com`;
  const verifier = "v".repeat(20) + crypto.randomUUID().replaceAll("-", "");
  const form = { app: APP, return: `${ORIGIN}/`, challenge: await challengeOf(verifier), state: "live", name, email, password: PASSWORD };
  const up = await fetch(`${BASE}/do/signup`, { method: "POST", body: new URLSearchParams(form), headers: { origin: BASE! }, redirect: "manual" });
  const to = up.headers.get("location") ?? "";
  const code = to.startsWith(ORIGIN) ? new URL(to).searchParams.get("code") : null;
  if (!code) throw new Error(`sign-up answered ${up.status} to ${to || "nowhere"}, not the game with a code`);
  const who = await getJson(`${BASE}/api/exchange`, ExchangeReply, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ app: APP, code, verifier }) });
  if (!who) throw new Error("the code didn't trade in for a login");
  if (!who.token) throw new Error("eqosys has no signing key: the login came back without a token");
  return { name, email, id: who.user.id, token: who.token };
}

/** One op on a person's own hub from the game's page, answered with their state. */
async function hub(p: Person, op: Record<string, string>) {
  const s = await getJson(`${BASE}/api/hub`, HubState, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, origin: ORIGIN }, body: JSON.stringify(op) });
  if (!s) throw new Error(`/api/hub ${op.op} didn't answer with a hub state`);
  return s;
}

/** A live socket the game's page holds, the token as a subprotocol: every frame read through `guard`, the latest kept. */
function socket<T>(path: string, p: Person, guard: Guard<T>) {
  const got: T[] = [];
  let bad = "";
  const ws = new WebSocket(`${WS}${path}`, { headers: { origin: ORIGIN }, protocols: [SOCKET_PROTOCOL, p.token] });
  ws.onmessage = (e) => { const v = check(guard, JSON.parse(String(e.data))); if (v) got.push(v); else bad = String(e.data).slice(0, 200); };
  ws.onclose = (e) => { if (e.code !== 1000 && e.code !== 1005) bad ||= `closed ${e.code} ${e.reason}`; };
  const opened = new Promise<void>((yes, no) => { ws.onopen = () => yes(); ws.onerror = () => no(new Error(`${path} socket didn't open`)); });
  return { ws, got, opened, problem: () => bad };
}

const HubFrame = obj({ t: oneOf(["state", "error"]) });
const HubOut: Guard<{ t: "state"; state: HubState } | { t: "error" }> = (v) => {
  const t = HubFrame(v).t;
  return t === "state" ? { t, state: HubState(v) } : { t };
};
type HubState = ReturnType<typeof HubState>;
const Minted = obj({ code: str(16), expires: num(0, 1e15) });
const Deleted = obj({ ok: oneOf([true]) });

const people: Person[] = [];
let failed = false;
const sockets: WebSocket[] = [];
console.log(`eqosys live check against ${BASE} (accounts livecheck+${tag}-*@example.com)`);
try {
  const a = await step("A signs up through the game and gets a token", () => signUp("Ada"));
  people.push(a);
  const b = await step("B signs up through the game and gets a token", () => signUp("Bo"));
  people.push(b);

  await step("A asks B by email; A's list shows the email typed", async () => {
    const s = await hub(a, { op: "befriend", email: b.email.toUpperCase() });
    if (!s.outgoing.some((o) => o.name.toLowerCase() === b.email)) throw new Error(`A's outgoing is ${JSON.stringify(s.outgoing)}`);
  });
  await step("B sees A's request", async () => {
    const s = await hub(b, { op: "state" });
    if (!s.incoming.some((i) => i.id === a.id)) throw new Error(`B's incoming is ${JSON.stringify(s.incoming)}`);
  });
  await step("B accepts", async () => {
    const s = await hub(b, { op: "accept", id: a.id });
    if (!s.friends.some((f) => f.id === a.id)) throw new Error(`B's friends after accepting are ${JSON.stringify(s.friends)}`);
  });
  await step("both see each other as friends", async () => {
    await until("A to see B as a friend", async () => (await hub(a, { op: "state" })).friends.some((f) => f.id === b.id && f.name === b.name));
    await until("B to see A as a friend", async () => (await hub(b, { op: "state" })).friends.some((f) => f.id === a.id && f.name === a.name));
  });

  await step("both open the hub socket and see the other online", async () => {
    const ha = socket("/hub", a, HubOut), hb = socket("/hub", b, HubOut);
    sockets.push(ha.ws, hb.ws);
    await Promise.all([ha.opened, hb.opened]);
    const online = (s: typeof ha, friend: Person) => () => {
      if (s.problem()) throw new Error(`hub socket: ${s.problem()}`);
      const last = s.got.filter((m) => m.t === "state").at(-1);
      return !!last && last.t === "state" && last.state.friends.some((f) => f.id === friend.id && f.presence.some((p) => p.app === APP));
    };
    await until("A to see B online", online(ha, b));
    await until("B to see A online", online(hb, a));
  });

  await step("A opens a party and B joins it by code; both see two members", async () => {
    const made = await getJson(`${BASE}/q/party?open=1`, Minted, { method: "POST", headers: { authorization: `Bearer ${a.token}`, origin: ORIGIN } });
    if (!made) throw new Error("/q/party didn't mint a code");
    const pa = socket(`/q/party/${made.code}`, a, PartyMsg);
    await pa.opened;
    const pb = socket(`/q/party/${made.code.toLowerCase()}`, b, PartyMsg);
    sockets.push(pa.ws, pb.ws);
    await pb.opened;
    const both = (s: typeof pa) => () => {
      if (s.problem()) throw new Error(`party socket: ${s.problem()}`);
      const last = s.got.filter((m) => m.t === "members").at(-1);
      const names = last?.t === "members" ? last.members.map((m) => m.name).sort().join() : "";
      return names === [a.name, b.name].sort().join();
    };
    await until("A to see both in the party", both(pa));
    await until("B to see both in the party", both(pb));
  });
  for (const ws of sockets.splice(0)) ws.close();

  await step("A unfriends B; neither lists the other", async () => {
    const s = await hub(a, { op: "drop", id: b.id });
    if (s.friends.length) throw new Error(`A still lists ${JSON.stringify(s.friends)}`);
    await until("B's list to lose A", async () => (await hub(b, { op: "state" })).friends.length === 0);
  });
} catch (e) {
  if (!(e instanceof Failed)) console.log(`FAIL  ${e instanceof Error ? e.message : String(e)}`);
  failed = true;
} finally {
  for (const ws of sockets) ws.close();
  // The accounts go whatever happened above, so a failed run leaves nothing behind.
  for (const p of people) {
    try {
      await step(`${p.name === "Ada" ? "A" : "B"}'s account is deleted`, async () => {
        const r = await getJson(`${BASE}/api/account/delete`, Deleted, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, origin: ORIGIN }, body: "{}" });
        if (!r) throw new Error("/api/account/delete didn't answer { ok: true }");
        const after = await fetch(`${BASE}/api/hub`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, origin: ORIGIN }, body: '{"op":"state"}' });
        if (after.status !== 401) throw new Error(`the deleted account's token still opens its hub (${after.status})`);
      });
    } catch { failed = true; console.log(`      delete ${p.email} by hand`); }
  }
}
console.log(failed ? "live check FAILED" : "live check passed");
process.exit(failed ? 1 : 0);
