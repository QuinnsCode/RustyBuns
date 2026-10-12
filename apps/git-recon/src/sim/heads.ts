// Heads you can wear on your soldier, earned by merging levels: every level you win
// (a level on a repo you haven't won it on before) unlocks the next one. Each is our own
// toy-like design built from a few primitives, a nod to a big name in open source, hosting
// or infra, never its logo traced or anyone's face. src/ui/characters.ts draws them, and
// src/ui/heads.ts lists them after the heads everyone has.

export interface Head {
  id: string;
  name: string;
  /** What it nods to. */
  nod: string;
}

export const UNLOCKABLE: Head[] = [
  { id: "bun", name: "Steamed bun", nod: "Bun, the runtime this repo is named for" },
  { id: "crab", name: "Crab", nod: "Rust's unofficial crab mascot" },
  { id: "penguin", name: "Penguin", nod: "Linux's penguin" },
  { id: "whale", name: "Whale with cargo", nod: "Docker's container-carrying whale" },
  { id: "cloud", name: "Orange cloud", nod: "Cloudflare" },
  { id: "pyramid", name: "Black pyramid", nod: "Vercel's triangle" },
  { id: "cat", name: "Many-armed cat", nod: "GitHub's cat-octopus mascot" },
  { id: "gopher", name: "Buck-toothed gopher", nod: "Go's gopher" },
  { id: "elephant", name: "Elephant", nod: "PostgreSQL's elephant" },
  { id: "helm", name: "Ship's wheel", nod: "Kubernetes' helm" },
  { id: "snakes", name: "Two snakes", nod: "Python's two snakes" },
  { id: "balloon", name: "Hot-air balloon", nod: "Fly.io's balloon" },
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
