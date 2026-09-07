// Round-session features (2026-09-06):
//  1. Room settings are a FIRST-ROUND-ONLY, host-only thing: visible in the
//     initial waiting room (round 1, before the game starts) for the host
//     only, and GONE in the between-rounds waiting room (round already
//     counted) — even for the host.
//  2. The round counter increments the moment a round finishes (server
//     finalizer), so the game-over overlay reads "Round N complete" and the
//     between-rounds waiting room reads "Waiting Room — Round N+1 Next".
//  3. The bottom score strip tracks the CUMULATIVE session total, not the
//     per-round points that reset every deal.
import { test, expect } from '@playwright/test';
import { makeServerState, injectCreated, injectState, waitForPhase, waitForConnected, watch, createRoomViaUI, startGameViaUI } from './helpers.js';

const card = (rank, suit) => ({ rank, suit });

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
    await page.evaluate(() => window.passTurn());
    return 'passed';
  }
  return 'no-turn';
}

test('settings: host sees them in the initial room only; never in the between-rounds room; guests never', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);

  // ── Initial waiting room (round 1, before the first game) ──
  // Host (player 0, creator): settings VISIBLE.
  await injectCreated(page, makeServerState({
    phase: 'lobby',
    round: 1,
    playLimitSecs: 10,
    winningPoint: 50,
  }));
  await expect(page.locator('#lobby-screen-party.active')).toBeVisible();
  await expect(page.locator('#party-settings-section')).toBeVisible();

  // Guest (player 1, not creator): settings HIDDEN.
  await injectCreated(page, makeServerState({
    phase: 'lobby',
    round: 1,
    playLimitSecs: 10,
    winningPoint: 50,
  }), { playerId: 1, code: 'TEST00' });
  await expect(page.locator('#party-settings-section')).toHaveCount(1);
  await expect(page.locator('#party-settings-section')).toBeHidden();

  // ── Between-rounds waiting room (the counter already ticked: round 2) ──
  // Host: settings GONE — the room was created, settings are locked in.
  await injectCreated(page, makeServerState({
    phase: 'lobby',
    round: 2,
    scores: [0, 0, 0, 0],
    totalScores: [10, 5, 0, -15],
    playLimitSecs: 10,
    winningPoint: 50,
  }));
  await expect(page.locator('#party-settings-section')).toBeHidden();
  // And the sub-line announces the next round (title stays "Waiting Room").
  await expect(page.locator('#lobby-screen-party .lobby-header h3')).toHaveText('Waiting Room');
  await expect(page.locator('#party-round-sub')).toHaveText('Round 2 Next');

  // Guest in the between-rounds room: hidden too.
  await injectCreated(page, makeServerState({
    phase: 'lobby',
    round: 2,
    scores: [0, 0, 0, 0],
    totalScores: [10, 5, 0, -15],
    playLimitSecs: 10,
    winningPoint: 50,
  }), { playerId: 1, code: 'TEST00' });
  await expect(page.locator('#party-settings-section')).toBeHidden();

  // Initial room again (fresh creation): host sees them.
  await injectCreated(page, makeServerState({
    phase: 'lobby',
    round: 1,
    playLimitSecs: 10,
    winningPoint: 50,
  }));
  await expect(page.locator('#party-settings-section')).toBeVisible();
});

test('round counter: overlay names the finished round; waiting room names the next', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);

  // Server semantics: the counter bumps the moment the round ends. After
  // round 2 finished, state.round === 3 — the overlay must read back to
  // the round that just played.
  await injectCreated(page, makeServerState({
    phase: 'gameOver',
    round: 3,
    scores: [-15, 10, 5, 0],
    finishedOrder: [1, 2, 3, 0],
    totalScores: [-5, 17, 8, 0],
  }));
  await expect(page.locator('#gameover-overlay.show')).toBeVisible();
  await expect(page.locator('#gameover-round')).toContainText('Round 2 complete');

  // Drop to the between-rounds waiting room: it names the NEXT round.
  await page.evaluate(() => window.playAgain());
  await expect(page.locator('#gameover-overlay.show')).toHaveCount(0);
  await expect(page.locator('#lobby-screen-party.active')).toBeVisible();
  await expect(page.locator('#party-round-sub')).toHaveText('Round 3 Next');

  // And the FIRST round's overlay: round 1 finished -> counter is 2,
  // overlay reads "Round 1 complete".
  await injectCreated(page, makeServerState({
    phase: 'gameOver',
    round: 2,
    scores: [10, 5, 0, -15],
    finishedOrder: [0, 1, 2, 3],
    totalScores: [10, 5, 0, -15],
  }));
  await expect(page.locator('#gameover-overlay.show')).toBeVisible();
  await expect(page.locator('#gameover-round')).toContainText('Round 1 complete');
});

test('bottom score strip: cumulative session totals, not per-round points', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);

  // Round 2 is in play: this round's points are [5, 2, 0, 0] so far, but
  // the strip must show the RUNNING TOTAL across the session.
  await injectCreated(page, makeServerState({
    phase: 'playing',
    round: 2,
    scores: [5, 2, 0, 0],
    totalScores: [12, 17, 3, -15],
  }));
  await waitForPhase(page, 'playing');
  const pts = await page.locator('#scoreboard .score-row .pts').allTextContents();
  // Human is seat 0 and pos 0 -> totals[0] first; then seats 1,2,3.
  expect(pts).toEqual(['12 pts', '17 pts', '3 pts', '-15 pts']);
  // The per-round values must NOT be what the strip shows.
  const html = await page.locator('#scoreboard').innerHTML();
  expect(html).not.toContain('>5 pts<');
  expect(html).not.toContain('>2 pts<');
});

test('real server: full round -> strip carries the round total forward; overlay says Round 1', async ({ page }) => {
  test.setTimeout(900_000);

  await createRoomViaUI(page, 'Dodi');
  await startGameViaUI(page);
  await waitForPhase(page, 'playing');

  // Fresh room: the strip is all zeros before anything plays.
  let pts = await page.locator('#scoreboard .score-row .pts').allTextContents();
  expect(pts).toEqual(['0 pts', '0 pts', '0 pts', '0 pts']);

  let safety = 0;
  while (!(await page.evaluate(() => window.__app_getState()?.gameOver))) {
    if (++safety > 2000) throw new Error('round 1 did not reach game over in time');
    await playOrPass(page);
  }

  // Round 1 finished: the counter ticked to 2 the moment the round ended.
  const round1 = await page.evaluate(() => {
    const s = window.__app_getState();
    return { round: s.round, total: s.totalScores, scores: s.scores, phase: s.phase };
  });
  expect(round1.phase).toBe('gameOver');
  expect(round1.round).toBe(2);
  // total == scores after round 1 (the session started at zero).
  expect(round1.total).toEqual(round1.scores);
  await expect(page.locator('#gameover-round')).toContainText('Round 1 complete');

  // Continue: the strip in round 2's waiting->play shows the carried totals.
  await page.evaluate(() => window.playAgain());
  await expect(page.locator('#lobby-screen-party.active')).toBeVisible();
  await page.click('#party-start-btn');
  await waitForPhase(page, 'playing');

  const totalsAfter = await page.evaluate(() => window.__app_getState().totalScores);
  expect(totalsAfter).toEqual(round1.total);
  const pts2 = await page.locator('#scoreboard .score-row .pts').allTextContents();
  expect(pts2).toEqual(round1.total.map(t => t + ' pts'));
  await watch(page);
});
