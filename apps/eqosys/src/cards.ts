// The words on every app's card in the library: the owner writes them in the card-copy editor and pastes its
// "All copy as JSON" export over cards.json, so the file is the export and nothing is retyped. An app's id here
// is its id in APPS (apps.ts); the test checks the two match. Empty strings mean "use the default".
import { check, obj, str, type Of } from "@rustybuns/util/guard";
import copy from "./cards.json";

const Card = obj({
  /** What the card is called; also the app's name everywhere else (presence, "Continue to …"). */
  name: str(40, { min: 1 }),
  /** The small uppercase line above the name: a genre or a mood, two or three words. Empty hides it. */
  kicker: str(48, { min: 0 }),
  /** The one sentence on the card. */
  blurb: str(120, { min: 1 }),
  /** What the round button says. Empty: "Play now" for a game, "Open" for a suite. */
  cta: str(20, { min: 0 }),
  /** Two or three sentences for a longer card. Not on the hub yet. */
  more: str(400, { min: 0 }),
});
export type Card = Of<typeof Card>;

const CARDS: Record<string, Card> = {};
for (const [id, c] of Object.entries(copy)) {
  const card = check(Card, c);
  if (!card) throw new Error(`cards.json: ${id} is not a card`);
  CARDS[id] = card;
}

/** The card copy of one app, or a bare card from its name when the JSON has none yet. */
export const cardOf = (id: string, name = id): Card => CARDS[id] ?? { name, kicker: "", blurb: "", cta: "", more: "" };

export const cardIds = () => Object.keys(CARDS);
