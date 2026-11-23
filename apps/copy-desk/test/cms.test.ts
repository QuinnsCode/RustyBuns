// The owner's everyday path: open the editor on a copy of content/, publish the draft post and rename one, and the page's
// own code shows the new list, in English and in Spanish (the Spanish line kept, the date and number from the source).
import { expect, test } from "bun:test";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cms } from "@rustybuns/cms";
import { localizeContent } from "@rustybuns/cms/locale";
import { livePosts, type Post } from "../src/site.ts";

const read = async (path: string): Promise<{ posts: Post[] }> => Bun.file(path).json();

test("a post edited and published in the editor shows on the page, translated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "copy-desk-"));
  await cp(join(import.meta.dir, "../content"), dir, { recursive: true });
  const app = cms({ dir, title: "Copy Desk" });

  const before = await read(join(dir, "posts.json"));
  expect(livePosts(before.posts).map((p) => p.id)).toEqual(["rye", "holiday"]);
  expect(await (await app(new Request("http://x/posts.json"))).text()).toContain("A second oven");

  const saved = await app(new Request("http://x/posts.json", {
    method: "POST",
    body: new URLSearchParams({ [JSON.stringify(["posts", 2, "published"])]: "1", [JSON.stringify(["posts", 0, "title"])]: "Dark rye, Fridays" }),
  }));
  expect(saved.status).toBe(303);

  const en = await read(join(dir, "posts.json"));
  expect(livePosts(en.posts).map((p) => p.title)).toEqual(["A second oven", "Dark rye, Fridays", "Holiday orders open"]);

  const es = structuredClone(en);
  const lang = localizeContent({ posts: es }, { "content/es/posts.json": await Bun.file(join(dir, "es/posts.json")).json() }, ["es-MX"]);
  expect(lang).toBe("es");
  expect(livePosts(es.posts).map((p) => [p.date, p.title])).toEqual([
    ["2026-11-25", "Un segundo horno"], ["2026-11-20", "Vuelve el centeno oscuro"], ["2026-11-18", "Abiertos los pedidos de fiestas"],
  ]);
});
