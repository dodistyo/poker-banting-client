// Verify the FAN hand redesign:
//  1. fan geometry (arc, rotation, in-viewport, card size) at 4 resolutions
//  2. manual drag reorder ACTUALLY reorders (mouse + touch) — grabbed by
//     VISIBLE SLIVER (left edge), the only part a finger can reach
//  3. screenshots for the user
// Drag-to-PLAY is verified separately against the real server (_drag-repro).
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'fs';
const BASE = 'http://localhost:3000';
const shots = '/tmp/fan-shots';
mkdirSync(shots, { recursive: true });

const deal = [
  { rank: '7', suit: 'clubs' }, { rank: 'A', suit: 'spades' },
  { rank: '3', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' },
  { rank: '5', suit: 'hearts' }, { rank: '2', suit: 'spades' },
  { rank: 'Q', suit: 'clubs' }, { rank: '4', suit: 'diamonds' },
  { rank: 'J', suit: 'hearts' }, { rank: '9', suit: 'clubs' },
  { rank: '10', suit: 'diamonds' }, { rank: '6', suit: 'hearts' },
  { rank: '8', suit: 'clubs' },
];
const bots = [1, 2, 3].map(i => ({ name: 'Bot ' + i, isBot: true, connected: true, hand: [], handCount: 13, score: 0 }));

async function newGame(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(({ deal, bots }) => {
    window.__app_injectMessage({ type: 'created', state: {
      phase: 'playing', currentPlayer: 0,
      players: [{ name: 'Dodi', isBot: false, connected: true, hand: deal, handCount: 13, score: 0 }, ...bots],
      trick: { combo: null, comboPlayer: null, passed: [], played: [] },
      log: ['Game started'], finishedOrder: [], threePhase: false,
    }, playerId: 0, code: 'FANTEST', token: 't' });
  }, { deal, bots });
  await page.waitForSelector('#hand-0 .card', { timeout: 8000 });
  await page.waitForTimeout(300); // fan layout RAF
  return page;
}

const orderOf = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#hand-0 > .card')].map(c => c.dataset.key));

// Visible sliver of slot i: the left-edge strip only card i owns (all other
// cards overlap its right side). The last card shows its full face.
async function grabPoint(page, i) {
  return page.evaluate((i) => {
    const cards = [...document.querySelectorAll('#hand-0 > .card')];
    const r = cards[i].getBoundingClientRect();
    const x = i === cards.length - 1 ? r.left + r.width / 2 : r.left + Math.max(4, r.width * 0.12);
    return { x, y: r.top + r.height / 2, cx: r.left + r.width / 2 };
  }, i);
}
const slotCenter = async (page, i) => page.evaluate((i) => {
  const r = document.querySelectorAll('#hand-0 > .card')[i].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, i);

async function mouseReorder(page, from, to) {
  const g = await grabPoint(page, from);
  const t = await slotCenter(page, to);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x + 6, g.y - 4, { steps: 3 });
  await page.mouse.move(t.x, t.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function touchReorder(page, from, to) {
  const g = await grabPoint(page, from);
  const t = await slotCenter(page, to);
  const cdp = await page.context().newCDPSession(page);
  const T = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p });
  await T('touchStart', [{ x: g.x, y: g.y, id: 1 }]);
  for (let i = 1; i <= 8; i++) {
    const x = g.x + (t.x - g.x) * (i / 8);
    const y = g.y + (t.y - g.y) * (i / 8) - Math.sin(Math.PI * i / 8) * 14;
    await T('touchMove', [{ x, y, id: 1 }]);
    await page.waitForTimeout(25);
  }
  await T('touchEnd', []);
  await page.waitForTimeout(200);
}

async function fanGeometry(page, label) {
  const g = await page.evaluate(() => {
    const hand = document.querySelector('.hand-bottom');
    const hr = hand.getBoundingClientRect();
    const cards = [...hand.querySelectorAll(':scope > .card')].map(c => {
      const r = c.getBoundingClientRect();
      return { w: r.width, h: r.height, cx: r.left + r.width / 2, top: r.top, bot: r.bottom };
    });
    return {
      handW: Math.round(hr.width), cardW: Math.round(cards[0].w), cardH: Math.round(cards[0].h), n: cards.length,
      arc: Math.round(cards[Math.floor(cards.length / 2)].top - cards[0].top),
      inViewport: cards.every(c => c.top >= 0 && c.bot <= window.innerHeight),
      centersSpread: Math.round(cards[cards.length - 1].cx - cards[0].cx),
    };
  });
  console.log(`FAN ${label}: ${JSON.stringify(g)}`);
  return g;
}

const browser = await chromium.launch();
const views = [
  { label: 'mobile-portrait', width: 390, height: 844, hasTouch: true, isMobile: true },
  { label: 'mobile-landscape', width: 844, height: 390, hasTouch: true, isMobile: true },
  { label: 'tablet-portrait', width: 800, height: 1120, hasTouch: true, isMobile: false },
  { label: 'desktop', width: 1440, height: 900, hasTouch: false, isMobile: false },
];

let failures = 0;
const check = (ok, label) => { console.log(`  ${ok ? 'ok' : '!! FAIL'} ${label}`); if (!ok) failures++; };

for (const v of views) {
  const ctx = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    hasTouch: v.hasTouch, isMobile: v.isMobile,
    userAgent: v.hasTouch ? devices['iPhone 13'].useAgent : undefined,
  });
  const page = await newGame(ctx);
  await page.screenshot({ path: `${shots}/fan-${v.label}.png` });

  const g = await fanGeometry(page, v.label);
  check(g.inViewport, `${v.label}: fan in viewport`);
  check(g.cardW >= 26, `${v.label}: card readable (${g.cardW}px)`);
  check(g.arc <= 0, `${v.label}: center card is highest (arc=${g.arc})`);

  // mouse reorder: slot 0 -> slot 5. New semantics: the card OCCUPIES slot 5.
  const before = await orderOf(page);
  await mouseReorder(page, 0, 5);
  const afterMouse = await orderOf(page);
  check(afterMouse.length === 13 && new Set(afterMouse).size === 13, `${v.label}(mouse): no cards lost`);
  check(afterMouse[5] === before[0], `${v.label}(mouse): card0 now AT slot 5 (got idx ${afterMouse.indexOf(before[0])})`);

  // touch reorder: slot 2 -> slot 9.
  await touchReorder(page, 2, 9);
  const afterTouch = await orderOf(page);
  check(afterTouch.length === 13 && new Set(afterTouch).size === 13, `${v.label}(touch): no cards lost`);
  check(afterTouch[9] === afterMouse[2], `${v.label}(touch): slot2 card now AT slot 9 (got idx ${afterTouch.indexOf(afterMouse[2])})`);

  await page.screenshot({ path: `${shots}/fan-${v.label}-after.png` });
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nALL FAN CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
