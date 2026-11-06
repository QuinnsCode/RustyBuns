const w = ms => new Promise(r => setTimeout(r, ms)), m = mythicMasters;
await m.journey.begin(['hodag', 'squonk', 'agropelter']);
for (let i = 0; i < 10; i++) {
  await w(1000); m.director.skip?.(); m.director.cut?.();
  const b = m.book?.state?.(); const opt = b?.options?.[0]?.id ?? b?.answers?.[0]?.id;
  if (opt) m.book.answer(opt); else m.book?.close?.();
}
m.world.peace?.(true);
const p = m.world.places(1)[0]; m.world.teleport(p.x + 12, p.z + 12);
m.world.setHour(11); m.world.setWeather({ rain: 0, snow: 0, mist: 0 }); await w(8000);
const s = m.world.state(); return { name: s.name, plants: s.plants, far: s.far, book: JSON.stringify(m.book?.state?.()).slice(0, 200) };
