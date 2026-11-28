"use server";
// Runs on the Bun host. The page imports these and calls them like local functions.
import { arr, num } from "@rustybuns/util/guard";
import { callPython } from "../python/call.ts";
import { About, Summary } from "../shapes.ts";

const Numbers = arr(num(-Number.MAX_VALUE, Number.MAX_VALUE), 10_000);

export async function about(): Promise<About> {
  return callPython("about", [], About);
}

export async function summarize(numbers: number[]): Promise<Summary> {
  return callPython("summarize", [Numbers(numbers)], Summary);
}
