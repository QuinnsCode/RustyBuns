// The /spaces page's panel: the same spacesPanel a game mounts (@rustybuns/util/spaces), against this eqosys, with a token
// for eqosys's own pages (GET /api/home-token, door.ts homeApp) asked again before it runs out. Mounted by the page's one
// module script (commands.client.ts) when the page has a #spaces box; the CSP lets no other script in.
import { createElement, ArrowLeft, ArrowUp, Copy, Flag, Hash, LogIn, LogOut, Mic, MicOff, PhoneOff, Plus, Send, Trash2, UserX, Volume2 } from "lucide";
import { space } from "@rustybuns/util/eqosys";
import { getJson } from "@rustybuns/util/http";
import { num, obj, str } from "@rustybuns/util/guard";
import { spacesPanel, type SpaceIcon } from "@rustybuns/util/spaces";

const ICONS: Record<SpaceIcon, Parameters<typeof createElement>[0]> = {
  "arrow-left": ArrowLeft, "arrow-up": ArrowUp, plus: Plus, "log-in": LogIn, send: Send, copy: Copy, hash: Hash,
  "mic-off": MicOff, mic: Mic, "user-x": UserX, flag: Flag, "log-out": LogOut, "volume-2": Volume2, "phone-off": PhoneOff, "trash-2": Trash2,
};
const HomeToken = obj({ token: str(4000, { min: 1 }), name: str(200), life: num(30, 86_400) });

/** Fill `box` with your spaces, opening `?open=<id>` when you're in it. Resolves to the panel, or null when signed out. */
export async function mountSpaces(box: HTMLElement) {
  let got = await getJson("/api/home-token", HomeToken, { credentials: "same-origin" });
  if (!got) { box.textContent = "Sign in to see your spaces."; return null; }
  // Asked again at four fifths of its life, so an open socket's next reconnect still has a good one.
  const renew = async () => { got = await getJson("/api/home-token", HomeToken, { credentials: "same-origin" }) ?? got; setTimeout(renew, got!.life * 800); };
  setTimeout(renew, got.life * 800);
  const start = new URLSearchParams(location.search).get("open") ?? undefined;
  return spacesPanel({
    box, start, name: () => got?.name,
    space: space({ url: () => location.origin, token: () => got?.token ?? "" }),
    icon: (n) => createElement(ICONS[n], { width: 16, height: 16 }),
  });
}
