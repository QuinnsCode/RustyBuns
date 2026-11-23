// What scripts/trailers.ts shoots and how it cuts it: each app's takes (a jump link and a script that plays it) and its reels
// (cuts of 3 s or less from those takes, with looks and captions). Times in a cut are seconds into its take: read them off the
// take's contact sheet (<cache>/<app>/<take>-sheet.jpg, one frame a second) after a `--takes-only` run.

/** One thing a take's script does, `at` seconds after the recording starts (setup steps run in order before it, waiting `after` ms). */
export type Step = ({ js: string } | { key: string; hold?: number; up?: boolean } | { click: [number, number] } | { move: [number, number] }) & { at?: number; after?: number };
/** One recording: where it opens (`url` for a server other than the app's), CSS to hide what a trailer shouldn't show, then `secs` of play. */
export interface Take { name: string; path: string; url?: string; wait?: number; css?: string; setup?: Step[]; steps?: Step[]; secs: number }
/** A piece of a take, 3 s or less: `fx` are push (a slow zoom), punch (a fast one), slow, fast, shake, flash, glitch, mono, dark. */
export type Cut = { take: string; at: number; len?: number; fx?: string[]; say?: string; sub?: string } | { card: string; kicker?: string; line?: string; len?: number; end?: boolean };
export interface Reel { name: string; title: string; cuts: Cut[]; crf?: number }
export interface Stage { serve?: unknown; takes: Take[]; reels: Reel[] }

/** Hides a page's own buttons and panels (the HUD) so only the game's picture is left; `keep` stays. */
const noHud = (keep = "") => `body *:not(canvas):not(:has(canvas))${keep ? `:not(${keep}):not(${keep} *)` : ""}{visibility:hidden !important}`;
const run = (cmd: string, args: unknown) => `return await __commands.run(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`;

/** A take that plays one of a page's director scenes (`?scene=<name>`, @rustybuns/util/director) from its start. */
const scene = (name: string, secs: number, css?: string): Take => ({ name, path: `/?scene=${name}`, secs, wait: 4000, ...(css ? { css } : {}) });

export const STAGES: Record<string, Stage> = {
  "git-recon": {
    takes: [
      scene("newsreel", 30), scene("credits", 30),
      ...["kitchen"].map((level): Take => ({ name: level, path: "/", wait: 5000, secs: 22, setup: [{ js: run("recon_start", { level }), after: 4000 }], steps: [
        { at: 0, key: "KeyW", up: false }, ...Array.from({ length: 40 }, (_, i): Step => ({ at: 0.3 + i * 0.5, js: i % 8 === 4 ? `${run("recon_look", { yaw: (i / 8) * 1.3, pitch: -0.05 })}` : i % 11 === 6 ? run("recon_jump", {}) : run("recon_fire", {}) })),
        { at: 6, key: "KeyA", hold: 1200 }, { at: 12, key: "KeyD", hold: 1500 }, { at: 21, key: "KeyW", up: true },
      ] })),
    ],
    reels: [
      { name: "war-for-main", title: "The war for main", crf: 29, cuts: [
        { card: "Somewhere in a real repo", kicker: "rustybuns@288aec0", line: "eight folders are in conflict.", len: 2 },
        { take: "newsreel", at: 0.2, len: 2.2, fx: ["push"] },
        { take: "kitchen", at: 0.2, len: 2.6, fx: ["punch"] },
        { take: "kitchen", at: 2.2, len: 2.4, fx: ["slow"], say: "Geronimo", sub: "a regrettable commit message" },
        { take: "kitchen", at: 4.6, len: 1.6, fx: ["shake", "flash"] },
        { take: "newsreel", at: 4.1, len: 2, fx: ["punch"] },
        { take: "kitchen", at: 8, len: 2.2, fx: ["push"], say: "Merge every folder" },
        { take: "newsreel", at: 6.2, len: 1.4, fx: ["shake", "glitch"] },
        { take: "kitchen", at: 13, len: 2, fx: ["fast", "punch"], say: "Resolve on sight" },
        { take: "newsreel", at: 7.4, len: 2.4, fx: ["push"] },
        { take: "newsreel", at: 9.2, len: 2.2, fx: ["punch", "flash"] },
        { take: "kitchen", at: 17, len: 1.8, fx: ["fast", "shake"] },
        { take: "newsreel", at: 13.2, len: 2.4, fx: ["flash", "shake"] },
        { take: "credits", at: 8, len: 2.6, fx: ["push"], say: "Outtakes included", sub: "take 4: nobody tied off the ladder" },
        { take: "newsreel", at: 11.2, len: 2.6, fx: ["push"] },
        { card: "Git Recon", kicker: "A shooter in a real repo", line: "Home to HEAD by six.", end: true, len: 2.2 },
      ] },
      { name: "boot-camp", title: "Boot camp", cuts: [
        { take: "kitchen", at: 0.3, len: 2.4, fx: ["push"] },
        { take: "kitchen", at: 2.3, len: 2.2, fx: ["slow", "flash"], say: "Your stop" },
        { take: "kitchen", at: 5, len: 1.8, fx: ["shake"] },
        { take: "kitchen", at: 9, len: 2.4, fx: ["push"], say: "0 of 6 merged", sub: "the clock is running" },
        { take: "kitchen", at: 15, len: 2, fx: ["fast", "punch"] },
        { card: "Git Recon", kicker: "Boot camp: the kitchen floor", end: true },
      ] },
      { name: "newsreel", title: "Newsreel", cuts: [
        { take: "newsreel", at: 0, len: 2.4, fx: ["mono", "push"] },
        { take: "newsreel", at: 4, len: 2.4, fx: ["mono", "punch"] },
        { take: "newsreel", at: 7.3, len: 2.6, fx: ["mono"] },
        { take: "newsreel", at: 9.2, len: 2.2, fx: ["mono", "punch"] },
        { take: "newsreel", at: 13, len: 2.6, fx: ["mono", "shake"] },
        { card: "A message from Command", kicker: "Git Recon", line: "Your branch needs you.", end: true },
      ] },
      { name: "outtakes", title: "Outtakes", cuts: [
        { take: "credits", at: 2.5, len: 2.4, fx: ["push"], say: "Blooper reel" },
        { take: "credits", at: 6, len: 2.6, fx: ["push"] },
        { take: "credits", at: 9.5, len: 2.6, fx: ["punch"], say: "Somebody dropped the prop" },
        { take: "credits", at: 13, len: 2.4, fx: ["push"] },
        { card: "Git Recon", kicker: "Thank you for your service", end: true },
      ] },
      { name: "drop-in", title: "Drop in", cuts: [
        { take: "kitchen", at: 1.2, len: 1.6, fx: ["punch"] },
        { take: "kitchen", at: 2.4, len: 2.8, fx: ["slow", "push"] },
        { take: "kitchen", at: 4.8, len: 1.6, fx: ["flash", "shake"], say: "Boots on the floor" },
        { take: "kitchen", at: 11, len: 2.2, fx: ["push"] },
        { card: "Git Recon", end: true },
      ] },
    ],
  },
  "skate-tech-park": {
    takes: [
      { name: "halfpipe", path: "/?level=yosemite-falls&spawn=creek%20halfpipe&nosweep", css: noHud(), secs: 16, steps: [{ at: 0.5, js: run("skate_line", { moves: [
        { seconds: 1.5, push: 1, jets: true }, { seconds: 1.2, push: 1, jets: true }, { seconds: 1.2, ollie: true, trick: "tre flip" }, { seconds: 1.5, push: 1, jets: true },
        { seconds: 1.2, ollie: true, manual: "tail", steer: 1 }, { seconds: 1.5, push: 1, jets: true }, { seconds: 1.4, ollie: true, trick: "360 hardflip" }, { seconds: 1.5, push: 1, jets: true },
        { seconds: 1.4, ollie: true, trick: "nightmare flip" }, { seconds: 2, push: 1 },
      ] }) }] },
      { name: "capitan", path: "/?level=el-capitan&nosweep", css: noHud(), secs: 14, steps: [{ at: 0.5, js: run("skate_line", { moves: [
        { seconds: 3, push: 1, jets: true }, { seconds: 1.5, ollie: true, trick: "double kickflip" }, { seconds: 2.5, push: 1, jets: true }, { seconds: 1.6, ollie: true, trick: "laser flip", steer: 1 }, { seconds: 3, push: 1 },
      ] }) }] },
      { name: "rail", path: "/?level=el-capitan&spawn=rail&nosweep", css: noHud(), secs: 12, steps: [{ at: 0.5, js: run("skate_line", { moves: [
        { seconds: 1.5, push: 1 }, { seconds: 0.4, ollie: true }, { seconds: 2.5, push: 0.3 }, { seconds: 1.2, ollie: true, trick: "kickflip" }, { seconds: 3, push: 1 },
      ] }) }] },
    ],
    reels: [
      { name: "send-it", title: "Send it", cuts: [
        { take: "halfpipe", at: 2, len: 2.2, fx: ["push"] },
        { take: "halfpipe", at: 4, len: 2.4, fx: ["slow", "flash"], say: "Tre flip" },
        { take: "capitan", at: 3, len: 2.6, fx: ["punch"], say: "El Capitan", sub: "Yosemite" },
        { take: "halfpipe", at: 9, len: 2.6, fx: ["slow", "shake"], say: "360 hardflip" },
        { take: "rail", at: 1, len: 2.6, fx: ["push"] },
        { card: "Skate Tech Park", kicker: "Fingerboard National Parks", end: true },
      ] },
    ],
  },
};
