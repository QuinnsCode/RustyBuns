// A worker for priority.test.ts: answers each message with how many it has seen,
// spins forever on "spin" and throws on "throw".
let seen = 0;
self.onmessage = (e: MessageEvent) => {
  if (e.data === "spin") for (;;);
  if (e.data === "throw") throw new Error("thrown in the worker");
  postMessage({ seen: ++seen, echo: e.data });
};
