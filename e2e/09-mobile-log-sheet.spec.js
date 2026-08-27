// Mobile game-log bottom sheet.
// On mobile (≤768px portrait / short landscape) the sidebar's #log is
// display:none, so log entries are mirrored into #sheet-log — a bottom sheet
// opened by the 📜 header button (#log-fab-btn). Covers:
//  - FAB visible on mobile, hidden on desktop
//  - open → entries render into #sheet-log (same content as state.log)
//  - incremental appends on new state messages
//  - close via X button and via backdrop
//  - sheet auto-closes on new game (created) and on game over
//  - desktop regression: #log still renders in the sidebar, FAB hidden
import { test, expect } from '@playwright/test';
import { makeServerState, injectCreated, injectState } from './helpers.js';

const MOBILE = { width: 390, height: 844 }; // iPhone-ish portrait

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
});

test('mobile: FAB visible, sidebar log hidden, sheet opens with entries', async ({ page }) => {
  await page.goto('/');
  await injectCreated(page, makeServerState({
    log: ['Game started', 'Dodi leads with 9♠', 'Bot 2 follows with K♠'],
  }));

  // FAB shown on mobile; the sidebar log itself is display:none
  await expect(page.locator('#log-fab-btn')).toBeVisible();
  const logDisplay = await page.evaluate(() =>
    getComputedStyle(document.getElementById('log')).display);
  expect(logDisplay).toBe('none');

  // Sheet starts closed (translated off-screen, no .open class)
  await expect(page.locator('#log-sheet')).not.toHaveClass(/open/);

  await page.click('#log-fab-btn');
  await expect(page.locator('#log-sheet')).toHaveClass(/open/);
  await expect(page.locator('#sheet-backdrop')).toHaveClass(/open/);

  // All three entries rendered, in order
  const sheetLog = page.locator('#sheet-log .log-entry');
  await expect(sheetLog).toHaveCount(3);
  await expect(sheetLog.nth(0)).toHaveText('Game started');
  await expect(sheetLog.nth(2)).toHaveText('Bot 2 follows with K♠');

  // Desktop #log has no entries on mobile? It does render (display:none but
  // DOM is populated) — both containers stay in sync.
  await expect(page.locator('#log .log-entry')).toHaveCount(3);
});

test('mobile: sheet appends incrementally on new state', async ({ page }) => {
  await page.goto('/');
  await injectCreated(page, makeServerState({ log: ['Game started'] }));
  await page.click('#log-fab-btn');
  await expect(page.locator('#sheet-log .log-entry')).toHaveCount(1);

  // New state message with two more entries (same array, longer)
  await injectState(page, makeServerState({
    log: ['Game started', 'Dodi leads with 9♠', 'Bot 3 wins the trick'],
  }));
  const sheetLog = page.locator('#sheet-log .log-entry');
  await expect(sheetLog).toHaveCount(3);
  await expect(sheetLog.nth(2)).toHaveText('Bot 3 wins the trick');
});

test('mobile: closes via X button and via backdrop', async ({ page }) => {
  await page.goto('/');
  await injectCreated(page, makeServerState({ log: ['Game started'] }));
  await page.click('#log-fab-btn');
  await expect(page.locator('#log-sheet')).toHaveClass(/open/);

  await page.click('#sheet-close-btn');
  await expect(page.locator('#log-sheet')).not.toHaveClass(/open/);
  await expect(page.locator('#sheet-backdrop')).not.toHaveClass(/open/);

  // Re-open, then close by tapping the backdrop
  await page.click('#log-fab-btn');
  await expect(page.locator('#log-sheet')).toHaveClass(/open/);
  await page.click('#sheet-backdrop', { position: { x: 10, y: 10 } });
  await expect(page.locator('#log-sheet')).not.toHaveClass(/open/);
});

test('mobile: tapping the FAB area while open closes via backdrop', async ({ page }) => {
  await page.goto('/');
  await injectCreated(page, makeServerState({ log: ['Game started'] }));
  await page.click('#log-fab-btn');
  await expect(page.locator('#log-sheet')).toHaveClass(/open/);

  // While the sheet is open, the backdrop covers the header (and the FAB).
  // A real tap in the FAB area hits the backdrop, which closes the sheet —
  // so "tap the FAB again to close" works via hit-testing, not the button.
  const fab = await page.locator('#log-fab-btn').boundingBox();
  await page.mouse.click(fab.x + fab.width / 2, fab.y + fab.height / 2);
  await expect(page.locator('#log-sheet')).not.toHaveClass(/open/);
  await expect(page.locator('#sheet-backdrop')).not.toHaveClass(/open/);
});

test('mobile: sheet resets and closes on new game', async ({ page }) => {
  await page.goto('/');
  await injectCreated(page, makeServerState({ log: ['Round 1 started', 'Dodi passes'] }));
  await page.click('#log-fab-btn');
  await expect(page.locator('#sheet-log .log-entry')).toHaveCount(2);

  // New game (re-created room, e.g. Main Lagi) clears the log
  await injectCreated(page, makeServerState({
    log: ['Round 2 started'], round: 2, totalScores: [3, 10, 5, 0],
  }));
  await expect(page.locator('#log-sheet')).not.toHaveClass(/open/);
  const sheetLog = page.locator('#sheet-log .log-entry');
  await expect(sheetLog).toHaveCount(1);
  await expect(sheetLog.nth(0)).toHaveText('Round 2 started');
});

test('mobile: sheet auto-closes on game over', async ({ page }) => {
  await page.goto('/');
  await injectCreated(page, makeServerState({ log: ['Game started'] }));
  await page.click('#log-fab-btn');
  await expect(page.locator('#log-sheet')).toHaveClass(/open/);

  await injectState(page, makeServerState({
    phase: 'gameOver',
    hands: [[], [], [], []],
    scores: [10, 5, 0, -15],
    finishedOrder: [0, 1, 2, 3],
    log: ['Game started', 'Dodi finished 1st'],
  }));
  await expect(page.locator('#log-sheet')).not.toHaveClass(/open/);
  // Game-over overlay is up instead
  await expect(page.locator('#gameover-overlay')).toHaveClass(/show/);
});

test('desktop: FAB hidden, sidebar log renders', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await injectCreated(page, makeServerState({ log: ['Game started', 'Bot 2 passes'] }));

  await expect(page.locator('#log-fab-btn')).toBeHidden();
  const logDisplay = await page.evaluate(() =>
    getComputedStyle(document.getElementById('log')).display);
  expect(logDisplay).not.toBe('none');
  await expect(page.locator('#log .log-entry')).toHaveCount(2);
});

test('short landscape: FAB visible and sheet opens', async ({ page }) => {
  // Phone rotated: height < 560 landscape → sidebar becomes a fixed strip,
  // #log hidden → the 📜 button must appear too.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await injectCreated(page, makeServerState({ log: ['Game started'] }));

  await expect(page.locator('#log-fab-btn')).toBeVisible();
  await page.click('#log-fab-btn');
  await expect(page.locator('#log-sheet')).toHaveClass(/open/);
  await expect(page.locator('#sheet-log .log-entry')).toHaveCount(1);
});
