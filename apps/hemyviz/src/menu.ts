// The Cmd/Ctrl+K menu: the top bar's modes, dimensions and view buttons.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { DIMS, MODES } from "./layout.ts";

addCommands([
  ...MODES.map((m, i) => buttonCommand(`#modes button[data-v="${m}"]`, { name: `hemyviz_mode_${m}`, title: `Show the ${m} view`, description: `Switch the picture to its ${m} mode.`, group: "Mode", keys: String(i + 1) })),
  ...DIMS.map((d) => buttonCommand(`#dims button[data-v="${d}"]`, { name: `hemyviz_dim_${d.replace(".", "_")}`, title: `Draw in ${d.toUpperCase()}`, description: `Draw the picture in ${d.toUpperCase()}.`, group: "Dimension" })),
  buttonCommand("#orbit", { name: "hemyviz_orbit", title: "Start or stop turning the 3D view", description: "Toggle the slow turn of the 3D view.", group: "View" }),
  buttonCommand("#fit", { name: "hemyviz_fit", title: "Fit the view", description: "Reset the camera so everything fits.", group: "View" }),
  buttonCommand("#theme", { name: "hemyviz_theme", title: "Switch the background", description: "Swap between the off-black and off-white backgrounds.", group: "View" }),
]);
mountPalette({ button: true });
