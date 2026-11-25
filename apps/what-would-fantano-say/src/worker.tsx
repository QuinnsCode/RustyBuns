import { env } from "cloudflare:workers";
import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { handleReview, humanCheckKey } from "./api.ts";
import { handleBoard, handleKeep, handleVote, reviewOf } from "./board.ts";
import { Document } from "./app/Document.tsx";
import { setCommonHeaders } from "./app/headers.ts";
import { Home } from "./app/pages/Home.tsx";

export { ReviewBudget } from "./budget-do.ts";

// One budget for the whole site: every live review asks the same Durable Object.
const budget = env.BUDGET && { take: (cap: number) => env.BUDGET!.get(env.BUDGET!.idFromName("global")).take(cap) };

export default defineApp([
  setCommonHeaders(),
  route("/api/review", {
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- caches.default is Cloudflare's; the app is typed with the DOM's lib, which doesn't have it
    post: ({ request }) => handleReview(request, { ...env, BUDGET: budget }, (caches as unknown as { default: Cache }).default),
  }),
  // Shared reviews: keep one past its day, read the board, and a signed-out visitor's one vote (src/board.ts).
  route("/api/keep", { post: ({ request }) => handleKeep(request, env) }),
  route("/api/board", { get: ({ request }) => handleBoard(request, env) }),
  route("/api/vote", { post: ({ request }) => handleVote(request, env) }),
  // The human check only shows where a review can go live; elsewhere (local dev) it would only fail and lock Judge me.
  render(Document, [route("/", async ({ request }) => {
    // A shared link (/?r=<review>&p=<post>) opens on that review.
    const q = new URL(request.url).searchParams;
    const review = await reviewOf(env.REVIEWS, q.get("r") ?? "");
    const shared = review ? { id: q.get("r")!, post: q.get("p") ?? "", review } : null;
    return <Home siteKey={humanCheckKey({ ...env, BUDGET: budget })} shared={shared} />;
  })]),
]);
