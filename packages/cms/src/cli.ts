// bun packages/cms/src/cli.ts <dir> [--title "Two Fronts"] [--port 4700]
import { resolve } from "node:path";
import { serveCms } from "./index.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const dir = resolve(args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "content");
const title = flag("title") ?? "Script";
const port = Number(flag("port") ?? 4700);
const server = serveCms({ dir, title, port });
console.log(`${title}: editing ${dir} at http://localhost:${server.port}`);
