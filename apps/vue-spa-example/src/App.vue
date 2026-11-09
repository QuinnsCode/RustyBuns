<script setup lang="ts">
import { ref } from "vue";
import { getCount, increment } from "./actions/counter.ts";

const count = ref<number | null>(null);
getCount().then((n) => (count.value = n));
</script>

<template>
  <h1 id="count">count: {{ count ?? "…" }}</h1>
  <button @click="increment().then((n) => (count = n))">increment</button>
</template>
