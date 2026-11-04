// The page's language, picked once at boot: ?lang=, then the browser's. Each translation in content/<lang>/ is written
// into the content/*.json the sim imports, before any of it runs (main.ts imports this first), so the sim gets its
// lines at setup and never asks per tick. `bun run cms` adds a language; nothing here changes when one lands.
import { localizeContent } from "../../../../packages/cms/src/locale.ts";
import gags from "../../content/gags.json";
import radio from "../../content/radio.json";
import stories from "../../content/stories.json";

export const LANG = localizeContent(
  { gags, radio, stories },
  import.meta.glob("../../content/*/*.json", { eager: true, import: "default" }),
  [new URLSearchParams(location.search).get("lang"), ...navigator.languages],
);
document.documentElement.lang = LANG;
