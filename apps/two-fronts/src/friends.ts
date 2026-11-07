// Playing with the people you know on eqosys. "With friends" mints an eqosys party and opens `?party=CODE` with the war
// the host picked (side, galaxy); a friend opens the same link, says Ready, the host says Start, and each page claims
// its seat in the war named after the party's room (POST /api/parties/<room>, src/edge/campaign.ts). From there it is
// an online campaign like any other, with the seat's token kept in this browser. The seat is the eqosys account's: the
// same account opening the party link on another device gets its own seat there. Spaces is the signed-in player's
// Qollab groups (text and voice), behind a button in the panel's header. Qollab's side: apps/eqosys/src/party.ts, space.ts.
import { ArrowLeft, ArrowUp, Copy, createElement, Flag, Hash, LogIn, LogOut, MessagesSquare, Mic, MicOff, PhoneOff, Plus, Send, Trash2, UserX, Volume2 } from "lucide";
import { lobbyPanel } from "@rustybuns/util/lobby";
import { spacesPanel, type SpaceIcon } from "@rustybuns/util/spaces";
import type { Faction } from "./battle/contract.ts";
import { FACTIONS } from "./war/rules.ts";
import { GALAXIES, type GalaxyId } from "./war/galaxy.ts";
import { fresh, login, party, space } from "./eqosys.ts";

/** A party link's code and the war its host picked; null when the address isn't one. */
export function partyIn(search: string): { code: string; side: Faction; galaxy: GalaxyId } | null {
  const q = new URLSearchParams(search);
  const code = (q.get("party") ?? "").toUpperCase().match(/^[A-Z0-9]{4,12}$/)?.[0];
  if (!code) return null;
  const side = FACTIONS.find((f) => f === q.get("side")) ?? "marines";
  const galaxy = Object.hasOwn(GALAXIES, q.get("galaxy") ?? "") ? (q.get("galaxy") as GalaxyId) : "short";
  return { code, side, galaxy };
}

/** Mint a party for this war and move the page to its lobby. Signed out or refused: false. */
export async function openParty(side: Faction, galaxy: GalaxyId): Promise<boolean> {
  const code = await party().make();
  if (!code) return false;
  location.search = `?${new URLSearchParams({ party: code, side, galaxy })}`;
  return true;
}

/** Join the party and keep `box` showing it; the host's Start hands each page its room and seat. Returns leave. */
export const joinParty = (code: string, box: HTMLElement, onStart: (s: { room: string; seat: number; ticket?: string }) => void) =>
  lobbyPanel({ code, box, party: party(), name: () => login()?.name, link: () => location.href, onStart });

const ICONS: Record<SpaceIcon, Parameters<typeof createElement>[0]> = {
  "arrow-left": ArrowLeft, "arrow-up": ArrowUp, plus: Plus, "log-in": LogIn, send: Send, copy: Copy, hash: Hash,
  "mic-off": MicOff, mic: Mic, "user-x": UserX, flag: Flag, "log-out": LogOut, "volume-2": Volume2, "phone-off": PhoneOff, "trash-2": Trash2,
};

/** The Spaces button: shown when signed in, it opens and closes the panel. */
export function mountSpaces(button: HTMLButtonElement) {
  const l = login();
  button.hidden = !(l && fresh(l));
  button.title = button.ariaLabel = "Spaces";
  button.append(createElement(MessagesSquare, { width: 18, height: 18 }));
  const box = Object.assign(document.createElement("aside"), { id: "spaces", hidden: true, ariaLabel: "Spaces" });
  document.body.append(box);
  let panel: ReturnType<typeof spacesPanel> | null = null;
  button.addEventListener("click", () => {
    if (panel) { panel.close(); panel = null; button.ariaPressed = "false"; return; }
    panel = spacesPanel({ box, space: space(), name: () => login()?.name, icon: (n) => createElement(ICONS[n], { width: 16, height: 16 }) });
    button.ariaPressed = "true";
  });
}
