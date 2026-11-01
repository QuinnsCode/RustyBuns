// Writes public/frameworks.json: each framework example, the framework version it pins and npm's latest,
// so the page can rate it fresh to stale. Run `bun run fresh` after bumping an example.

const FRAMEWORKS: { name: string; app: string; pkg: string }[] = [
  { name: "Next.js", app: "nextjs-example", pkg: "next" },
  { name: "React Router", app: "react-router-example", pkg: "react-router" },
  { name: "TanStack Start", app: "tanstack-start-example", pkg: "@tanstack/react-start" },
  { name: "Astro", app: "astro-example", pkg: "astro" },
  { name: "SvelteKit", app: "sveltekit-example", pkg: "@sveltejs/kit" },
  { name: "Nuxt", app: "nuxt-example", pkg: "nuxt" },
  { name: "SolidStart", app: "solidstart-example", pkg: "@solidjs/start" },
  { name: "Qwik City", app: "qwik-example", pkg: "@builder.io/qwik-city" },
  { name: "Hono", app: "hono-example", pkg: "hono" },
  { name: "Elysia", app: "elysia-example", pkg: "elysia" },
  { name: "RealWorld on Elysia", app: "elysia-conduit", pkg: "elysia" },
  { name: "Vite + React", app: "spa-example", pkg: "react" },
  { name: "Vite + Svelte", app: "svelte-spa-example", pkg: "svelte" },
  { name: "Postgres", app: "borg-postgres", pkg: "@electric-sql/pglite" },
];

// Reads one field off parsed JSON, or undefined when it isn't there.
const field = (v: unknown, k: string): unknown => (v && typeof v === "object" ? Reflect.get(v, k) : undefined);
const root = `${import.meta.dir}/../..`;
const out = await Promise.all(FRAMEWORKS.map(async (f) => {
  const pj: unknown = await Bun.file(`${root}/${f.app}/package.json`).json();
  const pinned = field(field(pj, "dependencies"), f.pkg) ?? field(field(pj, "devDependencies"), f.pkg);
  if (typeof pinned !== "string") throw new Error(`${f.app} has no ${f.pkg}`);
  const reply: unknown = await (await fetch(`https://registry.npmjs.org/${f.pkg}/latest`)).json();
  const latest = field(reply, "version");
  if (typeof latest !== "string") throw new Error(`npm gave no version for ${f.pkg}`);
  return { ...f, version: pinned.replace(/^[^\d]*/, ""), latest };
}));
await Bun.write(`${import.meta.dir}/../public/frameworks.json`, `${JSON.stringify({ checked: new Date().toISOString().slice(0, 10), frameworks: out }, null, 2)}\n`);
for (const f of out) console.log(`${f.name.padEnd(20)} ${f.version.padEnd(10)} latest ${f.latest}`);
