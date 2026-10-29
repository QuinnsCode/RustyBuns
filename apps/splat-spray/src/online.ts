// The page's side of an online match: a socket to a room, and the overlays that sit over the dark
// room (menu, lobby, countdown, round board, final leaderboard). Names come from other players,
// so every overlay is built with textContent and never innerHTML.

import { connectSocket, type Link } from "@rustybuns/util/socket";
import { worldUrl } from "@rustybuns/shell-bun/client";
import { MATCH, parseServerMsg, type Msg, type PlayerView, type View } from "./match/game.ts";

export type Status = { state: "connecting" | "online" | "closed"; error?: string };

export interface Session {
  readonly room: string;
  send(m: Msg): void;
  close(): void;
  /** Server clock minus this clock, in ms. */
  offset: number;
}

// No 0/O or 1/I, so a code read out loud comes out right.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newCode = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");
/** Quick play tries these rooms in turn and takes the first with a seat. */
export const QUICK_ROOMS = ["QUICK1", "QUICK2", "QUICK3", "QUICK4", "QUICK5", "QUICK6"];

/** One id per tab, kept across reloads, so a reload rejoins as the same player but two tabs are two players. */
export function tabPlayerId(): string {
  try {
    const have = sessionStorage.getItem("splat-spray.uid");
    if (have) return have;
    const id = crypto.randomUUID().replace(/-/g, "");
    sessionStorage.setItem("splat-spray.uid", id);
    return id;
  } catch { return crypto.randomUUID().replace(/-/g, ""); }
}

export function joinRoom(room: string, name: string, on: { view(v: View): void; status(s: Status): void }): Session {
  const s: Session = { room, offset: 0, send: (m) => { link.send(m); }, close: () => link.close(1000) };
  on.status({ state: "connecting" });
  const link: Link<Msg> = connectSocket(worldUrl("/ws", { room, uid: tabPlayerId(), name }), {
    decode: parseServerMsg,
    queue: 10,
    onOpen: () => on.status({ state: "online" }),
    onMessage: (m) => { s.offset = m.view.now - Date.now(); on.view(m.view); },
    onClose: (e) => {
      // A refused upgrade gives the page no status code, so name the usual causes.
      const error = e.code === 4001 ? "You joined from somewhere else."
        : e.seen ? "Lost the connection to the room."
        : `Couldn't get into room ${room}. It may be full (${MATCH.maxPlayers} players), or the server is busy; try again in a minute.`;
      on.status({ state: "closed", error });
    },
  });
  return s;
}

// ---------- overlays ----------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** The standings: a row per player with what `cols` say. `you` is marked. */
function table(players: PlayerView[], you: string, cols: { head: string; cell(p: PlayerView, i: number): string }[]): HTMLElement {
  const t = el("table", "board");
  const head = el("tr");
  head.append(el("th", "", "#"), el("th", "", "Spy"), ...cols.map((c) => el("th", "num", c.head)));
  t.append(head);
  players.forEach((p, i) => {
    const row = el("tr", p.id === you ? "me" : p.online ? "" : "gone");
    row.append(el("td", "", String(i + 1)), el("td", "", p.name), ...cols.map((c) => el("td", "num", c.cell(p, i))));
    t.append(row);
  });
  return t;
}

const found = (p: PlayerView) => p.ms >= 0;
const roundCols = [
  { head: "Time", cell: (p: PlayerView) => (found(p) ? secs(p.ms) : "not found") },
  { head: "Shots", cell: (p: PlayerView) => (found(p) ? String(p.shots) : "") },
  { head: "Round", cell: (p: PlayerView) => (p.got ? `+${p.got}` : "") },
  { head: "Total", cell: (p: PlayerView) => String(p.total) },
];
const finalCols = [{ head: "Points", cell: (p: PlayerView) => String(p.total) }];

export interface Panel {
  /** Show what this view needs over the room (the menu is shown by `menu`). */
  show(v: View, room: string, act: { start(): void; lobby(): void; leave(): void }): void;
  hide(): void;
}

export const panel: Panel = {
  hide() { $("lobby").hidden = true; },
  show(v, room, act) {
    const box = $("lobby");
    box.hidden = v.phase === "countdown" || v.phase === "play";
    if (box.hidden) return;
    const body: HTMLElement[] = [];
    const roomLine = el("p", "code");
    roomLine.append("Room ", el("b", "", room), el("span", "dim", " · tell friends this code"));
    if (v.phase === "lobby") {
      body.push(el("h2", "", "Lobby"), roomLine,
        table(v.players, v.you, []),
        el("p", "dim", `${MATCH.rounds} rounds, same room for everyone. First to spy it scores most; a wrong pick costs ${MATCH.wrongMs / 1000}s.`));
      const go = el("button", "primary", v.players.length > 1 ? "Start the match" : "Start alone");
      go.onclick = act.start;
      body.push(go);
    } else if (v.phase === "results") {
      body.push(el("h2", "", `Round ${v.round + 1} of ${v.rounds}`), table(v.players, v.you, roundCols),
        el("p", "dim", v.round + 1 < v.rounds ? "Next round starting…" : "Final board next…"));
    } else {
      body.push(el("h2", "", "Final leaderboard"), roomLine, table(v.players, v.you, finalCols));
      const again = el("button", "primary", "Back to the lobby");
      again.onclick = act.lobby;
      body.push(again);
    }
    const leave = el("button", "", "Leave");
    leave.onclick = act.leave;
    body.push(leave);
    box.replaceChildren(...body);
  },
};

/** The race strip over the HUD while a round is on: who has already found it. */
export function racers(v: View) {
  const strip = $("racers");
  strip.hidden = v.phase !== "play";
  if (strip.hidden) return;
  strip.replaceChildren(...v.players.map((p) => el("span", p.id === v.you ? "chip me" : "chip" + (found(p) ? " done" : ""), found(p) ? `${p.name} ${secs(p.ms)}` : p.name)));
}

/** The menu before any match: a name, quick play, a room code. Calls back with the choice. */
export function menu(on: { join(room: string, name: string): void; solo(): void }, lastName: string) {
  const box = $("menu");
  const name = $<HTMLInputElement>("menu-name"), code = $<HTMLInputElement>("menu-code");
  name.value = lastName;
  const who = () => name.value.trim().slice(0, 24) || "Spy";
  const hash = new URLSearchParams(location.hash.slice(1)).get("room");
  if (hash) code.value = hash.toUpperCase();
  $("menu-quick").onclick = () => on.join("QUICK", who());
  $("menu-make").onclick = () => on.join(newCode(), who());
  $("menu-join").onclick = () => { if (/^[A-Za-z0-9]{4,8}$/.test(code.value.trim())) on.join(code.value.trim().toUpperCase(), who()); else code.focus(); };
  $("menu-solo").onclick = on.solo;
  box.hidden = false;
}
