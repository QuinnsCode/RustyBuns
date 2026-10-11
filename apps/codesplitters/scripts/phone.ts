#!/usr/bin/env bun
// 📱 The desktop on your phone (#455): puts the running codeSplitters desktop on HTTPS your phone can
// reach, makes a pairing link (one use, five minutes) and prints it with a QR code to scan. The desktop
// keeps listening on 127.0.0.1, and only a phone that opens the link gets in.
//
//   bun run phone                                   Tailscale Serve: https://<this-mac>.<tailnet>.ts.net, your tailnet only
//   bun run phone -- --off                          stop serving it on the tailnet
//   bun run phone -- --cloudflare --tunnel cs --hostname cs.example.com
//                                                   a named Cloudflare Tunnel
//   bun run phone -- --cloudflare --public          a quick *.trycloudflare.com tunnel, open while this runs
//
// The desktop's port changes each launch (unless RB_LISTEN is set), and only it can mint a pairing code:
// this reads both from ~/.codesplitters/desktop.json, the 0600 file the running desktop keeps for local tools.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { qrText } from "../src/qr.ts";

export type Plan = { via: "tailscale"; off: boolean } | { via: "cloudflare"; tunnel?: string; hostname?: string };

export function plan(args: string[]): Plan {
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    if (at < 0) return undefined;
    const v = args[at + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  if (!args.includes("--cloudflare")) return { via: "tailscale", off: args.includes("--off") };
  const tunnel = value("--tunnel"), hostname = value("--hostname");
  if (!tunnel !== !hostname) throw new Error("--tunnel and --hostname go together");
  if (!tunnel && !args.includes("--public"))
    throw new Error("a quick tunnel is a public address: say --public, or use --tunnel/--hostname");
  return { via: "cloudflare", tunnel, hostname };
}

export interface Desktop { url: string; token: string; pid: number }

/** The running desktop, from the file it keeps while it runs. */
export function desktop(file = join(homedir(), ".codesplitters/desktop.json")): Desktop {
  let d: Desktop;
  try { d = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("the desktop isn't running: start it first (bun run desktop)"); }
  try { process.kill(d.pid, 0); } catch { throw new Error("the desktop isn't running (it left its file behind): start it again"); }
  return d;
}

/** A one-time code from the desktop, asked for as its own page does: the launch cookie, and its own Origin. */
export async function pairCode(d: Desktop): Promise<string> {
  const port = new URL(d.url).port;
  const r = await fetch(`${d.url}/__rb/pair`, { method: "POST", headers: { cookie: `rb_token_${port}=${d.token}`, origin: d.url } });
  if (!r.ok) throw new Error(`the desktop wouldn't make a pairing code (${r.status})`);
  return ((await r.json()) as { code: string }).code;
}

export const pairLink = (origin: string, code: string) => `${origin.replace(/\/+$/, "")}/?rb_launch=${code}`;

/** This machine's MagicDNS name, from `tailscale status --json`. */
export function tailnetHost(status: { Self?: { DNSName?: string } }) {
  return status.Self?.DNSName?.replace(/\.$/, "") || undefined;
}

/** The quick tunnel's address, from cloudflared's log. */
export const quickTunnelUrl = (log: string) => /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log)?.[0];

const which = (...names: string[]) => names.find((n) => (n.startsWith("/") ? existsSync(n) : Bun.which(n)));

async function show(d: Desktop, origin: string) {
  const link = pairLink(origin, await pairCode(d));
  console.log(`\n${qrText(link)}\n`);
  console.log(`📱 Scan that with your phone's camera, or open: ${link}`);
  console.log("   It works once, for five minutes. Run this again for another phone, or after restarting the desktop.\n");
}

async function tailscale(p: Extract<Plan, { via: "tailscale" }>) {
  const ts = which("tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  if (!ts) throw new Error("no tailscale: install it (https://tailscale.com/download), sign in, and on your phone too");
  if (p.off) return Bun.spawnSync([ts, "serve", "--https=443", "off"], { stdio: ["inherit", "inherit", "inherit"] }).exitCode ?? 1;
  const d = desktop();
  const status = Bun.spawnSync([ts, "status", "--json"]);
  const host = status.exitCode === 0 ? tailnetHost(JSON.parse(status.stdout.toString())) : undefined;
  if (!host) throw new Error("tailscale isn't up on this Mac: open Tailscale and sign in");
  // The first time, this prints a link to turn on HTTPS for the tailnet.
  const r = Bun.spawnSync([ts, "serve", "--bg", "--https=443", `http://127.0.0.1:${new URL(d.url).port}`], { stdio: ["inherit", "inherit", "inherit"] });
  if (r.exitCode !== 0) return r.exitCode ?? 1;
  await show(d, `https://${host}`);
  console.log("   Only devices on your tailnet can open it. `bun run phone -- --off` stops serving it.");
  return 0;
}

async function cloudflare(p: Extract<Plan, { via: "cloudflare" }>) {
  const cf = which("cloudflared");
  if (!cf) throw new Error("no cloudflared: brew install cloudflared");
  const d = desktop();
  const cmd = p.tunnel ? [cf, "tunnel", "run", "--url", d.url, p.tunnel] : [cf, "tunnel", "--url", d.url];
  const child = Bun.spawn(cmd, { stdout: "inherit", stderr: "pipe" });
  if (p.hostname) await show(d, `https://${p.hostname}`);
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
      await show(d, url);
      console.log("   Ctrl-C closes the tunnel; its address changes every run.");
    }
  }
  return await child.exited;
}

if (import.meta.main) {
  try {
    const p = plan(process.argv.slice(2));
    process.exit(p.via === "tailscale" ? await tailscale(p) : await cloudflare(p));
  } catch (e) {
    console.error(`📱 ${(e as Error).message}`);
    process.exit(1);
  }
}
