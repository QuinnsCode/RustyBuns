// rustybuns build steam: the desktop host binary inside an Electron window, as SteamPipe depots.
//
//   dist/steam/
//     app_build.vdf            steamcmd +run_app_build reads this
//     depots/windows/          <name>.exe, Electron's files, resources/app/
//     depots/darwin/           <Title>.app/Contents/Resources/app/
//     depots/linux/            <name>, Electron's files, resources/app/
//
// resources/app holds main.cjs and preload.cjs (steam-shell/), steam.json, steamworks.js with
// only that OS's addon, and host/<the desktop binary>. Electron and steamworks.js are fetched
// once into .rustybuns/steam-cache and checked against the hashes pinned below, so a changed
// download stops the build.
//
// Why Electron and not Electrobun's bundled CEF: steamworks.js is built and tested for Electron
// (its overlay switch is an Electron helper), Electron ships the same Chromium on Windows, macOS
// and Linux (Steam Deck), and its Linux build doesn't lean on WebKitGTK. The frame-time and
// overlay checks on real machines are a manual run.

import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { $ } from "bun";
import type { RustyBunsConfig, SteamOs, SteamTarget } from "./config.ts";
import { buildDesktop } from "./build.ts";

export const STEAM_OS: SteamOs[] = ["windows-x64", "darwin-arm64", "linux-x64"];

export const ELECTRON = {
  version: "45.4.1",
  /** sha256 of each zip, from the release's SHASUMS256.txt. */
  sha256: {
    "windows-x64": "2ba6223afa9121f42831fefe92c434334907540165294fc56697449d12e7cfe9",
    "darwin-arm64": "d080c3b05a01bd16137f2c12ab9ebf083c577757fe846844ba325bafa8e8bdf4",
    "linux-x64": "e1d077c7a087d7e344350ea0c5cd2b7dc5af3d9bf7979474f38e0fc1a560b875",
  } satisfies Record<SteamOs, string>,
};

export const STEAMWORKS = {
  version: "0.4.0",
  /** The npm registry's dist.integrity. */
  integrity: "sha512-O5TTRs7ucCRql4IA/kYUIQYeghTsXqf3rAm81sC22RDId264LQYqQjuaMEUSqL60I5LdULiGu0W2/A+ZDcKBKA==",
};

const ELECTRON_OS: Record<SteamOs, string> = { "windows-x64": "win32-x64", "darwin-arm64": "darwin-arm64", "linux-x64": "linux-x64" };
/** steamworks.js keeps each OS's addon and steam_api library in its own dist/ folder. */
const STEAMWORKS_DIST: Record<SteamOs, string> = { "windows-x64": "win64", "darwin-arm64": "osx", "linux-x64": "linux64" };

export type DepotOs = "windows" | "darwin" | "linux";
export const depotOs = (t: SteamOs): DepotOs => t.split("-")[0] as DepotOs;

export const electronUrl = (t: SteamOs, v = ELECTRON.version) =>
  `https://github.com/electron/electron/releases/download/v${v}/electron-v${v}-${ELECTRON_OS[t]}.zip`;
export const steamworksUrl = (v = STEAMWORKS.version) => `https://registry.npmjs.org/steamworks.js/-/steamworks.js-${v}.tgz`;

/** Depot ID per OS: the config's, else appId + 1 (windows), + 2 (darwin), + 3 (linux). */
export function depotIds(s: SteamTarget): Record<DepotOs, number> {
  return {
    windows: s.depots?.windows ?? s.appId + 1,
    darwin: s.depots?.darwin ?? s.appId + 2,
    linux: s.depots?.linux ?? s.appId + 3,
  };
}

/** Where things go inside one depot folder, relative to it. */
export function depotLayout(t: SteamOs, name: string, title: string) {
  const os = depotOs(t);
  if (os === "darwin") {
    const app = `${title}.app`;
    return { launch: app, appDir: `${app}/Contents/Resources/app`, host: `${name}-${t}` };
  }
  return { launch: os === "windows" ? `${name}.exe` : name, appDir: "resources/app", host: `${name}-${t}${os === "windows" ? ".exe" : ""}` };
}

const vq = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * app_build.vdf for steamcmd. `live` names the branch the build is set live on (a beta tag
 * gives "beta"); unset, the build only uploads and the owner sets it live in Steamworks.
 * Steam never lets an upload set the default branch live, so "default" is refused here too.
 */
export function appBuildVdf(o: { appId: number; depots: Partial<Record<DepotOs, number>>; desc: string; live?: string }): string {
  if (o.live === "default") throw new Error(`a build can't set the default branch live: leave --live off and set it live in Steamworks`);
  if (o.live && !/^[a-z0-9_-]+$/i.test(o.live)) throw new Error(`bad branch name: ${o.live}`);
  const depots = (Object.entries(o.depots) as [DepotOs, number][]).map(([os, id]) => [
    `\t\t${vq(String(id))}`, "\t\t{",
    "\t\t\t\"FileMapping\"", "\t\t\t{",
    `\t\t\t\t"LocalPath" ${vq(`${os}/*`)}`, `\t\t\t\t"DepotPath" "."`, `\t\t\t\t"recursive" "1"`,
    "\t\t\t}", "\t\t}",
  ].join("\n"));
  return [
    "\"AppBuild\"", "{",
    `\t"AppID" ${vq(String(o.appId))}`,
    `\t"Desc" ${vq(o.desc)}`,
    ...(o.live ? [`\t"SetLive" ${vq(o.live)}`] : []),
    `\t"ContentRoot" "depots/"`,
    `\t"BuildOutput" "output/"`,
    "\t\"Depots\"", "\t{",
    ...depots,
    "\t}", "}", "",
  ].join("\n");
}

async function digest(algo: "sha256" | "sha512", bytes: Uint8Array, enc: "hex" | "base64") {
  return new Bun.CryptoHasher(algo).update(bytes).digest(enc);
}

/** Download once into the cache, and check it on every use. */
export async function fetchChecked(url: string, check: { sha256?: string; integrity?: string }, cacheDir: string, fetcher: typeof fetch = fetch): Promise<string> {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, basename(new URL(url).pathname));
  let bytes: Uint8Array;
  if (existsSync(file)) bytes = readFileSync(file);
  else {
    const r = await fetcher(url);
    if (!r.ok) throw new Error(`download failed: ${url} (${r.status})`);
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  const ok = check.sha256 ? (await digest("sha256", bytes, "hex")) === check.sha256
    : check.integrity ? `sha512-${await digest("sha512", bytes, "base64")}` === check.integrity
    : false;
  if (!ok) { rmSync(file, { force: true }); throw new Error(`${basename(file)} doesn't match its pinned hash: not using it`); }
  if (!existsSync(file)) writeFileSync(file, bytes);
  return file;
}

async function unzip(zip: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  // unzip keeps the symlinks inside Electron.app's frameworks. On Windows, System32's tar is
  // bsdtar, which reads zips; Git Bash's GNU tar earlier on PATH doesn't.
  if (process.platform === "win32") await $`${join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")} -xf ${zip} -C ${dest}`.quiet();
  else await $`unzip -q -o ${zip} -d ${dest}`.quiet();
}

export interface SteamBuildOpts {
  targets?: SteamOs[];
  /** Steam branch to set live (beta tags). */
  live?: string;
  version?: string;
  /** Only write app_build.vdf over depot folders already there (the CI upload job). */
  vdfOnly?: boolean;
  /** Build the host binary for a target; returns its path. Default: buildDesktop. */
  buildHost?: (t: SteamOs) => Promise<string>;
  fetcher?: typeof fetch;
  outDir?: string;
  cacheDir?: string;
}

export function steamConfig(c: RustyBunsConfig): SteamTarget {
  const s = c.targets.steam;
  if (!s) throw new Error("no targets.steam in rustybuns.config.ts: add steam: { appId } (480 is Valve's Spacewar test app)");
  if (!c.targets.desktop) throw new Error("targets.steam wraps the desktop build: add targets.desktop first (rustybuns add desktop)");
  return s;
}

/** Lay out the depots and app_build.vdf. Returns the out dir and each depot's launch path. */
export async function buildSteam(c: RustyBunsConfig, o: SteamBuildOpts = {}) {
  const s = steamConfig(c);
  const out = o.outDir ?? "dist/steam", cache = o.cacheDir ?? ".rustybuns/steam-cache";
  const title = s.title ?? c.name;
  const version = o.version ?? (existsSync("package.json") ? JSON.parse(readFileSync("package.json", "utf8")).version : undefined) ?? "0.0.0";
  const targets = o.targets ?? s.targets ?? STEAM_OS;
  const bad = targets.filter((t) => !STEAM_OS.includes(t));
  if (bad.length) throw new Error(`unknown steam target ${bad.join(", ")}: use ${STEAM_OS.join(", ")}`);
  const ids = depotIds(s);
  const launches: Partial<Record<DepotOs, string>> = {};

  if (!o.vdfOnly) {
    const buildHost = o.buildHost ?? (async (t: SteamOs) => (await buildDesktop(c, { target: t })).trim());
    for (const t of targets) {
      const os = depotOs(t), dir = join(out, "depots", os), L = depotLayout(t, c.name, title);
      const host = await buildHost(t);
      rmSync(dir, { recursive: true, force: true });
      await unzip(await fetchChecked(electronUrl(t), { sha256: ELECTRON.sha256[t] }, cache, o.fetcher), dir);
      if (os === "darwin") renameSync(join(dir, "Electron.app"), join(dir, L.launch));
      else renameSync(join(dir, os === "windows" ? "electron.exe" : "electron"), join(dir, L.launch));
      const res = os === "darwin" ? join(dir, L.launch, "Contents/Resources") : join(dir, "resources");
      rmSync(join(res, "default_app.asar"), { force: true });

      const app = join(dir, L.appDir);
      mkdirSync(join(app, "host"), { recursive: true });
      for (const f of ["main.cjs", "preload.cjs"]) copyFileSync(new URL(`./steam-shell/${f}`, import.meta.url), join(app, f));
      writeFileSync(join(app, "package.json"), JSON.stringify({ name: c.name, version, private: true, main: "main.cjs" }, null, 2) + "\n");
      writeFileSync(join(app, "steam.json"), JSON.stringify({ appId: s.appId, title, host: L.host }, null, 2) + "\n");
      copyFileSync(host, join(app, "host", L.host));
      chmodSync(join(app, "host", L.host), 0o755);

      // steamworks.js, with only this OS's addon and steam_api library.
      const sw = join(cache, `steamworks.js-${STEAMWORKS.version}`);
      if (!existsSync(join(sw, "package"))) {
        mkdirSync(sw, { recursive: true });
        await $`tar -xzf ${await fetchChecked(steamworksUrl(), { integrity: STEAMWORKS.integrity }, cache, o.fetcher)} -C ${sw}`.quiet();
      }
      const dest = join(app, "node_modules", "steamworks.js");
      cpSync(join(sw, "package"), dest, { recursive: true });
      for (const d of readdirSync(join(dest, "dist"))) if (d !== STEAMWORKS_DIST[t]) rmSync(join(dest, "dist", d), { recursive: true, force: true });
      launches[os] = L.launch;
    }
  }

  const present = (Object.keys(ids) as DepotOs[]).filter((os) => existsSync(join(out, "depots", os)));
  if (!present.length) throw new Error(`no depot folders in ${join(out, "depots")}: build them first`);
  const vdf = appBuildVdf({ appId: s.appId, depots: Object.fromEntries(present.map((os) => [os, ids[os]])), desc: `${c.name} ${version}`, live: o.live });
  writeFileSync(join(out, "app_build.vdf"), vdf);
  return { out, depots: present, launches, ids };
}
