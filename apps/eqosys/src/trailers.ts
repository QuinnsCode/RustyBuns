// Each app's clips: short reels of it being played, cut by scripts/trailers.ts at the repo root into public/trailers/, which
// writes trailers.json. A tile plays its app's first clip on hover; the app's page plays them all (app/trailers.client.ts).
import { arr, check, num, obj, rec, str, type Of } from "@rustybuns/util/guard";
import list from "./trailers.json";

const Clip = obj({ file: str(120, { re: /^[a-z0-9-]+\.mp4$/ }), title: str(60, { min: 1 }), secs: num(0, 300) });
export type Clip = Of<typeof Clip>;
const Clips = rec(arr(Clip, 12), 100);

const ALL = check(Clips, list);
if (!ALL) throw new Error("trailers.json is not a list of clips");

/** An app's clips in the order they play, with each one's address and still. */
export const clipsOf = (id: string) => (ALL[id] ?? []).map((c) => ({ ...c, src: `/trailers/${c.file}`, still: `/trailers/${c.file.replace(/\.mp4$/, ".jpg")}` }));
