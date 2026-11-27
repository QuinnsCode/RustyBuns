// The browser entry: find this page's room (its address, /r/<room>, or a new one), bring back what this browser
// kept of it, and mount the page with the agents' doors up for as long as it is mounted.
import { BrowserHost } from "@effect/ui/html";
import { Effect, Layer, Option, Schema } from "effect";
import { layer as agent, savedKey } from "./agent.ts";
import { Page, starter } from "./page.ts";
import { startCity } from "./city.ts";
import { ProfilePage } from "./ProfilePage.ts";
import { ROOM } from "./tools.ts";

const newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

const here = location.pathname.match(/^\/r\/([^/]+)\/?$/)?.[1];
const room = here && ROOM.test(here) ? here : newRoom();
if (room !== here) history.replaceState(null, "", `/r/${room}${location.search}`);

const kept = (() => { try { return localStorage.getItem(savedKey(room)); } catch { return null; } })();
const initial = kept ? Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Page))(kept), () => starter) : starter;

const Main = BrowserHost.mount(ProfilePage, { room, origin: location.origin, initial, full: new URLSearchParams(location.search).has("full"), landing: kept === null }, document.getElementById("app")!)
  .pipe(Layer.provide(agent(room, initial)));

Layer.launch(Main).pipe(Effect.runFork);

const city = document.getElementById("city");
if (city instanceof HTMLCanvasElement) startCity(city, () => document.querySelector(".landing") !== null);
