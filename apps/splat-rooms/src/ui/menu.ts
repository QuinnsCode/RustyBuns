// The Cmd/Ctrl+K menu: each screen's buttons, marked data-cmd in the components. The palette lists the ones on screen.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

const cmd = (id: string, title: string, description: string) => buttonCommand(`[data-cmd="${id}"]`, { name: `rooms_${id.replaceAll("-", "_")}`, title, description });

addCommands([
  cmd("quick-hunt", "Quick hunt", "Start a hunt in a random room."),
  cmd("choose-room", "Choose a room", "Open the mission board."),
  cmd("browse", "Browse rooms", "Open the room browser."),
  cmd("how-to", "How to play", "Open the field manual."),
  cmd("pause", "Pause, or back to the menu", "Pause the hunt; outside a hunt, go back to the menu."),
  cmd("resume", "Resume the hunt", "Carry on after a pause."),
  cmd("new-target", "New target", "Start again with another object to find."),
  cmd("next-hunt", "Next hunt", "Start the next hunt after a result."),
  cmd("another-room", "Another room", "Hunt in a different room."),
  cmd("frame-room", "Frame the room", "In the browser, pull the camera back to the whole room."),
  cmd("back", "Back to the menu", "Leave this screen for the main menu."),
]);
mountPalette({ button: true });
