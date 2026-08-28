import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BIN = path.resolve(__dirname, '../poker-banting-server/target/debug/poker-banting-server');

// Opt-in slow mode for watching a headed run: E2E_SLOW=1 npx playwright test
// (or `make e2e-slow`). Off by default so normal runs stay fast.
const SLOW = process.env.E2E_SLOW === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // tests share one server room namespace; keep deterministic
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,
    // Opt-in via E2E_SLOW=1 (see `make e2e-slow`): slow each action down so a
    // human can follow a headed run. slowMo is a launch option, so it goes
    // under launchOptions (top-level `use.slowMo` is silently ignored).
    // Off by default — normal runs should stay fast.
    launchOptions: SLOW ? { slowMo: 1000 } : {},
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node dev-server.js',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      cwd: __dirname,
    },
    {
      command: `${SERVER_BIN}`,
      url: 'http://localhost:8080/health',
      reuseExistingServer: true,
      cwd: path.resolve(__dirname, '../poker-banting-server'),
      // BOT_TURN_DELAY_MS: the real-server specs (full round vs 3 bots) would
      // take ~10 min at the default 2.5s delay. 300ms keeps the same code path
      // but makes the suite finish in seconds. Override with your own value.
      env: { RUST_LOG: 'info', BOT_TURN_DELAY_MS: process.env.BOT_TURN_DELAY_MS || '300' },
    },
  ],
});
