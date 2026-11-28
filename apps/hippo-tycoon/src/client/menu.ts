// The Cmd/Ctrl+K menu: each screen's buttons, marked data-cmd in the components. The palette lists the ones on screen.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

const cmd = (id: string, title: string, description: string) => buttonCommand(`[data-cmd="${id}"]`, { name: `hippo_${id.replaceAll("-", "_")}`, title, description });

addCommands([
  cmd("solo", "Play solo", "Start a game against bots."),
  cmd("couch", "Couch game", "Set up a game for people on this screen."),
  cmd("host-lan", "Host on this network", "Open a game others on your network can join."),
  cmd("join-lan", "Join on this network", "Join a game on your network."),
  cmd("online", "Play online", "Join or open an online room."),
  cmd("options", "Options", "Open the options."),
  cmd("start", "Start the game", "Start from the setup or the lobby."),
  cmd("mute", "Sound on or off", "Mute or unmute the game."),
  cmd("hint", "Show or hide the controls", "Toggle the controls hint during a game."),
  cmd("rematch", "Rematch", "Play again from the podium."),
  cmd("back", "Back to the menu", "Leave this screen for the main menu."),
]);
mountPalette({ button: true });
