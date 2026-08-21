// Turn-taking and play validation, driven by injected state so it's
// deterministic (no real bot timing). Covers:
//  - action bar hidden on bot turn, visible on human turn
//  - selecting a card enables Play only when the combo is valid
//  - playing a card via the button (server echo simulated by re-injecting)
import { test, expect } from '@playwright/test';
import {
  makeServerState, makeHand, injectCreated, injectState, waitForPhase, humanCardCount, watch,
} from './helpers.js';

// Seat DOM ids map to player ids when the human is player 0 (created as id 0):
//   bottom = #player-0 (you), right = #player-1, top = #player-2, left = #player-3
test('turn badge and action bar follow currentPlayer', async ({ page }) => {
  await page.goto('/');

  // Bot's turn (player 1 = right seat): action bar hidden, right seat THINKING
  await injectCreated(page, makeServerState({ currentPlayer: 1 }));
  await waitForPhase(page, 'playing');
  await watch(page); // let the viewer see the bot's turn
  await expect(page.locator('#action-bar')).not.toHaveClass(/visible/);
  await expect(page.locator('#player-1 .turn-badge')).toHaveText('THINKING...');
  await expect(page.locator('#btn-sort')).toBeDisabled();

  // Human's turn (player 0 = bottom seat): action bar visible, YOUR TURN
  await injectState(page, makeServerState({ currentPlayer: 0 }));
  await watch(page); // let the viewer see the turn flip to the human
  await expect(page.locator('#action-bar')).toHaveClass(/visible/);
  await expect(page.locator('#player-0 .turn-badge')).toHaveText('YOUR TURN');
  await expect(page.locator('#btn-sort')).toBeEnabled();
});

test('card selection gates the Play button on combo validity', async ({ page }) => {
  await page.goto('/');

  // Deterministic hands built here so the "played card" is known in Node scope.
  const humanHand = makeHand(13, 0);
  const played = humanHand[0]; // will become the single on the table
  const humanHandAfter = humanHand.slice(1); // 12 cards, played card removed
  const bot2 = makeHand(13, 13);
  const bot3 = makeHand(13, 26);
  const bot4 = makeHand(13, 39);

  await injectCreated(page, makeServerState({
    currentPlayer: 0,
    hands: [humanHand, bot2, bot3, bot4],
  }));
  await waitForPhase(page, 'playing');
  await watch(page); // let the viewer see the full 13-card hand first

  // Nothing selected -> Play disabled
  const playBtn = page.locator('#btn-play');
  await expect(playBtn).toBeDisabled();

  // Select the first card (a valid single when the table is empty)
  await page.locator('.hand-bottom .card').first().click();
  await expect(page.locator('#combo-preview')).not.toHaveText('');
  await expect(playBtn).toBeEnabled();
  await watch(page); // let the viewer see the selected card + combo preview

  // Click Play: playCards() sends over the (closed) socket; simulate the
  // server's echo by injecting a state where the human played one card and
  // the turn moved to bot 1.
  await playBtn.click();

  await injectState(page, makeServerState({
    currentPlayer: 1,
    hands: [humanHandAfter, bot2, bot3, bot4],
    trick: {
      cards: [played],
      comboType: 'single',
      comboPlayer: 0,
      passed: [],
      played: [0],
    },
  }));

  // Hand shrank to 12, center shows the played card, info names the combo
  await expect.poll(() => humanCardCount(page)).toBe(12);
  await expect(page.locator('#center-cards .card')).toHaveCount(1);
  await expect(page.locator('#center-info')).toHaveText('Single by Dodi');
  // Turn moved to the right seat (bot 1)
  await expect(page.locator('#player-1 .turn-badge')).toHaveText('THINKING...');
  await expect(page.locator('#action-bar')).not.toHaveClass(/visible/);
});
