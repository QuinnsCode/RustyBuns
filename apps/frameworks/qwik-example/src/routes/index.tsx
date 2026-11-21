// The page reads the count on the server (a routeLoader$) from the Worker's KV binding, and its
// form posts to a routeAction$ that bumps it. `platform.env` is what Qwik City's Cloudflare
// adapter hands every loader and action; the desktop host backs COUNTER with a folder under
// ~/.qwik-example.
import { component$ } from "@builder.io/qwik";
import { Form, routeAction$, routeLoader$ } from "@builder.io/qwik-city";

export const useCount = routeLoader$(async ({ platform }) => {
  return Number((await platform.env.COUNTER.get("count")) ?? 0);
});

export const useIncrement = routeAction$(async (_, { platform }) => {
  const n = Number((await platform.env.COUNTER.get("count")) ?? 0) + 1;
  await platform.env.COUNTER.put("count", String(n));
  return { count: n };
});

export default component$(() => {
  const count = useCount();
  const increment = useIncrement();
  return (
    <>
      <h1 id="count">count: {count.value}</h1>
      <Form action={increment}>
        <button type="submit">+1</button>
      </Form>
    </>
  );
});
