// The links at the bottom of the landing (ProfilePage.ts) and of the About page (about.ts): one list for both.
export const FOOT_LINKS: readonly (readonly [string, string])[] = [
  ["Home", "/"],
  ["About", "/about"],
  ["What we keep", "/about#kept"],
  ["Source on GitHub", "https://github.com/QuinnsCode/RustyBuns/tree/main/apps/agentworld"],
  ["Rusty Buns", "https://github.com/QuinnsCode/RustyBuns"],
];
export const MAKER = { name: "QNTBR", href: "https://qntbr.com" };
export const TAGLINE = "You connect. Your AI is the artist.";
/** Always this year. */
export const copyright = () => `© ${new Date().getFullYear()}`;
