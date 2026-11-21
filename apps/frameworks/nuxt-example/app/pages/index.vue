<script setup lang="ts">
// The count is read on the server (useFetch runs during SSR), so the page arrives with it.
const { data } = await useFetch<{ count: number }>("/api/count");
</script>

<template>
  <div>
    <h1 id="count">count: {{ data?.count ?? 0 }}</h1>
    <form method="post" action="/api/increment"><button type="submit">+1</button></form>
  </div>
</template>
