// Qollab Studio's front door, as data: a room you make (its name, the studio it's in), the invite link a friend opens,
// and the last few rooms you made or joined. The page (main.ts) draws it; the room itself is an FM DAW sesh, whose
// first visitor with a key is its maker (packages/desktop/world.ts), so making a room and walking in makes you its leader.
import { arr, bool, check, int, obj, str, type Of } from "@rustybuns/util/guard";
import { seshName } from "../sesh.ts";
import { ROOMS, ROOM_LIST, LIVE_ROOM } from "./rooms/index.ts";
import { yours } from "./builder.ts";

/** The studios a room can be in: the builder's rooms, and the one you built in /rooms.html (?studio=yours) when there is one. */
export const studios = () => [...ROOM_LIST.map((r) => ({ id: r.id, name: r.name })), ...(yours() ? [{ id: "yours", name: "The one you built" }] : [])];

const SUFFIX = "abcdefghijkmnpqrstuvwxyz23456789";
/** A sesh id for a room called `name`: its words, then four letters so two "Friday jam"s are two rooms. No name, a sesh name. */
export function roomId(name: string, rand: () => number = Math.random): string {
  const words = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  if (!words) return seshName(rand);
  let tail = "";
  for (let i = 0; i < 4; i++) tail += SUFFIX[Math.floor(rand() * SUFFIX.length)];
  return `${words}-${tail}`;
}

/** A room's link: the jam room, in this sesh, in this studio, under the name its maker gave it. */
export function inviteLink(origin: string, room: string, studio = LIVE_ROOM.id, name = ""): string {
  const u = new URL("/jam.html", origin);
  u.searchParams.set("room", room);
  u.searchParams.set("studio", studio);
  if (name) u.searchParams.set("name", name.slice(0, 60));
  return u.href;
}

/** What an invite link (or the address bar) says: the room and its studio, or null on the front door. */
export function fromLink(search: string): { room: string; studio: string; name: string } | null {
  const q = new URLSearchParams(search);
  const room = q.get("room");
  if (!room || !/^[a-z0-9-]{1,64}$/.test(room)) return null;
  const studio = q.get("studio") ?? "";
  const name = (q.get("name") ?? "").replace(/\p{C}/gu, "").trim().slice(0, 60);
  return { room, studio: ROOMS[studio] || studio === "yours" ? studio : LIVE_ROOM.id, name };
}

/** A room in the lobby's list. */
export const Recent = obj({ room: str(64), name: str(60, { min: 0, dflt: "" }), studio: str(64), mine: bool(false), at: int(0, 1e15) });
export type Recent = Of<typeof Recent>;
const RecentList = arr(Recent, 50, { drop: true });
/** How many rooms the lobby lists. */
export const RECENT_MAX = 6;
const KEY = "qollab-studio:rooms";

/** The rooms you made or joined, newest first; a room you go back into moves to the top and keeps being yours if it was. */
export function remember(list: Recent[], r: Recent): Recent[] {
  const had = list.find((x) => x.room === r.room);
  const row = { ...r, name: r.name || had?.name || "", mine: r.mine || !!had?.mine };
  return [row, ...list.filter((x) => x.room !== r.room)].slice(0, RECENT_MAX);
}

export function loadRecent(): Recent[] {
  try { return check(RecentList, JSON.parse(localStorage.getItem(KEY) ?? "[]")) ?? []; } catch { return []; }
}
export function saveRecent(list: Recent[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private window: this visit only */ }
}
