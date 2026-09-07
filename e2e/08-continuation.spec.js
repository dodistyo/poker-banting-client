// Game continuation ("sesi unlimited").
//
// Round 1 ends -> game-over overlay shows the round points AND the running
// session total -> "Main Lagi" drops the overlay onto the waiting room
// (server auto-readies everyone, WebSocket stays open) -> creator presses
// Start Game -> round 2 deals straight into Playing (NO three-discard) with
// the previous round's #1 leading.
//
// Tests 1-2 drive the overlay flow with injected state (deterministic).
// Test 3 is the only real-server full-round test: it plays an entire round
// against 3 bots, so it is SLOW (bot delay 2.5s x ~28 tricks) and needs a
// long timeout. Human strategy is ALWAYS-LEGAL by construction:
//   - lead (empty table)  -> play highest single (valid on empty table)
//   - follow (table busy) -> pass (legal: I am never the combo player,
//     because a trick always completes before the table cycles back to the
//     combo player — see check_trick_complete in rules.rs)
// This guarantees the round finishes no matter what the bots play.
import { test, expect } from '@playwright/test';
import { makeServerState, injectCreated, injectState, waitForPhase, waitForConnected, createRoomViaUI, startGameViaUI } from './helpers.js';

const card = (rank, suit) => ({ rank, suit });

// The human is player 0 (creator) in every injected state.
// Card DOM keys are 'c<rankIdx>_<suitIdx>' (see render.js cardKey), NOT
// 'rank:suit' — so we drive selection through the app's own selectCard()
// (the same path a real click uses) instead of clicking a data-key selector.
function highestSingleCard(page) {
  return page.evaluate(() => {
    const s = window.__app_getState();
    const pid = window.__app_getPlayerId?.() ?? 0;
    const hand = s?.hands?.[pid] || [];
    let best = null;
    for (const c of hand) {
      if (best === null || c.rankIndex > best.rankIndex) best = c;
    }
    return best ? { idx: hand.indexOf(best), key: best.rank + ':' + best.suit } : null;
  });
}

async function playOrPass(page, maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    const turn = await page.evaluate(() => {
      const s = window.__app_getState();
      const pid = window.__app_getPlayerId?.() ?? 0;
      return s && !s.gameOver && !s.threePhase && s.currentPlayer === pid
        && !(s.trick && s.trick.passed.includes(pid));
    });
    if (!turn) {
      await page.waitForTimeout(400);
      continue;
    }
    const tableCombo = await page.evaluate(
      () => window.__app_getState().trick?.combo || null
    );
    if (!tableCombo) {
      // Leading an empty table: the highest single is always valid.
      const best = await highestSingleCard(page);
      if (best) {
        await page.evaluate(([pid, ci]) => window.selectCard(pid, ci), [
          (await page.evaluate(() => window.__app_getPlayerId?.() ?? 0)),
          best.idx,
        ]);
        const played = await page.evaluate(() => {
          window.playCards();
          const s = window.__app_getState();
          return !(s.trick && s.trick.comboPlayer === null) || s.gameOver;
        });
        if (played) return 'played';
      }
    }
    // Following a live combo: pass is always legal here (I am not the
    // combo player — tricks complete before cycling back to them).
    await page.evaluate(() => window.passTurn());
    return 'passed';
  }
  return 'no-turn';
}

async function humanHandSize(page) {
  return page.evaluate(() => {
    const s = window.__app_getState();
    const pid = window.__app_getPlayerId?.() ?? 0;
    return (s?.hands?.[pid] || []).length;
  });
}

test('game over -> Main Lagi -> waiting room (auto-ready, same room)', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);

  // Human loses round 1; the running total differs from the round score,
  // proving it is an accumulated session value, not a copy of `scores`.
  await injectCreated(page, makeServerState({
    phase: 'gameOver',
    hands: [[card('3', 'clubs')], [], [], []],
    scores: [-15, 10, 5, 0],
    finishedOrder: [1, 2, 3, 0],
    round: 3,
    totalScores: [-5, 17, 8, 0],
  }));

  await expect(page.locator('#gameover-overlay.show')).toBeVisible();
  await expect(page.locator('#winner-text')).toHaveText('You Lost!');
  await expect(page.locator('#gameover-round')).toContainText('Round 2 complete');

  // Round points AND running total are shown per row.
  const rows = page.locator('#final-scores > div');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveText('1st Bot 2 (10 pts)  ·  Total 17');
  await expect(rows.nth(3)).toHaveText('Last Dodi (-15 pts)  ·  Total -5');
  await expect(page.locator('#gameover-total')).toContainText('Session total');

  // Main Lagi: overlay goes away, the SAME room's waiting room shows up,
  // everyone is Ready (server auto-ready on game over), and the session
  // score is visible in the player list.
  await page.evaluate(() => window.playAgain());
  await expect(page.locator('#gameover-overlay.show')).toHaveCount(0);
  await expect(page.locator('#lobby-screen-party.active')).toBeVisible();

  const readyChips = page.locator('#party-player-list tbody span', { hasText: 'Ready' });
  await expect(readyChips).toHaveCount(4);
  // Cumulative score column: Bot 2 leads with 17.
  await expect(page.locator('#party-player-list tbody tr').nth(1)).toContainText('17');
  // Creator still sees Start Game (creator-only button).
  await expect(page.locator('#party-start-btn')).toBeVisible();
  await expect(page.locator('#party-code')).not.toBeEmpty();
});

test('game over -> Keluar leaves the room (old behaviour kept)', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);

  await injectCreated(page, makeServerState({
    phase: 'gameOver',
    hands: [[], [], [], [card('3', 'clubs')]],
    scores: [10, 5, 0, -15],
    finishedOrder: [0, 1, 2, 3],
    round: 2,
    totalScores: [10, 5, 0, -15],
  }));

  await expect(page.locator('#gameover-overlay.show')).toBeVisible();
  await expect(page.locator('#winner-text')).toHaveText('Bot 4 Lost!');

  await page.evaluate(() => window.nextRound());
  await expect(page.locator('#gameover-overlay.show')).toHaveCount(0);
  // Back to the fresh main lobby — the room was left, not continued.
  await expect(page.locator('#lobby-screen-main.active')).toBeVisible();
});

test('real server: full round -> game over -> start again -> round 2 without three-discard', async ({ page }) => {
  test.setTimeout(900_000); // ~5-6 min round at 2.5s bot delay, generous margin

  await createRoomViaUI(page, 'Dodi');
  const code = (await page.locator('#party-code').textContent()).trim();
  await startGameViaUI(page);
  await waitForPhase(page, 'playing');

  // ── Play round 1 to completion ──
  // Drive the human turn directly and let the server's bot loop run the rest.
  // (No up-front waitForFunction(gameOver): the game stalls on the human turn
  // until we actually play, so we must play *while* waiting, not wait first.)
  let safety = 0;
  while (!(await page.evaluate(() => window.__app_getState()?.gameOver))) {
    if (++safety > 2000) throw new Error('round 1 did not reach game over in time');
    await playOrPass(page);
  }

  // ── Round 1 result: overlay with totals ──
  await expect(page.locator('#gameover-overlay.show')).toBeVisible();
  const round1 = await page.evaluate(() => {
    const s = window.__app_getState();
    return { round: s.round, total: s.totalScores, scores: s.scores, phase: s.phase };
  });
  expect(round1.phase).toBe('gameOver');
  // New semantics: the counter bumped the moment round 1 FINISHED.
  expect(round1.round).toBe(2);
  // total == scores after round 1 (the session started at zero).
  expect(round1.total).toEqual(round1.scores);
  await expect(page.locator('#gameover-round')).toContainText('Round 1 complete');

  // ── Continue: Main Lagi -> waiting room -> Start Game ──
  await page.evaluate(() => window.playAgain());
  await expect(page.locator('#lobby-screen-party.active')).toBeVisible();
  await expect(page.locator('#party-player-list tbody span', { hasText: 'Ready' })).toHaveCount(4);

  await page.click('#party-start-btn');
  await waitForPhase(page, 'playing');
  await expect(humanHandSize(page)).resolves.toBe(13); // fresh full hand

  const round2 = await page.evaluate(() => {
    const s = window.__app_getState();
    return { round: s.round, three: s.threePhase, noThree: !s.threeDiscard };
  });
  // The continuation contract: `round` holds the number of the round currently
  // in play (the bump to the NEXT number happens only when THIS round ends),
  // and there is NO three-discard phase.
  expect(round2.round).toBe(2);
  expect(round2.three).toBe(false);
  expect(round2.noThree).toBe(true);

  // Cumulative scores survived the redeal (they carry over, unchanged so far).
  const totalsAfter = await page.evaluate(() => window.__app_getState().totalScores);
  expect(totalsAfter).toEqual(round1.total);
});
