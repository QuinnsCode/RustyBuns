// The About page (about.html): the words are in the HTML; this fills the footer from the list the landing uses.
import { addCommands } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { copyright, FOOT_LINKS, MAKER, TAGLINE } from "./foot.ts";

const link = ([text, href]: readonly [string, string]) => Object.assign(document.createElement("a"), { textContent: text, href });
const nav = document.createElement("nav");
nav.append(...FOOT_LINKS.map(link));
const by = document.createElement("span");
by.append("created by ", link([MAKER.name, MAKER.href]), ` · ${copyright()}`);
document.querySelector(".site-foot")!.append(Object.assign(document.createElement("p"), { textContent: TAGLINE }), nav, by);

addCommands(FOOT_LINKS.map(([title, href]) => ({ name: `page_go_${title.toLowerCase().replaceAll(" ", "_")}`, title, group: "Go", description: `Opens ${title}.`,
  execute: () => location.assign(href) })));
mountPalette({ button: true });
