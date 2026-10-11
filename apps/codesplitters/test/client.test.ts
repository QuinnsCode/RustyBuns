import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(import.meta.dir, "../src/client.html"), "utf8");
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every selector in the page's styles that reaches `.cls`, and its declarations. */
const rulesFor = (cls: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap(([, sel, body]) => sel!.split(",").map((s) => ({ sel: s.trim(), body: body! })))
  .filter(({ sel }) => new RegExp(String.raw`\.${cls}(?![\w-])`).test(sel));

// The ⌘K palette opened as a narrow, tall box twice (#609, #678): a bare `.sheet` rule for
// another widget (the repo tabs, max-width: 200px) also styled the palette's sheet.
describe("the command palette and the drawer keep their size", () => {
  test("the palette's sheet is full width", () => {
    expect(html).toContain(`<div class="palette" id="palette" hidden><div class="sheet"`);
    const own = rulesFor("sheet").find((r) => r.sel === ".palette .sheet");
    expect(own?.body).toContain("width: min(640px, calc(100vw - 32px))");
  });

  test("no rule styles a .sheet outside the palette or the drawer", () => {
    expect(rulesFor("sheet").map((r) => r.sel).filter((s) => !/^\.(palette|drawer)(\.on)? \.sheet\b/.test(s))).toEqual([]);
  });
});

// Every git action draws what it does before you press it (#693).
describe("git action pictures", () => {
  const src = html.slice(html.indexOf("const GITPICS"), html.indexOf("const picAttr"));
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const { GITPICS, gitPic } = new Function("esc", `${src}; return { GITPICS, gitPic };`)(esc);
  const dots = (out: string) => [...out.matchAll(/<span class="dots">(.*?)<\/span>/g)].map(([, d]) => [...d!.matchAll(/<i class="(\w)"/g)].map((m) => m[1]).join(""));

  test("every kind draws two sides before and after, with a caption", () => {
    for (const kind of Object.keys(GITPICS)) {
      const out = gitPic([kind, { branch: "fix", ref: "dev", ahead: 1, behind: 1 }]);
      expect(dots(out)).toHaveLength(4);
      expect(out).toMatch(/<span class="say">[^<]+<\/span>/);
    }
  });

  test("a sync draws the commits waiting on each side, and nothing when in step", () => {
    expect(dots(gitPic(["sync", { ahead: 2, behind: 1 }]))).toEqual(["oou", "oomm", "ooumm", "ooumm"]);
    expect(gitPic(["sync", { ahead: 0, behind: 0 }])).toContain("Already in step");
  });

  test("the git actions on the page carry a picture", () => {
    for (const b of ["data-resolve=\"mine\"", "data-resolve=\"rebase\"", "id=\"mirror-sync\"", "data-crew=\"1\"", "data-push=", "data-pull=", "data-open-ref="])
      expect(html).toMatch(new RegExp(`${b}[^>]*\\$\\{(picAttr|sync)`));
  });
});
