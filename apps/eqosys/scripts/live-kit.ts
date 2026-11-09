// What the live checks (live-check.ts, live-check-two-fronts.ts) share: throwaway accounts made through an app's own
// handoff, one printed line a step, the app page's sockets, and deleting every account at the end whatever happened.
import { bool, check, num, obj, oneOf, str, type Guard, type Of } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import { ExchangeReply, SOCKET_PROTOCOL } from "@rustybuns/util/eqosys";
import { HubState } from "../src/qollab/hub.ts";
import { challengeOf } from "../src/members.ts";
import { ourApp } from "../src/apps.ts";

export type Hub = Of<typeof HubState>;
export type Person = { name: string; email: string; id: string; token: string; app: string; origin: string };

/** `--name value` off the command line, or `fallback`. */
export const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return (i > 0 ? process.argv[i + 1] : undefined) ?? fallback;
};

const WAIT = 15_000;
class Failed extends Error {}
/** One step, one line: `ok` and its value, or `FAIL` with why, and the run stops there. */
export async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try { const v = await run(); console.log(`ok    ${name}`); return v; } catch (e) {
    console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`);
    throw new Failed(name);
  }
}
export const until = async (what: string, f: () => boolean | Promise<boolean>) => {
  const end = Date.now() + WAIT;
  while (!(await f())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(100); }
};

/**
 * A live check against eqosys at `base`: `body` gets `signUp` and `socket`, and every account it made is deleted after,
 * passed or failed, so the run is safe on production. Exits 1 on the first failure.
 */
export async function liveCheck(title: string, body: (k: Kit) => Promise<void>): Promise<never> {
  const base = arg("url")?.replace(/\/+$/, "");
  if (!base) { console.error(`usage: bun ${process.argv[1]} --url https://eqosys-preview.qntbr.com`); process.exit(2); }
  const tag = crypto.randomUUID().slice(0, 8), password = `live-check ${crypto.randomUUID()}`;
  const people: Person[] = [], sockets: WebSocket[] = [];
  console.log(`${title} against ${base} (accounts livecheck+${tag}-*@example.com)`);

  /** Sign up through the app's handoff, as its page does: /do/signup back to the app with a code, the code traded for a token. */
  const signUp = async (name: string, app: string): Promise<Person> => {
    const origin = ourApp(app)?.origins[0];
    if (!origin) throw new Error(`${app} isn't an eqosys app with a page`);
    const email = `livecheck+${tag}-${name.toLowerCase()}@example.com`;
    const verifier = "v".repeat(20) + crypto.randomUUID().replaceAll("-", "");
    const form = { app, return: `${origin}/`, challenge: await challengeOf(verifier), state: "live", name, email, password };
    const up = await fetch(`${base}/do/signup`, { method: "POST", body: new URLSearchParams(form), headers: { origin: base }, redirect: "manual" });
    const to = up.headers.get("location") ?? "";
    const code = to.startsWith(origin) ? new URL(to).searchParams.get("code") : null;
    if (!code) throw new Error(`sign-up answered ${up.status} to ${to || "nowhere"}, not ${app} with a code`);
    const who = await getJson(`${base}/api/exchange`, ExchangeReply, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ app, code, verifier }) });
    if (!who) throw new Error("the code didn't trade in for a login");
    if (!who.token) throw new Error("eqosys has no signing key: the login came back without a token");
    const p = { name, email, id: who.user.id, token: who.token, app, origin };
    people.push(p);
    return p;
  };

  /** One op on a person's own hub from their app's page, answered with their state. */
  const hub = async (p: Person, op: Record<string, string>) => {
    const s = await getJson(`${base}/api/hub`, HubState, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, origin: p.origin }, body: JSON.stringify(op) });
    if (!s) throw new Error(`/api/hub ${op.op} didn't answer with a hub state`);
    return s;
  };

  /** A live socket the app's page holds, the token as a subprotocol: every frame read through `guard`. */
  const socket = <T>(path: string, p: Person, guard: Guard<T>) => {
    const got: T[] = [];
    let bad = "";
    // @ts-expect-error Bun's WebSocket takes headers; the DOM type does not
    const ws = new WebSocket(`${base.replace(/^http/, "ws")}${path}`, { headers: { origin: p.origin }, protocols: [SOCKET_PROTOCOL, p.token] });
    sockets.push(ws);
    ws.onmessage = (e) => { const v = check(guard, JSON.parse(String(e.data))); if (v) got.push(v); else bad = String(e.data).slice(0, 200); };
    ws.onclose = (e) => { if (e.code !== 1000 && e.code !== 1005) bad ||= `closed ${e.code} ${e.reason}`; };
    const opened = new Promise<void>((yes, no) => { ws.onopen = () => yes(); ws.onerror = () => no(new Error(`${path} socket didn't open`)); });
    /** The newest frame `pick` takes; throws once the socket has had a frame it can't read or closed on an error. */
    const last = <U>(pick: (m: T) => U | undefined) => {
      if (bad) throw new Error(`${path}: ${bad}`);
      for (let i = got.length - 1; i >= 0; i--) { const u = pick(got[i]!); if (u !== undefined) return u; }
      return undefined;
    };
    return { ws, got, opened, last, send: (m: unknown) => ws.send(JSON.stringify(m)) };
  };

  /** A party code minted by `host` for their app (`open`: anyone on the app with the code may join, else the host's friends). */
  const mintParty = async (host: Person, open = false) => {
    const made = await getJson(`${base}/q/party${open ? "?open=1" : ""}`, Minted, { method: "POST", headers: { authorization: `Bearer ${host.token}`, origin: host.origin } });
    if (!made) throw new Error("/q/party didn't mint a code");
    return made.code;
  };

  /** A asks B by email and B says yes: friends both ways. */
  const befriend = async (a: Person, b: Person) => {
    await hub(a, { op: "befriend", email: b.email });
    await until(`${b.name} to see ${a.name}'s request`, async () => (await hub(b, { op: "state" })).incoming.some((i) => i.id === a.id));
    await hub(b, { op: "accept", id: a.id });
    await until(`${a.name} to list ${b.name}`, async () => (await hub(a, { op: "state" })).friends.some((f) => f.id === b.id));
  };

  let failed = false;
  try { await body({ base, signUp, hub, socket, mintParty, befriend, closeSockets: () => { for (const ws of sockets.splice(0)) ws.close(); } }); } catch (e) {
    if (!(e instanceof Failed)) console.log(`FAIL  ${e instanceof Error ? e.message : String(e)}`);
    failed = true;
  }
  for (const ws of sockets) ws.close();
  for (const p of people) {
    try {
      await step(`${p.name}'s account is deleted`, async () => {
        const r = await getJson(`${base}/api/account/delete`, Deleted, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, origin: p.origin }, body: "{}" });
        if (!r?.ok) throw new Error("/api/account/delete didn't answer { ok: true }");
        const after = await fetch(`${base}/api/hub`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, origin: p.origin }, body: '{"op":"state"}' });
        if (after.status !== 401) throw new Error(`the deleted account's token still opens its hub (${after.status})`);
      });
    } catch { failed = true; console.log(`      delete ${p.email} by hand`); }
  }
  console.log(failed ? `${title} FAILED` : `${title} passed`);
  process.exit(failed ? 1 : 0);
}

const Minted = obj({ code: str(16), expires: num(0, 1e15) });
const Deleted = obj({ ok: bool() });

export interface Kit {
  base: string;
  signUp(name: string, app: string): Promise<Person>;
  hub(p: Person, op: Record<string, string>): Promise<Hub>;
  socket<T>(path: string, p: Person, guard: Guard<T>): {
    ws: WebSocket; got: T[]; opened: Promise<void>; last<U>(pick: (m: T) => U | undefined): U | undefined; send(m: unknown): void;
  };
  mintParty(host: Person, open?: boolean): Promise<string>;
  befriend(a: Person, b: Person): Promise<void>;
  closeSockets(): void;
}

/** A hub socket's frames: a state, or an error. */
const HubFrame = obj({ t: oneOf(["state", "error"]) });
export const HubOut: Guard<{ t: "state"; state: Hub } | { t: "error" }> = (v) => {
  const t = HubFrame(v).t;
  return t === "state" ? { t, state: HubState(v) } : { t };
};
