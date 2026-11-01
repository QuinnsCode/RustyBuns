import { expect, test } from "bun:test";
import { partyCode, roomUrl } from "../src/net/lobby.ts";

test("a started party moves everyone from ?party= to ?room= on the same level", () => {
  expect(partyCode("?level=el-capitan&party=krtz")).toBe("KRTZ");
  expect(partyCode("?party=no")).toBeNull();
  expect(roomUrl("?level=el-capitan&party=KRTZ", "KRTZ")).toBe("?level=el-capitan&room=KRTZ");
});
