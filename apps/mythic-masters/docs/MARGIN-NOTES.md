# Margin-note voice guide

For anyone writing a line the book says in its own voice: the hand under the circle, a page's scrawl, a toast, an empty ribbon,
a result note. Part of the tome direction in [#3266](https://github.com/QuinnsCode/RustyBuns/issues/3266).

**Spoiler:** the book is the wizard's list of contacts and the beasts are his friends, whom we kidnapped. Nothing early
says so. So every line has to be true twice: once as a grimoire with opinions, once, on a second look, as a phone book
(and a rude phone call). A line that only works one way is not a margin note yet.

## The rules

1. **Short.** One line, two at most, under about 90 characters. A margin has no room.
2. **The book speaks, never the game.** No "Click", "Press", "Error", no numbers about balance. Instructions go in the
   UI's own voice (`blank` and `dry` in `src/grimoire.ts` may state the action, then add one wry word).
3. **Dry, not zany.** Deadpan beats jokes. The book is tired, a little smug and not sorry. No exclamation marks, no
   "LOL", no emoji (icons are lucide, in the UI only, never in the copy).
4. **Handwriting things.** Ink, smudges, coffee rings, torn corners, a stuck page, a bookmark nobody put there. Reach for
   the object before the monster.
5. **The double reading.** Pick ordinary phone-book words (call, message, number, owes, back, Thursday, left it on,
   not in, try again) and use them for a grimoire thing at the same time. The literal reading must still make full
   sense on its own, and the second reading must never need a sinister word.
6. **Never confirm it.** No "friends", "contacts", "kidnapped", "dial", "phone" or "address" in early copy. The reveal
   copy is the owner's to approve and does not ship without a yes ([#3266](https://github.com/QuinnsCode/RustyBuns/issues/3266)).
7. **No cruelty to the beasts.** They are sulking, busy or late, never hurt. The book is rude; it is not a villain you can
   read yet.
8. **Same wizard, same hand.** Notes are unsigned and written by one person who never explains himself. No names, no
   dates that are not "Thursday"-sized, no jokes that need the player to know a franchise.
9. **Fiction first, no real brands.** Folklore beasts by name are fine; commercial games, characters and studios never.
10. **Lines are shared.** Add a line to the list below in the same PR that ships it, so the next writer can hear the voice and
    nothing says the same thing twice.

## Twenty example lines

Each shows the grimoire reading, then the second look.

| # | Line | First reading | On a second look |
|---|---|---|---|
| 1 | call back re: Thursday | a ritual, due on a day | an unreturned call |
| 2 | owes me a boat | a debt to the book | a friend who borrowed something |
| 3 | not in. try again | the beast did not come | the person did not pick up |
| 4 | left it on the table, ring and all | a coffee ring on the page | a note to a friend about a mug |
| 5 | it said it would be there by now | late summons | late arrival |
| 6 | do not ask about the ferry | an incident | a falling-out |
| 7 | still has my good quill | a thief | a loan |
| 8 | prefers mornings | summon at dawn | best time to reach them |
| 9 | number's changed? | the page was rewritten | a dead line |
| 10 | tell no one about the soup | secret recipe | something shared in confidence |
| 11 | sulking again. leave it a day | a moody beast | someone who needs a day |
| 12 | owes me one. I owe it two | ritual debt | favours between friends |
| 13 | met at the lake, forgot why | a pact | how most friends begin |
| 14 | the ink ran out mid-name | a smudge | a name nobody finished writing |
| 15 | will call me. has not | waiting | waiting |
| 16 | good in a crisis. bad at doors | strong, clumsy | a friend you can rely on |
| 17 | this page is warm | an enchanted page | someone just touched it |
| 18 | ask after the cousin | a related beast | polite small talk |
| 19 | do not forget the birthday | a date of power | a birthday |
| 20 | never says goodbye, just stops | it vanishes from the circle | the line goes quiet |

## Where lines live

- Summon results: `LINES` in `src/grimoire.ts` (arrives, grumpy, misread). Keep their present shape: one sentence the book says.
- The versus tag line (`#bookTag`) and any new page's scrawl: same rules, same list.
- Empty-state labels ("an empty ribbon"): rule 3, no joke needed.

## Checking a new line

Say it aloud as the grimoire, then again as a person leaving a note for a friend. If the second reading takes an
explanation, or sounds like a threat, rewrite it. If it would still read fine on a title page that says "Contacts",
it passes.
