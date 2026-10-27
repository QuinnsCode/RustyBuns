#!/usr/bin/env bun
// The latest.json the shell's "Check for updates" reads (Tauri's static updater format). agent-office-shell.yml runs it
// after the signed .app.tar.gz files are built and uploads the result last, so a client never sees a manifest whose
// files aren't there yet.
//
//   bun scripts/update-manifest.ts --version 1.2.0 --repo QuinnsCode/RustyBuns --tag agent-office-latest --dir out > latest.json
import { readFileSync } from "node:fs";
import path from "node:path";

/** Tauri's platform keys; the build copies each bundle to `agent-office-<platform>.app.tar.gz` (+ `.sig`). */
export const PLATFORMS = ["darwin-aarch64", "darwin-x86_64"];

export function manifest(o: { version: string; repo: string; tag: string; dir: string; notes?: string; date?: Date }) {
  if (!/^\d+\.\d+\.\d+$/.test(o.version)) throw new Error(`not a stable version: ${o.version}`);
  const platforms: Record<string, { signature: string; url: string }> = {};
  for (const p of PLATFORMS) {
    const file = `agent-office-${p}.app.tar.gz`;
    let signature = "";
    try { signature = readFileSync(path.join(o.dir, `${file}.sig`), "utf8").trim(); } catch {}
    if (!signature) throw new Error(`no signature for ${p}: ${file}.sig is missing or empty in ${o.dir}`);
    platforms[p] = { signature, url: `https://github.com/${o.repo}/releases/download/${o.tag}/${file}` };
  }
  return { version: o.version, notes: o.notes ?? `Agent Office ${o.version}`, pub_date: (o.date ?? new Date()).toISOString(), platforms };
}

if (import.meta.main) {
  const arg = (name: string) => {
    const at = process.argv.indexOf(`--${name}`);
    const v = at >= 0 ? process.argv[at + 1] : undefined;
    if (!v) throw new Error(`--${name} is required`);
    return v;
  };
  console.log(JSON.stringify(manifest({ version: arg("version"), repo: arg("repo"), tag: arg("tag"), dir: arg("dir") }), null, 2));
}
