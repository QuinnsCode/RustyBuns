// The build computer's card, server half (built into rb-builder.js): is the builder Mac reachable, and what did last
// night's build (scripts/builder-nightly.ts) say. Signed-in only, like the other /__rb/ routes. It only reads: one ssh,
// the same one `bun run builder` uses (scripts/remote-ci.ts), and nothing on the builder changes.
import { check } from "@rustybuns/util/guard";
import { parseJson } from "@rustybuns/util/http";
import { Nightly, type BuilderReply, type Status } from "../connect/types.ts";

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
export const parseNightly = (text: string): Nightly | null => check(Nightly, parseJson(text));

export async function builderState(host: string | undefined, run: Run = ssh): Promise<BuilderReply> {
  const reply = (status: Status, nightly: Nightly | null = null) =>
    ({ connections: [{ id: "builder", kind: "builder", account: host ?? "", status, access: "read" }], setup: SETUP, nightly }) satisfies BuilderReply;
  if (!host) return reply("unset");
  const r = await run(host, `cat ${NIGHTLY} 2>/dev/null; true`).catch(() => ({ code: 255, out: "" }));
  if (r.code !== 0) return reply("down");
  return reply("ok", parseNightly(r.out));
}

export function builderRoute(run: Run = ssh, host: () => string | undefined = () => process.env.BUILDER_HOST) {
  return async (method: string, url: URL): Promise<{ status: number; body: unknown } | null> => {
    if (url.pathname !== "/__rb/builder" || method !== "GET") return null;
    return { status: 200, body: await builderState(host(), run) };
  };
}

