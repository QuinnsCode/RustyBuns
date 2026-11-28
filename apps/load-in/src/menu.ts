// The Cmd/Ctrl+K menu for the game's three pages (the walk-in, the stacker, the cable room): their own buttons. One
// list, since the palette shows only the buttons on the page in front of you.
import { addCommands, buttonCommand, type Command } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

const cmd = (selector: string, name: string, title: string, description: string, more: Partial<Pick<Command, "annotations" | "keys">> = {}) =>
  buttonCommand(selector, { name: `loadin_${name}`, title, description, ...more });

addCommands([
  cmd("#play", "play", "Start the load-in", "Leave the menu and start playing."),
  cmd("#speakers", "speakers", "Speakers up or down", "Bring the speakers up or down.", { keys: "M" }),
  cmd("#make", "make_party", "Make a party", "Open a party others can join with a code."),
  cmd("#start", "start_party", "Start the party's load-in", "As the host, start the game for the party."),
  cmd("#go", "stack_it", "Just do it", "Build the picked rig's stacks for this floor."),
  cmd("#crossover", "crossover", "Set the amps' crossover", "The tri-amp stack's response plot and its splits, delays and polarity, as a lesson.", { keys: "K" }),
  cmd("#undo", "undo", "Undo", "Take back the last change to the design."),
  cmd("#v-stack", "view_stack", "Show the stack", "Look at the stack from the front."),
  cmd("#v-stage", "view_stage", "Show the stage", "Look at the floor plan."),
  cmd("#t-use", "use", "Grab or plug", "Pick up or plug in what you look at."),
  cmd("#t-48", "phantom", "48 V phantom on or off", "Switch the desk's phantom power."),
  cmd("#t-reset", "reset", "Reset the room", "Put the cables back where they began.", { annotations: { destructiveHint: true } }),
]);
mountPalette({ button: true });
