// The front door: what the title screen offers and which address each choice opens. Pure data, no DOM,
// so a test can walk the whole tree. A choice never names a level: the park picker comes next and carries
// these parameters across (see `carry`).
import { newRoomCode, roomCode } from "../net/client.ts";

export type Party = "single" | "multi";
export type Play = {
  id: string;
  label: string;
  blurb: string;
  icon: "route" | "paw" | "flag" | "letters";
  /** Parameters that open it. A `room` of "new" is replaced with a fresh code. */
  query: Record<string, string>;
  /** Not built yet: shown, greyed, and it opens nothing. */
  soon?: boolean;
};

export const PLAYS: Record<Party, Play[]> = {
  single: [
    { id: "free", label: "Free skate", blurb: "Any park, no clock. Land what you like.", icon: "route", query: { mode: "free" } },
    { id: "chase", label: "Run from the bear", blurb: "Something big wants you off the board. Keep moving.", icon: "paw", query: { mode: "chase", chase: "bear" } },
  ],
  multi: [
    { id: "free", label: "Free skate", blurb: "Up to four riders in one park.", icon: "route", query: { mode: "free", room: "new" } },
    { id: "race", label: "Race", blurb: "First through the finish, with a trick to land inside a ring on the way.", icon: "flag", query: { mode: "race", room: "new" }, soon: true },
    { id: "skate", label: "S.K.A.T.E.", blurb: "Set a trick, the next rider has to land it. Miss and take a letter.", icon: "letters", query: { mode: "skate", room: "new" }, soon: true },
  ],
};

/** The address a play opens; `room` is the code to join, if the rider typed one. */
export function launch(play: Play, join?: string): string {
  const q = new URLSearchParams(play.query);
  if (q.get("room") === "new") q.set("room", (join && roomCode(`?room=${join}`)) || newRoomCode());
  return `?${q}`;
}

/** Joining a friend's room needs no mode choice: the code is the whole invitation. */
export const joinAddress = (code: string): string | null => {
  const room = roomCode(`?room=${code}`);
  return room ? `?${new URLSearchParams({ mode: "free", room })}` : null;
};

/** The title screen opens on a bare address. Any parameter that picks something skips it, so every old link still works. */
export const showFront = (search: string) => {
  const q = new URLSearchParams(search);
  return !["level", "showroom", "room", "chase", "mode"].some((k) => q.has(k)) || q.has("front");
};

/** The parameters that survive picking a park, so a mode chosen on the title screen reaches the game. */
export const carry = (search: string): URLSearchParams => {
  const from = new URLSearchParams(search), out = new URLSearchParams();
  for (const k of ["mode", "room", "pve", "chase"]) if (from.has(k)) out.set(k, from.get(k)!);
  return out;
};
