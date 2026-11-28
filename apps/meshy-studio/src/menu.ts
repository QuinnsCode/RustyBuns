// The Cmd/Ctrl+K menu: the top bar's views and dialogs and the board's batch buttons, marked data-cmd. Anything that
// spends credits still stops at the app's own "Spend about ..." confirmation.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

const cmd = (id: string, title: string, description: string) => buttonCommand(`[data-cmd="${id}"]`, { name: `meshy_${id.replaceAll("-", "_")}`, title, description });

addCommands([
  buttonCommand('.step a[href*="meshy.ai"]', { name: "meshy_get_key", title: "Get a Meshy API key", description: "Open meshy.ai, where the setup's API key comes from." }),
  cmd("choose-folder","Choose a workspace folder", "Pick the folder this studio works in."),
  cmd("create", "Create", "Open the text to 3D and concept image dialog."),
  cmd("folders", "Show folders", "Switch to the folders view."),
  cmd("pipeline", "Show the pipeline", "Switch to the pipeline board."),
  cmd("presets", "Presets", "Open the presets."),
  cmd("settings", "Settings", "Open the settings: API key, engines and spending."),
  cmd("send", "Send the new cards", "Ask to send the new cards to Meshy; the app confirms the cost first."),
  cmd("texture", "Texture the drafts", "Ask to texture the draft models; the app confirms the cost first."),
  cmd("switch", "Switch workspace", "Leave this workspace and pick another."),
]);
mountPalette({ button: true });
