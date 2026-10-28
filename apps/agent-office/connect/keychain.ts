// Where the office keeps a GitHub token: the Mac's login keychain, written by the office itself through `security`,
// so it doesn't matter how the office was started (gh's own keyring is out of reach from some shells, #2498).
// Elsewhere (Linux, a box) a file only this user can read, beside the office's data.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Secrets {
  get(account: string): Promise<string | null>;
  set(account: string, token: string): Promise<void>;
  remove(account: string): Promise<void>;
}

export const SERVICE = "agent-office-github";

function run(args: string[], stdin?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn("security", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ code: -1, out, err: e.message }));
    p.on("close", (code) => resolve({ code: code ?? -1, out, err }));
    p.stdin.end(stdin ?? "");
  });
}

/** A login or token as one argument of a `security -i` line (both are [A-Za-z0-9_-]; anything else is refused). */
function word(s: string): string {
  if (!/^[\w.-]+$/.test(s)) throw new Error(`can't keep ${JSON.stringify(s)} in the keychain`);
  return s;
}

export function keychain(service = SERVICE): Secrets {
  return {
    async get(account) {
      const r = await run(["find-generic-password", "-s", service, "-a", word(account), "-w"]);
      return r.code === 0 ? r.out.trim() || null : null;
    },
    async set(account, token) {
      // the token goes in on stdin (`security -i`), never on a command line another process could read
      const r = await run(["-i"], `add-generic-password -U -s ${word(service)} -a ${word(account)} -w ${word(token)}\n`);
      if (r.code !== 0 || r.err.trim()) throw new Error(`the keychain refused the token: ${r.err.trim() || `exit ${r.code}`}`);
    },
    async remove(account) {
      await run(["delete-generic-password", "-s", service, "-a", word(account)]);
    },
  };
}

export function fileSecrets(dir: string): Secrets {
  const file = path.join(dir, "github-tokens.json");
  const read = (): Record<string, string> => {
    if (!existsSync(file)) return {};
    const v: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
  };
  const write = (all: Record<string, string>) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
    chmodSync(file, 0o600);
  };
  return {
    async get(account) { return read()[account] ?? null; },
    async set(account, token) { write({ ...read(), [account]: token }); },
    async remove(account) { const all = read(); delete all[account]; write(all); },
  };
}

export const secretsFor = (dir: string): Secrets => (process.platform === "darwin" ? keychain() : fileSecrets(dir));
