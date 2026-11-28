// The Cmd/Ctrl+K menu: open a folder, an empty editor, switch library, marked data-cmd in the components.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

addCommands([
  buttonCommand('[data-cmd="open-folder"]', { name: "desk_open_folder", title: "Open a folder", description: "Pick the folder of scenes to work in." }),
  buttonCommand('[data-cmd="empty-editor"]', { name: "desk_empty_editor", title: "Open an empty editor", description: "Start the editor with no scene (it asks first if there are unsaved changes)." }),
  buttonCommand('[data-cmd="switch"]', { name: "desk_switch_folder", title: "Switch folder", description: "Close this library and pick another (it asks first if there are unsaved changes)." }),
]);
mountPalette({ button: true });
