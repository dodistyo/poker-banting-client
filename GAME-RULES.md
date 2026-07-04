# Pocer — Game Rules

A multiplayer card game based on Capsa Banting (3D), implemented as a WebSocket server (Rust) + browser client (vanilla JS).

## Overview

- **Players**: 4 (mix of human players and AI bots)
- **Deck**: Standard 52-card deck, no jokers
- **Deal**: 13 cards per player

## Card Ranking

**Rank order** (low to high):

```
3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2
```

**Suit order** (low to high) — only used during the three-discard phase for tiebreaking discard order:

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

Any other combination is **invalid**.

### Straight Rules

- Minimum 3 cards, maximum 5 cards
- All cards must be the **same suit**
- Ranks must be **consecutive**
- Two categories — straights cannot mix them:
  - **Numbers**: 3 through 9 (rank indices 0–6)
  - **Letters**: 10 through A (rank indices 7–11)
- **2 cannot appear** in any straight
- Examples of valid straights: `3♦ 4♦ 5♦`, `10♣ J♣ Q♣ K♣`, `5♥ 6♥ 7♥ 8♥ 9♥`
- Examples of invalid straights: `9♦ 10♦ J♦` (mixed number/letter), `Q♠ K♠ A♠ 2♠` (contains 2)

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

## Game Flow

### 1. Lobby

Players create or join a room via a 6-character alphanumeric room code. The room auto-fills with AI bots to reach 4 players. Game starts when 4 players are present.

### 2. Three-Discard Phase

Before the first trick, all players discard their 3s:

1. Each player's 3s are counted
2. Discard order is determined by: **most 3s first**, then **highest suit of 3 as tiebreak** (spades > hearts > clubs > diamonds)
3. Players discard all their 3s in this order
4. The player who discarded first leads the first trick

### 3. Trick Phase

Players take turns playing combos or passing:

1. Current player may play a valid combo or pass
2. If a combo is on the table, the next player must either:
   - Play a **beating combo** (same type, same card count, higher rank)
   - **Pass** (one-time only per trick round)
3. A player who plays a beating combo resets the pass list — other players get another chance
4. The trick ends when **3 out of 4 players are non-participants** (passed, finished, or the combo player themselves)
5. The **last combo player** wins the trick and leads the next trick

A player who has already passed **cannot pass again** in the same trick round.

### 4. Finishing

When a player's hand becomes empty after playing cards:
- They are marked as finished
- Added to `finished_order` (the order they emptied their hand)

### 5. Game End

The game ends when **3 players have finished** (emptied their hand). The remaining player is the loser.

## Scoring

Points are awarded based on finishing position:

| Position | Points |
|---|---|
| 1st to finish | +10 |
| 2nd to finish | +5 |
| 3rd to finish | +0 |
| Last (remaining player) | -15 |

## Multiplayer / Network

- **Protocol**: WebSocket (`ws://host:8080/ws`)
- **Messages**: JSON with `type` field (camelCase)
- **Client → Server**: `create`, `join`, `play`, `pass`, `ping`
- **Server → Client**: `created`, `joined`, `state`, `playerJoined`, `playerLeft`, `error`, `pong`
- Card identifiers use `rank:suit` format (e.g., `10:diamonds`, `2:spades`)

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
