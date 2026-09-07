// Full trick lifecycle and game over, driven entirely by injected state.
// Verifies the center board, pass markers, and the game-over overlay.
//
// Game-over semantics (see showGameOver in src/app.js): the LOSEr is
// finishedOrder[3] (the last to finish). If that's the human -> "You Lost!",
// otherwise "<loser name> Lost!".
import { test, expect } from '@playwright/test';
import { makeServerState, injectCreated, injectState, waitForPhase, watch } from './helpers.js';

const card = (rank, suit) => ({ rank, suit });

test('trick progression: play, pass markers, new trick', async ({ page }) => {
  await page.goto('/');

  // Human leads with a pair
  const humanLead = {
    cards: [card('9', 'spades'), card('9', 'hearts')],
    comboType: 'pair',
    comboPlayer: 0,
    passed: [],
    played: [0],
  };
  await injectCreated(page, makeServerState({ currentPlayer: 1, trick: humanLead }));
  await waitForPhase(page, 'playing');
  await watch(page); // let the viewer see the human's opening pair

  await expect(page.locator('#center-cards .card')).toHaveCount(2);
  await expect(page.locator('#center-info')).toHaveText('Pair by Dodi');

  // Bot 1 passes -> pass marker appears
  await injectState(page, makeServerState({
    currentPlayer: 2,
    trick: { ...humanLead, passed: [1] },
  }));
  await expect(page.locator('#pass-markers .pass-tag')).toHaveCount(1);
  await expect(page.locator('#pass-markers .pass-tag')).toHaveText('Bot 2 Pass');
  await watch(page); // let the viewer see the pass marker

  // Bot 2 beats the pair
  const botBeat = {
    cards: [card('J', 'spades'), card('J', 'clubs')],
    comboType: 'pair',
    comboPlayer: 2,
    passed: [1],
    played: [0, 2],
  };
  await injectState(page, makeServerState({
    currentPlayer: 0,
    trick: botBeat,
  }));
  await expect(page.locator('#center-cards .card')).toHaveCount(2);
  await expect(page.locator('#center-info')).toHaveText('Pair by Bot 3');
  // It's the human's turn again: action bar back
  await expect(page.locator('#action-bar')).toHaveClass(/visible/);
  await watch(page); // let the viewer see the winning pair before the trick ends

  // New trick: center cleared, new leader text
  await injectState(page, makeServerState({
    currentPlayer: 2,
    trick: { cards: [], comboType: null, comboPlayer: null, passed: [], played: [] },
  }));
  await expect(page.locator('#center-cards .card')).toHaveCount(0);
  await expect(page.locator('#pass-markers .pass-tag')).toHaveCount(0);
  await expect(page.locator('#center-info')).toHaveText('New trick — Bot 3 plays first');
  await watch(page); // let the viewer see the fresh trick
});

test('game over: bot loses, human ranked first', async ({ page }) => {
  await page.goto('/');

  // finishedOrder [0,1,2,3]: human finishes 1st, bot 4 is last (the loser).
  // Finished players emptied their hands; the loser keeps the remainder.
  await injectCreated(page, makeServerState({
    phase: 'gameOver',
    currentPlayer: 0,
    hands: [[], [], [], [card('3', 'clubs')]],
    scores: [9, 7, 5, 1],
    finishedOrder: [0, 1, 2, 3],
    round: 2,
    totalScores: [9, 7, 5, 1],
  }));

  await expect(page.locator('#gameover-overlay.show')).toBeVisible();
  // Loser is a bot -> its name, not "You Lost!"
  await expect(page.locator('#winner-text')).toHaveText('Bot 4 Lost!');
  await watch(page); // let the viewer read the result + final table

  const rows = page.locator('#final-scores > div');
  await expect(rows).toHaveCount(4);
  // Round 1: total equals the round score.
  await expect(rows.nth(0)).toHaveText('1st Dodi (9 pts)  ·  Total 9');
  await expect(rows.nth(3)).toHaveText('Last Bot 4 (1 pts)  ·  Total 1');
});

test('game over: human is the loser', async ({ page }) => {
  await page.goto('/');

  // finishedOrder [1,2,3,0]: bots finish before the human; human is last.
  await injectCreated(page, makeServerState({
    phase: 'gameOver',
    hands: [[card('3', 'clubs')], [], [], []],
    scores: [1, 9, 7, 5],
    finishedOrder: [1, 2, 3, 0],
    round: 2,
    totalScores: [1, 9, 7, 5],
  }));

  await expect(page.locator('#gameover-overlay.show')).toBeVisible();
  await expect(page.locator('#winner-text')).toHaveText('You Lost!');
  await watch(page); // let the viewer read the result

  const rows = page.locator('#final-scores > div');
  await expect(rows.nth(0)).toHaveText('1st Bot 2 (9 pts)  ·  Total 9');
  await expect(rows.nth(3)).toHaveText('Last Dodi (1 pts)  ·  Total 1');
});
