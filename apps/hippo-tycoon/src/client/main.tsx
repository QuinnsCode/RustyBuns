// Browser entry. StrictMode is off on purpose: its double-mount would open two
// WebGL contexts, two AudioContexts and, online, two sockets.
import { createRoot } from "react-dom/client";
import { mountControls } from "@rustybuns/game-controls";
import { App } from "./App.tsx";
import { finishSignIn, reportButton } from "./eqosys.ts";
import { tuning } from "./input.ts";
import "./style.css";

/** The Controls cog sits outside React so it stays put across the menu, couch setup and play. */
function mountCog() {
  const host = Object.assign(document.createElement("div"), { className: "cog-host" });
  document.body.append(host);
  mountControls({
    key: "hippo-tycoon.controls", parent: host, skin: "house", hide: ["lookY", "invertY"], labels: { lookX: "Stick sensitivity", touch: "Touch drag sensitivity" },
    keys: [["A / D", "Slide"], ["W / Space", "Chomp"], ["Q", "Bellow"], ["Arrows, Enter, /", "Player 2: slide, chomp, bellow"], ["Gamepad", "Stick or D-pad slides, A chomps, B bellows"], ["Touch", "Drag to slide, tap to chomp"], ["H", "Show or hide the controls hint"]],
    onChange: (s) => { tuning.pad = s.lookX; tuning.touch = s.touch; },
  });
}

const root = createRoot(document.getElementById("root")!);
// The dev preview page (finale, poses, geyser, turntable). import.meta.env.DEV is a
// constant, so a production build drops this branch and never emits the preview's chunk.
if (import.meta.env.DEV && (location.pathname.replace(/\/$/, "").endsWith("/preview") || new URLSearchParams(location.search).has("preview"))) {
  void import("./preview/Preview.tsx").then(({ Preview }) => root.render(<Preview />));
} else {
  // Back from eqosys with ?code=&state=: trade it in before the menu shows the name.
  reportButton();
  void finishSignIn().then((back) => root.render(<App signInNote={back?.error} />));
  mountCog();
}
