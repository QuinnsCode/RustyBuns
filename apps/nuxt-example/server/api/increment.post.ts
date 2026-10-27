export default defineEventHandler(async (event) => {
  const n = (await readCount(event)) + 1;
  await counter(event).put("count", String(n));
  return sendRedirect(event, "/", 303);
});
