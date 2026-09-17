import { test, expect } from "bun:test";
import { infer } from "../src/glue/infer.ts";
import { analyze, plan } from "../src/glue/boundary.ts";
import { parseWrangler, wranglerToConfig } from "../src/wrangler.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";
import { generateWrangler } from "../src/gen/wrangler.ts";

const root = new URL("../../../apps/spa-example", import.meta.url).pathname;

test("infer: framework, pm, deps, vite aliases from the repo itself", () => {
  const i = infer(root);
  expect(i.framework).toBe("rwsdk");
  expect(i.hasReact).toBe(true);
  expect(i.vite.plugins).toContain("cloudflare");
  expect(i.vite.aliases["@"]).toBe("src");
  expect(i.vite.configPath).not.toBeNull();
});

test("boundary: tiers, action exports, leak via server import, stub names", () => {
  const { modules } = analyze({ root, srcDir: "src", aliases: { "@": "src" } });
  const t = Object.fromEntries(modules.map((m) => [m.file, m.tier]));
  expect(t["src/app/actions/social/socialCrud.ts"]).toBe("action");
  expect(t["src/app/components/Dashboard.tsx"]).toBe("server");
  expect(t["src/app/components/Leaky.tsx"]).toBe("leak");
  expect(t["src/app/components/FriendsPanel.tsx"]).toBe("client");   // importing an action is fine
  expect(t["src/app/components/Pure.tsx"]).toBe("client");
  const p = plan(modules);
  expect(p.actions[0]!.exports).toEqual(["listFriends", "addFriend"]);
  expect(p.stubNames["@/db"]).toEqual(["visits"]);
});

test("wrangler round trip keeps every binding and generates both files", async () => {
  const w = parseWrangler(await Bun.file(root + "/wrangler.jsonc").text());
  const c = wranglerToConfig(w);
  expect(Object.keys(c.bindings).sort()).toEqual(["ASSETS_BUCKET", "BETTER_AUTH_URL", "DB", "MAP_BUILDER_DO", "PRESENCE_KV", "SESSION_DURABLE_OBJECT", "WEBAUTHN_APP_NAME", "WORLD_DURABLE_OBJECT"]);
  const a = generateAlchemy(c);
  expect(a).toContain('Cloudflare.D1.Database("DB"');
  expect(a).toContain("Cloudflare.InferEnv<typeof Worker>");
  const g = JSON.parse(generateWrangler(c).replace(/^\/\/.*$/gm, ""));
  expect(g.durable_objects.bindings.length).toBe(3);
  expect(g.r2_buckets[0].bucket_name).toBe("druids-curse-assets");
});

test("layout: app/ with ~ and #lib from tsconfig paths, no src/", () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const r = mkdtempSync(tmpdir() + "/oddapp-");
  mkdirSync(r + "/app/lib", { recursive: true });
  writeFileSync(r + "/package.json", JSON.stringify({ name: "odd", dependencies: { vite: "6", react: "19" } }));
  writeFileSync(r + "/tsconfig.json", `{ "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["./app/*"], "#lib/*": ["./app/lib/*"] } } }`);
  writeFileSync(r + "/app/act.ts", `"use server";\nimport { thing } from "#lib/db";\nexport async function act() { return thing(); }\n`);
  writeFileSync(r + "/app/lib/db.ts", `import { env } from "cloudflare:workers";\nexport const thing = () => env.X;\n`);
  writeFileSync(r + "/app/C.tsx", `"use client";\nimport { act } from "~/act";\nexport const C = () => null;\n`);
  const i = infer(r);
  expect(i.srcDir).toBe("app");
  expect(i.srcDirSource).toBe("tsconfig");
  expect(i.aliases).toEqual({ "~": "app", "#lib": "app/lib" });
  const { modules } = analyze({ root: r, srcDir: i.srcDir, aliases: i.aliases });
  const t = Object.fromEntries(modules.map((m) => [m.file, m.tier]));
  expect(t["app/act.ts"]).toBe("action");
  expect(t["app/lib/db.ts"]).toBe("server");
  expect(t["app/C.tsx"]).toBe("client");
  expect(plan(modules).stubNames["#lib/db"]).toEqual(["thing"]);
});