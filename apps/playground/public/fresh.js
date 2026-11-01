// How fresh a framework example is: the version it pins against npm's latest, as a bun from the oven.
// 4 Fresh (on latest), 3 Warm (a patch behind), 2 Day-old (a minor behind), 1 Stale (a major behind).
export const RATINGS = ["", "Stale", "Day-old", "Warm", "Fresh"];

export const freshness = (pinned, latest) => {
  const [a, b] = [pinned, latest].map((v) => v.split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0));
  if (a[0] !== b[0]) return a[0] > b[0] ? 4 : 1;
  if (a[1] !== b[1]) return a[1] > b[1] ? 4 : 2;
  return a[2] >= b[2] ? 4 : 3;
};
