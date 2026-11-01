// The party lobby panel, shared by every page that plays through a Qollab party (apps/eqosys/src/party.ts): who is in and
// who is ready, a Ready button (Start for the host), and Copy link. What happens on start is the page's own.
import type { PartyMember, party } from "./eqosys.ts";

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
  const draw = () => {
    const mine = members.find((m) => m.name === name());
    const list = members.map((m) => `${m.name}${m.host ? " (host)" : m.ready ? " ready" : ""}`).join(", ") || "joining...";
    box.replaceChildren(
      Object.assign(document.createElement("div"), { textContent: `Party ${code}: ${list}${note ? ` - ${note}` : ""}` }),
      mine?.host ? button("Start", () => p.start()) : button(mine?.ready ? "Not ready" : "Ready", () => p.ready(!mine?.ready)),
      button("Copy link", () => void navigator.clipboard?.writeText(link()).then(() => say?.("Link copied"), () => {})),
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

function button(text: string, on: () => void) {
  const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
  b.addEventListener("click", on);
  return b;
}
