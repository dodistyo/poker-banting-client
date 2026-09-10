// wake.js — screen Wake Lock for in-room play.
//
// Why: mobile browsers throttle/suspend pages when the screen turns off, so
// the 25s WebSocket ping stops firing and the connection drops mid-game.
// A screen wake lock keeps the display on for as long as the user is IN a
// room (waiting room + playing) and is released when they leave.
//
// Design (mirrors sound.js — DOM-light, lazily read, testable in Node):
// - navigator.wakeLock is read on demand from globalThis (Node has no wake
//   lock; older browsers don't either) — hold() simply resolves false there.
// - The OS releases the sentinel when the user locks/unlocks the screen;
//   while we still want the lock (in-room) we re-request automatically.
// - release() marks "no longer in a room": from then on, sentinel release
//   events are ignored and in-flight requests are dropped. No loops.

let wantLock = false;
let sentinel = null;
let requesting = false;

function wl() {
  try {
    return globalThis.navigator && globalThis.navigator.wakeLock || null;
  } catch {
    return null;
  }
}

async function acquire() {
  if (requesting) return;
  const w = wl();
  if (!w) { wantLock = false; return; }
  requesting = true;
  try {
    const s = await w.request('screen');
    if (!wantLock) {
      // User left while the request was in flight — drop the lock.
      try { s.release(); } catch { /* ignore */ }
      return;
    }
    sentinel = s;
    s.addEventListener('release', () => {
      // Fired when the OS reclaims the lock (screen off, unlock gesture, or
      // our own release() below). If we still want it, re-acquire.
      sentinel = null;
      if (wantLock && !sentinel && !requesting) schedule();
    });
  } catch {
    // Transient failure (e.g. not allowed yet) — stay silent, the
    // visibilitychange / re-entry path will try again.
    sentinel = null;
  } finally {
    requesting = false;
  }
}

function schedule() {
  // Tiny delay so a burst of release+re-hold (e.g. visibilitychange right
  // after an OS release) collapses into one request.
  setTimeout(() => { if (wantLock && !sentinel && !requesting) acquire(); }, 50);
}

/**
 * Request (or keep) the screen wake lock. Call from user-gesture paths
 * (create room / join room / rejoin). Idempotent: no second request while a
 * lock is held or in flight. Resolves true if a lock is (or will be) held.
 */
export async function hold() {
  wantLock = true;
  if (!wl()) return false;
  if (!sentinel && !requesting) acquire();
  return true;
}

/** Stop holding the lock (leaving the room). */
export function release() {
  wantLock = false;
  if (sentinel) {
    const s = sentinel;
    sentinel = null;
    try { s.release(); } catch { /* ignore */ }
  }
}

/** True while a lock is currently held. */
export function isHeld() {
  return wantLock && !!sentinel;
}
