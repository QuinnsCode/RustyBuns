// The Cmd/Ctrl+K menu: the page's one button, as a command a person or an agent can run.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

addCommands([buttonCommand("#wave", { name: "hello_wave", title: "Wave", description: "Wave once; the page counts the waves." })]);
mountPalette({ button: true });
