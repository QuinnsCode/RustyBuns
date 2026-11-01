// Playing with friends goes through Qollab's party: its codes are rooms here, and the host gets to the World first.
import { expect, test } from "bun:test";
import { ROOM } from "../src/api.ts";
import { arriveIn, partyCode } from "../src/ui/lobby.ts";

test("a party's code is a room the World accepts, and the link's code is read back", () => {
  // Qollab mints six letters with no vowels (apps/eqosys/src/party.ts).
  expect(ROOM.test("BCDFGH")).toBe(true);
  expect(partyCode("?party=bcdfgh&x=1")).toBe("BCDFGH");
  expect(partyCode("?party=no")).toBeNull();
  expect(partyCode("?room=PIKA")).toBeNull();
});

test("the host walks in first, the others after, in seat order", () => {
  const seats = [0, 1, 2, 3, 4, 5].map(arriveIn);
  expect(seats[0]).toBe(0);
  expect(seats).toEqual([...seats].sort((a, b) => a - b));
  expect(new Set(seats).size).toBe(seats.length);
});
