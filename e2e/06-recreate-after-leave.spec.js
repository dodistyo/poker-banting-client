// Regression: the "create -> waiting room -> back arrow -> new game ->
// create again" edge case.
//
// Root cause this guards against: the server closes the WebSocket on
// LeaveRoom, and sendLeaveRoom() nulls connectUrl to stop auto-reconnect.
// createRoom() used to do a bare send() on that dead socket — which drops
// the message SILENTLY (send() checks readyState and gives up) — so every
// subsequent lobby action (create/join/rejoin) was dead until a full page
// reload. The fix routes create/join/rejoin through ensureConnected(),
// which reuses-or-reopens the socket first.
//
// This test drives the real UI path (the party-screen back arrow is the
// same __app_leaveRoom() as the Leave button) over the REAL Rust server,
// so it fails loudly if the socket is ever dead again at create time.
import { test, expect } from '@playwright/test';
import { createRoomViaUI, waitForConnected } from './helpers.js';

test('re-create room after leaving via back arrow', async ({ page }) => {
  // --- First room, through the normal UI path ---
  await createRoomViaUI(page, 'Dodi');
  const partyCode = page.locator('#lobby-screen-party.active #party-code');
  await expect(partyCode).toBeVisible();
  const firstCode = (await partyCode.textContent()).trim();
  expect(firstCode).toMatch(/^[A-Z0-9]{6}$/);

  // --- The exact repro: press the back arrow in the waiting room ---
  await page.click('#lobby-screen-party.active .lobby-back-icon');
  await expect(page.locator('#lobby-screen-main.active')).toBeVisible();

  // --- New Game -> create a SECOND room (this was the silent no-op) ---
  await page.click('li.primary'); // New Game
  await page.locator('#lobby-name-input').fill('Dodi');
  await page.click('#lobby-screen-new .lobby-submit-btn');

  // Second room must materialize. Before the fix the `create` message was
  // dropped on the dead socket and this selector never appeared.
  const secondCodeLoc = page.locator('#lobby-screen-party.active #party-code');
  await expect(secondCodeLoc).toBeVisible({ timeout: 10_000 });
  const secondCode = (await secondCodeLoc.textContent()).trim();
  expect(secondCode).toMatch(/^[A-Z0-9]{6}$/);

  // It's a fresh room, not a stale echo of the first one.
  expect(secondCode).not.toBe(firstCode);

  // We're the host of the new room (Start button is creator-only).
  await expect(page.locator('#party-start-btn')).toBeVisible();
});
