// The Cmd/Ctrl+K menu: the preset blitz rates (the chips) and any rate you type. Wrangler bundles this to
// public/menu.js (the page has no build of its own).
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { num, obj } from "@rustybuns/util/guard";
import { mountPalette } from "@rustybuns/util/palette";

const Rate = obj({ rate: num(30.7, 90) });
const preset = (n: number, id: string, title: string) => buttonCommand(`#chips .chip:nth-child(${n})`, { name: `blitz_${id}`, title, description: `Set the slider to ${title.toLowerCase()}.`, group: "Blitz rate" });

addCommands([
  preset(1, "typical", "Typical team's rate"),
  preset(2, "second", "The No. 2 team's rate"),
  preset(3, "season", "Vikings season rate"),
  preset(4, "one_game", "Vikings against the Colts"),
  { name: "blitz_set", title: "Set the blitz rate", group: "Blitz rate", description: "Set one team's blitz rate (30.7 to 90 percent) and watch the league average move.",
    ask: "Percent, 30.7 to 90", inputSchema: { type: "object", properties: { rate: { type: "number" } }, required: ["rate"] },
    execute: (a) => {
      const slider = document.querySelector<HTMLInputElement>("#rate")!;
      slider.value = String(Rate(a).rate);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.scrollIntoView({ block: "center" });
    } },
]);
mountPalette({ button: true });
