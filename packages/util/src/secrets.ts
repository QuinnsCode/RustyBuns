// A desktop app's secrets in the place its OS keeps them: the login keychain on macOS, Credential Manager on
// Windows, the Secret Service (GNOME Keyring, KWallet) on Linux. Bun only: a Worker has no OS to ask.
//
// macOS goes through `/usr/bin/security`, not `Bun.secrets`: a keychain item remembers which program made it and asks
// again whenever a different build reads it, so every rebuilt office binary would pop a "wants to use your keychain"
// sheet. An item `security` made is read by `security` every time, however the app was started (#2498).
// Windows and Linux have no such per-program lock, so `Bun.secrets` covers them. A Linux box with no Secret Service
// (a server, a container, no D-Bus session) falls back to a file only this user can read, when the caller names a folder.
//
// A value is printable ASCII (a token, or JSON with `asciiJson`); anything else is refused, so it reads back as written.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hex } from "./bytes.ts";
import { check } from "./guard.ts";
import { Login } from "./token.ts";

export interface Secrets {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  remove(account: string): Promise<void>;
}

/** Which store a platform uses: what `osSecrets` picks, and what a settings page can name. */
export const storeFor = (platform: string): "keychain" | "credential-manager" | "secret-service" | "file" =>
  platform === "darwin" ? "keychain" : platform === "win32" ? "credential-manager" : platform === "linux" ? "secret-service" : "file";

/** A service or account name: letters, digits, `_`, `.` and `-`, so it is one safe word on a `security` line. */
function word(s: string): string {
  if (!/^[\w.-]{1,128}$/.test(s)) throw new Error(`can't name a secret ${JSON.stringify(s)}`);
  return s;
}

function printable(v: string): string {
  if (!/^[\x20-\x7e]{1,8192}$/.test(v)) throw new Error("a secret is 1 to 8192 printable ASCII characters (asciiJson for JSON)");
  return v;
}

/** JSON with every non-ASCII character written as \uXXXX, so a name like "Zoë" can be kept as a secret. */
export const asciiJson = (v: unknown): string =>
  JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

type Run = (args: string[], stdin?: string) => Promise<{ code: number; out: string; err: string }>;

const security: Run = async (args, stdin) => {
  try {
    const p = Bun.spawn(["/usr/bin/security", ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    p.stdin.write(stdin ?? "");
    await p.stdin.end();
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, out, err };
  } catch (e) {
    return { code: -1, out: "", err: e instanceof Error ? e.message : String(e) };
  }
};

/** The macOS login keychain, through `security`. The value goes in on stdin as hex, never on a command line. */
export function keychain(service: string, run: Run = security): Secrets {
  word(service);
  return {
    async get(account) {
      const r = await run(["find-generic-password", "-s", service, "-a", word(account), "-w"]);
      return r.code === 0 ? r.out.replace(/\n$/, "") || null : null;
    },
    async set(account, value) {
      const data = hex(new TextEncoder().encode(printable(value)));
      const r = await run(["-i"], `add-generic-password -U -s ${service} -a ${word(account)} -X ${data}\n`);
      if (r.code !== 0 || r.err.trim()) throw new Error(`the keychain refused the secret: ${r.err.trim() || `exit ${r.code}`}`);
    },
    async remove(account) {
      await run(["delete-generic-password", "-s", service, "-a", word(account)]);
    },
  };
}

/** Windows Credential Manager or the Linux Secret Service, through `Bun.secrets`. Throws when the OS has no store. */
export function bunSecrets(service: string): Secrets {
  word(service);
  return {
    get: (account) => Bun.secrets.get({ service, name: word(account) }),
    set: (account, value) => Bun.secrets.set({ service, name: word(account), value: printable(value) }),
    async remove(account) { await Bun.secrets.delete({ service, name: word(account) }); },
  };
}

/** A JSON file only this user can read, `<dir>/<service>.json`: where a box with no OS store keeps its secrets. */
export function fileSecrets(dir: string, service: string): Secrets {
  const file = join(dir, `${word(service)}.json`);
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
    async get(account) { return read()[word(account)] ?? null; },
    async set(account, value) { write({ ...read(), [word(account)]: printable(value) }); },
    async remove(account) { const all = read(); delete all[word(account)]; write(all); },
  };
}

/**
 * Tries `os` first and, when it throws (no Secret Service on this box), uses `file` from then on. A secret only the
 * file holds (kept before the OS store worked, or by an older build) moves into the OS store the first time it is read.
 */
export function withFallback(os: Secrets, file: Secrets): Secrets {
  let broken = false;
  const either = async <T>(f: (s: Secrets) => Promise<T>): Promise<T> => {
    if (!broken) {
      try { return await f(os); } catch { broken = true; }
    }
    return f(file);
  };
  return {
    async get(account) {
      const held = await either((s) => s.get(account));
      if (held !== null || broken) return held;
      const old = await file.get(account);
      if (old === null) return null;
      try { await os.set(account, old); await file.remove(account); } catch { /* the file keeps it */ }
      return old;
    },
    set: (account, value) => either((s) => s.set(account, value)),
    async remove(account) {
      await either((s) => s.remove(account));
      await file.remove(account);
    },
  };
}

/**
 * This OS's own store for `service`. With `fallbackDir`, a Linux box whose Secret Service doesn't answer (or an OS
 * with no store at all) uses `<fallbackDir>/<service>.json` instead, and secrets kept there move into the Secret
 * Service once it does. A Mac or Windows refusal is an error, never a quiet slide to a file.
 */
export function osSecrets(
  service: string,
  opts: { fallbackDir?: string; /** The fallback file's name, `<name>.json` (default the service). */ fallbackName?: string; platform?: string } = {},
): Secrets {
  const platform = opts.platform ?? process.platform, where = storeFor(platform);
  const file = opts.fallbackDir ? fileSecrets(opts.fallbackDir, opts.fallbackName ?? service) : null;
  if (where === "keychain") return keychain(service);
  if (where === "credential-manager") return bunSecrets(service);
  if (where === "secret-service") return file ? withFallback(bunSecrets(service), file) : bunSecrets(service);
  if (!file) throw new Error(`no secret store on ${platform}: pass fallbackDir`);
  return file;
}

/**
 * A desktop app's eqosys sign-in, kept in the OS store (service "eqosys", one entry per app) instead of a webview's
 * localStorage: the Bun side's twin of the iOS kit's `KeychainStore`. `load` gives null for nothing kept or a kept
 * value that isn't a `Login` any more; `save(null)` signs out.
 */
export function eqosysLogin(app: string, opts: { fallbackDir?: string; platform?: string; secrets?: Secrets } = {}) {
  const s = opts.secrets ?? osSecrets("eqosys", opts);
  return {
    async load(): Promise<Login | null> {
      const raw = await s.get(word(app));
      if (!raw) return null;
      try { return check(Login, JSON.parse(raw)); } catch { return null; }
    },
    async save(login: Login | null): Promise<void> {
      if (login) await s.set(word(app), asciiJson(Login(login)));
      else await s.remove(app);
    },
  };
}
