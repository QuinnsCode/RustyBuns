// The Cmd/Ctrl+K menu: the side panel's buttons, marked data-cmd in App.tsx.
import { addCommands, buttonCommand, type Command } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

const cmd = (id: string, title: string, description: string, group: string, more: Partial<Pick<Command, "agent">> = {}) =>
  buttonCommand(`[data-cmd="${id}"]`, { name: `rig_${id.replaceAll("-", "_")}`, title, description, group, ...more });

addCommands([
  cmd("gingerbread", "Load the gingerbread", "Load and rig the gingerbread sample.", "Model"),
  cmd("lizard", "Load the lizard", "Load and rig the lizard sample.", "Model"),
  cmd("fox", "Load the fox", "Download and rig the fox sample.", "Model"),
  cmd("cesium-man", "Load Cesium Man", "Download and rig the Cesium Man sample.", "Model"),
  cmd("open", "Open a .glb file", "Pick a model from this computer.", "Model", { agent: false }),
  cmd("rig", "Rig it", "Find the skeleton and skin weights with the sliders as they are.", "Rig"),
  cmd("race", "Race the engines", "Time the rig on each engine.", "Rig"),
  cmd("reset-pose", "Reset the pose", "Put the model back in its first pose.", "Pose"),
  cmd("download", "Download the rigged .glb", "Save the model with its new rig.", "Pose"),
  cmd("weights", "Show or hide skin weights", "Toggle the skin weight colours.", "View"),
  cmd("skeleton", "Show or hide the skeleton", "Toggle the skeleton and drag handles.", "View"),
]);
mountPalette({ button: true });
