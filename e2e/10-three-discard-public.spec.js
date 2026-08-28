// Three-discard phase: other players' 3s are PUBLIC (they are removed from
// all hands up front and never re-enter play), so the overlay renders each
// opponent's actual 3s face-up — not the old "N 3s" count label.
import { test, expect } from '@playwright/test';
import { makeServerState, injectCreated, watch } from './helpers.js';

// Viewer = player 0. Opponents: p1 has one 3 (diamonds), p2 has none,
// p3 has one 3 (clubs). The server no longer masks playerCards, so the
// client must show the real faces.
const threeDiscardState = {
  phase: 'threeDiscard',
  players: [0, 1, 2, 3].map(i => ({
    id: i,
    name: i === 0 ? 'Dodi' : `Bot ${i + 1}`,
    hand: Array.from({ length: 12 }, (_, k) => ({
      rank: k < 11 ? '5' : '7',
      suit: ['hearts', 'spades', 'clubs', 'diamonds'][k % 4],
    })),
    finished: false,
    isBot: i !== 0,
    connected: true,
    isCreator: i === 0,
  })),
  ready: [true, true, true, true],
  currentPlayer: 1,
  trick: { cards: [], comboType: null, comboPlayer: null, passed: [], played: [] },
  finishedOrder: [],
  scores: [0, 0, 0, 0],
  round: 1,
  totalScores: [0, 0, 0, 0],
  threeDiscard: {
    order: [0, 1, 3, 2], // most-3s / highest-suit first (p0 has 2, p1/p3 1, p2 0)
    index: 1, // p0 already discarded, p1's turn
    playerCards: [
      [
        { rank: '3', suit: 'hearts' },
        { rank: '3', suit: 'spades' },
      ],
      [{ rank: '3', suit: 'diamonds' }],
      [],
      [{ rank: '3', suit: 'clubs' }],
    ],
    playerCounts: [2, 1, 0, 1],
    discarded: [true, false, false, false],
  },
  log: ['Dodi discarded 3 ♥ 3 ♠'],
};

test('opponent 3s render face-up in the three-discard overlay', async ({ page }) => {
  await page.goto('/');
  await injectCreated(page, makeServerState({ log: ['Game started'] }));
  await injectCreated(page, threeDiscardState);
  await watch(page, 800);

  // Overlay is showing and the turn info reflects p1 discarding.
  await expect(page.locator('#three-phase-overlay')).toHaveClass(/show/);
  await expect(page.locator('#three-phase-center-info')).toContainText('Bot 2 is discarding 3s');

  // Every player cell in the grid.
  const cells = page.locator('.three-discard-player');
  await expect(cells).toHaveCount(4);

  // Collect {name, cardTexts} per cell in seat order (posToPlayer from _playerId=0
  // is identity: cell 0=p0, 1=p1, 2=p2, 3=p3).
  const grid = await page.evaluate(() => {
    return [...document.querySelectorAll('.three-discard-player')].map(el => ({
      name: el.querySelector('.tdp-name')?.textContent.trim(),
      cards: [...el.querySelectorAll('.tdp-cards .card')].map(c => ({
        rank: c.querySelector('.rank')?.textContent,
        suit: c.querySelector('.suit')?.textContent,
      })),
      label: el.querySelector('.tdp-cards > span:not(.card)')?.textContent || null,
    }));
  });

  // p0 (self, already discarded): its two 3s still face-up.
  expect(grid[0].name).toBe('Dodi');
  expect(grid[0].cards).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rank: '3', suit: '♥' }),
      expect.objectContaining({ rank: '3', suit: '♠' }),
    ])
  );

  // p1 (Bot 2, active): its single 3 face-up — NOT a "1 3" label.
  expect(grid[1].name).toBe('Bot 2');
  expect(grid[1].cards).toEqual([{ rank: '3', suit: '♦' }]);
  expect(grid[1].label).toBeNull();

  // p2 (Bot 3, no 3s): the count-label fallback renders "no 3s".
  expect(grid[2].name).toBe('Bot 3');
  expect(grid[2].cards).toEqual([]);
  expect(grid[2].label).toBe('no 3s');

  // p3 (Bot 4): its single 3 face-up — NOT a "1 3" label.
  expect(grid[3].name).toBe('Bot 4');
  expect(grid[3].cards).toEqual([{ rank: '3', suit: '♣' }]);
  expect(grid[3].label).toBeNull();
});
