// The votes, counted. This is the file the demo's agents work on together.

export type Votes = Record<string, number>;

export const SNACKS = ["pretzels", "popcorn", "gummies", "chips"];

export function vote(votes: Votes, snack: string): Votes {
  if (!SNACKS.includes(snack)) throw new Error(`not on the menu: ${snack}`);
  return { ...votes, [snack]: (votes[snack] ?? 0) + 1 };
}

export function total(votes: Votes): number {
  return Object.values(votes).reduce((a, b) => a + b, 0);
}

export function leader(votes: Votes): string | null {
  let best: string | null = null;
  for (const s of SNACKS) if ((votes[s] ?? 0) > (best ? votes[best] ?? 0 : 0)) best = s;
  return best;
}

export function banner(votes: Votes): string {
  const top = leader(votes);
  return top ? `${top} is winning` : "No votes yet";
}
