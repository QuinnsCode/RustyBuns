export default defineEventHandler(async (event) => ({ count: await readCount(event) }));
