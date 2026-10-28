// The build computer's card, server half (built into rb-builder.js): is the builder Mac reachable, and what did last
// night's build (scripts/builder-nightly.ts) say. Signed-in only, like the other /__rb/ routes. It only reads: one ssh,
// the same one `bun run builder` uses (scripts/remote-ci.ts), and nothing on the builder changes.

export type Status = "ok" | "down" | "unset";
export type Nightly = { at: string; commit: string; results: { app: string; target: string; ok: boolean; seconds: number }[] };
export type Run = (host: string, script: string) => Promise<{ code: number; out: string }>;

const SETUP = "curl -fsSL https://raw.githubusercontent.com/QuinnsCode/RustyBuns/main/scripts/builder-setup.sh | sh -s -- 3";
const NIGHTLY = "$HOME/builder/nightly/results.json";

/** One ssh to the builder, never asking for a password and giving up after a few seconds. */
export const ssh: Run = async (host, script) => {
  const argv = (process.env.BUILDER_SSH ?? "ssh -o BatchMode=yes").split(" ");
  const p = Bun.spawn([...argv, "-o", "ConnectTimeout=4", host, script], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), 8_000);
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  clearTimeout(timer);
  return { code, out };
};

/** Last night's results file, or null while there is none or it isn't the shape builder-nightly writes. */
export function parseNightly(text: string): Nightly | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  if (typeof j !== "object" || j === null || !("at" in j) || !("results" in j) || !Array.isArray(j.results)) return null;
  const commit = "commit" in j && typeof j.commit === "string" ? j.commit : "";
  if (typeof j.at !== "string") return null;
  const results: Nightly["results"] = [];
  for (const r of j.results) {
    if (typeof r !== "object" || r === null || !("app" in r) || !("ok" in r)) continue;
    const { app, ok } = r;
    if (typeof app !== "string" || typeof ok !== "boolean") continue;
    results.push({ app, target: "target" in r && typeof r.target === "string" ? r.target : "", ok, seconds: "seconds" in r && typeof r.seconds === "number" ? r.seconds : 0 });
  }
  return { at: j.at, commit, results };
}

export async function builderState(host: string | undefined, run: Run = ssh) {
  const connection = (status: Status) => ({ id: "builder", kind: "builder", account: host ?? "", status, access: "read" as const });
  if (!host) return { connections: [connection("unset")], setup: SETUP, nightly: null };
  const r = await run(host, `cat ${NIGHTLY} 2>/dev/null; true`).catch(() => ({ code: 255, out: "" }));
  if (r.code !== 0) return { connections: [connection("down")], setup: SETUP, nightly: null };
  return { connections: [connection("ok")], setup: SETUP, nightly: parseNightly(r.out) };
}

export function builderRoute(run: Run = ssh, host: () => string | undefined = () => process.env.BUILDER_HOST) {
  return async (method: string, url: URL): Promise<{ status: number; body: unknown } | null> => {
    if (url.pathname !== "/__rb/builder" || method !== "GET") return null;
    return { status: 200, body: await builderState(host(), run) };
  };
}

