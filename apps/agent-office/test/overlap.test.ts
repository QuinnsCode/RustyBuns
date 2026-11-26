// #4956: twenty tasks on one app went out at once, since each named a file or two and the queue never asked again.
import { afterEach, expect, test } from "bun:test";
import { resetOverlap, taskApps } from "../live/overlap.ts";

afterEach(resetOverlap);

const PATHS = ["apps/fm-daw/src/circuit/amps.ts", "apps/fm-daw/src/desk.ts", "apps/load-in/src/van.ts", "apps/example/src/main.ts", "packages/gear/src/cable.ts"];

test("a task's apps: the ones its files sit in, an apps/ path it writes, a hyphenated app name, not a plain word", () => {
  const cases: [string, string[]][] = [
    ["Q Amp: a phaser in src/circuit/amps.ts", ["fm-daw"]],
    ["see apps/load-in for the van", ["load-in"]],
    ["the fm-daw desk and the load-in van", ["fm-daw", "load-in"]],
    ["an example of a cable in packages/gear/src/cable.ts", []],
    ["apps/nowhere/x.ts and my-thing", []],
  ];
  for (const [text, apps] of cases) expect([text, taskApps(text, PATHS)]).toEqual([text, apps]);
});

