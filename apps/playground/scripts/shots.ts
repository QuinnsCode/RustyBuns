// Copies eqosys's card screenshots (apps/eqosys/public/cards/<app>.jpg) next to the page as public/shots/<app>.jpg,
// so each card here shows the same picture as on eqosys. Run `bun run shots` after eqosys gets a new one.
import { cpSync, mkdirSync, readdirSync } from "node:fs";

const from = `${import.meta.dir}/../../eqosys/public/cards`;
const to = `${import.meta.dir}/../public/shots`;
mkdirSync(to, { recursive: true });
const jpgs = readdirSync(from).filter((f) => f.endsWith(".jpg"));
for (const f of jpgs) cpSync(`${from}/${f}`, `${to}/${f}`);
console.log(`${jpgs.length} screenshots copied to public/shots`);
