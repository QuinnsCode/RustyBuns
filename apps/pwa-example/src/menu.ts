// The Cmd/Ctrl+K menu: roll, share and install, the page's own buttons.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

addCommands([
  buttonCommand("#roll", { name: "dice_roll", title: "Roll the dice", description: "Roll the picked number of dice and sides." }),
  buttonCommand("#share", { name: "dice_share", title: "Share this roll", description: "Share (or copy) a link that rolls the same dice." }),
  buttonCommand("#install", { name: "dice_install", title: "Install the app", description: "Offer to install Pocket Dice, when the browser allows it." }),
]);
mountPalette({ button: true });
