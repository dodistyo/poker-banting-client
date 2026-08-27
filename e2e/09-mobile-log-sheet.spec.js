// Mobile game-log bottom sheet.
// On mobile (≤768px portrait / short landscape) the sidebar's #log is
// display:none, so log entries are mirrored into #sheet-log — a bottom sheet
// opened by the "📜 Game Log" pill (#log-fab-btn) which lives INSIDE the
// bottom strip (#sidebar) — the name+points bar — NOT in the top header
// (user preference: bottom center, not the top bar). Covers:
//  - pill visible on mobile inside the bottom strip, absent from #header
//  - open → entries render into #sheet-log (same content as state.log)
//  - incremental appends on new state messages
//  - close via X button and via backdrop
//  - sheet auto-closes on new game (created) and on game over
//  - desktop regression: #log still renders in the sidebar, pill hidden
import { test, expect } from '@playwright/test';
import { makeServerState, injectCreated, injectState } from './helpers.js';

const MOBILE = { width: 390, height: 844 }; // iPhone-ish portrait

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
});

test('mobile: pill visible in the bottom strip (not the top bar), sheet opens with entries', async ({ page }) => {
  await page.goto('/');
  await injectCreated(page, makeServerState({
    log: ['Game started', 'Dodi leads with 9♠', 'Bot 2 follows with K♠'],
  }));

  // The pill lives in the bottom strip (#sidebar), which on mobile holds the
  // name+points chips — and it must NOT be in the top header bar.
  await expect(page.locator('#log-fab-btn')).toBeVisible();
  expect(await page.locator('#sidebar #log-fab-btn').count()).toBe(1);
  expect(await page.locator('#header #log-fab-btn').count()).toBe(0);
  // It sits below the name+points chips and is centered relative to the strip
  // itself (not the viewport — a vertical scrollbar can shrink the strip's
  // width, and the pill must stay centered on the strip the user taps).
  const geo = await page.evaluate(() => {
    const fab = document.getElementById('log-fab-btn').getBoundingClientRect();
    const chips = document.getElementById('scoreboard').getBoundingClientRect();
    const sb = document.getElementById('sidebar').getBoundingClientRect();
    return {
      fabCx: fab.x + fab.width / 2,
      sbCx: sb.x + sb.width / 2,
      chipBottom: chips.bottom,
      fabTop: fab.top,
      sbBottom: sb.bottom,
      vh: window.innerHeight,
    };
  });
  expect(geo.fabTop).toBeGreaterThan(geo.chipBottom);          // below the chips
  expect(Math.abs(geo.fabCx - geo.sbCx)).toBeLessThan(3);      // centered on strip
  expect(geo.sbBottom).toBeLessThanOrEqual(geo.vh + 1);        // strip not clipped off-screen
  // The sidebar log itself is display:none
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

test('short landscape: pill visible in the bottom strip and sheet opens', async ({ page }) => {
  // Phone rotated: height < 560 landscape → sidebar becomes a fixed strip,
  // #log hidden → the "📜 Game Log" pill must appear in the strip too.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await injectCreated(page, makeServerState({ log: ['Game started'] }));

  await expect(page.locator('#sidebar #log-fab-btn')).toBeVisible();
  expect(await page.locator('#header #log-fab-btn').count()).toBe(0);
  await page.click('#log-fab-btn');
  await expect(page.locator('#log-sheet')).toHaveClass(/open/);
  await expect(page.locator('#sheet-log .log-entry')).toHaveCount(1);
});
