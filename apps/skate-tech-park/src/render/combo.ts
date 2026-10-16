// The running combo as a line for the HUD: the last few tricks in order, a repeat folded into "x2",
// and what the chain has scored so far.
export const SHOWN = 5; // tricks kept on the line; older ones scroll off to the left

export function comboLine(combo: readonly string[], score: number): string {
  if (!combo.length) return "";
  const folded: string[] = [];
  for (let i = 0, run = 0; i < combo.length; i++) {
    run++;
    if (combo[i + 1] === combo[i]) continue;
    folded.push(run > 1 ? `${combo[i]} x${run}` : combo[i]!);
    run = 0;
  }
  const tail = folded.slice(-SHOWN);
  return `${folded.length > tail.length ? "... " : ""}${tail.join(" > ")}   ${score}`;
}
