// Two Fronts' party seats against a live eqosys and Two Fronts (#3895), so nobody needs two browsers before a go-live:
// two friends open a party, both ready, the host starts, each claims the seat its start ticket names in the same war;
// a third account (and one holding a friend's ticket) is refused; the host sets Chat to Only the host and the friend's
// message is refused. Every account is deleted after, passed or failed.
//   bun apps/eqosys/scripts/live-check-two-fronts.ts --url https://eqosys.qntbr.com [--game https://two-fronts.notryanquinn.workers.dev]
// Two Fronts checks tickets against the eqosys it is built for (EQOSYS in its src/account.ts), so --url has to be that one.
import { PartyMsg } from "@rustybuns/util/eqosys";
import { check, obj, str } from "@rustybuns/util/guard";
import { readJson } from "@rustybuns/util/http";
import { arg, liveCheck, step, until, type Person } from "./live-kit.ts";

const APP = "two-fronts";
const GAME = arg("game", "https://two-fronts.notryanquinn.workers.dev")!.replace(/\/+$/, "");
/** What Two Fronts answers a party's seat ask (`Claimed` in apps/two-fronts/src/edge/view.ts), or why not. */
const Claimed = obj({ id: str(200), token: str(1000), faction: str(40) });
const Refused = obj({ error: str(1000) });

/** Ask Two Fronts for the seat a start ticket names, as the game's page does on start. */
const claim = (p: Person, room: string, seat: number, ticket?: string) => fetch(`${GAME}/api/parties/${room}`, {
  method: "POST", headers: { "content-type": "application/json", "x-eqosys-token": p.token, origin: p.origin },
  body: JSON.stringify({ seat, side: "marines", galaxy: "intro", ...(ticket && { ticket }) }),
});

await liveCheck("Two Fronts party seats live check", async ({ signUp, socket, mintParty, befriend }) => {
  const a = await step("A (the host) signs up through Two Fronts", () => signUp("Ada", APP));
  const b = await step("B signs up through Two Fronts", () => signUp("Bo", APP));
  const c = await step("C, not in the party, signs up through Two Fronts", () => signUp("Cy", APP));
  await step("A and B become friends", () => befriend(a, b));

  const code = await step("A opens a party for friends", () => mintParty(a));
  const pa = socket(`/q/party/${code}`, a, PartyMsg), pb = socket(`/q/party/${code}`, b, PartyMsg);
  const names = (s: typeof pa) => s.last((m) => m.t === "members" ? m.members.map((x) => x.name).sort().join() : undefined);
  await step("both join it by code and see each other in the lobby", async () => {
    await Promise.all([pa.opened, pb.opened]);
    await until("both in A's lobby", () => names(pa) === "Ada,Bo");
    await until("both in B's lobby", () => names(pb) === "Ada,Bo");
  });

  const starts = await step("both ready, the host starts, and each gets a start ticket", async () => {
    pa.send({ t: "ready", ready: true });
    pb.send({ t: "ready", ready: true });
    const allReady = (s: typeof pa) => () => !!s.last((m) => m.t === "members" ? m.members.every((x) => x.ready) && m.members.length === 2 : undefined);
    await until("both ready", allReady(pa));
    pa.send({ t: "start" });
    const start = (s: typeof pa) => s.last((m) => m.t === "start" ? m : undefined);
    await until("A's start", () => !!start(pa));
    await until("B's start", () => !!start(pb));
    const sa = start(pa)!, sb = start(pb)!;
    if (sa.room !== code || sb.room !== code) throw new Error(`started rooms ${sa.room} and ${sb.room}, not the party's ${code}`);
    if (!sa.ticket || !sb.ticket) throw new Error("a start came without a ticket: eqosys has no signing key");
    if (sa.seat === sb.seat) throw new Error(`both were given seat ${sa.seat}`);
    return { a: { seat: sa.seat, ticket: sa.ticket }, b: { seat: sb.seat, ticket: sb.ticket } };
  });

  await step("each claims its own seat in the same war", async () => {
    const got = [];
    for (const [p, s] of [[a, starts.a], [b, starts.b]] as const) {
      const r = await claim(p, code, s.seat, s.ticket);
      const seat = await readJson(r.clone(), Claimed);
      if (!seat) throw new Error(`${p.name}'s seat ask answered ${r.status}: ${check(Refused, await r.json().catch(() => null))?.error ?? "something else"}`);
      got.push(seat);
    }
    if (got[0]!.id !== got[1]!.id) throw new Error(`two wars: ${got[0]!.id} and ${got[1]!.id}`);
    if (got[0]!.faction === got[1]!.faction) throw new Error(`both sides are ${got[0]!.faction}`);
  });

  await step("C, not in the party, is told to join the party to take a seat (with no ticket, and with B's)", async () => {
    for (const ticket of [undefined, starts.b.ticket]) {
      const r = await claim(c, code, starts.b.seat, ticket);
      const why = check(Refused, await r.json().catch(() => null))?.error ?? "";
      if (r.status !== 403 || !why.startsWith("Join the party to take a seat")) throw new Error(`answered ${r.status} "${why}"${ticket ? " with B's ticket" : ""}`);
    }
  });

  await step("the host sets Chat to Only the host; B's message is refused and A's goes through", async () => {
    const rules = pa.last((m) => m.t === "rules" ? m.rules : undefined);
    if (!rules) throw new Error("A's lobby never sent its rules");
    pa.send({ t: "rules", rules: { ...rules, chat: "host" } });
    await until("B to hear the new rules", () => pb.last((m) => m.t === "rules" ? m.rules.chat : undefined) === "host");
    pb.send({ t: "say", text: "can I talk?" });
    await until("B's message to be refused", () => pb.last((m) => m.t === "refused" ? m.why : undefined) === "only the host talks in this party");
    pa.send({ t: "say", text: "only me" });
    await until("B to hear A", () => pb.last((m) => m.t === "say" ? m.text : undefined) === "only me");
    if (pa.got.some((m) => m.t === "say" && m.text === "can I talk?")) throw new Error("A heard B's refused message");
  });
});
