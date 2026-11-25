// Qollab Studio's front door, as data: a room you make (its name, the studio it's in), the invite link a friend opens,
// and the last few rooms you made or joined. The page (main.ts) draws it; the room itself is an FM DAW sesh, whose
// first visitor with a key is its maker (packages/desktop/world.ts), so making a room and walking in makes you its leader.
import { arr, bool, check, int, obj, str, type Of } from "@rustybuns/util/guard";
import { seshName } from "../sesh.ts";
import { ROOMS, ROOM_LIST, LIVE_ROOM } from "./rooms/index.ts";
import { yours } from "./builder.ts";
import type { StudioDef } from "./room.ts";
import type { HubFriend, HubNote } from "@rustybuns/util/eqosys";

/** A studio as the pickers show it: its id, name, a line on what it is, and the room itself (for its shot). */
export interface Studio { id: string; name: string; about: string; def: StudioDef }
/** The studio the pickers show first (the owner's pick): the desert gathering. */
export const FIRST_STUDIO = "desert-gathering";
/**
 * The studios a room can be in, as the pickers list them: the builder's rooms with the desert gathering first, and the
 * one you built in /rooms.html (?studio=yours) when there is one.
 */
export function studios(): Studio[] {
  const mine = yours(), rooms = [...ROOM_LIST].sort((a, b) => Number(b.id === FIRST_STUDIO) - Number(a.id === FIRST_STUDIO));
  return [...rooms.map((r) => ({ id: r.id, name: r.name, about: r.about ?? "", def: r })),
    ...(mine ? [{ id: "yours", name: "The one you built", about: "Your own room, from the studio builder.", def: mine }] : [])];
}

/**
 * Where this page goes when the sesh's studio isn't the one its link names: the same room's link in the sesh's studio,
 * so everyone in it walks into the room the leader picked and the invite link names it. Null: stay (it matches, or the
 * sesh names none yet, or a studio this page doesn't know).
 */
export function follow(origin: string, here: { room: string; studio: string; name: string }, sesh: string | undefined): string | null {
  if (!sesh || sesh === here.studio || !(ROOMS[sesh] || sesh === "yours")) return null;
  return inviteLink(origin, here.room, sesh, here.name);
}

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

/** What an invite says in a friend's eqosys notes (it carries the room's link beside it): 280 characters at most. */
export function inviteNote(room: string, studio: string): string {
  return `Come jam with me in ${room ? `"${room}"` : "my room"}${studio ? `, in ${studio}` : ""}.`.slice(0, 280);
}

/** An invite a friend sent you through eqosys: who, when, and the room's link on this site. */
export interface Invite { from: string; at: number; room: string; name: string; link: string }
/**
 * The invites in your eqosys notes: the notes this app sent with a room's link, newest first, one per room. The link is
 * rebuilt on `origin` from the room it names, so a note never sends you anywhere but a room here.
 */
export function invitesIn(notes: readonly HubNote[], app: string, origin: string): Invite[] {
  const out: Invite[] = [], seen = new Set<string>();
  for (const n of [...notes].sort((a, b) => b.at - a.at)) {
    if (n.app !== app || !n.link) continue;
    let u: URL;
    try { u = new URL(n.link); } catch { continue; }
    const r = u.pathname === "/jam.html" ? fromLink(u.search) : null;
    if (!r || seen.has(r.room)) continue;
    seen.add(r.room);
    out.push({ from: n.from.name || "A friend", at: n.at, room: r.room, name: r.name, link: inviteLink(origin, r.room, r.studio, r.name) });
  }
  return out;
}

/** Your eqosys friends to invite: the ones with this app open now first (`here`), then the rest, each by name. */
export function friendOrder(friends: readonly HubFriend[], app: string): (HubFriend & { here: boolean })[] {
  return friends.map((f) => ({ ...f, here: f.presence.some((p) => p.app === app) }))
    .sort((a, b) => Number(b.here) - Number(a.here) || (a.name || a.id).localeCompare(b.name || b.id));
}

const SETUP = "qollab-studio:setup";
/**
 * The studio this browser makes its rooms in: picked once on the front door (the first room you make), then used
 * without asking; Settings changes it. Null before that, with no storage, or when it names a studio that's gone.
 */
export function loadSetup(): string | null {
  try { const id = localStorage.getItem(SETUP); return id && studios().some((s) => s.id === id) ? id : null; } catch { return null; }
}
export function saveSetup(id: string) {
  try { localStorage.setItem(SETUP, id); } catch { /* private window: asked again next visit */ }
}
