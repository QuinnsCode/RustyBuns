// The cable feel test as one self-contained HTML file, for an artifact the owner plays in the browser:
//
//   bun apps/load-in/scripts/feel-page.ts <out.html>
//
// It bundles src/feel/main.ts (three.js included) and inlines it into the marked parts of feel.html
// (between <!--page--> and <!--/page-->: an artifact page brings no <html>, <head> or <body> of its own), with the
// shared look (src/paper.css) inlined in place of its link.
// Publish the file it writes to the same artifact to update it (the link is in #5029).
import { join } from "node:path";

const out = process.argv[2];
if (!out || out === "--help") {
  console.log((await Bun.file(import.meta.path).text()).split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(out ? 0 : 1);
}
const app = join(import.meta.dir, "..");
const built = await Bun.build({ entrypoints: [join(app, "src/feel/main.ts")], minify: true, target: "browser" });
if (!built.success) throw new AggregateError(built.logs, "the feel page did not bundle");
const js = await built.outputs[0]!.text(), html = await Bun.file(join(app, "feel.html")).text();
const parts = [...html.matchAll(/<!--page-->([\s\S]*?)<!--\/page-->/g)].map((m) => m[1]!);
const tag = `<script type="module" src="/src/feel/main.ts"></script>`;
if (parts.length !== 2 || !parts[1]!.includes(tag)) throw new Error("feel.html lost its <!--page--> marks or its script tag");
const look = `<link rel="stylesheet" href="/src/paper.css">`, css = await Bun.file(join(app, "src/paper.css")).text();
if (!parts[0]!.includes(look)) throw new Error("feel.html no longer links src/paper.css (the shared look)");
await Bun.write(out, parts.join("\n").replace(look, () => `<style>\n${css}\n</style>`).replace(tag, () => `<script type="module">\n${js.replaceAll("</script", "<\\/script")}\n</script>`));
console.log(`${out}: ${(js.length / 1e6).toFixed(2)} MB of script`);
