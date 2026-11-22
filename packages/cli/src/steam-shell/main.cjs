// The Steam build's window (rustybuns build steam copies this into each depot as resources/app/main.cjs).
// Electron's own Chromium draws the game, so no user browser is involved. It starts the app's
// desktop host binary (host/ beside this file), reads the URL the host prints, and opens one
// window on it. steamworks.js lives here in the main process; the page reaches it only through
// the small bridge preload.cjs exposes (window.rbSteam), and only from the host's own origin.
"use strict";
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const cfg = require("./steam.json"); // { appId, title, host }

let sw = null;
try {
  sw = require("steamworks.js");
  // Before app ready: on Windows the overlay needs --in-process-gpu and --disable-direct-composition,
  // and a repaint each frame so it has something to draw over.
  sw.electronEnableSteamOverlay();
} catch (e) {
  console.error(`[steam] steamworks.js did not load: ${e.message}`);
}

let steam = null, origin = null, host = null;

/** Wait for the host's "[rustybuns] open <url>" line (RB_NO_BROWSER prints it with the token). */
function hostUrl(child, ms = 30_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("the game's host did not start in time")), ms);
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      buf += chunk.toString();
      const m = buf.match(/\[rustybuns\] open (https?:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`the game's host stopped (exit ${code})`)); });
  });
}

function onDeck() {
  try { if (steam && steam.utils.isSteamRunningOnSteamDeck()) return true; } catch {}
  return process.env.SteamDeck === "1";
}

// The bridge: one channel, a few verbs. A frame from any other origin gets nothing.
ipcMain.handle("rb-steam", async (e, op, ...args) => {
  if (!origin || !e.senderFrame || new URL(e.senderFrame.url).origin !== origin) return null;
  if (op === "info") return { available: !!steam, deck: onDeck() };
  if (!steam) return null;
  try {
    switch (op) {
      case "achievement": return steam.achievement.activate(String(args[0]));
      case "presence": steam.localplayer.setRichPresence(String(args[0]), args[1] == null ? null : String(args[1])); return true;
      // Remote Play Together invites go through the overlay's friends list.
      case "invite": steam.overlay.activateDialog(0 /* Friends */); return true;
      case "keyboard": {
        const [x, y, w, h, multi] = args.map(Number);
        return await steam.utils.showFloatingGamepadTextInput(multi ? 1 : 0, x | 0, y | 0, w | 0, h | 0);
      }
    }
  } catch (err) { console.error(`[steam] ${op}: ${err.message}`); }
  return null;
});

app.whenReady().then(async () => {
  if (sw) {
    try { steam = sw.init(cfg.appId); }
    catch (e) { console.error(`[steam] not running under Steam: ${e.message}`); }
  }
  host = spawn(path.join(__dirname, "host", cfg.host), [], {
    env: { ...process.env, RB_NO_BROWSER: "1" },
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  let url;
  try { url = await hostUrl(host); }
  catch (e) { dialog.showErrorBox(cfg.title, e.message); app.quit(); return; }
  origin = new URL(url).origin;
  host.on("exit", () => app.quit());

  const deck = onDeck();
  const win = new BrowserWindow({
    title: cfg.title,
    width: 1280, height: 800,          // the Steam Deck's screen; desktops can resize
    minWidth: 960, minHeight: 600,
    fullscreen: deck,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();
  // The window only ever shows the host. Links elsewhere open in the player's own browser.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/.test(u)) void shell.openExternal(u);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, u) => {
    if (new URL(u).origin !== origin) { e.preventDefault(); if (/^https?:/.test(u)) void shell.openExternal(u); }
  });
  await win.loadURL(url);
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => { try { host && host.kill(); } catch {} });
