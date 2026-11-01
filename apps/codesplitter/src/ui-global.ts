// The UI kit (packages/ui) for client.html's classic script: built to /ui.js, which sets `ui` (ui.toast, ui.button, ...).
// The page's theme is its --ui-* tokens in the head <style>, so the kit looks like the page.
import * as ui from "../../../packages/ui/src/index.ts";

Object.assign(globalThis, { ui });
