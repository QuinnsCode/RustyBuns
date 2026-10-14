import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "../src/serve.ts";
import { RELOAD_PATH, RELOAD_TAG } from "../src/reload.ts";

function page() {
  const dir = mkdtempSync(join(tmpdir(), "rb-reload-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><html><head></head><body>hi</body></html>");
  return dir;
}

test("RB_WATCH: pages carry the reload script and /__rb/boot gives this host's id", async () => {
  process.env["RB_WATCH"] = "1";
  const a = serve({ assets: page(), token: "t", port: 0 }), b = serve({ assets: page(), token: "t", port: 0 });
  try {
    const cookie = { cookie: `rb_token_${a.port}=t` };
    expect(await (await fetch(a.url + "/", { headers: cookie })).text()).toContain(RELOAD_TAG);
    const id = (await (await fetch(a.url + RELOAD_PATH, { headers: cookie })).json() as { boot: string }).boot;
    expect(id).toBeTruthy();
    expect((await (await fetch(a.url + RELOAD_PATH, { headers: cookie })).json() as { boot: string }).boot).toBe(id);
    const other = (await (await fetch(b.url + RELOAD_PATH, { headers: { cookie: `rb_token_${b.port}=t` } })).json() as { boot: string }).boot;
    expect(other).not.toBe(id);
    expect((await fetch(a.url + RELOAD_PATH)).status).toBe(403);
  } finally { delete process.env["RB_WATCH"]; await a.stop(); await b.stop(); }
});

test("without RB_WATCH there is no script and no boot route", async () => {
  const s = serve({ assets: page(), port: 0 });
  try {
    expect(await (await fetch(s.url + "/")).text()).not.toContain("__rb/boot");
    expect((await fetch(s.url + RELOAD_PATH)).status).toBe(404);
  } finally { await s.stop(); }
});
