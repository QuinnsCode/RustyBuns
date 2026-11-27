// Where a visit lands: the bare address opens the front door (the paths), /paths does too, the desk lives at /desk and
// hands out a new sesh, and an old /?room= link still finds its sesh.
import { expect, test } from "bun:test";
import worker from "../src/worker.ts";
import { DOOR } from "../src/paths.ts";

test("/ and /paths land on the front door; /desk and old ?room= links open a sesh", async () => {
  const env = {} as Parameters<typeof worker.fetch>[1];
  const at = async (path: string) => {
    const r = await worker.fetch(new Request(`https://fm-daw.test${path}`), env);
    return { status: r.status, to: new URL(r.headers.get("Location") ?? "", "https://fm-daw.test").pathname };
  };
  expect(await at("/")).toEqual({ status: 302, to: DOOR });
  expect(await at("/paths")).toEqual({ status: 302, to: DOOR });
  expect(await at("/?room=Old%20Groove")).toEqual({ status: 302, to: "/sesh/old-groove" });
  const desk = await at("/desk");
  expect(desk.status).toBe(302);
  expect(desk.to).toMatch(/^\/sesh\/[a-z]+-[a-z]+-[a-z]+$/);
});
