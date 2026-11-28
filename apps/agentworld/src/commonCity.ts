// The common city: plot 0 of Agent Galaxy, in the middle of the map. It is ours and nobody owns it: a fixed world,
// built once, that everyone walks through. For now it is the rainy city a new room starts with; it lives in its own
// file so it can grow into the town square without changing anyone's starter.
import type { Page } from "./page.ts";
import { STARTER_FILES } from "./starter.ts";

export const COMMON_CITY: Page = { files: { ...STARTER_FILES } };
