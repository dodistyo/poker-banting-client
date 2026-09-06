# Pocer — Poker Banting Card Game (Client)

Browser game (vanilla JS, ES modules) for the Pocer poker-banting server.

## Structure

- `index.html` — entry point, markup + all CSS
- `src/app.js` — app state, screens, turn handling, play-limit countdown
- `src/game.js` — **single source of truth for combo logic** (`detectCombo`,
  `isStraight`, `validatePlay`, card model)
- `src/render.js` — DOM rendering (hand, table, player frames, turn hint)
- `src/network.js` — WebSocket client (connect, room actions, message send)
- `sw.js` — service worker (network-first; bump `CACHE_VERSION` `pb-vN` on
  every release; `/api` bypasses the cache)

**Game rules: `GAME-RULES.md` in this repo is the single reference** (combos,
straights, bomb, scoring, play limit, winning point, protocol). Update it
whenever rules change.

## Dev Server

`make serve` — starts `dev-server.js` on port 3000, proxies `/api` →
`localhost:8080` (HTTP + WebSocket); proxy strips the `/api` prefix.

- `PROXY=false make serve` — static files only
- `PROXY_TARGET=host:port make serve` — custom backend target
- Backend URL in `src/app.js` resolves to `ws://location.host/api/ws`

## Testing

```bash
for f in test/*.test.js; do node "$f"; done   # unit (plain assert, no framework)
xvfb-run -a npx playwright test               # e2e (no $DISPLAY here; server must be up)
```

- `test/*.test.js` import combo logic from `src/game.js` (they do NOT
  duplicate it). E2E specs live in `e2e/*.spec.js`; shared helpers in
  `e2e/helpers.js`.
- E2E runs against the LIVE server, so start it first (`just dev` in the
  server repo).

## Key State Variables

All in module scope in `src/app.js`:

- `state` — last server state (adapted via `adaptState`), or `null`
- `playerId` — our seat id (0–3)
- `roomCode` — current room code
- `turnCountdownTimer` / `turnCountdownKey` — play-limit countdown, keyed on
  `turnSeq` so stale timers die when the turn advances

## Gotchas

- `src/game.js` MUST stay semantically identical to the server's
  `src/game/combo.rs` (parity). The server's
  `tests/integration_test.rs::test_combo_detection_matches_js` is the guard.
  Change both sides + their tests together.
- State is server-authoritative: the client only mirrors the last `state`
  message. Never mutate game state locally.
- After a match winner (`state.gameWinner != null`), Start Game is hidden —
  the server blocks a new start for that room permanently.
- Mobile-first (Android PWA via Cloudflare tunnel); desktop must work too.
