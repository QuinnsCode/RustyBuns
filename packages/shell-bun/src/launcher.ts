// The launcher: mints the token, decides local vs remote, opens the browser.
// Chrome/Edge in --app mode when present (chromeless window, own icon);
// default browser otherwise. Children die with us.
//
// The token never goes on stdout or in the browser's argv (where `ps` shows
// it to every local user) while a browser opens: the browser gets a one-time
// launch code instead (shell.launchCode()). The token URL is printed only
// when there is no browser to open (RB_NO_BROWSER, or the spawn failed).
// Local tools find a running app through <data>/desktop.json instead (writeDesktopFile).
//
// Under `rustybuns run desktop --watch` (RB_WATCH) the first host's window outlives the host,
// and a restarted host (RB_WATCH=again) opens none: it has the same port and token, so a reload
// of that window reaches it.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LaunchOptions {
  url: string;
  token?: string;
  /** One-time launch code (shell.launchCode()) handed to the browser instead of the token. */
  code?: string;
  /** "app" = chromeless window via --app; "tab" = default browser. */
  window?: "app" | "tab";
  /** Override the browser binary. */
  browser?: string;
}

const CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  linux: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"],
  win32: [
    `${process.env["ProgramFiles"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["LOCALAPPDATA"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
};

export async function findChromium(): Promise<string | null> {
  for (const c of CANDIDATES[process.platform] ?? []) {
    if (c.includes("/") || c.includes("\\")) { if (await Bun.file(c).exists()) return c; }
    else if (Bun.which(c)) return Bun.which(c);
  }
  return null;
}

const children: Bun.Subprocess[] = [];
function reap() { for (const c of children) { try { c.kill(); } catch {} } }
process.on("exit", reap);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { reap(); process.exit(0); });

/**
 * Writes {url, token} to <dataDir>/desktop.json, readable by this user alone (0600), so a local
 * tool can reach the running app without RB_NO_BROWSER; removed on exit if it is still ours.
 * Same user, same machine: no weaker than the browser's cookie.
 */
export function writeDesktopFile(dataDir: string, url: string, token: string | undefined): string | undefined {
  if (!token) return;
  const file = join(dataDir, "desktop.json"), body = JSON.stringify({ url, token, pid: process.pid }) + "\n";
  try {
    rmSync(file, { force: true }); // so the mode below applies, whatever an older file had
    writeFileSync(file, body, { mode: 0o600, flag: "wx" });
  } catch { return; }
  // A second copy of the app may have taken the file over since: leave its file alone.
  process.on("exit", () => { try { if (readFileSync(file, "utf8") === body) rmSync(file); } catch {} });
  return file;
}

export function mintToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
}

export async function openBrowser(opts: LaunchOptions): Promise<void> {
  const withToken = opts.token ? `${opts.url}/?token=${opts.token}` : opts.url;
  const fallback = () => console.log(`[rustybuns] could not open a browser. Open this yourself:\n  ${withToken}`);
  if (process.env["RB_WATCH"] === "again") { console.log(`[rustybuns] restarted: reload ${opts.url}`); return; }
  if (process.env["RB_NO_BROWSER"]) { console.log(`[rustybuns] open ${withToken}`); return; }
  // Without a code the token still has to ride the URL; a code is the safe path.
  const target = opts.code ? `${opts.url}/?rb_launch=${opts.code}` : withToken;
  console.log(`[rustybuns] open ${opts.url}`);
  const chromium = opts.browser ?? (opts.window !== "tab" ? await findChromium() : null);
  const cmd = chromium ? [chromium, `--app=${target}`, "--new-window"]
    : process.platform === "darwin" ? ["open", target]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", target]
    : ["xdg-open", target];
  let child: Bun.Subprocess;
  try {
    child = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch { fallback(); return; }
  if (!process.env["RB_WATCH"]) children.push(child);
  // open/xdg-open/start hand off and exit; a non-zero exit means nothing opened.
  if (!chromium) void child.exited.then((code) => { if (code !== 0) fallback(); });
}
