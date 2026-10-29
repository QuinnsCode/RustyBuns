// The Rust tour reader, as the page gets it: the glue and wasm strings the Worker serves, run here in Bun. The reader's
// own rules are under cargo test in wasm/; this checks the shipped build reads a real script (the demo tour).
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import threePlaces from "../content/three-places.json";
import { TOUR_GLUE, TOUR_WASM_B64 } from "../sphere/tour-pkg.ts";

test("the shipped wasm reads the demo tour as slides, and says what is wrong with a broken one", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "sphere-tour-")), "sphere_tour.mjs");
  writeFileSync(file, TOUR_GLUE);
  const glue = await import(file);
  await glue.default({ module_or_path: Uint8Array.from(atob(TOUR_WASM_B64), (c) => c.charCodeAt(0)) });

  const o = JSON.parse(glue.outline(JSON.stringify(threePlaces)));
  expect(o.issues).toEqual([]);
  expect(o.slides.map((s: { title: string }) => s.title)).toEqual(["Three places, one globe", "Boulder, Colorado", "The Great Barrier Reef", "Svalbard", "That's the walk."]);
  expect(o.slides[1]).toMatchObject({ lat: 40, lon: -105.3, hold: null });
  expect(o.slides[3].hold).toBe(12);
  expect(glue.slide_of(JSON.stringify(threePlaces), o.slides[2].first)).toBe(2);

  const broken = JSON.parse(glue.outline('{"tourTasks":[{"showRect":{"rectID":"a","caption":"A"}},{"flyTo":{"lat":99,"lon":0}}]}'));
  expect(broken.issues.map((i: { what: string }) => i.what)).toEqual(["flyTo needs lat -90..90 and lon -180..180", 'showRect "a" is never hidden']);
  expect(JSON.parse(glue.outline("nope")).issues[0].what).toStartWith("not JSON");
});
