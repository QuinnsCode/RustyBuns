/** `s` with `from` (which must be in it exactly once) swapped for `to`: one patch to a file of the pinned release, `rel`. */
export function once(s: string, rel: string, from: string, to: string) {
  if (s.split(from).length !== 2) throw new Error(`Agent Office changed: patch target moved in ${rel}: ${from}`);
  return s.replace(from, () => to);
}
