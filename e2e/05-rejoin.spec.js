// Rejoin via localStorage session over the REAL server.
//
// One context, one client: create a room, start it, reload the page. On
// reconnect the client reads its saved session (code + name + token) from
// localStorage and sends a `rejoin`; the server restores the same seat.
//
// NOTE: kept separate from 04 (two-client) so a server rejoin quirk in one
// doesn't mask the other. If this fails, it's a server-side rejoin problem,
// not a client storage problem.
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

test('rejoin after reload restores the same seat', async ({ page }) => {
  // Create + start a real room (same proven path as the 01 spec).
  await createRoomViaUI(page, 'Dodi');
  const code = (await page.locator('#party-code').textContent()).trim();

  await startGameViaUI(page);
  await waitForPhase(page, 'playing');
  await expect(ownHandDealt(page)).resolves.toBe(true);
  await watch(page, 2000); // viewer: the live table before the reload

  // Reload: WS drops, session persists in localStorage, client must rejoin.
  await page.reload();
  await waitForConnected(page);
  await waitForPhase(page, 'playing');
  await expect(ownHandDealt(page)).resolves.toBe(true);
  await expect(page.locator('#room-code-header')).toHaveText('Room: ' + code);
  // Seat must be the human seat again, not a renamed bot.
  const myName = await page.evaluate(() => {
    const s = window.__app_getState();
    const pid = window.__app_getPlayerId?.() ?? 0;
    return s?.players?.[pid]?.name;
  });
  expect(myName).toBe('Dodi');
  await watch(page, 2000); // viewer: back on the table
});
