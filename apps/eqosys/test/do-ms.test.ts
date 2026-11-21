// scripts/do-ms.ts: Cloudflare's per-day DO rows sum to active ms per socket message for each namespace, quiet
// namespaces are left out, and a reply without the DO dataset (a token with no analytics scope) is refused.
import { expect, test } from "bun:test";
import { check } from "@rustybuns/util/guard";
import { Periodic, msPerMessage } from "../scripts/do-ms.ts";

const row = (namespaceId: string, activeTime: number, inboundWebsocketMsgCount: number) =>
  ({ dimensions: { namespaceId }, sum: { activeTime, inboundWebsocketMsgCount } });
const reply = (rows: unknown[]) => ({ data: { viewer: { accounts: [{ durableObjectsPeriodicGroups: rows }] } } });

test("two days of a relay room sum to ms per message; a quiet namespace is left out", () => {
  const r = check(Periodic, reply([row("a", 30_000_000, 400_000), row("a", 20_000_000, 100_000), row("b", 9_000, 12)]))!;
  expect(msPerMessage(r, new Map([["a", "mythic Room"]]))).toEqual([{ ns: "mythic Room", msgs: 500_000, ms: 0.1 }]);
});

test("a reply without the DO dataset is refused", () => {
  expect(check(Periodic, { data: null, errors: [{ message: "not authorized" }] })).toBeNull();
  expect(check(Periodic, reply([{ dimensions: {}, sum: {} }]))).toBeNull();
});
