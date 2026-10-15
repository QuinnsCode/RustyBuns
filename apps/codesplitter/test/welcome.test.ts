// The welcome tour (scripts/welcome.ts) is the new user's first five minutes: it must hold from dig-up to deploy verdict.
import { expect, test } from "bun:test";
import { local } from "./app-kit.ts";
import { tour } from "../scripts/welcome.ts";

test("the tour digs up hello-world, survives the firehose, settles a clash and reads the fit", async () => {
  const call = await local({ GH_CLI: "off" });
  const said: string[] = [];
  const r = await tour(call, { pace: 0, rounds: 1, say: (who, what) => said.push(`${who} ${what}`) });
  expect(r.landed).toBe(8);
  expect(r.conflicted).toBe(true);
  expect(r.waves).toBe(2);
  const tree = await (await call("ryan", "/api/repos/ryan/hello-world/tree?path=src")).json() as { entries: { name: string }[] };
  expect(tree.entries.map((e) => e.name)).toContain("greeting.ts");
});
