// The party lobby panel, shared by every page that plays through a Qollab party (apps/eqosys/src/qollab/party.ts): who is in and
// who is ready, a Ready button (Start for the host), and Copy link. What happens on start is the page's own. The box wears
// the page's eqosys skin (./skin.ts); where it sits is the page's.
import type { PartyMember, party } from "./eqosys.ts";
import { eqButton, wearSkin } from "./skin.ts";

export interface LobbyPanel {
  code: string;
  box: HTMLElement;
  party: ReturnType<typeof party>;
  /** The signed-in name, to find this rider among the members. */
  name: () => string | undefined;
  /** What Copy link puts on the clipboard. */
  link: () => string;
  /** Called with the room and seat when the host starts. */
  onStart: (s: { room: string; seat: number }) => void;
  /** Told when something worth a note happened (the link was copied). */
  say?: (note: string) => void;
}

/** Join the party and keep `box` showing it. Returns a function that leaves and hides the box. */
export function lobbyPanel({ code, box, party: p, name, link, onStart, say }: LobbyPanel) {
  let members: PartyMember[] = [], note = "";
  wearSkin();
  box.classList.add("eq", "rb-lobby");
  const draw = () => {
    const mine = members.find((m) => m.name === name());
    const list = members.map((m) => `${m.name}${m.host ? " (host)" : m.ready ? " ready" : ""}`).join(", ") || "joining...";
    box.replaceChildren(
      Object.assign(document.createElement("div"), { className: "rb-lobby-who", textContent: `Party ${code}: ${list}${note ? ` - ${note}` : ""}` }),
      mine?.host ? eqButton({ text: "Start", primary: true, onClick: () => p.start() }) : eqButton({ text: mine?.ready ? "Not ready" : "Ready", primary: !mine?.ready, onClick: () => p.ready(!mine?.ready) }),
      eqButton({ text: "Copy link", onClick: () => void navigator.clipboard?.writeText(link()).then(() => say?.("Link copied"), () => {}) }),
    );
  };
  p.onMembers((m) => { members = m; note = ""; draw(); });
  p.onRefused((why) => { note = why; draw(); });
  p.onGone((why) => { note = why; members = []; draw(); });
  p.onStart(onStart);
  p.join(code);
  box.hidden = false;
  draw();
  return () => { p.leave(); box.hidden = true; };
}
