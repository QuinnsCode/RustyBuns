import { env } from "cloudflare:workers";
import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { handleReview, humanCheckKey } from "./api.ts";
import { Document } from "./app/Document.tsx";
import { setCommonHeaders } from "./app/headers.ts";
import { Home } from "./app/pages/Home.tsx";

export { ReviewBudget } from "./budget-do.ts";

// One budget for the whole site: every live review asks the same Durable Object.
const budget = env.BUDGET && { take: (cap: number) => env.BUDGET!.get(env.BUDGET!.idFromName("global")).take(cap) };

export default defineApp([
  setCommonHeaders(),
  route("/api/review", {
    post: ({ request }) => handleReview(request, { ...env, BUDGET: budget }, (caches as unknown as { default: Cache }).default),
  }),
  // The human check only shows where a review can go live; elsewhere (local dev) it would only fail and lock Judge me.
  render(Document, [route("/", () => <Home siteKey={humanCheckKey({ ...env, BUDGET: budget })} />)]),
]);
