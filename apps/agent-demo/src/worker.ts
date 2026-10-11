import { banner, total, vote, type Votes } from "./tally.ts";

// One room's votes, kept in memory: enough for a demo, gone on a cold start.
let votes: Votes = {};

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname.startsWith("/vote/")) {
      try { votes = vote(votes, url.pathname.slice(6)); } catch (e) { return new Response(String(e), { status: 400 }); }
    }
    if (url.pathname === "/tally") return Response.json({ votes, total: total(votes), banner: banner(votes) });
    return new Response(`<h1>${banner(votes)}</h1><p>${total(votes)} votes</p>`, { headers: { "content-type": "text/html" } });
  },
};
