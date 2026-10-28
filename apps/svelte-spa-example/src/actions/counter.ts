"use server";
// Runs on the desktop host (Bun), not in the page: the SPA has no Worker, so the count lives in a file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".svelte-spa-example");
const file = join(dir, "count.json");

export async function getCount(): Promise<number> {
  return existsSync(file) ? Number(JSON.parse(readFileSync(file, "utf8")).count) || 0 : 0;
}

export async function increment(): Promise<number> {
  const count = (await getCount()) + 1;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ count }));
  return count;
}
