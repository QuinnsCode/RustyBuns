// The Cmd/Ctrl+K menu: the Find and Race buttons.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

addCommands([
  buttonCommand('[data-cmd="samples"]', { name: "rag_sample_photos", title: "Load the sample photos", description: "Index the sample photos and their faces." }),
  buttonCommand('[data-cmd="add"] input', { name: "rag_add_pics", title: "Add pictures", description: "Pick pictures from this computer.", agent: false }),
  buttonCommand("#go", { name: "rag_race", title: "Race the search", description: "Time the index search on the picked lanes." }),
  buttonCommand("#race-faces", { name: "rag_race_faces", title: "Race the face finder", description: "Time finding faces on every page." }),
]);
mountPalette({ button: true });
