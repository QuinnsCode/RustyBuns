# Margin-note voice guide

For anyone writing a line the book says in its own voice: the hand under the circle, a page's scrawl, a toast, an empty ribbon,
a result note. Part of the tome direction in [#3266](https://github.com/QuinnsCode/RustyBuns/issues/3266) and the
Book's hill climb ([#3468](https://github.com/QuinnsCode/RustyBuns/issues/3468) and the rounds after it).

**Who is talking.** There is no wizard. The Eldritch Compendium is a possessed book that wants the earth's cryptids
collected, and asks like a mob boss keeping accounts: a numbered ledger, receipts, no thanks. The aliens that dropped us
here fled the forces around it, not the book. The book never explains those forces. More lore comes from the owner.

The book speaks two ways, both in its hand (Fondamento italic, a quill's broad nib, `.demand` in `src/tome.css`):

- **A demand** wants something done. It is signed "the Book" (`SIGNATURE` in `src/demand.ts`).
- **A margin note** remarks on what is on the page. It is unsigned.

**On hold:** #3266 had a late-game secret (the book is a wizard's list of contacts, so every note read twice). It came
before "there is no wizard", and whether it stays, changes or goes is the owner's call. Until then the phone-book double
reading below is optional: a line may carry it, but none needs it.

## The rules

1. **Short.** One line, two at most, under about 90 characters. A margin has no room.
2. **The book speaks, never the game.** No "Click", "Press", "Error", no numbers about balance. Instructions go in the
   UI's own voice (`blank` and `dry` in `src/grimoire.ts` may state the action, then add one wry word).
3. **Dry, not zany.** Deadpan beats jokes. The book is tired, a little smug and not sorry. No exclamation marks, no
   "LOL", no emoji (icons are lucide, in the UI only, never in the copy).
4. **Handwriting things.** Ink, smudges, coffee rings, torn corners, a stuck page, a bookmark nobody put there. Reach for
   the object before the monster.
5. **Accounts, not spells.** The book talks like someone collecting: items, received, owed, late, short, the ledger.
   Never incantations, never what the forces are. Ordinary words beat dark ones.
6. **Say something true for the page.** A bind gets a receipt with its item number, a loss an order to get up, a
   win that brought nothing the standing demand. The same line pasted on every page does not count.
7. **No cruelty to the beasts.** They are sulking, busy or late, never hurt. The book is rude; it is not a villain you can
   read yet.
8. **One hand.** Demands signed "the Book", margin notes unsigned, all written by one voice that never explains itself.
   No names, no dates that are not "Thursday"-sized, no jokes that need the player to know a franchise.
9. **Fiction first, no real brands.** Folklore beasts by name are fine; commercial games, characters and studios never.
10. **Lines are shared.** Add a line to the list below in the same PR that ships it, so the next writer can hear the voice and
    nothing says the same thing twice.

## The ledger: lines in use

The demands and receipts in `src/demand.ts` (`demandOf`, `reactionOf`). Add yours here when it ships.

| Where | Line | Signed |
|---|---|---|
| Title, compendium | Item 4: the one with wings, shadow in its blood. Bring it. | yes |
| Title, compendium | Item 6: the Squonk. You saw it. You let it go. Bring it. | yes |
| Title, compendium | Item 77: nothing. For now. | yes |
| Result: a new bind | Item 6. Received. (sometimes: Late. / Smaller than described. / Wipe its feet. / About time.) | no |
| Result: a bind it has | I have one of those. Keep it. Bring me one I have not. | yes |
| Result: a wild win, no bind | You beat it and let it walk. That is not how a ledger works. | yes |
| Result: a keeper beaten | A keeper is not an item. (then the standing demand) | yes |
| Result: the mythic fled | It ran. I have its smell on this page now. Go back for it. | yes |
| Result: one down, more left | This one can't fight. Send in the next. | no |
| Result: all down | No creatures left to fight. Back to the last stone. | no |
| Result: a deadly wild one | You lost. Heal up and try again. | no |
| Result: versus | Practice. I keep no accounts of practice. | no |
| Bestiary folio: a bound one | Item 4. Entered. (within the hour: The ink is still wet.) | no |
| Bestiary folio: one only seen | Seen. Not entered. Looking is not collecting. | no |
| Bestiary deck, no journey yet | Item 1: the Jersey Devil, top of this deck. Then the rest, in order. | yes |
| Bestiary deck: top card unmet | Item 4: the Jersey Devil, top of my deck. Go and find it. (seen: You have seen it. Bring it.) | yes |
| Bestiary deck: every card bound | Every card in this deck is mine. Keep them in order. | no |

## Twenty margin lines from the first pass

From before "there is no wizard" (#3266): fine as margin notes, and each shows the grimoire reading, then the
phone-book one that is on hold.

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

- A fight's result note: `reactionOf` in `src/demand.ts`, drawn under the heading.

## Checking a new line

Read it aloud as someone who runs a ledger and is owed. If it explains anything, wants a thank-you, or could sit on any
page, rewrite it. If it is a demand, it ends signed; if it only remarks, it does not.
