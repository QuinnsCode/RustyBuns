// Builds the boxes' real side from the critic's actual reviews, offline and once:
//
//   bun scripts/build-boxes.ts [reviews.csv] [--transcripts data/transcripts]
//
// Scores come from andrewjleung/tnd-reviews (MIT), a public CSV of ~2,650 scored reviews
// with genres, pinned to one commit and checked by hash. It's fetched from GitHub if no
// local copy is given. Takes come from transcripts you pulled by hand into
// data/transcripts/ ("Artist - Title.txt"); that folder is gitignored and never committed,
// and an album with no transcript just has no take. Nothing here calls a paid API, and the
// app never touches YouTube.
//
// Writes data/albums.json (every album: score and take, grouped by box; committed, not
// bundled) and src/boxes.data.json (per box: score range, artists, a few examples; this one
// ships in the Worker).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SOURCE = "https://raw.githubusercontent.com/andrewjleung/tnd-reviews/c4b4b9923be0e45ef726324e368664fec4aebe1e/reviews.csv";
const SHA256 = "2098c7135a2f13809f4159f59716a115c4dbca26975dc5020930dc8e17c8ba85";

export interface Album {
  artist: string;
  title: string;
  /** The year of the review, not the release. */
  year: number;
  score: number;
  genres: string[];
  take?: string;
}

/** Genre → box, first match wins. An album goes in the box of its first genre that matches. */
export const RULES: [RegExp, string][] = [
  [/industrial hip hop|experimental hip hop|noise rap|glitch hop|horrorcore|digicore|industrial rap/, "abrasive-rap"],
  [/jazz rap|conscious|abstract hip hop|boom bap|underground hip hop|political hip hop|instrumental hip hop/, "conscious-rap"],
  [/trap|cloud rap|pop rap|drill|rage|plugg|emo rap|mumble/, "streaming-rap"],
  [/metal|hardcore punk|grind|screamo|mathcore|powerviolence|post-hardcore|sludge|doom|crust|emoviolence|deathcore/, "heavy"],
  [/ambient|drone|new age|modern classical|sound collage|field recording|minimalis|^noise$|^experimental$|dark jazz/, "ambient"],
  [/house|techno|idm|edm|dubstep|garage$|bass$|drum and bass|jungle|breakcore|electronic|wonky|glitch$|footwork|indietronic|electro$|electro-|electroclash|disco|trance|vaporwave|plunderphonics/, "electronic"],
  [/r&b|soul|funk|jazz|gospel|quiet storm/, "rnb"],
  [/pop punk|alternative rock|hard rock|pop rock|arena|grunge|blues rock|glam rock|heartland|soft rock|power pop|classic rock|southern rock|country|^rock$/, "dad-rock"],
  [/art pop|hyperpop|experimental pop|glitch pop|bubblegum bass|chamber pop|baroque pop|progressive pop|psych pop|psychedelic pop|dream pop/, "art-pop"],
  [/post-punk|noise rock|noise pop|punk|garage|shoegaze|art rock|experimental rock|no wave|post-rock|math rock|psych|krautrock|chamber rock|dance-punk/, "noise-rock"],
  [/folk|singer-songwriter|indie|americana|slowcore|sadcore|emo/, "indie-folk"],
  [/pop/, "radio-pop"],
  [/hip hop|hop$|rap/, "conscious-rap"],
  [/prog|wave$/, "noise-rock"],
  [/rock|ska/, "dad-rock"],
];

export function boxFor(genres: string[]): string | undefined {
  for (const g of genres) for (const [re, id] of RULES) if (re.test(g)) return id;
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += '"', i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), field = "";
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), row = [], field = "";
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some(Boolean));
}

export function parseReviews(csv: string): Album[] {
  const [head, ...rows] = parseCsv(csv);
  const col = (name: string) => head!.indexOf(name);
  const [at, artist, title, rating, genres] = ["publishedAt", "artist", "title", "rating", "genres"].map(col);
  return rows.flatMap((r) => {
    const score = Number(r[rating!]);
    if (!r[artist!] || !r[title!] || !Number.isInteger(score) || score < 0 || score > 10) return [];
    return [{
      artist: r[artist!]!.trim(), title: r[title!]!.trim(), year: Number(r[at!]!.slice(0, 4)), score,
      genres: (r[genres!] ?? "").split(";;").map((g) => g.trim().toLowerCase()).filter(Boolean),
    }];
  });
}

/** The file name a transcript goes under: "Artist - Title.txt", minus characters file systems dislike. */
export const transcriptName = (a: Pick<Album, "artist" | "title">) => `${a.artist} - ${a.title}`.replace(/[\/\\:*?"<>|]/g, "").trim() + ".txt";

const MAX_TAKE = 160;

/**
 * The one-line take from a review transcript: what he says just before he gives the
 * score ("I'm feeling a strong 8 on this one"). Auto captions have no punctuation, so
 * it's the last couple of dozen words before that, cut to a sentence start when there is one.
 */
export function takeFrom(transcript: string): string | undefined {
  const text = transcript.replace(/<[^>]+>/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const m = [...text.matchAll(/\b(?:i'?m|i am) (?:feeling|giving (?:this|it))\b/gi)].at(-1);
  if (!m) return;
  const before = text.slice(0, m.index).trim();
  const sentences = before.split(/(?<=[.!?])\s+/).filter((s) => s.split(" ").length > 3);
  let take = sentences.length > 1 ? sentences.at(-1)! : before.split(" ").slice(-24).join(" ");
  take = take.replace(/^(and|but|so|anyway|overall|yeah|um|uh)[, ]+/i, "").replace(/[,;: ]+$/, "");
  if (take.split(" ").length < 4) return;
  if (take.length > MAX_TAKE) take = take.slice(0, take.lastIndexOf(" ", MAX_TAKE - 1)) + "…";
  return take[0]!.toUpperCase() + take.slice(1);
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

export interface BoxData {
  reviews: number;
  median: number;
  /** Where the middle half of his scores for this box land. */
  scores: [number, number];
  /** The artists he's reviewed most in this box. */
  soundsLike: string[];
  /** A handful of real reviews across the range, for the review text to point at. */
  examples: { artist: string; title: string; year: number; score: number; take?: string }[];
}

export function summarize(albums: Album[]): BoxData {
  const sorted = albums.map((a) => a.score).sort((x, y) => x - y);
  const byArtist = new Map<string, number>();
  for (const a of albums) byArtist.set(a.artist, (byArtist.get(a.artist) ?? 0) + 1);
  const soundsLike = [...byArtist].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 5).map(([a]) => a);
  // One example per score he's given in this box, newest first, preferring ones with a take.
  const examples = [...new Set(sorted)].map((s) =>
    albums.filter((a) => a.score === s).sort((x, y) => Number(!!y.take) - Number(!!x.take) || y.year - x.year)[0]!,
  ).map(({ artist, title, year, score, take }) => ({ artist, title, year, score, ...(take && { take }) }));
  return { reviews: albums.length, median: quantile(sorted, 0.5), scores: [quantile(sorted, 0.25), quantile(sorted, 0.75)], soundsLike, examples };
}

async function loadCsv(path?: string): Promise<string> {
  const text = path ? readFileSync(path, "utf8") : await (await fetch(SOURCE)).text();
  const hash = new Bun.CryptoHasher("sha256").update(text).digest("hex");
  if (hash !== SHA256) console.warn(`! ${path ?? SOURCE} isn't the pinned dataset (sha256 ${hash}); building from it anyway`);
  return text;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const t = args.indexOf("--transcripts");
  const dir = t >= 0 ? args.splice(t, 2)[1]! : "data/transcripts";
  const albums = parseReviews(await loadCsv(args[0]));
  let takes = 0;
  if (existsSync(dir)) {
    const files = new Set(readdirSync(dir));
    for (const a of albums) {
      const f = transcriptName(a);
      if (files.has(f) && (a.take = takeFrom(readFileSync(join(dir, f), "utf8")))) takes++;
    }
  }
  const grouped: Record<string, Album[]> = {};
  let unboxed = 0;
  for (const a of albums) {
    const id = boxFor(a.genres);
    if (id) (grouped[id] ??= []).push(a);
    else unboxed++;
  }
  const ids = Object.keys(grouped).sort();
  writeFileSync("data/albums.json", JSON.stringify({
    source: SOURCE,
    boxes: Object.fromEntries(ids.map((id) => [id, grouped[id]!.map(({ artist, title, year, score, take }) => ({ artist, title, year, score, ...(take && { take }) }))])),
  }, null, 1) + "\n");
  writeFileSync("src/boxes.data.json", JSON.stringify(Object.fromEntries(ids.map((id) => [id, summarize(grouped[id]!)])), null, 1) + "\n");
  console.log(`${albums.length} reviews, ${albums.length - unboxed} boxed, ${unboxed} with no box, ${takes} takes from transcripts`);
  for (const id of ids) { const s = summarize(grouped[id]!); console.log(`  ${id.padEnd(14)} ${String(s.reviews).padStart(4)}  ${s.scores.join("–")} (median ${s.median})  ${s.soundsLike.slice(0, 3).join(", ")}`); }
}
