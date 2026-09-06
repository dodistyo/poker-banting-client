# Pocer — Game Rules

A multiplayer card game based on Poker Banting (3D), implemented as a
WebSocket server (Rust) + browser client (vanilla JS).

This file is the single source of truth for game rules. It must be updated
whenever rules change on the server. Last synced with server code on
2026-09-06 (play limit + winning point release).

## Overview

- **Players**: 4 (mix of human players and AI bots)
- **Deck**: Standard 52-card deck, no jokers
- **Deal**: 13 cards per player

## Card Ranking

**Rank order** (low to high):

```
3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2
```

**Suit order** (low to high) — only used during the three-discard phase for
tiebreaking discard order:

```
Diamonds (♦) < Clubs (♣) < Hearts (♥) < Spades (♠)
```

## Valid Combos

Only these combinations can be played. A play must use exactly 1–5 cards:

| Combo | Cards | Description |
|---|---|---|
| Single | 1 | Any one card |
| Pair | 2 | Two cards of the same rank |
| Triple | 3 | Three cards of the same rank |
| Straight | 3–5 | Consecutive ranks, same suit (see rules below) |
| Full House | 5 | Three of a kind + a pair |
| Four of a Kind | 5 | Four cards of the same rank + one kicker |
| **Bomb** | 4 | Four cards of the same rank — **reaction card, see Bomb Rules** |

Any other combination is **invalid**.

### Straight Rules

- Minimum 3 cards, maximum 5 cards
- All cards must be the **same suit**
- Ranks must be **consecutive**
- Two categories — straights **cannot mix them**:
  - **Numbers**: 3 through 10 (rank indices 0–7); 3–5 consecutive cards
  - **Letters**: **exactly J-Q-K** (rank indices 8–10, 3 cards only)
- **A and 2 cannot appear** in any straight
- Examples of valid straights: `3♦ 4♦ 5♦`, `6♦ 7♦ 8♦ 9♦ 10♦`, `J♣ Q♣ K♣`
- Examples of invalid straights:
  - `9♦ 10♦ J♦` (mixed number/letter — 10 belongs to the number category)
  - `J♠ Q♠ K♠ A♠` (contains A)
  - `Q♠ K♠ A♠ 2♠` (contains A and 2)

## Combo Comparison

To beat a combo on the table, your play must:
1. Be the **same type** (single vs single, pair vs pair, etc.)
2. Be the **same number of cards**
3. Have a **higher rank**

Comparison rules per type:

| Combo | Comparison |
|---|---|
| Single | Higher rank wins; same rank → **cannot beat** |
| Pair | Higher pair rank wins |
| Triple | Higher triple rank wins |
| Straight | Higher top card wins |
| Full House | Higher triple rank wins; same triple → higher pair rank wins |
| Four of a Kind | Higher quad rank wins; same quad → higher kicker wins |

Different combo types **cannot** be compared. You must match the type and card count.

## Bomb Rules

The Bomb (four of a kind, any rank) is a **pure reaction card**:

1. A bomb **can never open a trick** (leading with a bomb is illegal).
2. A bomb is legal **only against a single 2** on the table. It beats the
   single-2 outright — no rank comparison needed.
3. Once a bomb is on the table, the only legal responses are a **higher bomb**
   (strictly higher rank) or **pass**. No other combo type can answer a bomb.
4. Bomb vs bomb: only a **strictly higher rank** may counter.
5. **Bomb endgame**: when the trick on the table is a bomb AND the trick
   completes (all other three players have passed / been bypassed), the round
   ends **immediately** with fixed scoring:
   - last (highest) bomber = **1st (+10)**
   - the bombed player = **4th (−15)** — the single-2 holder, or the first
     bomber if the bomb was countered
   - the other two = **0**

## Game Flow

### 1. Lobby

Players create or join a room via a 6-character alphanumeric room code. The
room auto-fills with AI bots to reach 4 players. The host can change **Room
Settings** in the lobby (see below). Start Game is visible to the host; it
requires all 4 players present.

### 2. Three-Discard Phase

Before the first trick, all players discard their 3s:

1. Each player's 3s are counted
2. Discard order is determined by: **most 3s first**, then **highest suit of 3
   as tiebreak** (spades > hearts > clubs > diamonds)
3. Players discard all their 3s in this order
4. The player who discarded first leads the first trick

On **continuation rounds** (Main Lagi, see Match Play below) the
three-discard phase is **skipped** — the round deals straight into the trick
phase with the previous round's #1 leading.

### 3. Trick Phase

Players take turns playing combos or passing:

1. Current player may play a valid combo or pass
2. If a combo is on the table, the next player must either:
   - Play a **beating combo** (same type, same card count, higher rank) or a
     legal **bomb**
   - **Pass** (one-time only per trick round)
3. A player who plays a beating combo resets the pass list — other players get
   another chance
4. The trick ends when **3 out of 4 players are non-participants** (passed,
   finished, or the combo player themselves)
5. The **last combo player** wins the trick and leads the next trick

A player who has already passed **cannot pass again** in the same trick round.

### 4. Finishing

When a player's hand becomes empty after playing cards:
- They are marked as finished
- Added to `finished_order` (the order they emptied their hand)

### 5. Game End (Round End)

The round ends when **3 players have finished** (emptied their hand), or
**immediately** on a completed bomb trick (see Bomb Rules). The remaining
player is the loser. Scoring is applied and the round totals are added to the
session totals, then the match-winner check runs (see Match Play).

## Scoring

Points are awarded based on finishing position (normal round end):

| Position | Points |
|---|---|
| 1st to finish | +10 |
| 2nd to finish | +5 |
| 3rd to finish | +0 |
| Last (remaining player) | -15 |

Bomb endgame scoring is fixed (+10 / 0 / 0 / −15) — see Bomb Rules.

## Play Limit (Turn Timer)

The host sets a **play limit** in Room Settings (default **10s**, valid range
**1–120s**). While it is a **human** player's turn, the server starts a
watchdog for that many seconds:

- The client shows a countdown (`⏱ Ns`) while it is your turn.
- If the human does nothing when the timer expires, the server **auto-moves**:
  - leading (empty table): plays the **lowest single**
  - responding: plays the **lowest single that beats the table**
  - if no legal non-winning play exists (e.g. bomb on table with no counter):
    **pass**
- **Bots are exempt** — they are never auto-moved (they act on their own
  schedule).
- The watchdog is cancelled as soon as the turn advances (any play, pass, or
  bomb).

## Room Settings

Host-only, changeable in the **lobby** and in the **game-over** state:

| Setting | Default | Valid range | Meaning |
|---|---|---|---|
| Play limit (seconds) | 10 | 1–120 | Turn timer for human players |
| Winning point | 50 | 1–9999 | First player whose session total reaches this wins the match |

Out-of-range values are **rejected** by the server (not clamped). Non-host
players see the values read-only.

## Match Play (Winning Point & Sesi Unlimited)

Rounds can be chained into a match with a running **session total**:

1. After each round, per-round points are added to each player's session total.
2. **Winning point check**: the first player whose session total reaches the
   host-set winning point **wins the match**. The match ends **permanently**
   for that room — the celebration screen shows the match winner and
   Start Game is blocked afterwards.
3. If nobody reached the winning point, the host (and players) press
   **Main Lagi** to continue in the same room: everyone is auto-ready, the
   WebSocket stays open, and the next round deals **without** the
   three-discard phase.
4. **Keluar** always leaves the room (back to the main lobby).

## Multiplayer / Network

- **Protocol**: WebSocket (`ws://host:8080/ws`)
- **Messages**: JSON with `type` field (camelCase)
- **Client → Server**: `create`, `join`, `rejoin`, `checkRoom`, `play`,
  `pass`, `ready`, `startGame`, `setRoomSettings`, `leaveRoom`, `ping`
- **Server → Client**: `created`, `joined`, `rejoined`, `seatChanged`,
  `roomStatus`, `state`, `playerJoined`, `playerLeft`, `playerReady`,
  `gameStarted`, `roomSettings`, `error`, `pong`
- Card identifiers use `rank:suit` format (e.g., `10:diamonds`, `2:spades`)
- `state` payloads carry `playLimitSecs`, `winningPoint`, `gameWinner`
  (seat index or null), and `turnSeq` (turn-advance counter used by the
  client to invalidate stale countdowns)

### Game Phases (server state)

| Phase | Description |
|---|---|
| `lobby` | Waiting for players |
| `threeDiscard` | 3-discard phase in progress |
| `playing` | Active trick play |
| `gameOver` | Round ended, showing results |

## AI Bot Behavior

Bots use a simple strategy:
- **Free play** (no combo on table): play the weakest valid combo to save strong cards
- **Beat play**: play the lowest combo that beats the table
- **Pass**: when no beating combo exists
- Combo strength is calculated as `rank_index * 10 + combo_type_offset`
- Bots ignore the play limit — they never time out
