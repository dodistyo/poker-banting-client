// Menu drawer (top-right hamburger, every viewport) — the room's "meta" home:
// room code + copy, and a two-tap-confirmed Leave.
//
// Two driving modes, matching the rest of the suite:
//   1. Injected state (helpers.js) for the label / copy / two-tap UI logic —
//      deterministic, no bot timing.
//   2. Real Rust server for the behavioral cases: hamburger show/hide per
//      phase, a mid-game Leave that converts the seat to a bot while a second
//      human keeps playing, and a creator "Close Room" that dissolves a public
//      room (waiting-room button — the dissolve is a lobby-only action).
//
// Label semantics (server-verified in rooms.rs):
//   - Mid-game Leave (the drawer's reachable case): seat becomes a bot, the
//     game continues for the remaining humans. Always "Leave Room".
//   - Lobby "Close Room": creator of a PUBLIC room -> the room dissolves for
//     everyone. Lives on the waiting-room screen (party-leave-btn), which the
//     hamburger does not replace.
import { test, expect } from '@playwright/test';
import {
  makeServerState, makeHand, injectCreated, waitForPhase, watch,
  waitForConnected, createRoomViaUI, startGameViaUI,
} from './helpers.js';

const hands = [
  makeHand(13, 0),
  makeHand(13, 13),
  makeHand(13, 26),
  makeHand(13, 39),
];

// Inject a mid-game state where `pid` is the human (id===0 is the creator).
async function midGame(page, { pid = 0, phase = 'playing', names } = {}) {
  await page.goto('/');
  const ss = makeServerState({ phase, currentPlayer: 0, hands, names });
  // makeServerState marks i===0 as creator; keep that unless overridden.
  await injectCreated(page, ss, { playerId: pid, code: 'CODE12' });
  await waitForPhase(page, phase);
  await watch(page);
}

// Two-client helper (mirrors 04): a fresh context joins with the code.
async function joinRoomViaUI(page, code, name) {
  await page.goto('/');
  await waitForConnected(page);
  await page.locator('li', { hasText: 'Join Game' }).click();
  await page.locator('#lobby-join-name-input').fill(name);
  await page.locator('#lobby-code-input').fill(code);
  await page.click('#lobby-screen-join .lobby-submit-btn');
  await page.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
}

// ── Injected-state UI tests ──────────────────────────────────────────────

test('drawer shows the room code + a working copy button (mid-game)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3000' });
  await midGame(page, { pid: 1 }); // non-creator human mid-game

  await expect(page.locator('#menu-toggle-btn')).toBeVisible();
  await page.click('#menu-toggle-btn');
  await expect(page.locator('#menu-drawer')).toHaveClass(/open/);
  await expect(page.locator('#menu-drawer-code')).toHaveText('CODE12');

  // Copy puts the code on the clipboard (secure context -> navigator.clipboard).
  await page.click('#menu-copy-btn');
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toBe('CODE12');
});

test('mid-game drawer leave is "Leave Room" with the bot subtext', async ({ page }) => {
  await midGame(page, { pid: 1 });
  await page.click('#menu-toggle-btn');
  await expect(page.locator('#menu-leave-label')).toHaveText('Leave Room');
  await expect(page.locator('#menu-leave-sub')).toHaveText(/bot/i);
  // Mid-game is never the dissolve case -> not the red danger style.
  await expect(page.locator('#menu-leave-btn')).not.toHaveClass(/danger/);
});

test('creator of a public room sees "Close Room" (danger) in the waiting room', async ({ page }) => {
  // Lobby phase, creator (id 0), public -> the waiting-room leave button
  // relabels to "Close Room" (dissolve) and turns red.
  await page.goto('/');
  await injectCreated(page, makeServerState({ phase: 'lobby' }), { playerId: 0, code: 'CODE12' });
  await waitForPhase(page, 'lobby');
  await watch(page);
  await expect(page.locator('#party-leave-btn')).toHaveText('Close Room');
  const bg = await page.locator('#party-leave-btn').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toMatch(/rgb\(122,\s*31,\s*43\)/); // #7a1f2b
});

test('non-creator in the waiting room sees plain "Leave"', async ({ page }) => {
  await page.goto('/');
  await injectCreated(page, makeServerState({ phase: 'lobby' }), { playerId: 1, code: 'CODE12' });
  await waitForPhase(page, 'lobby');
  await watch(page);
  await expect(page.locator('#party-leave-btn')).toHaveText('Leave');
});

test('two-tap confirm: first tap arms, second tap fires the leave', async ({ page }) => {
  await midGame(page, { pid: 1 });
  await page.click('#menu-toggle-btn');

  // Record outgoing WS messages to prove the second tap actually sent leave.
  await page.evaluate(() => {
    window.__sent = [];
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try { window.__sent.push(JSON.parse(data)); } catch { /* keep raw */ }
      return orig.call(this, data);
    };
  });

  // Tap 1: arms the confirm (label changes, red pulse), no leave sent yet.
  await page.click('#menu-leave-btn');
  await expect(page.locator('#menu-leave-label')).toHaveText('Tap Again to Confirm');
  await expect(page.locator('#menu-leave-btn')).toHaveClass(/confirming/);
  expect(await page.evaluate(() => (window.__sent || []).some(m => m && m.type === 'leaveRoom'))).toBe(false);

  // Tap 2 (within the 3s window): fires the leave.
  await page.click('#menu-leave-btn');
  await expect.poll(async () =>
    page.evaluate(() => (window.__sent || []).some(m => m && m.type === 'leaveRoom'))
  ).toBe(true);
});

test('Escape and the backdrop both close the drawer', async ({ page }) => {
  await midGame(page, { pid: 1 });
  await page.click('#menu-toggle-btn');
  await expect(page.locator('#menu-drawer')).toHaveClass(/open/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-drawer')).not.toHaveClass(/open/);

  // Reopen, then dismiss via the backdrop (click the darkened left region).
  await page.click('#menu-toggle-btn');
  await expect(page.locator('#menu-drawer')).toHaveClass(/open/);
  await page.mouse.click(20, 200); // far left, over the backdrop only
  await expect(page.locator('#menu-drawer')).not.toHaveClass(/open/);
});

// ── Real-server behavioral tests ─────────────────────────────────────────

test('real server: hamburger hidden in lobby, visible in play, drawer shows the live code', async ({ page }) => {
  await createRoomViaUI(page, 'Dodi');
  const code = (await page.locator('#party-code').textContent()).trim();

  // Waiting room (lobby): the hamburger is hidden — the room has its own
  // Leave/Close button on the party screen.
  await expect(page.locator('#menu-toggle-btn')).toBeHidden();

  await startGameViaUI(page);
  await waitForPhase(page, 'playing');
  // In the game: the hamburger appears and the drawer carries the room code.
  await expect(page.locator('#menu-toggle-btn')).toBeVisible();
  await page.click('#menu-toggle-btn');
  await expect(page.locator('#menu-drawer-code')).toHaveText(code);
  await page.keyboard.press('Escape');
  await watch(page, 1500); // viewer: the live table with the menu available
});

test('real server: mid-game Leave turns the seat into a bot, the other human continues', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // A creates, B joins (two humans + two bots), B readies, A starts.
  await createRoomViaUI(pageA, 'Dodi');
  const code = (await pageA.locator('#party-code').textContent()).trim();
  await joinRoomViaUI(pageB, code, 'Olivia');
  await pageB.click('#party-ready-btn');
  await pageA.click('#party-start-btn');
  await waitForPhase(pageA, 'playing');
  await waitForPhase(pageB, 'playing');

  // A opens the drawer mid-game and leaves (two-tap confirm).
  await pageA.click('#menu-toggle-btn');
  await expect(pageA.locator('#menu-drawer')).toHaveClass(/open/);
  await pageA.click('#menu-leave-btn'); // arm
  await pageA.click('#menu-leave-btn'); // fire
  // A is back at the main menu with the hamburger gone.
  await expect(pageA.locator('#lobby-screen-main.active')).toBeVisible();
  await expect(pageA.locator('#menu-toggle-btn')).toBeHidden();

  // B stays in the game and now sees A's seat as a bot named "Bot (Dodi)".
  await expect.poll(async () => pageB.evaluate(() => {
    const s = window.__app_getState();
    const p = s && s.players && s.players[0];
    return p ? (p.isBot && p.name === 'Bot (Dodi)') : false;
  })).toBe(true);
  // B is still a connected human (id 1) in the playing phase.
  await expect(pageB.locator('#table-area')).toHaveAttribute('data-phase', 'playing');

  await ctxA.close();
  await ctxB.close();
});

test('real server: creator "Close Room" (waiting room) dissolves the public room', async ({ page }) => {
  await createRoomViaUI(page, 'Dodi');
  const code = (await page.locator('#party-code').textContent()).trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  // Public + creator -> the waiting-room button reads "Close Room".
  await expect(page.locator('#party-leave-btn')).toHaveText('Close Room');

  // Single tap on the waiting-room button (it is NOT two-tap; the two-tap
  // confirm is a drawer-only protection for mid-game leaves).
  await page.click('#party-leave-btn');
  // A is ejected back to the main menu; the hamburger is hidden.
  await expect(page.locator('#lobby-screen-main.active')).toBeVisible();
  await expect(page.locator('#menu-toggle-btn')).toBeHidden();
});

// ── Mobile viewport ──────────────────────────────────────────────────────

test('mobile viewport: drawer is usable, code + copy + two-tap leave all present', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // phone portrait
  await midGame(page, { pid: 1 });

  await expect(page.locator('#menu-toggle-btn')).toBeVisible();
  await page.click('#menu-toggle-btn');
  await expect(page.locator('#menu-drawer')).toHaveClass(/open/);
  await expect(page.locator('#menu-drawer-code')).toHaveText('CODE12');
  await expect(page.locator('#menu-copy-btn')).toBeVisible();
  await expect(page.locator('#menu-leave-btn')).toBeVisible();
  await expect(page.locator('#menu-leave-label')).toHaveText('Leave Room');
  // Touch target big enough (>= 44px tall) for a finger.
  const box = await page.locator('#menu-toggle-btn').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});
