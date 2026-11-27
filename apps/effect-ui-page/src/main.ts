// The browser entry: find this page's room (its address, /r/<room>, or a new one), bring back what this browser
// kept of it, and mount the page with the agents' doors up for as long as it is mounted.
import { BrowserHost } from "@effect/ui/html";
import { Effect, Layer, Option, Schema } from "effect";
import { layer as agent, savedKey } from "./agent.ts";
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
import { backFromSignIn, login } from "./account.ts";

const newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

// Back from signing in with eqosys (account.ts): the person's own world opens, landing passed.
const back = location.pathname === "/" ? await backFromSignIn() : null;
const here = back ?? location.pathname.match(/^\/r\/([^/]+)\/?$/)?.[1];
const room = here && ROOM.test(here) ? here : newRoom();
if (location.pathname !== `/r/${room}`) history.replaceState(null, "", `/r/${room}${location.search}`);

const kept = (() => { try { return localStorage.getItem(savedKey(room)); } catch { return null; } })();
const initial = kept ? Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Page))(kept), () => starter) : starter;

// Before the page mounts, so the first world's load is seen.
startPictures(room);

const Main = BrowserHost.mount(ProfilePage, { room, origin: location.origin, initial, full: new URLSearchParams(location.search).has("full"), landing: kept === null && back === null, who: login()?.name ?? null }, document.getElementById("app")!)
  .pipe(Layer.provide(agent(room, initial)));

Layer.launch(Main).pipe(Effect.runFork);

// Cmd+K: the page's own tools (agent.ts puts them up) and, for a person only, the two lines that connect an AI.
const copy = (text: string) => navigator.clipboard.writeText(text).then(() => "Copied", () => "The clipboard said no: copy it from the dock.");
const claudeLine = connectLines(location.origin, room)[0]!.text;
addCommands([
  // The same buttons a person sees, on the landing and in the dock.
  ...READY.map((w) => ({ name: `page_try_${w.name.toLowerCase().replaceAll(" ", "_")}`, title: `Try the ${w.name.toLowerCase()}`, group: "Try one", agent: false,
    description: "Loads this ready-made world. Undo takes it back.", execute: () => document.querySelector<HTMLButtonElement>(`[data-try="${w.name}"]`)?.click() })),
  { name: "page_copy_claude_line", title: "Copy the Claude Code line", group: "Connect", agent: false, answers: true,
    description: "Puts this room's claude mcp add line on the clipboard.", execute: () => copy(claudeLine) },
  { name: "page_copy_prompt", title: "Copy the prompt for any AI", group: "Connect", agent: false, answers: true,
    description: "Puts the paste-into-any-agent prompt for this room on the clipboard.", execute: () => copy(prompt(linksFor(location.origin, room))) },
  { name: "page_export_gif", title: "Export GIF", group: "Share", agent: false, answers: true,
    description: "Records three seconds of the world and downloads an animated GIF.", execute: () => exportGif(room) },
]);
mountPalette({ button: true, placeholder: "What should the page do?" });

const city = document.getElementById("city");
if (city instanceof HTMLCanvasElement) startCity(city, () => document.querySelector(".landing") !== null);
