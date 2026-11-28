// The Cmd/Ctrl+K menu for QView3D's own pages (demo shop, sandbox, samples admin, shops). Never imported by the widget: a
// shop's page gets no menu from us. One list, since the palette shows only the buttons on the page in front of you.
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";

const product = (id: string, title: string) => buttonCommand(`button[data-product="${id}"]`, { name: `qview_show_${id.replaceAll("-", "_")}`, title: `Show the ${title}`, description: `Put the ${title} in the preview.`, group: "Product" });

addCommands([
  product("field-cap", "field cap"), product("crew-tee", "crew tee"), product("pullover-hoodie", "pullover hoodie"), product("cuff-beanie", "cuff beanie"),
  product("bucket-hat", "bucket hat"), product("crew-sweater", "crew sweater"), product("classic-tank", "classic tank"), product("racerback-tank", "racerback tank"),
  buttonCommand("#hanger", { name: "qview_hanger", title: "On a hanger, or off", description: "Hang the top from a hanger.", group: "Product" }),
  buttonCommand('button[data-copy="prompt"], #take .tagbox:nth-of-type(1) button', { name: "qview_copy_prompt", title: "Copy the line for your coding agent", description: "Copy what to tell a coding agent to add the customiser to a page.", group: "Embed" }),
  buttonCommand('button[data-copy="snippet"], #take .tagbox:nth-of-type(2) button', { name: "qview_copy_tag", title: "Copy the embed tag", description: "Copy the script and tag that put the customiser on a page.", group: "Embed" }),
  buttonCommand('button[data-copy="frame"], #take .tagbox:nth-of-type(3) button', { name: "qview_copy_iframe", title: "Copy the iframe", description: "Copy the iframe, for a site builder that strips scripts.", group: "Embed" }),
  buttonCommand("#go",{ name: "qview_make_sample", title: "Make the sample", description: "Send the picked photos to be made into a model.", group: "Samples" }),
  buttonCommand("#printGo", { name: "qview_print_files", title: "Make print files", description: "Lay out the print files for the design in the box.", group: "Samples" }),
  buttonCommand("#signin", { name: "qview_sign_in", title: "Sign in", description: "Sign in with eqosys to set up your shop.", group: "Account" }),
  buttonCommand("#signout", { name: "qview_sign_out", title: "Sign out", description: "Sign out of the shops page.", group: "Account" }),
]);
mountPalette({ button: true });
