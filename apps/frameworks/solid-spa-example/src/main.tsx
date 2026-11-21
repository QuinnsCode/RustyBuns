import { render } from "solid-js/web";
import { createResource } from "solid-js";
import { getCount, increment } from "./actions/counter.ts";

function App() {
  const [count, { mutate }] = createResource(getCount);
  return (
    <>
      <h1 id="count">count: {count() ?? "…"}</h1>
      <button onClick={async () => mutate(await increment())}>increment</button>
    </>
  );
}

render(() => <App />, document.getElementById("app")!);
