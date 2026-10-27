// The sample-app contract (FRAMEWORKS.md): the count, read from KV on the server on every request,
// and a plain form that posts to the route handler in app/increment/route.ts.
import { readCount } from "./counter.ts";

export const dynamic = "force-dynamic";

export default async function Page() {
  const n = await readCount();
  return (
    <main>
      <h1 id="count">count: {n}</h1>
      <form method="post" action="/increment">
        <button type="submit">+1</button>
      </form>
    </main>
  );
}
