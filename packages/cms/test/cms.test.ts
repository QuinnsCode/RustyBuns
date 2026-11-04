import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cms, localize, pickLocale } from "../src/index.ts";
import { localizeContent } from "../src/locale.ts";

const start = async (file: unknown) => {
  const dir = await mkdtemp(join(tmpdir(), "cms-"));
  await writeFile(join(dir, "script.json"), JSON.stringify(file));
  return { dir, app: cms({ dir, title: "Test" }) };
};
const post = (app: (r: Request) => Promise<Response>, fields: Record<string, string>) =>
  app(new Request("http://x/script.json", { method: "POST", body: new URLSearchParams(fields) }));

test("a writer edits a line, a list, a number and a stop in a list of stops, and the file keeps its shape", async () => {
  const { dir, app } = await start({
    radio: { shield: ["one", "two"] }, title: "Old", delay: 3, nested: [1, 2],
    stops: [{ caption: "Boulder", flyTo: { lat: 40, lon: -105 } }, { caption: "Reef", flyTo: { lat: -18, lon: 147 } }],
  });
  const html = await (await app(new Request("http://x/script.json"))).text();
  expect(html).toContain("<textarea");
  const res = await post(app, {
    [JSON.stringify(["title"])]: "New\r\n", [JSON.stringify(["radio", "shield"])]: "one\n\n  three  \n",
    [JSON.stringify(["delay"])]: "99", [JSON.stringify(["extra"])]: "x",
    [JSON.stringify(["stops", 1, "caption"])]: "Great Barrier Reef", [JSON.stringify(["stops", 1, "flyTo", "lat"])]: "-18.3",
    [JSON.stringify(["stops", 0, "flyTo", "lon"])]: "west", // not a number: the old one stays
  });
  expect(res.status).toBe(303);
  expect(JSON.parse(await readFile(join(dir, "script.json"), "utf8"))).toEqual({
    radio: { shield: ["one", "three"] }, title: "New", delay: 99, nested: [1, 2],
    stops: [{ caption: "Boulder", flyTo: { lat: 40, lon: -105 } }, { caption: "Great Barrier Reef", flyTo: { lat: -18.3, lon: 147 } }],
  });
});

test("a cross-site form and a file outside the folder are refused", async () => {
  const { app } = await start({ a: "b" });
  const cross = await app(new Request("http://x/script.json", { method: "POST", headers: { origin: "http://evil" }, body: new URLSearchParams() }));
  expect(cross.status).toBe(403);
  expect((await app(new Request("http://x/..%2Fpackage.json"))).status).toBe(404);
});

test("a translator adds Spanish, fills some lines, and the game reads them with the rest in English", async () => {
  const source = { title: "Hello", delay: 3, radio: ["one", "two"], stops: [{ caption: "Boulder" }, { caption: "Reef" }] };
  const { dir, app } = await start(source);
  const add = await app(new Request("http://x/", { method: "POST", body: new URLSearchParams({ lang: "es" }) }));
  expect(add.status).toBe(303);
  expect((await app(new Request("http://x/", { method: "POST", body: new URLSearchParams({ lang: "../x" }) }))).status).toBe(400);
  const index = await (await app(new Request("http://x/"))).text();
  expect(index).toContain("0 of 4 translated");

  const res = await app(new Request("http://x/es/script.json", { method: "POST", body: new URLSearchParams({
    [JSON.stringify(["title"])]: "Hola", [JSON.stringify(["stops", 1, "caption"])]: "Arrecife", [JSON.stringify(["delay"])]: "9",
  }) }));
  expect(res.status).toBe(303);
  const saved: unknown = JSON.parse(await readFile(join(dir, "es", "script.json"), "utf8"));
  expect(saved).toEqual({ title: "Hola", delay: 3, radio: [], stops: [{ caption: "" }, { caption: "Arrecife" }] });
  expect(localize(source, saved)).toEqual({ title: "Hola", delay: 3, radio: ["one", "two"], stops: [{ caption: "Boulder" }, { caption: "Arrecife" }] });
  expect(await (await app(new Request("http://x/"))).text()).toContain("2 of 4 translated");
  expect((await app(new Request("http://x/de/script.json"))).status).toBe(404);
});

test("a reader gets their language, its base, or the original", () => {
  const have = ["en", "es", "pt-BR"];
  expect(pickLocale(["es-MX", "en"], have, "en")).toBe("es");
  expect(pickLocale(["pt-br"], have, "en")).toBe("pt-BR");
  expect(pickLocale([null, "de", "fr"], have, "en")).toBe("en");
});

test("a game picks Spanish at boot, and the lines its sim already holds read in Spanish", () => {
  const radio = { shield: ["Humming in the ferns.", "Not cuddly."], delay: 3, drop: { title: "THE RIDE DOWN", who: "Drop Two" } };
  const held = radio.shield; // what a sim module took out of the import before boot
  const files = { "../../content/es/radio.json": { shield: ["Algo zumba entre los helechos."], delay: 9, drop: { title: "LA BAJADA", who: "" } } };
  expect(localizeContent({ radio }, files, ["es-MX", "en"])).toBe("es");
  expect(held).toEqual(["Algo zumba entre los helechos."]);
  expect(radio).toEqual({ shield: held, delay: 3, drop: { title: "LA BAJADA", who: "Drop Two" } });

  const other = { lines: ["one"] };
  expect(localizeContent({ other }, files, ["de"])).toBe("en");
  expect(other).toEqual({ lines: ["one"] });
});
