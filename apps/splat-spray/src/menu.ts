// The Cmd/Ctrl+K menu: the menu card's ways to play and the buttons in a hunt.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

addCommands([
  buttonCommand("#menu-quick", { name: "spray_quick_play", title: "Quick play", description: "Join an open hunt.", group: "Play" }),
  buttonCommand("#menu-solo", { name: "spray_solo", title: "Play solo", description: "Start a hunt on your own.", group: "Play" }),
  buttonCommand("#menu-friends", { name: "spray_friends", title: "Play with friends", description: "Open the room options.", group: "Play" }),
  buttonCommand("#menu-make", { name: "spray_new_room", title: "Make a new room", description: "Open a new room to share.", group: "Play" }),
  buttonCommand("#mode-scan", { name: "spray_scan", title: "Scan mode", description: "Shoot paint to reveal the room.", group: "Hunt" }),
  buttonCommand("#mode-pick", { name: "spray_pick", title: "Pick mode", description: "Point at the object you think it is.", group: "Hunt" }),
  buttonCommand("#next", { name: "spray_next", title: "Next mission", description: "Go on to the next object.", group: "Hunt", keys: "Space" }),
  buttonCommand("#reveal", { name: "spray_reveal", title: "Reveal the whole room", description: "Show everything (solo).", group: "Hunt" }),
  buttonCommand("#reset", { name: "spray_start_over", title: "Start over", description: "Cover the room again (solo).", group: "Hunt", annotations: { destructiveHint: true } }),
  buttonCommand("#leave", { name: "spray_leave", title: "Leave the room", description: "Leave the online room.", group: "Hunt", annotations: { destructiveHint: true } }),
]);
mountPalette({ button: true });
