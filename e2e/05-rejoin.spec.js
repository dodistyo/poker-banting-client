// Manual rejoin via localStorage session over the REAL server.
//
// Rejoin is MANUAL (user decision 2026-09): after a reload the client shows
// the main menu — and only when a saved session (code+name+token) exists, a
// "Rejoin Room" item appears ABOVE "New Game". Clicking it sends the
// `rejoin` and the server restores the same seat. Nothing auto-fires on
// connect anymore (the old auto-rejoin would yank the user straight into the
// table on every page load).
import { test, expect } from '@playwright/test';
import { waitForConnected, waitForPhase, watch, createRoomViaUI, startGameViaUI } from './helpers.js';

async function ownHandDealt(page) {
  return page.evaluate(() => {
    const s = window.__app_getState();
    if (!s || !Array.isArray(s.hands) || s.hands.length !== 4) return false;
    const pid = window.__app_getPlayerId?.() ?? 0;
    const hand = s.hands[pid] || [];
    return hand.length >= 9 && hand.length <= 13 && !hand.some(c => c.rank === '3');
  });
}

const rejoinItem = (page) => page.locator('#lobby-rejoin-item');

test('no saved session -> Rejoin item hidden (fresh start)', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);
  await expect(rejoinItem(page)).toBeHidden();
});

test('reload shows manual Rejoin on top of New Game; clicking it restores the seat', async ({ page }) => {
  // Create + start a real room (same proven path as the 01 spec).
  await createRoomViaUI(page, 'Dodi');
  const code = (await page.locator('#party-code').textContent()).trim();

  await startGameViaUI(page);
  await waitForPhase(page, 'playing');
  await expect(ownHandDealt(page)).resolves.toBe(true);
  await watch(page, 2000); // viewer: the live table before the reload

  // Reload: WS drops, session persists in localStorage. Rejoin is now
  // MANUAL — we must land on the main menu (NOT auto-teleported to the
  // table) with the amber Rejoin item visible, ABOVE New Game.
  await page.reload();
  await waitForConnected(page);

  // No auto-rejoin: state is null and we're on the main lobby screen.
  await expect(rejoinItem(page)).toBeVisible();
  await expect(page.evaluate(() => window.__app_getState() == null)).resolves.toBe(true);
  await expect(page.locator('#lobby-screen-main.active')).toBeVisible();
  // The item is the FIRST entry of the lobby menu (above "New Game").
  const firstItem = page.locator('#lobby-screen-main .lobby-menu li').first();
  await expect(firstItem).toHaveClass(/rejoin/);
  // The saved room code is surfaced on the item.
  await expect(rejoinItem(page)).toContainText(code);

  // Viewer: the manual menu beat.
  await watch(page, 1500);

  // Manual click -> server restores the same seat.
  await rejoinItem(page).click();
  await waitForPhase(page, 'playing');
  await expect(ownHandDealt(page)).resolves.toBe(true);
  // Room code lives in the menu drawer (rejoined session preserved it)
  await page.click('#menu-toggle-btn');
  await expect(page.locator('#menu-drawer-code')).toHaveText(code);
  // Seat must be the human seat again, not a renamed bot.
  const myName = await page.evaluate(() => {
    const s = window.__app_getState();
    const pid = window.__app_getPlayerId?.() ?? 0;
    return s?.players?.[pid]?.name;
  });
  expect(myName).toBe('Dodi');
  // Regression: opponent hands must carry a real handCount on the rejoin
  // wire. The server used to round-trip the personalised state through the
  // GameState struct (no handCount field), dropping the count — the client
  // then fell back to hand.length === 0 and every opponent rendered
  // "0 cards" after a refresh. The live table before the reload proves the
  // counts were >0 at that moment, so a 0 after rejoin is a state loss.
  const oppCounts = await page.evaluate(() => {
    const s = window.__app_getState();
    const pid = window.__app_getPlayerId?.() ?? 0;
    return (s?.players || [])
      .filter(p => p.id !== pid)
      .map(p => p.handCount ?? (p.hand ? p.hand.length : 0));
  });
  expect(oppCounts.length).toBe(3);
  for (const c of oppCounts) {
    expect(c, `opponent handCount must be >0 after rejoin, got ${c}`).toBeGreaterThan(0);
  }
  await watch(page, 2000); // viewer: back on the table
});
