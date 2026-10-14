// Lucide ships ~1,500 icons as one 358 KB file; the pages use a few dozen. Scan the source for
// every quoted kebab-case word that names an icon and bundle just those, exposed as the same
// `window.lucide` ({ icons, createElement, createIcons }) the pages already call.
import { readdir, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";

const lucideDir = dirname(require.resolve("lucide")); // dist/cjs/lucide.cjs or similar
const iconFile = (n: string) => join(lucideDir, "..", "esm", "icons", `${n}.js`);

const pascal = (n: string) => n.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase());

export async function usedIcons(srcDir: string): Promise<string[]> {
  const found = new Set<string>();
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(html|ts|js)$/.test(e.name)) {
        for (const m of (await readFile(p, "utf8")).matchAll(/["'`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)["'`]/g)) if (existsSync(iconFile(m[1]!))) found.add(m[1]!);
      }
    }
  };
  await walk(srcDir);
  return [...found].sort();
}

export async function buildLucide(srcDir: string, outFile: string, scratch: string): Promise<number> {
  const names = await usedIcons(srcDir);
  await mkdir(scratch, { recursive: true });
  const entry = join(scratch, "lucide-entry.ts");
  const esm = join(lucideDir, "..", "esm");
  await Bun.write(entry, [
    `import createElement from ${JSON.stringify(join(esm, "createElement.js"))};`,
    `import { createIcons } from ${JSON.stringify(join(esm, "lucide.js"))};`,
    ...names.map((n) => `import ${pascal(n)} from ${JSON.stringify(iconFile(n))};`),
    `const icons = { ${names.map(pascal).join(", ")} };`,
    `(globalThis as any).lucide = { icons, createElement, createIcons: (o?: object) => createIcons({ icons, ...o }) };`,
  ].join("\n"));
  const r = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife", minify: true });
  if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
  await Bun.write(outFile, await r.outputs[0]!.text());
  return names.length;
}
