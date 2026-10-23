// Tells the server you found a hidden game or room (finds.ts), once per spot per page. Resolves to
// {count, total, all} for the account, or null when signed out or offline.
const sent = new Set();
export async function found(key) {
  if (sent.has(key)) return null;
  sent.add(key);
  try {
    const r = await fetch("/api/me/finds", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
