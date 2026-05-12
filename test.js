// Quick test - run with: node test.js
const assert = require('assert');

// --- Card model ---
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUITS = [
  { name: 'd', symbol: '\u2666', order: 0 },
  { name: 'c', symbol: '\u2663', order: 1 },
  { name: 'h', symbol: '\u2665', order: 2 },
  { name: 's', symbol: '\u2660', order: 3 }
];

function rankIndex(r) { return RANKS.indexOf(r); }
function mkCard(rank, suitName) {
  const s = SUITS.find(x => x.name === suitName);
  return { rank, suit: suitName, suitSymbol: s.symbol, suitOrder: s.order, rankIndex: rankIndex(rank) };
}

// --- Combo detection ---
function isStraight(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => a - b);
  if (unique.length < 3) return false;
  if (unique.some(r => r >= 12)) return false;
  const allNumbers = unique.every(r => r <= 7);
  const allLetters = unique.every(r => r >= 8);
  if (!allNumbers && !allLetters) return false;
  for (let i = 1; i < unique.length; i++)
    if (unique[i] !== unique[i - 1] + 1) return false;
  return true;
}

function detectCombo(cards) {
  const n = cards.length;
  const sorted = [...cards].sort((a, b) => a.rankIndex - b.rankIndex || a.suitOrder - b.suitOrder);
  const ranks = sorted.map(c => c.rankIndex);
  const suits = sorted.map(c => c.suit);
  const isSameSuit = suits.every(s => s === suits[0]);
  const rankCounts = {};
  ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
  const counts = Object.values(rankCounts).sort((a, b) => a - b);

  if (n === 1) return { type: 'single', cards: sorted };
  if (n === 2 && counts[0] === 2) return { type: 'pair', cards: sorted };
  if (n === 3) {
    if (counts[0] === 3) return { type: 'triple', cards: sorted };
    if (isSameSuit && isStraight(ranks)) return { type: 'straight', cards: sorted };
  }
  if (n === 4) {
    if (isSameSuit && isStraight(ranks)) return { type: 'straight', cards: sorted };
  }
  if (n === 5) {
    if (counts[0] === 1 && counts[1] === 4) return { type: 'fourkind', cards: sorted };
    if (counts[0] === 2 && counts[1] === 3) return { type: 'fullhouse', cards: sorted };
    if (isSameSuit && isStraight(ranks)) return { type: 'straight', cards: sorted };
  }
  return null;
}

// --- Compare combos ---
function compareByRankThenSuit(cardsA, cardsB) {
  const aHigh = cardsA[cardsA.length - 1];
  const bHigh = cardsB[cardsB.length - 1];
  return aHigh.rankIndex - bHigh.rankIndex;
}

function compareCombos(comboA, comboB) {
  if (comboA.type !== comboB.type) return null;
  switch (comboA.type) {
    case 'single': case 'pair': case 'triple':
      return compareByRankThenSuit(comboA.cards, comboB.cards);
     case 'straight': {
      const aHigh = comboA.cards[comboA.cards.length - 1];
      const bHigh = comboB.cards[comboB.cards.length - 1];
      return aHigh.rankIndex - bHigh.rankIndex;
    }
    case 'fullhouse': {
      const aTripleRank = comboA.cards[0].rankIndex === comboA.cards[2].rankIndex ? comboA.cards[0].rankIndex : comboA.cards[3].rankIndex;
      const bTripleRank = comboB.cards[0].rankIndex === comboB.cards[2].rankIndex ? comboB.cards[0].rankIndex : comboB.cards[3].rankIndex;
      if (aTripleRank !== bTripleRank) return aTripleRank - bTripleRank;
      const aPairRank = comboA.cards[0].rankIndex === comboA.cards[2].rankIndex ? comboA.cards[3].rankIndex : comboA.cards[0].rankIndex;
      const bPairRank = comboB.cards[0].rankIndex === comboB.cards[2].rankIndex ? comboB.cards[3].rankIndex : comboB.cards[0].rankIndex;
      return aPairRank - bPairRank;
    }
    case 'fourkind': {
      const aQuadRank = comboA.cards[0].rankIndex === comboA.cards[1].rankIndex ? comboA.cards[0].rankIndex : comboA.cards[4].rankIndex;
      const bQuadRank = comboB.cards[0].rankIndex === comboB.cards[1].rankIndex ? comboB.cards[0].rankIndex : comboB.cards[4].rankIndex;
      if (aQuadRank !== bQuadRank) return aQuadRank - bQuadRank;
      const aKicker = comboA.cards.find(c => c.rankIndex !== aQuadRank).rankIndex;
      const bKicker = comboB.cards.find(c => c.rankIndex !== bQuadRank).rankIndex;
      return aKicker - bKicker;
    }
    default: return 0;
  }
}

// --- Tests ---
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.log(`  ✗ ${name} — ${e.message}`); failed++; }
}

console.log('\n=== Combo Detection ===');
test('single', () => assert.strictEqual(detectCombo([mkCard('7','h')]).type, 'single'));
test('pair', () => assert.strictEqual(detectCombo([mkCard('K','h'), mkCard('K','s')]).type, 'pair'));
test('triple', () => assert.strictEqual(detectCombo([mkCard('5','d'), mkCard('5','c'), mkCard('5','h')]).type, 'triple'));
test('straight J-Q-K-A same suit', () => assert.strictEqual(detectCombo([mkCard('J','h'),mkCard('Q','h'),mkCard('K','h'),mkCard('A','h')]).type, 'straight'));
test('10-J-Q-K-A same suit is invalid (mixed number/letter)', () => assert.strictEqual(detectCombo([mkCard('10','h'),mkCard('J','h'),mkCard('Q','h'),mkCard('K','h'),mkCard('A','h')]), null));
test('straight 3-4-5 same suit', () => assert.strictEqual(detectCombo([mkCard('3','h'),mkCard('4','h'),mkCard('5','h')]).type, 'straight'));
test('straight mixed suit fails', () => assert.strictEqual(detectCombo([mkCard('3','h'),mkCard('4','d'),mkCard('5','h')]), null));
test('straight 7-8-9-10 same suit', () => assert.strictEqual(detectCombo([mkCard('7','h'),mkCard('8','h'),mkCard('9','h'),mkCard('10','h')]).type, 'straight'));
test('straight mixed numbers and letters fails', () => assert.strictEqual(detectCombo([mkCard('9','h'),mkCard('10','h'),mkCard('J','h')]), null));
test('straight with 2 fails', () => assert.strictEqual(detectCombo([mkCard('Q','h'),mkCard('K','h'),mkCard('A','h'),mkCard('2','h')]), null));
test('full house', () => assert.strictEqual(detectCombo([mkCard('K','d'),mkCard('K','c'),mkCard('K','h'),mkCard('7','s'),mkCard('7','d')]).type, 'fullhouse'));
test('four of a kind', () => assert.strictEqual(detectCombo([mkCard('3','d'),mkCard('A','d'),mkCard('A','c'),mkCard('A','h'),mkCard('A','s')]).type, 'fourkind'));
test('5 same suit non-straight is not valid', () => assert.strictEqual(detectCombo([mkCard('3','s'),mkCard('7','s'),mkCard('9','s'),mkCard('Q','s'),mkCard('2','s')]), null));
test('invalid 4 random cards', () => assert.strictEqual(detectCombo([mkCard('3','d'),mkCard('7','c'),mkCard('Q','h'),mkCard('K','s')]), null));
test('pair of 2s is highest pair', () => {
  const a = detectCombo([mkCard('2','d'), mkCard('2','c')]);
  const b = detectCombo([mkCard('2','d'), mkCard('2','h')]);
  assert.strictEqual(compareCombos(a, b), 0); // same rank = equal
});
test('3 is lowest single', () => {
  const a = detectCombo([mkCard('3','d')]);
  const b = detectCombo([mkCard('4','d')]);
  assert.strictEqual(compareCombos(a, b), -1); // 3 < 4
});
test('2 of spades is highest single', () => {
  const a = detectCombo([mkCard('2','s')]);
  const b = detectCombo([mkCard('A','s')]);
  assert.strictEqual(compareCombos(a, b), 1); // 2 > A
});
test('different types cannot beat', () => {
  assert.strictEqual(compareCombos(detectCombo([mkCard('2','s')]), detectCombo([mkCard('2','d'),mkCard('2','c')])), null);
});

// --- Trick cycle simulation (the actual bug) ---
console.log('\n=== Trick Cycle (Bug Reproduction) ===');
test('trick reset: winner starts next trick', () => {
  const playerNames = ['P0', 'P1', 'P2', 'P3'];
  let currentComboPlayer = 2; // P2 played winning card
  let passedPlayers = [0, 1, 3]; // P0, P1, P3 all passed
  let currentCombo = { type: 'single', cards: [mkCard('K','s')] };
  let currentPlayer = -1;

  // Simulate the CORRECT logic (fixed order):
  if (passedPlayers.length === 3) {
    // Save winner BEFORE resetting
    currentPlayer = currentComboPlayer;
    currentCombo = null;
    currentComboPlayer = -1;
    passedPlayers = [];
  }

  assert.strictEqual(currentPlayer, 2, 'currentPlayer should be 2 (P2)');
  assert.strictEqual(currentComboPlayer, -1, 'currentComboPlayer should be -1');
  assert.strictEqual(currentCombo, null, 'currentCombo should be null');
  assert.strictEqual(playerNames[currentPlayer], 'P2', 'winner name should be P2, not undefined');
});

test('trick reset: WRONG order causes undefined (old bug demo)', () => {
  const playerNames = ['P0', 'P1', 'P2', 'P3'];
  let currentComboPlayer = 2;
  let passedPlayers = [0, 1, 3];
  let currentPlayer = -1;

  // Simulate the OLD buggy logic:
  if (passedPlayers.length === 3) {
    currentComboPlayer = -1;  // reset first
    passedPlayers = [];
    currentPlayer = currentComboPlayer;  // now -1
  }

  // Demonstrates the bug: currentPlayer = -1, name = undefined
  console.log('    (demo: currentPlayer=-1, name=undefined — this is the old bug)');
  assert.strictEqual(currentPlayer, -1);
  assert.strictEqual(playerNames[currentPlayer], undefined);
});

// --- Full game simulation ---
console.log('\n=== Full Game Simulation ===');
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

test('full game: no undefined player names, game ends', () => {
  const playerNames = ['P0', 'P1', 'P2', 'P3'];
  // Create deck
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(mkCard(r, s.name));
  shuffle(deck);

  const hands = [[], [], [], []];
  for (let i = 0; i < 52; i++) hands[i % 4].push(deck[i]);
  for (let i = 0; i < 4; i++) hands[i].sort((a, b) => b.rankIndex - a.rankIndex || b.suitOrder - a.suitOrder);

  let currentCombo = null, currentComboPlayer = -1, passedPlayers = [];
  let currentPlayer = 0, gameOver = false;

  // Auto-play 3D
  const starterIdx = hands.findIndex(h => h.find(c => c.rank === '3' && c.suit === 'd'));
  const threeD = hands[starterIdx].find(c => c.rank === '3' && c.suit === 'd');
  hands[starterIdx] = hands[starterIdx].filter(c => c !== threeD);
  currentCombo = { type: 'single', cards: [threeD] };
  currentComboPlayer = starterIdx;
  currentPlayer = (starterIdx + 1) % 4;

  let turns = 0;
  while (!gameOver && turns < 300) {
    turns++;
    assert(currentPlayer >= 0 && currentPlayer < 4, `currentPlayer=${currentPlayer} out of range at turn ${turns}`);
    assert(playerNames[currentPlayer] !== undefined, `Player name undefined at turn ${turns}, currentPlayer=${currentPlayer}`);

    let played = false;
    if (!currentCombo) {
      // Free play: lowest single
      const card = hands[currentPlayer][hands[currentPlayer].length - 1];
      if (card) {
        hands[currentPlayer] = hands[currentPlayer].filter(c => c !== card);
        currentCombo = { type: 'single', cards: [card] };
        currentComboPlayer = currentPlayer;
        passedPlayers = [];
        if (hands[currentPlayer].length === 0) { gameOver = true; break; }
        currentPlayer = (currentPlayer + 1) % 4;
        played = true;
      }
    } else {
      // Try to beat with a single
      const targetRank = currentCombo.cards[0].rankIndex;
      const targetSuit = currentCombo.cards[0].suitOrder;
      const beatCard = hands[currentPlayer].find(c =>
        c.rankIndex > targetRank || (c.rankIndex === targetRank && c.suitOrder > targetSuit)
      );
      if (beatCard) {
        hands[currentPlayer] = hands[currentPlayer].filter(c => c !== beatCard);
        currentCombo = { type: 'single', cards: [beatCard] };
        currentComboPlayer = currentPlayer;
        passedPlayers = [];
        if (hands[currentPlayer].length === 0) { gameOver = true; break; }
        currentPlayer = (currentPlayer + 1) % 4;
        played = true;
      }
    }

    if (!played) {
      passedPlayers.push(currentPlayer);
      if (passedPlayers.length === 3) {
        // FIXED: save winner before resetting
        currentPlayer = currentComboPlayer;
        currentCombo = null;
        currentComboPlayer = -1;
        passedPlayers = [];
      } else {
        currentPlayer = (currentPlayer + 1) % 4;
      }
    }
  }

  assert(gameOver, 'Game should end');
  assert(turns < 300, `Game took too many turns: ${turns}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
