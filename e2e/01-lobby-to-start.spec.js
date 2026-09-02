// Happy path through the REAL Rust server:
// connect -> create room -> start -> cards dealt -> play phase.
//
// The three-discard (dropping rank-"3" cards) is intentional gameplay:
// who gets rid of their 3s first leads the first trick. The server runs
// it automatically, so after start the client lands in the `playing`
// phase and the human hand has 9..13 cards with no "3" rank.
import { test, expect } from '@playwright/test';
import { createRoomViaUI, startGameViaUI, humanCardCount, watch } from './helpers.js';

test('lobby to game start over real server', async ({ page }) => {
  await createRoomViaUI(page, 'Dodi');

  // Party screen shows our room code and the host row
  const partyCode = page.locator('#lobby-screen-party.active #party-code');
  await expect(partyCode).toBeVisible();
  await expect(partyCode).toHaveText(/^[A-Z0-9]{6}$/);
  await expect(page.locator('#party-player-list tbody tr').first())
    .toContainText('Dodi');

  // Host sees the Start Game button (creator only)
  await expect(page.locator('#party-start-btn')).toBeVisible();
  await startGameViaUI(page);

  // Lobby is gone, table is showing, and we're in the play phase
  await expect(page.locator('#lobby-overlay')).toBeHidden();
  await expect(page.locator('#table-area[data-phase]')).toBeVisible();
  await expect(page.locator('#table-area')).toHaveAttribute('data-phase', 'playing');

  // Cards are dealt: human hand is non-empty, between 9 and 13 cards,
  // and contains no "3" rank (the three-discard removed them).
  await expect.poll(() => humanCardCount(page), { timeout: 10_000 }).toBeGreaterThan(0);
  await watch(page, 2500); // let the viewer watch the deal land on the table
  const handInfo = await page.evaluate(() => {
    const s = window.__app_getState();
    const ranks = s.hands[0].map(c => c.rank);
    return { len: s.hands[0].length, hasThree: ranks.includes('3') };
  });
  expect(handInfo.len).toBeGreaterThanOrEqual(9);
  expect(handInfo.len).toBeLessThanOrEqual(13);
  expect(handInfo.hasThree).toBe(false);

  // Room code moved to the menu drawer (top-right hamburger)
  await expect(page.locator('#menu-toggle-btn')).toBeVisible();
  await page.click('#menu-toggle-btn');
  await expect(page.locator('#menu-drawer')).toHaveClass(/open/);
  await expect(page.locator('#menu-drawer-code')).toHaveText(await partyCode.textContent());
  await expect(page.locator('#menu-copy-btn')).toBeEnabled();

  // Three bots were added to fill the table
  await expect(page.locator('.bot-badge')).toHaveCount(3);
});
