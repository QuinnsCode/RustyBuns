// The Cmd/Ctrl+K menu: find an app, a surprise one, and the sky. Wrangler bundles this to public/menu.js (the page has
// no build of its own).
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { obj, str } from "@rustybuns/util/guard";
import { mountPalette } from "@rustybuns/util/palette";

const Words = obj({ words: str(100) });
const sky = (mode: string, title: string) => buttonCommand(`[data-sky-pick="${mode}"]`, { name: `playground_sky_${mode}`, title, description: `${title}.`, group: "Sky" });

addCommands([
  { name: "playground_find", title: "Find an app", description: "Filter the list by name or words.", ask: "Which app?",
    inputSchema: { type: "object", properties: { words: { type: "string" } }, required: ["words"] },
    execute: (a) => {
      const q = document.querySelector<HTMLInputElement>("#q")!;
      q.value = Words(a).words;
      q.dispatchEvent(new Event("input", { bubbles: true }));
      q.scrollIntoView({ block: "center" });
    } },
  buttonCommand("#lucky", { name: "playground_surprise", title: "Surprise me", description: "Open a random playable app in a new tab." }),
  sky("day", "Day sky"),
  sky("night", "Night sky"),
  sky("system", "Sky follows my device"),
]);
mountPalette({ button: true });
