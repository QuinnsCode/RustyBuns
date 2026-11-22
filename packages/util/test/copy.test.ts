import { expect, test } from "bun:test";
import { fillCopy } from "../src/copy.ts";

test("a menu's empty elements and attributes take their lines, escaped, and a missing line names itself", () => {
  const html = `<h1 id="t" data-copy="title"></h1><span><b data-copy="menu.play">old</b></span>`
    + `<input id="code" data-copy-placeholder="menu.code" maxlength="8" data-copy-aria-label="menu.code">`;
  const copy = { title: "Bigfoot & friends", menu: { play: "Play <now>", code: "Room \"code\"" } };
  expect(fillCopy(html, copy)).toBe(`<h1 id="t" data-copy="title">Bigfoot &#38; friends</h1><span><b data-copy="menu.play">Play &#60;now&#62;</b></span>`
    + `<input id="code" placeholder="Room &#34;code&#34;" maxlength="8" aria-label="Room &#34;code&#34;">`);
  expect(() => fillCopy(`<p data-copy="menu.gone"></p>`, copy)).toThrow(`no line "menu.gone"`);
});
