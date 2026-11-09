// Super Spy Splat Shot's party against a live eqosys and the live game (Part of #3462), so nobody needs two browsers before
// a go-live: two friends sign up through the game, open a party, both ready, the host starts, and both walk into the
// game's room named after the party with their eqosys tokens: the safehouse shows them by their account names, and the
// host's start begins the mission for the two of them with no bots. Every account is deleted after, passed or failed.
//   bun apps/eqosys/scripts/live-check-splat-spray.ts --url https://eqosys.qntbr.com [--game https://supersplatspyshot.notryanquinn.workers.dev]
// The game checks tokens against the eqosys it is built for (EQOSYS in its src/eqosys.ts), so --url has to be that one.
import { PartyMsg } from "@rustybuns/util/eqosys";
import type { Guard } from "@rustybuns/util/guard";
import { parseServerMsg, type View } from "../../splat-spray/src/match/game.ts";
import { arg, liveCheck, step, until, type Person } from "./live-kit.ts";

const APP = "splat-spray";
const GAME = arg("game", "https://supersplatspyshot.notryanquinn.workers.dev")!.replace(/\/+$/, "");
const Frame: Guard<View> = (v) => { const m = parseServerMsg(v); if (!m) throw new Error("not a game view"); return m.view; };

/** The game's room socket as its page opens it: the room, the token in place of a guest uid, from the game's own origin. */
function room(code: string, p: Person) {
  const views: View[] = [];
  let bad = "";
  // @ts-expect-error Bun's WebSocket takes headers; the DOM type does not
  const ws = new WebSocket(`${GAME.replace(/^http/, "ws")}/ws?${new URLSearchParams({ room: code, token: p.token, name: "ignored" })}`, { headers: { origin: GAME } });
  ws.onmessage = (e) => { try { views.push(Frame(JSON.parse(String(e.data)))); } catch { bad = String(e.data).slice(0, 200); } };
  ws.onclose = (e) => { if (e.code !== 1000 && e.code !== 1005) bad ||= `closed ${e.code} ${e.reason}`; };
  const opened = new Promise<void>((yes, no) => { ws.onopen = () => yes(); ws.onerror = () => no(new Error(`the game's room ${code} didn't open for ${p.name}`)); });
  const last = () => { if (bad) throw new Error(`${p.name}'s room: ${bad}`); return views.at(-1); };
  return { ws, opened, last, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

await liveCheck("Super Spy Splat Shot party live check", async ({ signUp, socket, mintParty, befriend }) => {
  const a = await step("A (the host) signs up through Super Spy Splat Shot", () => signUp("Ada", APP));
  const b = await step("B signs up through Super Spy Splat Shot", () => signUp("Bo", APP));
  await step("A and B become friends", () => befriend(a, b));

  const code = await step("A opens a party for friends", () => mintParty(a));
  const pa = socket(`/q/party/${code}`, a, PartyMsg), pb = socket(`/q/party/${code}`, b, PartyMsg);
  await step("both join it by code and see each other in the lobby", async () => {
    await Promise.all([pa.opened, pb.opened]);
    const names = (s: typeof pa) => s.last((m) => m.t === "members" ? m.members.map((x) => x.name).sort().join() : undefined);
    await until("both in both lobbies", () => names(pa) === "Ada,Bo" && names(pb) === "Ada,Bo");
  });

  const partyRoom = await step("both ready, the host starts, and both are sent to the party's room", async () => {
    pa.send({ t: "ready", ready: true });
    pb.send({ t: "ready", ready: true });
    await until("both ready", () => !!pa.last((m) => m.t === "members" ? m.members.length === 2 && m.members.every((x) => x.ready) : undefined));
    pa.send({ t: "start" });
    const start = (s: typeof pa) => s.last((m) => m.t === "start" ? m : undefined);
    await until("both starts", () => !!start(pa) && !!start(pb));
    const sa = start(pa)!, sb = start(pb)!;
    if (sa.room !== code || sb.room !== code) throw new Error(`started rooms ${sa.room} and ${sb.room}, not the party's ${code}`);
    if (sa.seat !== 0) throw new Error(`the host was given seat ${sa.seat}, not 0, so their page wouldn't start the mission`);
    return sa.room;
  });

  const ra = room(partyRoom, a), rb = room(partyRoom, b);
  await step("both walk into the game's safehouse under their account names", async () => {
    await Promise.all([ra.opened, rb.opened]);
    const names = (r: typeof ra) => r.last()?.players.filter((p) => p.online).map((p) => p.name).sort().join();
    await until("both in the safehouse", () => ra.last()?.phase === "lobby" && names(ra) === "Ada,Bo" && names(rb) === "Ada,Bo");
  });

  await step("the host's start begins the mission for the two of them, no bots", async () => {
    ra.send({ t: "start" });
    await until("the countdown on both", () => ra.last()?.phase === "countdown" && rb.last()?.phase === "countdown");
    const n = rb.last()!.players.length;
    if (n !== 2) throw new Error(`the race has ${n} agents, not the 2 friends`);
  });
  ra.ws.close(); rb.ws.close();
});
