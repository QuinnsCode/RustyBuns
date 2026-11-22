import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screens, type Screen } from "../src/screens.ts";

test("the owner opens a screen, changes its button, saves, and the app's file keeps everything else", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screens-"));
  const file = join(dir, "first-screen.json");
  await writeFile(file, JSON.stringify({ home: { heading: "One account", play: "Play" }, login: { signIn: "Sign in" } }));
  const list: Screen[] = [
    { id: "home", app: "eqosys", name: "The front door", why: "A stranger arrives.", file, keys: ["home"] },
    { id: "login", app: "eqosys", name: "Sign in", why: "Sent from a game.", file, keys: ["login"] },
  ];
  let shot = "";
  const app = screens({ title: "First screens", screens: list, shots: dir, shoot: async (s) => { shot = s.id; return null; } });

  const index = await (await app(new Request("http://x/"))).text();
  expect(index).toContain(`href="/login"`);
  const page = await (await app(new Request("http://x/home"))).text();
  expect(page).toContain("One account");
  expect(page).not.toContain("Sign in</textarea>"); // the login screen's line is on its own page

  const saved = await app(new Request("http://x/home", { method: "POST", body: new URLSearchParams({ [JSON.stringify(["home", "play"])]: "Play now" }) }));
  expect(saved.headers.get("location")).toBe("/home?saved=1");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ home: { heading: "One account", play: "Play now" }, login: { signIn: "Sign in" } });

  const again = await app(new Request("http://x/login/shot", { method: "POST" }));
  expect([shot, again.headers.get("location")]).toEqual(["login", "/login?shot=ok"]);
  expect((await app(new Request("http://x/shot/..%2Ffirst-screen.json"))).status).toBe(404);
  expect((await app(new Request("http://x/home", { method: "POST", headers: { origin: "http://evil" }, body: new URLSearchParams() }))).status).toBe(403);
});
