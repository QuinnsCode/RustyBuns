<script lang="ts">
  import { getCount, increment } from "./actions/counter.ts";

  let count = $state<number | null>(null);
  getCount().then((n) => (count = n));
</script>

<h1 id="count">count: {count ?? "…"}</h1>
<button onclick={async () => (count = await increment())}>increment</button>
