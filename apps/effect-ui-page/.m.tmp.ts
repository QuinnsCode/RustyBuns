const m = await import("./test/session.ts");
const r = await m.measure();
console.log(m.table(r));
console.log(JSON.stringify(r.map((x) => [x.refused.map((c) => c.reply), x.world === m.TALLER])));
process.exit(0);
