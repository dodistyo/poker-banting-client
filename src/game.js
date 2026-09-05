const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUITS = [
  { name: 'diamonds', symbol: '\u2666', order: 0 },
  { name: 'clubs', symbol: '\u2663', order: 1 },
  { name: 'hearts', symbol: '\u2665', order: 2 },
  { name: 'spades', symbol: '\u2660', order: 3 }
];

export function rankIndex(r) { return RANKS.indexOf(r); }
export function suitOrder(s) { return SUITS.find(su => su.name === s).order; }

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit: suit.name, suitSymbol: suit.symbol, suitOrder: suit.order, rankIndex: rankIndex(rank) });
    }
  }
  return deck;
}

export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function cardLabel(c) { return c.rank + c.suitSymbol; }

export function sortCards(cards) {
  return [...cards].sort((a, b) => b.rankIndex - a.rankIndex || b.suitOrder - a.suitOrder);
}

export function detectCombo(cards) {
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

export function isStraight(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => a - b);
  if (unique.length < 3) return false;
  // A (12) and 2 (13) never appear in straights
  if (unique.some(r => r >= 11)) return false;
  // Number straight: 3-10 (indices 0-7), 3-5 consecutive cards
  const allNumbers = unique.every(r => r <= 7);
  // Letter straight: exactly J-Q-K (indices 8-10)
  const allLetters = unique.length === 3 && unique.every(r => r >= 8 && r <= 10);
  if (!allNumbers && !allLetters) return false;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] !== unique[i - 1] + 1) return false;
  }
  return true;
}

export function compareCombos(comboA, comboB) {
  if (comboA.type !== comboB.type) return null;

  switch (comboA.type) {
    case 'single': {
      const aHigh = comboA.cards[comboA.cards.length - 1];
      const bHigh = comboB.cards[comboB.cards.length - 1];
      return aHigh.rankIndex - bHigh.rankIndex;
    }
    case 'pair':
    case 'triple':
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

export function compareByRankThenSuit(cardsA, cardsB) {
  const aHigh = cardsA[cardsA.length - 1];
  const bHigh = cardsB[cardsB.length - 1];
  return aHigh.rankIndex - bHigh.rankIndex;
}

export function validatePlay(cards, tableCombo) {
  if (!cards || cards.length === 0) return { valid: false, error: 'No cards selected', comboName: '' };

  const combo = detectCombo(cards);
  if (!combo) return { valid: false, error: 'Invalid combo', comboName: '' };

  if (tableCombo) {
    if (combo.cards.length !== tableCombo.cards.length || combo.type !== tableCombo.type)
      return { valid: false, error: 'Must match: ' + comboName(tableCombo) + ' (' + tableCombo.cards.length + ' cards).', comboName: comboName(combo) };
    if (compareCombos(combo, tableCombo) <= 0)
      return { valid: false, error: 'Cannot beat: ' + tableCombo.cards.map(cardLabel).join(' '), comboName: comboName(combo) };
  }

  return { valid: true, error: '', comboName: comboName(combo), combo };
}

export function comboName(combo) {
  const names = {
    single: 'Single', pair: 'Pair', triple: 'Triple',
    straight: 'Straight', fullhouse: 'Full House',
    fourkind: 'Four of a Kind'
  };
  return names[combo.type] || combo.type;
}


