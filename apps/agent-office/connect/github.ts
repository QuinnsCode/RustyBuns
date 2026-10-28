// Sign the office in to GitHub with a code (the device flow), as many accounts as you like, built into rb-connect.js.
// Signed-in only, like the other /__rb/ routes. The list of accounts sits in the office's data folder; each token
// sits in the keychain (keychain.ts). Every account starts read-only (#2498): `access` turns to write only when
// the owner allows it, and nothing here does that.
//
//   GET  /__rb/connections                   the accounts, any code waiting to be typed, whether sign-in is set up
//   POST /__rb/connections?do=github         start a sign-in: a code to type at github.com/login/device
//   POST /__rb/connections?do=test&id=…      ask GitHub who the token is; the light turns green or red
//   POST /__rb/connections?do=revoke&id=…    forget the account and drop its token from the keychain
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { secretsFor, type Secrets } from "./keychain.ts";
import type { Access, Connection, Status } from "./types.ts";

export interface Deps {
  /** The office's data folder (the list of accounts lives here). */
  dir: string;
  /** The GitHub app's client ID (not a secret), from AGENT_OFFICE_GITHUB_CLIENT_ID. */
  clientId: string;
  secrets: Secrets;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** github.com and api.github.com, unless a test says otherwise. */
  web: string;
  api: string;
  wait(ms: number): Promise<void>;
}

interface Saved { id: string; account: string; access: Access }
export interface Pending { id: string; userCode: string; uri: string; expiresAt: number }
export interface State { connections: Connection[]; pending: Pending[]; ready: boolean; error?: string }

const listFile = (dir: string) => path.join(dir, "connections.json");

const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === "string" ? o[k] : undefined);
const num = (o: Record<string, unknown>, k: string) => (typeof o[k] === "number" ? o[k] : undefined);
async function object(r: Response): Promise<Record<string, unknown>> {
  const v: unknown = await r.json().catch(() => null);
  return typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : {};
}

export function loadSaved(dir: string): Saved[] {
  if (!existsSync(listFile(dir))) return [];
  const v: unknown = JSON.parse(readFileSync(listFile(dir), "utf8"));
  if (!Array.isArray(v)) return [];
  return v.flatMap((e: unknown) => {
    if (typeof e !== "object" || e === null) return [];
    const o = Object.fromEntries(Object.entries(e));
    const account = str(o, "account");
    return account ? [{ id: `github:${account}`, account, access: o.access === "write" ? "write" : "read" } satisfies Saved] : [];
  });
}

function save(dir: string, list: Saved[]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(listFile(dir), JSON.stringify(list, null, 2));
}

/** The office's own GitHub token: the account named, or the first one signed in. Null when there is none. */
export async function githubToken(dir: string, account?: string, secrets: Secrets = secretsFor(dir)): Promise<string | null> {
  const name = account ?? loadSaved(dir)[0]?.account;
  return name ? secrets.get(name) : null;
}

export function defaults(dir: string): Deps {
  return {
    dir, clientId: process.env.AGENT_OFFICE_GITHUB_CLIENT_ID ?? "", secrets: secretsFor(dir), fetch: (u, i) => fetch(u, i),
    web: "https://github.com", api: "https://api.github.com", wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

export function connections(deps: Deps) {
  const { dir, secrets } = deps;
  const status = new Map<string, Status>();
  const pending = new Map<string, Pending>();
  let error: string | undefined;
  let n = 0;

  const who = async (token: string): Promise<string | null> => {
    const r = await deps.fetch(`${deps.api}/user`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "agent-office" } }).catch(() => null);
    return r?.ok ? str(await object(r), "login") ?? null : null;
  };

  const test = async (s: Saved): Promise<Status> => {
    const token = await secrets.get(s.account).catch(() => null);
    const ok = token !== null && (await who(token)) === s.account;
    status.set(s.id, ok ? "ok" : "down");
    return ok ? "ok" : "down";
  };

  const form = (body: Record<string, string>) => ({
    method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(),
  });

  // GitHub says how often to ask; until the code is typed it answers authorization_pending
  async function poll(p: Pending, deviceCode: string, every: number) {
    while (Date.now() < p.expiresAt && pending.has(p.id)) {
      await deps.wait(every * 1000);
      const r = await deps.fetch(`${deps.web}/login/oauth/access_token`, form({ client_id: deps.clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" })).catch(() => null);
      const o = r ? await object(r) : {};
      const token = str(o, "access_token");
      if (token) {
        const login = await who(token);
        pending.delete(p.id);
        if (!login) return void (error = "GitHub gave a token but wouldn't say whose it is");
        await secrets.set(login, token);
        const list = loadSaved(dir);
        // signing in again keeps what was allowed; a new account starts read-only
        if (!list.some((s) => s.account === login)) save(dir, [...list, { id: `github:${login}`, account: login, access: "read" }]);
        status.set(`github:${login}`, "ok");
        error = undefined;
        return;
      }
      const e = str(o, "error");
      if (e === "slow_down") every = num(o, "interval") ?? every + 5;
      else if (e && e !== "authorization_pending") {
        pending.delete(p.id);
        return void (error = e === "access_denied" ? "The sign-in was cancelled on GitHub" : e === "expired_token" ? "The code ran out before it was typed; start again" : `GitHub said ${e}`);
      }
    }
    if (pending.delete(p.id)) error = "The code ran out before it was typed; start again";
  }

  async function start(): Promise<string | undefined> {
    if (!deps.clientId) return "Sign-in isn't set up: start the office with AGENT_OFFICE_GITHUB_CLIENT_ID (the GitHub app's client ID, #2499)";
    const r = await deps.fetch(`${deps.web}/login/device/code`, form({ client_id: deps.clientId })).catch(() => null);
    const o = r?.ok ? await object(r) : {};
    const deviceCode = str(o, "device_code"), userCode = str(o, "user_code"), uri = str(o, "verification_uri");
    if (!deviceCode || !userCode || !uri) return str(o, "error_description") ?? "GitHub didn't hand out a code; try again in a minute";
    const p: Pending = { id: `github:pending:${++n}`, userCode, uri, expiresAt: Date.now() + (num(o, "expires_in") ?? 900) * 1000 };
    pending.set(p.id, p);
    error = undefined;
    void poll(p, deviceCode, num(o, "interval") ?? 5);
  }

  // an account's light is looked up the first time it's drawn, then on Test
  const state = async (): Promise<State> => ({
    connections: await Promise.all(loadSaved(dir).map(async (s) => ({ id: s.id, kind: "github", account: s.account, access: s.access, status: status.get(s.id) ?? await test(s) }))),
    pending: [...pending.values()],
    ready: deps.clientId !== "",
    ...(error ? { error } : {}),
  });

  return async (method: string, url: URL): Promise<{ status: number; body: unknown } | null> => {
    if (url.pathname !== "/__rb/connections") return null;
    if (method === "GET") return { status: 200, body: await state() };
    if (method !== "POST") return null;
    const what = url.searchParams.get("do"), id = url.searchParams.get("id") ?? "";
    if (what === "github") {
      const e = await start();
      return e ? { status: 400, body: { ...await state(), error: e } } : { status: 200, body: await state() };
    }
    if (what === "cancel") { pending.delete(id); return { status: 200, body: await state() }; }
    const s = loadSaved(dir).find((c) => c.id === id);
    if (!s) return { status: 404, body: { ...await state(), error: "No such connection" } };
    if (what === "test") { await test(s); return { status: 200, body: await state() }; }
    if (what === "revoke") {
      await secrets.remove(s.account);
      save(dir, loadSaved(dir).filter((c) => c.id !== id));
      status.delete(id);
      return { status: 200, body: await state() };
    }
    return { status: 400, body: { ...await state(), error: "unknown change" } };
  };
}

export const connectRoute = (dir: string) => connections(defaults(dir));
