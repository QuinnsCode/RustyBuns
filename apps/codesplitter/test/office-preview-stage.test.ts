// The office-preview stage (#1385): destroying it must never touch what's live, so it shares no name with
// the live stage, adopts nothing of the live Worker's data, and protects nothing.

import { expect, test } from "bun:test";
import { forStage } from "@rustybuns/cli/config";
import config from "../rustybuns.config.ts";

const live = forStage(config, "live");
const preview = forStage(config, "office-preview");
const names = (c: typeof live) => {
  const b = Object.values(c.bindings);
  return [
    c.targets.edge!.workerName,
    ...b.flatMap((x) => (x.type === "d1" ? [x.databaseName] : x.type === "r2" ? [x.bucketName] : x.type === "queue" ? [x.queueName] : x.type === "artifacts" ? [x.namespace] : x.type === "ratelimit" ? [x.namespaceId] : [])),
  ];
};

test("office-preview shares no resource name with the live stage", () => {
  const l = new Set(names(live));
  expect(names(preview).filter((n) => l.has(n))).toEqual([]);
  expect(names(preview)).toHaveLength(names(live).length);
});

test("office-preview takes nothing over from the live Worker, protects nothing and sweeps nothing", () => {
  expect(preview.targets.edge!.renamedFrom).toBeUndefined();
  expect(Object.values(preview.bindings).filter((b) => "protect" in b && b.protect)).toEqual([]);
  expect(preview.worker!.crons).toBeUndefined();
  expect(preview.bindings.BETTER_AUTH_URL).toEqual({ type: "var", value: "https://codesplitter-office-preview.notryanquinn.workers.dev" });
  expect(preview.bindings.TURNSTILE_SITE_KEY).toEqual({ type: "var", value: "" });
});

test("the live stage keeps every database, bucket, KV and index through a destroy", () => {
  const data = Object.entries(live.bindings).filter(([, b]) => ["d1", "r2", "kv", "vectorize"].includes(b.type));
  expect(data.length).toBeGreaterThan(0);
  expect(data.filter(([, b]) => !("protect" in b && b.protect)).map(([n]) => n)).toEqual([]);
});
