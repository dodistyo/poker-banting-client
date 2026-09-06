# Pocer — Poker Banting Card Game

## Structure

`index.html` — entry point, imports from `src/app.js` (ES modules). Game logic split across `src/` directory.

## Dev Server

`make serve` — starts `dev-server.js` on port 3000, proxies `/api` → `localhost:8080` (HTTP + WebSocket). Proxy strips `/api` prefix before forwarding.

- `PROXY=false make serve` — disables proxy (static files only)
- `PROXY_TARGET=host:port make serve` — custom backend target

Backend URL in `src/app.js:8` resolves to `ws://location.host/api/ws`.

## Testing

Test files duplicate core game logic (card model, combo detection) since they can't import from the HTML file.

```
node test.js            # combo detection, trick cycle, full game simulation
node trick-test.js      # trick reset scenario (human wins, bots pass)
node trick-reset-test.js # sequential trick wins, no-undefined check
```

Tests use Node's built-in `assert` module. No test framework installed.

## Game Rules (Poker Banting / 3D)

- 4 players (1 human + 3 AI bots), standard 52-card deck, 13 cards each
- Rank order: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2
- Suit order: diamonds < clubs < hearts < spades (only used for 3-discard phase tiebreak, not trick play)
- Valid combos: single, pair, triple, straight (3-5 cards, same suit), full house, four of a kind, bomb (4 same rank, any suit — reaction only: counters a single 2 or a higher bomb; a completed bomb trick ends the round: bomber 1st +10, bombed player 4th -15, others 0)
- Straights must be all-numbers (3–10, min 3 cards) or exactly J-Q-K. 2s and aces cannot appear in straights.
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

- `src/game.js` is the single source of truth for combo logic (card model, `detectCombo`, `isStraight`, `validatePlay`); test files import from it. Keep it in sync with the server's `game/combo.rs`.
- The `trick` object is an IIFE closure (line 733). Don't access `combo`/`passed` directly — use `trick.getCombo()`, `trick.getPassed()`, etc.
- AI delay is 600–1000ms via `setTimeout`. The `aiTimeout` global is used to cancel pending AI turns on game reset.
