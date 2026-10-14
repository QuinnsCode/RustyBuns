import { expect, test } from "bun:test";
import { analyze, appStatus, board, mergeReports, shardOf, type Audit, type Control } from "./phone-smoke-lib.ts";

const ctl = (label: string, o: Partial<Control> = {}): Control => ({ tag: "button", label, x: 10, y: 10, w: 100, h: 40, shown: true, obscured: false, ...o });
const page = (controls: Control[], o: Partial<Audit> = {}): Audit => ({ vw: 375, vh: 667, scrollW: 375, viewportMeta: true, textLen: 200, canvases: 0, controls, ...o });
const kinds = (fs: { kind: string }[]) => fs.map((f) => f.kind).sort();

test("a clean page has no findings", () => {
  const p = page([ctl("Play")]);
  expect(analyze(p, page([ctl("Play")]))).toEqual([]);
});

test("a button that was on the laptop page and is gone on the phone is flagged", () => {
  const ref = page([ctl("Play"), ctl("Settings")], { vw: 1280 });
  const phone = page([ctl("Play"), ctl("Settings", { shown: false })]);
  const fs = analyze(phone, ref);
  expect(kinds(fs)).toEqual(["missing-vs-desktop"]);
  expect(fs[0].detail).toContain("Settings");
});

test("layout breaks: wide page, cut-off and covered controls", () => {
  const p = page([ctl("Buy", { x: 340, w: 80 }), ctl("Quit", { obscured: true })], { scrollW: 520 });
  expect(kinds(analyze(p, undefined))).toEqual(["covered", "cut-off", "h-overflow"]);
});

test("tiny and unlabeled controls are warnings, and page noise is carried", () => {
  const fs = analyze(page([ctl("x", { w: 16, h: 16 }), ctl("", { tag: "a" })]), undefined, ["console.error: boom"]);
  expect(kinds(fs)).toEqual(["console", "tiny-target", "unlabeled"]);
  expect(fs.every((f) => f.sev === "warn")).toBe(true);
});

test("an empty page is blank, but a canvas game is not", () => {
  expect(kinds(analyze(page([], { textLen: 0 }), undefined))).toEqual(["blank"]);
  expect(analyze(page([], { textLen: 0, canvases: 1 }), undefined)).toEqual([]);
  const ref = page([], { textLen: 0, vw: 1280 });
  expect(analyze(page([], { textLen: 0 }), ref)[0].sev).toBe("warn");
  expect(analyze(page([], { textLen: 0 }), page([ctl("Play")], { vw: 1280 }))[0].sev).toBe("error");
});

test("shards split the apps without overlap, and merged reports keep each app once", () => {
  const apps = ["a", "b", "c", "d", "e"];
  const parts = [1, 2, 3].map((i) => shardOf(apps, i, 3));
  expect(parts.flat().sort()).toEqual(apps);
  const m = mergeReports([{ generatedAt: "2026-01-01", apps: [{ app: "a", phones: [] }] }, { generatedAt: "2026-01-02", apps: [{ app: "b", phones: [] }, { app: "a", phones: [] }] }]);
  expect(m.apps.map((a) => a.app).sort()).toEqual(["a", "b"]);
});

test("the board lists broken apps first and escapes what the page said", () => {
  const html = board({
    generatedAt: "2026-10-14T00:00:00Z",
    apps: [
      { app: "fine", phones: [{ phone: "Pixel 8", w: 412, h: 915, shot: "fine/p.jpg", findings: [] }] },
      { app: "bad", phones: [{ phone: "Pixel 8", w: 412, h: 915, findings: [{ kind: "covered", sev: "error", detail: `<script>"x"</script>` }] }] },
      { app: "dead", phones: [], bootError: "vite exited 1" },
    ],
  });
  expect(appStatus({ app: "dead", phones: [], bootError: "x" })).toBe("error");
  expect(html.indexOf("<h2><span class=\"dot\"></span>bad")).toBeLessThan(html.indexOf("<h2><span class=\"dot\"></span>fine"));
  expect(html).not.toContain("<script>\"x\"");
  expect(html).toContain("vite exited 1");
});
