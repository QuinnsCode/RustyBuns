#!/usr/bin/env bun
// 🥐 The office on your phone: puts the office this Mac is running on HTTPS your phone can reach, and prints the
// link to its 2D view, /lite (every worker, its terminal and what it's waiting on, the issues, PRs and queue, ✨ New task).
// The office keeps listening on 127.0.0.1; only the tunnel reaches it, and the office password (or your account)
// still guards it.
//
//   bun run office:phone                          Tailscale Serve: https://<this-mac>.<tailnet>.ts.net, your tailnet only
//   bun run office:phone -- --off                 stop serving it on the tailnet
//   bun run office:phone -- --cloudflare --tunnel office --hostname office.example.com
//                                                 a named Cloudflare Tunnel, behind Cloudflare Access (README)
//   bun run office:phone -- --cloudflare --public a quick *.trycloudflare.com tunnel: anyone with the link reaches the login
//   --port 4700                                   an office on another port (4600 by default)
import { existsSync } from "node:fs";
import { connect } from "node:net";

export type Plan =
  | { via: "tailscale"; port: number; off: boolean }
  | { via: "cloudflare"; port: number; tunnel?: string; hostname?: string };

export function plan(args: string[]): Plan {
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    if (at < 0) return undefined;
    const v = args[at + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const port = Number(value("--port") ?? 4600);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port ${value("--port")} isn't a port`);
  if (!args.includes("--cloudflare")) return { via: "tailscale", port, off: args.includes("--off") };
  const tunnel = value("--tunnel"), hostname = value("--hostname");
  if (!tunnel !== !hostname) throw new Error("--tunnel and --hostname go together");
  if (!tunnel && !args.includes("--public"))
    throw new Error("a quick tunnel puts the office's login on the internet: say --public, or use --tunnel/--hostname behind Cloudflare Access");
  return { via: "cloudflare", port, tunnel, hostname };
}

/** The 2D view on the phone, signing in first if it must (the office sends /lite to /login?next=/lite). */
export const liteUrl = (origin: string) => `${origin.replace(/\/+$/, "")}/lite`;

/** This machine's MagicDNS name, from `tailscale status --json`. */
export function tailnetHost(status: { Self?: { DNSName?: string } }) {
  return status.Self?.DNSName?.replace(/\.$/, "") || undefined;
}

/** The quick tunnel's address, from cloudflared's log. */
export const quickTunnelUrl = (log: string) => /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log)?.[0];

const which = (...names: string[]) => names.find((n) => (n.startsWith("/") ? existsSync(n) : Bun.which(n)));

const officeUp = (port: number) =>
  new Promise<boolean>((done) => {
    const s = connect(port, "127.0.0.1", () => { s.end(); done(true); });
    s.on("error", () => done(false));
  });

function ready(url: string) {
  console.log(`\n📱 On your phone: ${url}`);
  console.log("   Sign in with the office password, or better, an account of your own (☰ → 🔑 Accounts).");
  console.log("   Add it to your home screen and it opens like an app.\n");
}

async function tailscale(p: Extract<Plan, { via: "tailscale" }>) {
  const ts = which("tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  if (!ts) throw new Error("no tailscale: install it (https://tailscale.com/download), sign in, and on your phone too");
  if (p.off) {
    const r = Bun.spawnSync([ts, "serve", "--https=443", "off"], { stdio: ["inherit", "inherit", "inherit"] });
    return r.exitCode ?? 1;
  }
  const status = Bun.spawnSync([ts, "status", "--json"]);
  const host = status.exitCode === 0 ? tailnetHost(JSON.parse(status.stdout.toString())) : undefined;
  if (!host) throw new Error("tailscale isn't up on this Mac: open Tailscale and sign in");
  // The first time, this prints a link to turn on HTTPS for the tailnet.
  const r = Bun.spawnSync([ts, "serve", "--bg", "--https=443", `http://127.0.0.1:${p.port}`], { stdio: ["inherit", "inherit", "inherit"] });
  if (r.exitCode !== 0) return r.exitCode ?? 1;
  ready(liteUrl(`https://${host}`));
  console.log("   Only devices on your tailnet can open it. `bun run office:phone -- --off` stops it.");
  return 0;
}

async function cloudflare(p: Extract<Plan, { via: "cloudflare" }>) {
  const cf = which("cloudflared");
  if (!cf) throw new Error("no cloudflared: brew install cloudflared");
  const origin = `http://127.0.0.1:${p.port}`;
  const cmd = p.tunnel ? [cf, "tunnel", "run", "--url", origin, p.tunnel] : [cf, "tunnel", "--url", origin];
  const child = Bun.spawn(cmd, { stdout: "inherit", stderr: "pipe" });
  if (p.hostname) ready(liteUrl(`https://${p.hostname}`));
  let shown = !!p.hostname, log = "";
  const decoder = new TextDecoder();
  const reader = child.stderr.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    const text = decoder.decode(r.value);
    process.stderr.write(text);
    if (shown) continue;
    log += text;
    const url = quickTunnelUrl(log);
    if (url) {
      shown = true;
      ready(liteUrl(url));
      console.log("   ⚠️  Anyone with this link reaches the office's login. Ctrl-C closes it; it changes every run.");
    }
  }
  return await child.exited;
}

if (import.meta.main) {
  try {
    const p = plan(process.argv.slice(2));
    if (!(p.via === "tailscale" && p.off) && !(await officeUp(p.port)))
      throw new Error(`nothing on 127.0.0.1:${p.port}: start the office first (bun run office)`);
    process.exit(p.via === "tailscale" ? await tailscale(p) : await cloudflare(p));
  } catch (e) {
    console.error(`🥐 ${(e as Error).message}`);
    process.exit(1);
  }
}
