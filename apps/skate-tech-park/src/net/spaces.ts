// Qollab spaces in the park: a signed-in rider's groups that last between sessions, with text channels
// (@rustybuns/util/spaces draws them, apps/eqosys/src/space.ts keeps them). The HUD's chat button opens the panel.
import { ArrowLeft, ArrowUp, Copy, createElement, Flag, Hash, LogIn, LogOut, MessagesSquare, Mic, MicOff, Plus, Send, UserX } from "lucide";
import { spacesPanel, type SpaceIcon } from "@rustybuns/util/spaces";
import { fresh, login, space } from "../eqosys.ts";

const ICONS: Record<SpaceIcon, Parameters<typeof createElement>[0]> = {
  "arrow-left": ArrowLeft, "arrow-up": ArrowUp, plus: Plus, "log-in": LogIn, send: Send, copy: Copy, hash: Hash,
  "mic-off": MicOff, mic: Mic, "user-x": UserX, flag: Flag, "log-out": LogOut,
};
const icon = (n: SpaceIcon) => createElement(ICONS[n], { width: 16, height: 16 });

/** Show the chat button when the rider is signed in; it opens and closes the spaces panel. Returns the panel's state for a harness. */
export function mountSpaces(button: HTMLButtonElement) {
  const l = login();
  button.hidden = !(l && fresh(l));
  button.title = button.ariaLabel = "Spaces";
  button.append(createElement(MessagesSquare, { width: 18, height: 18 }));
  const box = Object.assign(document.createElement("aside"), { id: "spaces", hidden: true, ariaLabel: "Spaces" });
  document.body.append(box);
  let panel: ReturnType<typeof spacesPanel> | null = null;
  button.addEventListener("click", () => {
    if (panel) { panel.close(); panel = null; button.ariaPressed = "false"; button.blur(); return; }
    panel = spacesPanel({ box, space: space(), name: () => login()?.name, icon });
    button.ariaPressed = "true";
  });
  return { state: () => panel?.state() ?? null, toggle: () => button.click() };
}
