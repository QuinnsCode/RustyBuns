import { afterAll, expect, test } from "bun:test";
import { host, Mirror, type MirrorNode } from "../src/index.ts";

const page = host();
afterAll(() => page.close());

test("an unchanged react-dom app runs on the op stream: type, click, add, remove", async () => {
  const engine = new Mirror();
  const paint = async () => engine.apply(await page.frame());
  const find = (tag: string, text?: string): MirrorNode => {
    const hit = engine.findAll((n) => n.tag === tag && (text === undefined || engine.text(n) === text))[0];
    if (!hit) throw new Error(`no <${tag}> ${text ?? ""} on screen`);
    return hit;
  };

  // The entry is loaded by URL, as a script tag would, so nothing imports it for its types.
  await import(new URL("./app/main.tsx", import.meta.url).href);
  await paint();
  expect(engine.text(find("h1"))).toBe("Shopping");
  expect(engine.text(find("p"))).toBe("0 items");
  expect(find("main").style.get("padding")).toBe("16px");
  expect(find("button", "Add").attrs.has("disabled")).toBe(true);

  for (const item of ["milk", "eggs"]) {
    page.send(["input", find("input").id, item]);
    await paint();
    expect(find("input").props.get("value")).toBe(item);
    expect(find("button", "Add").attrs.has("disabled")).toBe(false);
    page.send(["click", find("button", "Add").id]);
    await paint();
  }
  expect(engine.findAll((n) => n.tag === "li").map((li) => engine.text(li))).toEqual(["milk Remove", "eggs Remove"]);
  expect(engine.text(find("p"))).toBe("2 items");
  expect(find("input").props.get("value")).toBe("");

  page.send(["click", find("button", "Remove").id]);
  await paint();
  expect(engine.findAll((n) => n.tag === "li").map((li) => engine.text(li))).toEqual(["eggs Remove"]);
  expect(find("p").attrs.get("class")).toBe("count");
});
