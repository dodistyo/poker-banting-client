# Pocer — Capsa Banting Card Game

## Structure

Single-file app. Everything lives in `index.html`: HTML markup, CSS styles, and JavaScript game logic all inline. No build step, no dependencies, no framework.

Open `index.html` in a browser to play.

## Testing

Test files duplicate core game logic (card model, combo detection) since they can't import from the HTML file.

```
node test.js            # combo detection, trick cycle, full game simulation
node trick-test.js      # trick reset scenario (human wins, bots pass)
node trick-reset-test.js # sequential trick wins, no-undefined check
```

Tests use Node's built-in `assert` module. No test framework installed.

## Game Rules (Capsa Banting / 3D)

- 4 players (1 human + 3 AI bots), standard 52-card deck, 13 cards each
- Rank order: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2
- Suit tiebreak: diamonds < clubs < hearts < spades
- Valid combos: single, pair, triple, straight (3-5 cards, same suit), full house, four of a kind
- Straights must be all-numbers (3–9) or all-letters (10–A), never mixed. 2s cannot appear in straights.
- First round: 3-discard phase — players discard all their 3s, ordered by most 3s first (highest suit tiebreak)
- First trick led by the player who discarded 3s first
- Scoring per round: 1st = +10, 2nd = +5, 3rd = +0, last = -15
- Game ends when 3 players have emptied their hands; the last player loses the round

## Key State Variables

All game state is module-scope `let`/`const` in `index.html` (around line 727):
- `hands` — array of 4 card arrays
- `currentPlayer` — whose turn it is
- `trick` — IIFE module tracking current combo, combo player, and pass list
- `finishedOrder` — players who've emptied their hands
- `threePhase` — boolean flag for the 3-discard phase

## Gotchas

- Test files have their own copy of `detectCombo`, `isStraight`, etc. Changes to combo logic in `index.html` must be manually synced to test files.
- The `trick` object is an IIFE closure (line 733). Don't access `combo`/`passed` directly — use `trick.getCombo()`, `trick.getPassed()`, etc.
- AI delay is 600–1000ms via `setTimeout`. The `aiTimeout` global is used to cancel pending AI turns on game reset.
