// The Cmd/Ctrl+K menu: take or add photos, look at the example, and the buttons under the view.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

addCommands([
  buttonCommand("#shoot", { name: "splat_take_photo", title: "Take a photo", description: "Open the camera for the next shot.", group: "Capture", agent: false }),
  buttonCommand("#batch", { name: "splat_add_photos", title: "Add many photos or a video", description: "Pick photos or a video from this device.", group: "Capture", agent: false }),
  buttonCommand("#reset", { name: "splat_start_over", title: "Start over", description: "Throw away the photos taken so far.", group: "Capture", annotations: { destructiveHint: true } }),
  buttonCommand("#example", { name: "splat_example", title: "Show the example scan", description: "Load the demo carton into the view.", group: "View" }),
  buttonCommand("#spin", { name: "splat_turntable", title: "Turntable on or off", description: "Start or stop the view turning.", group: "View" }),
  buttonCommand("#bg", { name: "splat_background", title: "Studio white or dark", description: "Swap the view's background.", group: "View" }),
  buttonCommand("#clean", { name: "splat_clean", title: "Clean up the scan", description: "Cut away the table and stray points.", group: "Scan" }),
  buttonCommand("#online", { name: "splat_put_online", title: "Put it online", description: "Upload the scan (signed in with eqosys) and get the embed code.", group: "Scan", annotations: { destructiveHint: true, openWorldHint: true } }),
]);
mountPalette({ button: true });
