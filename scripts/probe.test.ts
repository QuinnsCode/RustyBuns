import { expect, test } from "bun:test";
import { HANDLES, MAX_OUT, listLines, parse, show } from "./probe.ts";

test("the app, path and flags parse, and a game's default expression is its state", () => {
  expect(parse(["mythic-masters", "?a=hodag&b=squonk"])).toMatchObject({ app: "mythic-masters", path: "/?a=hodag&b=squonk", js: HANDLES["mythic-masters"]!.state, size: { w: 1280, h: 720 }, mobile: false, settle: 3000 });
  expect(parse(["two-fronts", "/?battle=1", "--js", "twoFronts.end('win')", "--shot", "a.png", "--size", "800x600", "--settle", "500"])).toMatchObject({ app: "two-fronts", path: "/?battle=1", js: "twoFronts.end('win')", shot: "a.png", size: { w: 800, h: 600 }, settle: 500 });
  expect(parse(["--url", "http://127.0.0.1:5173", "--js", "1+1", "--mobile"])).toMatchObject({ url: "http://127.0.0.1:5173", js: "1+1", mobile: true, size: { w: 390, h: 844 } });
  expect(parse(["two-fronts", "--cmd", "tf_jump", '{"world":"desert"}']).js).toBe('await __commands.run("tf_jump", {"world":"desert"})');
  expect(parse(["two-fronts", "--cmd", "tf_state", "--mobile"])).toMatchObject({ js: 'await __commands.run("tf_state", {})', mobile: true });
  expect(parse(["--list"]).list).toBe(true);
  expect(parse(["some-app"]).js).toBeUndefined();
});

test("a long answer is cut with a note, and the list names every handle", () => {
  expect(show({ a: 1 })).toBe('{\n "a": 1\n}');
  expect(show(undefined)).toBe("undefined");
  const big = show("x".repeat(MAX_OUT * 2));
  expect(big.length).toBeLessThan(MAX_OUT + 80);
  expect(big).toContain("more characters: ask for less");
  expect(listLines().join("\n")).toContain("mythic-masters: mythicMasters.state()");
});
