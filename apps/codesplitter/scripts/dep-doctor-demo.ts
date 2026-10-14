// See the dependency doctor's health page: starts the desktop app, seeds a repo of old packages,
// and opens the page. `bun scripts/dep-doctor-demo.ts` from apps/codesplitter; Ctrl+C stops it.
// The packages are small on purpose: express or vite make the health call grow past the edge's 128 MB.
const app = Bun.spawn(["bun", "run", "desktop:agent"], {
  env: { ...process.env, DEPLOYS: "1", AGENTS: "1", CHECKS: "1" },
  stdout: "pipe",
  stderr: "inherit",
});
process.on("SIGINT", () => { app.kill(); process.exit(0); });

let open = "";
const dec = new TextDecoder();
for await (const chunk of app.stdout) {
  const text = dec.decode(chunk);
  process.stdout.write(text);
  open = /open (http:\/\/\S+)/.exec(text)?.[1] ?? "";
  if (open) break;
}
if (!open) throw new Error("the desktop never printed its open URL");
const { origin } = new URL(open);
let cookie = (await fetch(open, { redirect: "manual" })).headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const call = (path: string, body: unknown) => fetch(origin + "/api" + path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

// The repo is yours alone (the health page is the owner's), so it's seeded under an alias:
// `bun scripts/dep-doctor-demo.ts <alias>`; sign in as that alias in the window if it asks.
const owner = process.argv[2] ?? "demo";
const login = await fetch(origin + "/api/login", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: owner }) });
if (!login.ok) throw new Error("sign-in as " + owner + ": " + (await login.text()));
cookie += "; " + login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const name = "small-deps-demo";
await call("/repos", { name, visibility: "private" });
const pkg = { name, version: "1.0.0", dependencies: { minimist: "1.2.0", mkdirp: "0.5.0", "left-pad": "1.1.0", semver: "5.0.0" }, devDependencies: { rimraf: "2.6.0", chalk: "2.0.0" } };
await call(`/repos/${owner}/${name}/files`, { path: "package.json", content: JSON.stringify(pkg, null, 2) });

const page = `${open}#/health/${owner}/${name}`;
console.log(`\nhealth page, as @${owner}: ${page}\n`);
Bun.spawn(["open", page]);
await app.exited;
