// The browser entry: find this page's room (its address, /r/<room>, or a new one), bring back its world (what the
// server keeps, so every browser sees the same one; this browser's copy when the server has none, or when it holds a
// change that never got there), ask whether that world is made (lock.ts), and mount the page with the agents' doors up.
import { BrowserHost } from "@effect/ui/html";
import { Effect, Layer, Option, Schema } from "effect";
import { layer as agent, savedKey, unsavedKey } from "./agent.ts";
import { Page, starter } from "./page.ts";
import { exportGif, startPictures } from "./pictures.ts";
import { addCommands } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { startCity } from "./city.ts";
import { connectLines } from "./ProfilePage.ts";
import { linksFor, prompt } from "./relay.ts";
import { READY } from "./worlds.ts";
import { ProfilePage } from "./ProfilePage.ts";
import { ROOM } from "./tools.ts";
import { getJson } from "@rustybuns/util/http";
import { backFromSignIn, login, mine, worldBuilder } from "./account.ts";
import { galaxyLock, lockLine } from "./lock.ts";
import { Made } from "./saved.ts";
import { startGalaxy } from "./galaxyView.ts";

const newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

// Back from signing in with eqosys (account.ts): the person's own world opens, landing passed.
const back = location.pathname === "/" ? await backFromSignIn() : null;
// Signed in already and back at the root: straight to your world, no landing.
const returning = location.pathname === "/" && back === null && login() ? mine() : null;
const here = back ?? returning ?? location.pathname.match(/^\/r\/([^/]+)\/?$/)?.[1];
const room = here && ROOM.test(here) ? here : newRoom();
if (location.pathname !== `/r/${room}`) history.replaceState(null, "", `/r/${room}${location.search}`);

const kept = (() => { try { return localStorage.getItem(savedKey(room)); } catch { return null; } })();
const unsent = (() => { try { return localStorage.getItem(unsavedKey(room)) !== null; } catch { return false; } })();
const [onServer, made] = await Promise.all([
  fetch(`/api/r/${room}/world`).then((r): unknown => (r.ok ? r.json() : null)).catch(() => null),
  getJson(`/api/r/${room}/made`, Made).then((m) => m?.made ?? false),
]);
const fromServer = Option.getOrNull(Schema.decodeUnknownOption(Page)(onServer));
const local = kept ? Option.getOrNull(Schema.decodeUnknownOption(Schema.fromJsonString(Page))(kept)) : null;
const initial = (unsent ? local ?? fromServer : fromServer ?? local) ?? starter;
const who = login()?.name ?? null;
galaxyLock.why = lockLine(who !== null, made);
// A world made before this sign-in (or before the achievement was there) still counts: yours only, not a shared link's.
if (who && made && room === mine()) void worldBuilder();

// Before the page mounts, so the first world's load is seen.
startPictures(room);

const Main = BrowserHost.mount(ProfilePage, { room, origin: location.origin, initial, full: new URLSearchParams(location.search).has("full"), landing: kept === null && fromServer === null && back === null && returning === null, who, made }, document.getElementById("app")!)
  .pipe(Layer.provide(agent(room, initial)));

Layer.launch(Main).pipe(Effect.runFork);
const galaxy = startGalaxy(room);

// Back from signing in, the next step has the focus: Pick your land when it is up (a new world), else Copy prompt,
// so one press copies.
if (back !== null) {
  const focus = () => { const b = document.querySelector<HTMLButtonElement>(".pick [data-land]") ?? document.querySelector<HTMLButtonElement>(".dock button.big"); b?.focus({ preventScroll: true }); return b !== null; };
  if (!focus()) { const o = new MutationObserver(() => { if (focus()) o.disconnect(); }); o.observe(document.getElementById("app")!, { childList: true, subtree: true }); }
  // Your land picked: the picker goes, and Copy prompt is next.
  let picking = document.querySelector(".pick") !== null;
  const picked = new MutationObserver(() => {
    const now = document.querySelector(".pick") !== null;
    if (picking && !now && (document.activeElement === document.body || !document.activeElement)) document.querySelector<HTMLButtonElement>(".dock button.big")?.focus({ preventScroll: true });
    picking = now;
    if (document.querySelector("[data-galaxy-tile].next")) picked.disconnect();
  });
  picked.observe(document.getElementById("app")!, { childList: true, subtree: true });
  // Still there when your world is made: the focus goes on to the Galaxy tile, the next step.
  const on = new MutationObserver(() => {
    const tile = document.querySelector<HTMLButtonElement>("[data-galaxy-tile].next");
    if (!tile) return;
    on.disconnect();
    // Only from Copy, or from nothing (the body): never away from something else you were using.
    const at = document.activeElement;
    if (!at || at === document.body || at.matches(".dock button.big")) tile.focus({ preventScroll: true });
  });
  on.observe(document.getElementById("app")!, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
}

// Cmd+K: the page's own tools (agent.ts puts them up) and, for a person only, the two lines that connect an AI.
const copy = (text: string) => navigator.clipboard.writeText(text).then(() => "Copied", () => "The clipboard said no: copy it from the console.");
const claudeLine = connectLines(location.origin, room)[0]!.text;
addCommands([
  // The same buttons a person sees, on the landing and in the dock.
  // The levels are on the landing and in the console until your agent connects; after that this says so.
  ...READY.map((w) => ({ name: `page_try_${w.name.toLowerCase().replaceAll(" ", "_")}`, title: `Try the ${w.name.toLowerCase()}`, group: "Try one", agent: false, answers: true,
    description: "Loads this ready-made world. Undo takes it back.", execute: () => {
      const b = document.querySelector<HTMLButtonElement>(`[data-try="${w.name}"]`);
      if (!b) return "The levels are shown before your agent connects, on a world not made yet.";
      b.click();
      return `Loaded the ${w.name.toLowerCase()}`;
    } })),
  { name: "page_copy_claude_line", title: "Copy the Claude Code line", group: "Connect", agent: false, answers: true,
    description: "Puts this room's claude mcp add line on the clipboard.", execute: () => copy(claudeLine) },
  { name: "page_copy_prompt", title: "Copy the prompt for any AI", group: "Connect", agent: false, answers: true,
    description: "Puts the paste-into-any-agent prompt for this room on the clipboard.", execute: () => copy(prompt(linksFor(location.origin, room))) },
  { name: "page_export_gif", title: "Export GIF", group: "Share", agent: false, answers: true,
    description: "Records three seconds of the world and downloads an animated GIF.", execute: () => exportGif(room) },
  // The dock's Agent Galaxy button and window.agentGalaxy.enter() send the same message.
  { name: "page_galaxy", title: "Agent Galaxy", group: "Galaxy", agent: false,
    description: "Walk the galaxy as your robot: your land next to everyone's, once your world is made.", answers: true,
    execute: () => galaxyLock.why ?? void galaxy.enter() },
  { name: "page_sign", title: "Sign for your land", group: "Galaxy", agent: false, answers: true,
    description: "Your signature, standing as a sign on your land for neighbours to see. Opens the pad, again too.",
    execute: () => galaxyLock.why ?? void galaxy.sign() },
  { name: "page_robot", title: "My robot", group: "Galaxy", agent: false, answers: false,
    description: "Build your robot, the body you walk the galaxy in: its paint, head, eyes, top and feet.",
    execute: () => galaxyLock.why ?? void galaxy.robot() },
  { name: "page_galaxy_back", title: "Back to my world", group: "Galaxy", agent: false,
    description: "Leave the galaxy and go back to your world and its console.", execute: () => { void galaxy.leave(); } },
]);
mountPalette({ button: true, placeholder: "What should the page do?" });

const city = document.getElementById("city");
if (city instanceof HTMLCanvasElement) startCity(city, () => document.querySelector(".landing") !== null);
