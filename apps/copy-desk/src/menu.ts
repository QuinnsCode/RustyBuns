// The Cmd/Ctrl+K menu: the page's own nav links, as commands a person or an agent can run.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

const go = (id: string, title: string, description: string) => buttonCommand(`nav a[href="#${id}"]`, { name: `desk_${id}`, title, description });

addCommands([
  go("news", "Go to the news", "Scroll to the posts."),
  go("hours", "Go to opening hours", "Scroll to the opening hours."),
  go("edit", "Go to how to edit", "Scroll to how the site's words are edited."),
]);
mountPalette({ button: true });
