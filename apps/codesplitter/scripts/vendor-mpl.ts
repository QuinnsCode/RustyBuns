// `bun scripts/vendor-mpl.ts <mpl checkout>`: bundles mpljs (github.com/ivarvong/mpl, ISC) into vendor/mpl/, the one module
// a code-mode program imports as `mpl` (#5402). Check out the commit you want first (`git clone` + `git checkout <sha>`);
// the sha, LICENSE and THIRD_PARTY_NOTICES.md are copied beside it. The default entry: DejaVu Sans and viridis built in.
//
// Two things in mpl would stop an isolated Worker (globalOutbound: null) loading it, and are rewritten here:
// - the tracer's flush(path) does `await import('node:fs/promises')`: stubbed to throw (a program has no file system);
// - the local loader's wall (`walled` in packages/shell-bun) refuses the words `module` and `globalThis` anywhere,
//   so a few field names and doc links are renamed. Each rewrite says how many it expects, so a new mpl that changes
//   them fails here instead of shipping something the wall turns away.
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { walled } from "../../../packages/shell-bun/src/bindings/worker-loader.ts";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);
const src = process.argv[2];
if (!src) { console.error("usage: bun scripts/vendor-mpl.ts <mpl checkout>"); process.exit(1); }
const out = join(import.meta.dir, "../vendor/mpl");
const sha = (await Bun.$`git -C ${src} rev-parse HEAD`.text()).trim();
const version: string = (await Bun.file(join(src, "package.json")).json()).version;

const built = await Bun.build({
  entrypoints: [join(src, "src/index.ts")], target: "browser", format: "esm", minify: true,
  plugins: [{ name: "no-trace-fs", setup(b) {
    b.onLoad({ filter: /src\/trace\.ts$/ }, async (a) => {
      const t = await Bun.file(a.path).text();
      const s = t.replace("const fs = await import('node:fs/promises');",
        "const fs = { appendFile: async (_p: string, _s: string): Promise<void> => { throw new Error('mpl: the tracer has no file system here'); } };");
      if (s === t) throw new Error("src/trace.ts changed: the flush stub no longer applies");
      return { contents: s, loader: "ts" };
    });
  } }],
});
if (!built.success) { console.error(built.logs); process.exit(1); }
let js = await built.outputs[0]!.text();

/** Replace every match, failing unless there were exactly `n`. */
const swap = (re: RegExp, to: string, n: number) => {
  const got = js.match(re)?.length ?? 0;
  if (got !== n) throw new Error(`expected ${n} of ${re}, found ${got}: mpl changed, look again`);
  js = js.replace(re, to);
};
swap(/#module-matplotlib\.\w+/g, "", 4);                  // doc links in the bundled matplotlibrc text
swap(/(?<![\w$.])module(?=[:;=])/g, "fontModule", 11);    // the font registry's field and its errors' class fields
swap(/\.module(?![\w$])/g, ".fontModule", 5);            // ...and where they are set and read
swap(/Reflect\.apply\((\w+),globalThis,/g, "Reflect.apply($1,void 0,", 1); // autopct called with no `this`

const why = walled({ "program.js": `import * as mpl from "./mpl.js"; export default { mpl };`, "mpl.js": js });
if (why) throw new Error(`the bundle still can't load in an isolated Worker: ${why}`);

mkdirSync(out, { recursive: true });
const head = `// mpljs ${version} (github.com/ivarvong/mpl @ ${sha}, ISC: LICENSE here), bundled by scripts/vendor-mpl.ts. Don't edit: rerun it.\n`;
await Bun.write(join(out, "mpl.ts"), `${head}export const MPL_VERSION = ${JSON.stringify(`${version}+${sha.slice(0, 12)}`)};\n/** The bundle's source, one ES module a code-mode program imports as \`./mpl.js\`. */\nexport const MPL_JS = ${JSON.stringify(js)};\n`);
for (const f of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) cpSync(join(src, f), join(out, f));
console.log(`vendor/mpl/mpl.ts: mpl ${version} @ ${sha.slice(0, 12)}, ${(js.length / 1024).toFixed(0)} KiB, ${(Bun.gzipSync(js).length / 1024).toFixed(0)} KiB gzip`);
