// The friends journey against a live eqosys, so nobody clicks through it by hand before a go-live (Part of #3898):
// two throwaway accounts sign up through a game, become friends, see each other online on the hub socket (eqosys's
// front door into Qollab), meet in a party by code, unfriend, and are deleted again, so it is safe on production too.
//   bun apps/eqosys/scripts/live-check.ts --url https://eqosys-preview.qntbr.com
// One line a step; the first failure says where and exits 1 (the accounts are still deleted).
import { PartyMsg } from "@rustybuns/util/eqosys";
import { HubOut, liveCheck, step, until, type Person } from "./live-kit.ts";

// A game, so the party is its own: the token's app is the one whose pages may open its sockets.
const APP = "park-hide-seek";

await liveCheck("eqosys live check", async ({ signUp, hub, socket, mintParty, closeSockets }) => {
  const a = await step("A signs up through the game and gets a token", () => signUp("Ada", APP));
  const b = await step("B signs up through the game and gets a token", () => signUp("Bo", APP));

  await step("A asks B by email; A's list shows the email typed", async () => {
    const s = await hub(a, { op: "befriend", email: b.email.toUpperCase() });
    if (!s.outgoing.some((o) => o.name.toLowerCase() === b.email)) throw new Error(`A's outgoing is ${JSON.stringify(s.outgoing)}`);
  });
  await step("B sees A's request", async () => {
    const s = await hub(b, { op: "state" });
    if (!s.incoming.some((i) => i.id === a.id)) throw new Error(`B's incoming is ${JSON.stringify(s.incoming)}`);
  });
  await step("B accepts", async () => {
    const s = await hub(b, { op: "accept", id: a.id });
    if (!s.friends.some((f) => f.id === a.id)) throw new Error(`B's friends after accepting are ${JSON.stringify(s.friends)}`);
  });
  await step("both see each other as friends", async () => {
    await until("A to see B as a friend", async () => (await hub(a, { op: "state" })).friends.some((f) => f.id === b.id && f.name === b.name));
    await until("B to see A as a friend", async () => (await hub(b, { op: "state" })).friends.some((f) => f.id === a.id && f.name === a.name));
  });

  await step("both open the hub socket and see the other online", async () => {
    const ha = socket("/hub", a, HubOut), hb = socket("/hub", b, HubOut);
    await Promise.all([ha.opened, hb.opened]);
    const online = (s: typeof ha, friend: Person) => () =>
      !!s.last((m) => m.t === "state" ? m.state : undefined)?.friends.some((f) => f.id === friend.id && f.presence.some((p) => p.app === APP));
    await until("A to see B online", online(ha, b));
    await until("B to see A online", online(hb, a));
  });

  await step("A opens a party and B joins it by code; both see two members", async () => {
    const code = await mintParty(a, true);
    const pa = socket(`/q/party/${code}`, a, PartyMsg);
    await pa.opened;
    const pb = socket(`/q/party/${code.toLowerCase()}`, b, PartyMsg);
    await pb.opened;
    const both = (s: typeof pa) => () =>
      s.last((m) => m.t === "members" ? m.members.map((x) => x.name).sort().join() : undefined) === [a.name, b.name].sort().join();
    await until("A to see both in the party", both(pa));
    await until("B to see both in the party", both(pb));
  });
  closeSockets();

  await step("A unfriends B; neither lists the other", async () => {
    const s = await hub(a, { op: "drop", id: b.id });
    if (s.friends.length) throw new Error(`A still lists ${JSON.stringify(s.friends)}`);
    await until("B's list to lose A", async () => (await hub(b, { op: "state" })).friends.length === 0);
  });
});
