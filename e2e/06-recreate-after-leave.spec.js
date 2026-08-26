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

// Regression (2nd round): the single-cycle flow above passed, but doing it
// REPEATEDLY broke — two latent races surfaced only after a few cycles:
//
//   1. Stale on-open replay: ensureConnected used to bake the "send create"
//      callback into onOpenCb, so the NEXT reconnect re-fired the PREVIOUS
//      cycle's create on a fresh socket — two rooms, one orphaned.
//   2. Zombie socket: after the server's leaveRoom teardown the local
//      socket's readyState still read OPEN, so the fast path sent the next
//      create into a socket the server no longer read — no response, no
//      close, no error. The Create button became a silent no-op.
//
// Looping the full cycle here is what makes both failures loud instead of
// "works until it suddenly doesn't".
test('repeated create->leave cycles never wedge the lobby', async ({ page }) => {
  test.setTimeout(120_000);
  const cycles = 6;
  const codes = [];
  for (let i = 0; i < cycles; i++) {
    await createRoomViaUI(page, 'LoopDodi');
    const partyCode = page.locator('#lobby-screen-party.active #party-code');
    await expect(partyCode).toBeVisible({ timeout: 10_000 });
    const code = (await partyCode.textContent()).trim();
    expect(code, `cycle ${i + 1}: no room code`).toMatch(/^[A-Z0-9]{6}$/);
    codes.push(code);

    // Leave via the waiting-room back arrow, then straight back in.
    await page.click('#lobby-screen-party.active .lobby-back-icon');
    await expect(page.locator('#lobby-screen-main.active')).toBeVisible();
    await page.click('li.primary'); // New Game
    await page.locator('#lobby-name-input').fill('LoopDodi');
    await page.click('#lobby-screen-new .lobby-submit-btn');
  }

  // Every cycle produced its own room: no replay (which would leave us on a
  // duplicated/stale code) and no zombie socket (which would leave us stuck
  // on the New Game screen with no party code at all).
  expect(new Set(codes).size).toBe(cycles);
});
