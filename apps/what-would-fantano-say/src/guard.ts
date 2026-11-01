// The door in front of the one paid call: Turnstile proves a person pressed the
// button, and a YouTube link only ever becomes a fixed oEmbed URL (no fetching
// whatever someone pastes).

export async function turnstileOk(secret: string, token: string, ip: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!token) { console.warn("turnstile: no token sent (widget not solved or script blocked)"); return false; }
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);
  const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  if (!res.ok) { console.warn(`turnstile: siteverify HTTP ${res.status}`); return false; }
  const out: unknown = await res.json().catch(() => null);
  const ok = typeof out === "object" && out !== null && "success" in out && out.success === true;
  // Codes like invalid-input-secret (secret doesn't match the site key), timeout-or-duplicate
  // (token reused or older than 5 min) or invalid-input-response say which fix is needed.
  if (!ok) console.warn("turnstile: siteverify said no", JSON.stringify(typeof out === "object" && out !== null && "error-codes" in out ? out["error-codes"] : out));
  return ok;
}

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

/** The 11-character video id from a YouTube link, or null. */
export function youtubeId(link: string): string | null {
  let u: URL;
  try { u = new URL(link); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!YT_HOSTS.has(u.hostname)) return null;
  const id = u.hostname === "youtu.be" ? u.pathname.slice(1) : u.pathname.startsWith("/shorts/") ? u.pathname.slice(8) : u.searchParams.get("v") ?? "";
  return /^[\w-]{11}$/.test(id) ? id : null;
}

/** "Title, by channel" from YouTube's public oEmbed, or null. No key, no download. */
export async function youtubeTitle(id: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const res = await fetcher(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; author_name?: string };
  return j.title ? `${j.title}${j.author_name ? `, by ${j.author_name}` : ""}` : null;
}
