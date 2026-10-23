// Heads you can wear on your soldier: the web languages' own marks (shields and tiles, a notch off the originals) and cartoony toy takes on the other tools people build with. Everyone starts with
// the STARTERS; every level you win (a level on a repo you haven't won it on before) unlocks the next of
// UNLOCKABLE. Rust is a generic cog, not its logo. src/ui/characters.ts draws them, and src/ui/heads.ts
// lists them after the heads everyone has.

export interface Head {
  id: string;
  name: string;
  /** What it nods to. */
  nod: string;
}

export const STARTERS: Head[] = [
  { id: "html5", name: "HTML5 shield", nod: "HTML5" },
  { id: "css3", name: "CSS3 shield", nod: "CSS3" },
  { id: "js", name: "Yellow JS", nod: "JavaScript" },
  { id: "ts", name: "Blue TS", nod: "TypeScript" },
  { id: "cloud", name: "Orange cloud", nod: "Cloudflare" },
];

export const UNLOCKABLE: Head[] = [
  { id: "bun", name: "Steamed bun", nod: "Bun, the runtime this repo is built on" },
  { id: "gear", name: "Rusty cog", nod: "Rust" },
  { id: "cube", name: "Corner cube", nod: "Three.js" },
  { id: "atom", name: "Atom", nod: "React" },
  { id: "flask", name: "Potion flask", nod: "Alchemy" },
  { id: "effect", name: "Chunky E", nod: "Effect" },
  { id: "wave", name: "Swooshes", nod: "Tailwind CSS" },
  { id: "b", name: "Blocky B", nod: "Better Auth" },
  { id: "bolt", name: "Lightning bolt", nod: "Vite" },
  { id: "island", name: "Palm island", nod: "TanStack" },
  { id: "svelte", name: "Swoopy S", nod: "Svelte" },
  { id: "vue", name: "Nested V", nod: "Vue" },
  { id: "peaks", name: "Twin peaks", nod: "Nuxt" },
];

/** A won level's key: the same level on another repo is another win. */
export const winKey = (levelId: string, repo: string) => `${levelId}:${repo}`;

/** The heads open to someone with these wins: one per distinct level won, in order. */
export const unlocked = (wins: readonly string[]): Head[] => UNLOCKABLE.slice(0, new Set(wins).size);

/** Record a win; says which head it unlocked, if any. */
export function addWin(wins: readonly string[], key: string): { wins: string[]; head: Head | null } {
  if (wins.includes(key)) return { wins: [...wins], head: null };
  const next = [...wins, key];
  return { wins: next, head: UNLOCKABLE[new Set(next).size - 1] ?? null };
}
