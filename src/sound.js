// sound.js — synthesized Web Audio cues for Pocer (no audio files).
//
// Design:
// - All cues are generated from oscillators + gain envelopes (~zero assets).
// - The AudioContext is created LAZILY on the first primeAudio() call (which
//   the app fires on the first user gesture — create/join/ready buttons)
//   because browsers block audio before a user gesture.
// - A suspended context is resumed on every primeAudio()/cue attempt.
// - Mute state persists in localStorage (default: unmuted).
//
// Cues (kept SUBTLE on purpose — bomb is the one moment that gets loud):
//   deal  — 3 short low ticks, staggered (cards hitting the felt)
//   card  — single soft "tap"
//   pass  — single very soft "thk"
//   turn  — high ding (it's YOUR turn)
//   bomb  — low thump + mid boom (the moment that should feel BIG)
//   win   — short ascending 3-note arpeggio

const MUTE_KEY = 'pocer-sound-muted';

let ctx = null;
let muted = readMute();

function readMute() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false; // no localStorage (Node tests / private mode) -> default off
  }
}

function AC() {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

function tryResume(c) {
  // resume() returns a Promise in browsers, but guard for engines that
  // return undefined (some older WebKit) so a cue can never throw.
  const r = c.resume();
  if (r && typeof r.catch === 'function') r.catch(() => {});
}

/**
 * Call from the first user gesture (create/join/ready/start buttons).
 * Creates the context if needed and resumes it if suspended. Safe to call
 * repeatedly and in environments without Web Audio (no-op).
 */
export function primeAudio() {
  const c = AC();
  if (c && c.state === 'suspended') tryResume(c);
}

/** Resume if the context was suspended (e.g. app returned from background). */
export function resumeAudio() {
  primeAudio();
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = !!m;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* best effort */
  }
}

/** One enveloped oscillator: osc -> gain -> destination. */
function blip(freq, { at = 0, dur = 0.08, type = 'triangle', peak = 0.15 } = {}) {
  if (muted) return;
  const c = AC();
  if (!c) return;
  if (c.state === 'suspended') {
    // Don't schedule into a dead context; kick resume and let the next cue land.
    tryResume(c);
    return;
  }
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// ---- Cues -----------------------------------------------------------------

export function playDeal() {
  // 3 quick low ticks, 55ms apart — the feel of a fast deal.
  blip(220, { dur: 0.05, type: 'triangle', peak: 0.08 });
  blip(200, { at: 0.055, dur: 0.05, type: 'triangle', peak: 0.08 });
  blip(185, { at: 0.11, dur: 0.06, type: 'triangle', peak: 0.09 });
}

export function playCard() {
  blip(520, { dur: 0.07, type: 'triangle', peak: 0.18 });
}

export function playPass() {
  blip(300, { dur: 0.06, type: 'sine', peak: 0.1 });
}

export function playTurn() {
  // High ding — "your move".
  blip(880, { dur: 0.16, type: 'sine', peak: 0.14 });
  blip(1320, { at: 0.02, dur: 0.12, type: 'sine', peak: 0.06 });
}

export function playBomb() {
  // THE moment: low thump + mid boom, louder than everything else.
  blip(70, { dur: 0.25, type: 'sine', peak: 0.5 });
  blip(140, { at: 0.03, dur: 0.2, type: 'triangle', peak: 0.35 });
  blip(95, { at: 0.09, dur: 0.18, type: 'sine', peak: 0.3 });
}

export function playWin() {
  // Ascending arpeggio: C5-E5-G5.
  blip(523.25, { dur: 0.14, type: 'triangle', peak: 0.16 });
  blip(659.25, { at: 0.12, dur: 0.14, type: 'triangle', peak: 0.16 });
  blip(783.99, { at: 0.24, dur: 0.28, type: 'triangle', peak: 0.18 });
}

/** Test helper: drop the cached context so a fresh fake gets picked up. */
export function resetForTests() {
  ctx = null;
}
