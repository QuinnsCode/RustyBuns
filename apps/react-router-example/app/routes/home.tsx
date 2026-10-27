// The sample app contract (FRAMEWORKS.md): the loader reads the count from the COUNTER KV binding,
// the action bumps it and sends the browser back to `/`. Both run on the server, through the
// `context.cloudflare` the Worker entry passes in, as they would on Cloudflare.
import { Form, redirect, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

const count = async (env: Env) => Number((await env.COUNTER.get("count")) ?? 0);

export async function loader({ context }: LoaderFunctionArgs) {
  return { count: await count(context.cloudflare.env) };
}

export async function action({ context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  await env.COUNTER.put("count", String((await count(env)) + 1));
  return redirect("/");
}

export default function Home() {
  const { count } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1 id="count">count: {count}</h1>
      {/* <Form> posts to `/?index`: a bare <form> would aim the POST at the parent route, which has no action (405). */}
      <Form method="post">
        <button type="submit">+1</button>
      </Form>
    </main>
  );
}
