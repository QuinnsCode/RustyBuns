// iOS jump-to-state, the pure half: the app address (with its scenario query), the rustybuns:// link the shell
// opens, the simulator to boot. No simctl here, so it tests without Xcode (ios-sim.test.ts); ios-sim.ts runs it.

export type Device = { udid: string; name: string; state: string; isAvailable: boolean };

/** `simctl list devices -j` as far as we read it. */
export function devicesOf(json: unknown): Device[] {
  const map = typeof json === "object" && json !== null && "devices" in json ? json.devices : null;
  if (typeof map !== "object" || map === null) return [];
  const out: Device[] = [];
  for (const [runtime, list] of Object.entries(map)) {
    if (!runtime.includes("iOS") || !Array.isArray(list)) continue;
    for (const d of list) {
      if (typeof d?.udid === "string" && typeof d.name === "string" && typeof d.state === "string") {
        out.push({ udid: d.udid, name: d.name, state: d.state, isAvailable: d.isAvailable !== false });
      }
    }
  }
  return out;
}

/** The simulator to use: the one named, else one already booted, else the first iPhone. */
export function pickDevice(devices: Device[], name?: string): Device | null {
  const ok = devices.filter((d) => d.isAvailable);
  if (name) return ok.find((d) => d.name === name) ?? null;
  return ok.find((d) => d.state === "Booted") ?? ok.find((d) => d.name.startsWith("iPhone")) ?? null;
}

/** The app address with the scenario merged into its query: `https://x.dev` + `level=5` is `https://x.dev/?level=5`. */
export function appUrl(url: string, state: string[] = []): URL {
  const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`not a web address: ${url}`);
  for (const kv of state) {
    const i = kv.indexOf("=");
    if (i < 1) throw new Error(`state must be key=value, got "${kv}"`);
    u.searchParams.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return u;
}

/** The link the shell's URL scheme opens: rustybuns://open?url=<address>. */
export const deepLink = (u: URL) => `rustybuns://open?url=${encodeURIComponent(u.href)}`;

export type Args = { url: string; state: string[]; device?: string; build: boolean };

/** `<url> [key=value ...] [--device "iPhone 15"] [--build]`. */
export function parseArgs(argv: string[]): Args {
  const a: Args = { url: "", state: [], build: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--build") a.build = true;
    else if (v === "--device") {
      const n = argv[++i];
      if (!n) throw new Error("--device needs a simulator name");
      a.device = n;
    } else if (v.startsWith("--")) throw new Error(`unknown flag ${v}`);
    else if (!a.url) a.url = v;
    else a.state.push(v);
  }
  if (!a.url) throw new Error("usage: bun run ios <app-url> [key=value ...] [--device NAME] [--build]");
  return a;
}
