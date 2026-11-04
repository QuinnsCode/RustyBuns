// The demo tours the Worker carries, from content/*.json: Science On a Sphere tour scripts (TerraViz's own format)
// with a `title` on top. `bun run cms` in apps/terraviz-demo edits their words and numbers; add a file here to
// ship another. A teacher plays one with ?tour=<name> on the link or window.sphere.tour("<name>").
// A translation (content/<lang>/<name>.json, `bun run cms` adds one) goes in the tour's list below. Every globe in
// the room fetches the same address and gets its own reader's language, so the teacher and a student can read the
// same tour in two languages and stay in step: the steps and numbers always come from the original.
import { localize, pickLocale } from "@rustybuns/cms/locale";
import threePlaces from "../content/three-places.json";

export type Tour = { title: string; json: string; langs: Record<string, string> };

export const tour = (t: { title: string; tourTasks: unknown[] }, translations: Record<string, unknown> = {}): Tour => ({
  title: t.title,
  json: JSON.stringify(t),
  langs: Object.fromEntries(Object.entries(translations).map(([lang, tr]) => [lang, JSON.stringify(localize(t, tr))])),
});

export const TOURS: Record<string, Tour> = {
  "three-places": tour(threePlaces, {}),
};

/** The tour in the reader's language: their Accept-Language (the browser's own list), else the original's. */
export function tourJson(t: Tour, acceptLanguage: string | null): string {
  const wanted = (acceptLanguage ?? "").split(",").map((s) => s.split(";")[0]!.trim());
  return t.langs[pickLocale(wanted, ["en", ...Object.keys(t.langs)], "en")] ?? t.json;
}
