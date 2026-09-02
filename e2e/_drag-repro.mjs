// Real-server drag repro: 1 human (mobile viewport) vs 3 bots.
// Logs EVERY WS state message (with per-player handCount) and snapshots
// the DOM (seat card counts + turn badges) before/during/after a REAL
// mouse-driven drag, to catch the exact moment opponent backs vanish.
import { chromium } from 'playwright';

const LOG = [];
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1);
const log = (m) => { LOG.push(`[${ts()}s] ${m}`); console.log(`[${ts()}s] ${m}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
});
const page = await ctx.newPage();
page.setDefaultTimeout(30000);

// --- Wire log: every state-ish message, with handCount per player ---
page.on('websocket', (ws) => {
  ws.on('framereceived', (ev) => {
    try {
      const m = JSON.parse(typeof ev.payload === 'string' ? ev.payload : ev.payload.toString());
      if (m.type === 'state' || m.type === 'created' || m.type === 'joined') {
        const s = m.state;
        const hc = s ? s.players.map(p => (p.handCount === undefined ? '∅' : p.handCount)) : null;
        log(`WS ${m.type}: phase=${s?.phase} cur=${s?.currentPlayer} trickLen=${s?.trick?.cards?.length ?? 0} hc=[${hc}]`);
      } else if (m.type === 'playerJoined') {
        log(`WS playerJoined: id=${m.playerId} name=${m.name}`);
      } else if (m.type === 'gameStarted') {
        log('WS gameStarted');
      } else if (m.type === 'error') {
        log(`WS error: ${m.message}`);
      }
    } catch { /* ignore non-JSON */ }
  });
  ws.on('framesent', (ev) => {
    try {
      const m = JSON.parse(typeof ev.payload === 'string' ? ev.payload : ev.payload.toString());
      if (m.type === 'play') log(`TX play: ${JSON.stringify(m.cards)}`);
      else if (m.type === 'pass') log('TX pass');
    } catch { /* ignore */ }
  });
});

// --- DOM snapshot: seat card counts, turn badges, adapted state ---
const domSnap = async (label) => {
  try {
    const d = await page.evaluate(() => {
      const seats = ['bottom', 'right', 'top', 'left'].map((pos, k) => {
        const el = document.getElementById('player-' + k);
        return {
          pos,
          cards: el ? el.querySelectorAll('.hand .card').length : -1,
          badge: el?.querySelector('.turn-badge')?.textContent ?? null,
          count: el?.querySelector('.count-badge')?.textContent ?? null,
        };
      });
      const s = window.__app_getState ? window.__app_getState() : null;
      return {
        phase: document.getElementById('table-area')?.dataset.phase,
        handCounts: s?.handCounts ?? null,
        currentPlayer: s?.currentPlayer ?? null,
        myId: s?._playerId ?? null,
        myCards: s?.hands?.[s?._playerId]?.length ?? null,
        seats,
      };
    });
    log(`DOM ${label}: phase=${d.phase} cur=${d.currentPlayer} handCounts=[${d.handCounts}] my=${d.myCards} seats=${JSON.stringify(d.seats)}`);
    return d;
  } catch (e) {
    log(`DOM ${label}: eval failed: ${e.message}`);
    return null;
  }
};

const isMyTurn = () => page.evaluate(() => {
  const s = window.__app_getState ? window.__app_getState() : null;
  const el = document.getElementById('table-area');
  return !!(el && el.dataset.phase === 'playing' && s && s.currentPlayer === s._playerId);
});

// --- Boot the real game ---
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connection-status.connected', { timeout: 15000 });
log('connected');

await page.click('li.primary'); // New Game
await page.fill('#lobby-name-input', 'DragRepro');
await page.click('#lobby-screen-new .lobby-submit-btn');
await page.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 15000 });
log('room created: ' + (await page.locator('#party-code').textContent()).trim());

await page.click('#party-start-btn');
await page.waitForFunction(
  () => document.getElementById('table-area')?.dataset.phase === 'playing',
  { timeout: 30000 },
);
await domSnap('dealt');

// --- Play loop: 3 tricks. Drag when I lead, pass otherwise. ---
let tricksSeen = 0;
let lastCenterKey = null;
const deadline = Date.now() + 150000;
while (Date.now() < deadline && tricksSeen < 3) {
  if (await isMyTurn()) {
    await domSnap('MY TURN before drag');
    // Decide: drag a card (only safe as a lead) or pass.
    const tableEmpty = await page.evaluate(() => {
      const s = window.__app_getState();
      return !(s.trick && s.trick.combo && s.trick.combo.cards.length);
    });
    if (tableEmpty) {
      // Real drag: first card of my hand -> center drop zone.
      const from = await page.locator('#hand-0 .card').first().boundingBox();
      const zone = await page.locator('#center-cards').boundingBox();
      if (from && zone) {
        const to = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x, from.y - 24, { steps: 3 });
        await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
        await page.mouse.move(to.x, to.y, { steps: 5 });
        await domSnap('DURING drag (over drop zone)');
        await page.mouse.up();
        await domSnap('AFTER pointerup');
      }
    } else {
      await page.locator('#btn-pass').click({ force: true }).catch(() => {});
      log('clicked pass');
    }
  }
  // Track new tricks via center content + handCounts changes.
  const center = await page.evaluate(() => {
    const s = window.__app_getState ? window.__app_getState() : null;
    const c = s?.trick?.combo;
    return c && c.cards ? c.cards.map(x => x.rank + ':' + x.suit).join(',') : null;
  }).catch(() => null);
  if (center !== lastCenterKey) {
    if (center === null && lastCenterKey !== null) {
      tricksSeen++;
      log(`>>> TRICK RESOLVED -> NEW TRICK (trick #${tricksSeen})`);
      await domSnap('NEW TRICK state');
    }
    lastCenterKey = center;
  }
  await page.waitForTimeout(400);
}

await domSnap('end');
const fs = await import('node:fs');
fs.writeFileSync('/tmp/drag-repro.log', LOG.join('\n') + '\n');
log(`done, tricksSeen=${tricksSeen}, log -> /tmp/drag-repro.log`);
await browser.close();
