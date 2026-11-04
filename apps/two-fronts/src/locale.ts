// The page's language, picked once at boot: ?lang=, then the browser's. Each translation in content/<lang>/ is written
// into the content/*.json the battle imports, before any of it runs (main.ts imports this first), so the sim gets
// its lines at setup and never asks per tick. `bun run cms` adds a language; nothing here changes when one lands.
import { localizeContent } from "../../../packages/cms/src/locale.ts";
import chatter from "../content/chatter.json";
import cutscenes from "../content/cutscenes.json";
import dialogStories from "../content/dialogStories.json";
import places from "../content/places.json";
import radio from "../content/radio.json";

export const LANG = localizeContent(
  { chatter, cutscenes, dialogStories, places, radio },
  import.meta.glob("../content/*/*.json", { eager: true, import: "default" }),
  [new URLSearchParams(location.search).get("lang"), ...navigator.languages],
);
document.documentElement.lang = LANG;
