// A sesh is a room with a name you can say out loud: /sesh/fuzzy-black-panda. There's no
// account yet, so the name is the key: keep the link and the groove is there when you come back.
const ADJECTIVES = ["fuzzy", "sleepy", "brave", "quiet", "bouncy", "lucky", "swift", "mellow", "giddy", "cosmic", "dusty", "wobbly", "breezy", "jolly", "shy", "grand", "tiny", "spicy", "humble", "zesty"];
const COLORS = ["black", "amber", "teal", "violet", "crimson", "golden", "silver", "olive", "coral", "indigo", "ivory", "jade", "rusty", "azure", "plum", "copper", "mint", "scarlet", "sandy", "slate"];
const ANIMALS = ["panda", "otter", "heron", "lynx", "badger", "gecko", "walrus", "falcon", "koala", "moose", "newt", "orca", "puffin", "quokka", "raven", "sloth", "tapir", "yak", "zebra", "marmot"];

/** 8,000 names; the edge also caps how many seshes it keeps (src/lobby.ts), so collisions stay rare. */
export function seshName(rand: () => number = Math.random): string {
  const pick = (l: string[]) => l[Math.floor(rand() * l.length)];
  return `${pick(ADJECTIVES)}-${pick(COLORS)}-${pick(ANIMALS)}`;
}

/** The room a path names: /sesh/<name>, lowercase letters, digits and dashes. Anything else is no sesh. */
export function seshFromPath(path: string): string | null {
  const m = /^\/sesh\/([a-z0-9-]{1,64})\/?$/.exec(path);
  return m ? m[1] : null;
}
