// The Cmd/Ctrl+K menu: play and the engine comparison, marked data-cmd in the components.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

addCommands([
  buttonCommand('[data-cmd="play"]', { name: "midi_play", title: "Play or pause the song", description: "Render the song if needed, then play it; again to pause." }),
  buttonCommand('[data-cmd="compare"]', { name: "midi_compare", title: "Show or hide the engine comparison", description: "Open or close the Rust against TypeScript panel." }),
  buttonCommand('[data-cmd="race"]', { name: "midi_race", title: "Run all three engines", description: "Render the song on each engine and time them (the comparison must be open)." }),
]);
mountPalette({ button: true });
