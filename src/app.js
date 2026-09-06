import { validatePlay, comboName, sortCards, rankIndex, suitOrder } from './game.js';
import { render, renderThreePhaseOverlay, updateScoreboard, renderLobby, adjustHandSizing } from './render.js';
import { connect, disconnect, createRoom, joinRoom, listRooms, sendPlay, sendPass, sendReady, sendStartGame, sendRoomSettings, sendLeaveRoom, sendRejoin, sendCheckRoom, isConnected, resetConnection } from './network.js';
import { SESSION_KEY as SESSION_STORAGE_KEY, saveSession, loadSession, clearSession } from './session.js';

let state = null;
let playerId = null;
let roomCode = null;
// True when the room this session belongs to is public. The creator of a
// PUBLIC room in the lobby dissolves the room when leaving (see
// rooms.rs:leave_room) — mid-game, a leaving human's seat becomes a bot.
// UI note: the button is always labelled "Leave" / "Leave Room" in neutral
// grey; the dissolve behaviour is server-side, not something we advertise
// in the label.
let isPublic = false;
// The client hand is a projection of the server hand, which is ALWAYS in
// deal order. So any client-side reorder (Sort, or a manual drag) reverts on
// the next state message (bot play/pass, our own play echo). To make a
// reorder "sticky" we remember the desired card order here and re-apply it in
// adaptState. Last explicit reorder wins: Sort sets it to sorted order, a drag
// sets it to the new manual order. Reset to null on redeal/new game.
let handOrder = null;
let serverUrl =
  (location.protocol === "https:" ? "wss://" : "ws://") +
  location.host +
  "/api/ws";
const ANIMALS = ['Fox', 'Wolf', 'Bear', 'Eagle', 'Shark', 'Tiger', 'Lion', 'Hawk', 'Panda', 'Otter', 'Raven', 'Falcon', 'Cobra', 'Panther', 'Hare', 'Badger', 'Jaguar', 'Osprey', 'Coyote', 'Stag', 'Mantis', 'Viper'];

function randomAnimalName() {
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const number = Math.floor(Math.random() * 89) + 10;
  return animal + number;
}

function resolvePlayerName(pid, fallback) {
  return state?.playerNames?.[pid] || fallback;
}

export function getSTATE() { return state; }
export function getPlayerId() { return playerId; }

// Test hook: feed a synthetic server message into the same dispatcher the
// WebSocket path uses. Lets E2E tests drive game state deterministically
// without waiting for real bot turns.
export function injectServerMessage(msg) { handleMessage(msg); }

export function initClient(url) {
  serverUrl = url || serverUrl;

  const session = loadSession();
  const defaultName = session.name || randomAnimalName();
  const nameInput = document.getElementById('lobby-name-input');
  if (nameInput) nameInput.value = defaultName;
  const joinNameInput = document.getElementById('lobby-join-name-input');
  if (joinNameInput) joinNameInput.value = defaultName;

  connect(serverUrl, handleMessage, onConnect, onDisconnect);
  updateRejoinMenuItem();

  // Resize observer for dynamic hand sizing
  let resizeTimer = null;
  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state) adjustHandSizing(); }, 100);
  };
  window.addEventListener('resize', onResize);
  const tableArea = document.getElementById('table-area');
  if (tableArea && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(onResize).observe(tableArea);
  }
}

function onConnect() {
  updateConnectionStatus(true);
  // Rejoin is MANUAL (user request 2026-09): a saved session shows a
  // "Rejoin" item in the main menu; nothing auto-fires on connect. The
  // retry machinery below (REJOIN_MAX_ATTEMPTS) still applies, because the
  // first manual rejoin after a reload can race the server's registration
  // of the old socket's disconnect -> "Rejoin failed".
  //
  // Proactive staleness check: probe the server about the saved session.
  // If the room is genuinely gone (found === false — closed, orphan
  // timeout, or server restart wiped the in-memory state), the "Rejoin"
  // item is a lie, so drop the session and hide it BEFORE the user even
  // clicks. found === true but rejoinable === false is the reload race
  // (old socket's disconnect not registered yet) — that's the existing
  // bounded retry's job, so we leave it alone.
  probeRejoinSession();
}

// Another tab (PWA + mobile browser share one localStorage) can clear or
// replace the session while this window is idle in the lobby. The `storage`
// event only fires in the OTHER windows (not the one that made the change),
// so it's a clean cross-tab signal: refresh the Rejoin item so both windows
// agree about what's rejoinable. A rejoin that failed with "seat in use"
// needs no special flag — that path resets its own state, so a click right
// after the other window lets go just works.
window.addEventListener('storage', (e) => {
  if (e.key === SESSION_STORAGE_KEY) updateRejoinMenuItem();
});

let rejoinProbeInFlight = false;

// Outstanding roomStatus probes (max ~1 in practice). The response is
// validated against the CURRENT session so a slow answer about a replaced
// session (user joined a new room while the probe was in flight) is ignored.
let pendingProbes = [];

function probeRejoinSession() {
  if (roomCode) return; // we're already in a room — nothing to check
  const session = loadSession();
  if (!session || !session.code || !session.name || !session.token) return;
  if (rejoinProbeInFlight) return;
  rejoinProbeInFlight = true;
  const probedCode = session.code;
  const timer = setTimeout(() => {
    // Probe unanswered (zombie socket / network hole): stay silent, the
    // manual rejoin's own error path + watchdog still covers it.
    rejoinProbeInFlight = false;
  }, 8000);
  sendCheckRoom(session.code, session.token);
  pendingProbes.push({
    code: probedCode,
    clear() {
      clearTimeout(timer);
    },
  });
}

// Show/hide the "Rejoin" main-menu item. Visible iff a complete session
// (code + name + token) exists AND we're not currently in a room — i.e.
// exactly the "I refreshed, I'm in the lobby, do I get my seat back?" state.
export function updateRejoinMenuItem() {
  const li = document.getElementById('lobby-rejoin-item');
  if (!li) return;
  const session = loadSession();
  const canRejoin = !!(session && session.code && session.name && session.token) && !roomCode;
  li.style.display = canRejoin ? '' : 'none';
  if (canRejoin) {
    const codeEl = li.querySelector('.rejoin-code');
    if (codeEl) codeEl.textContent = session.code;
  }
}

// Manual rejoin entry point (main-menu "Rejoin" item).
export function handleRejoinRoom() {
  const session = loadSession();
  if (!session || !session.code || !session.name || !session.token) {
    showError('No saved session to rejoin.');
    return;
  }
  disarmLobbyWatchdog();
  rejoinAttempts = 1;
  rejoinPending = true;
  sendRejoin(session.code, session.name, session.token);
}

// A reload tears the old socket down and opens a new one almost instantly, so
// the first rejoin can reach the server BEFORE the old connection's
// disconnect registers the seat as "disconnected" -> "Rejoin failed". A short
// bounded retry rides out that race without masking a genuine failure
// (expired seat / closed room).
const REJOIN_MAX_ATTEMPTS = 6;
const REJOIN_RETRY_MS = 800;
let rejoinAttempts = 0;
let rejoinPending = false;
let rejoinTimer = null;

function retryRejoin() {
  const session = loadSession();
  if (!session || !session.code || !session.name || !session.token) return;
  if (rejoinAttempts >= REJOIN_MAX_ATTEMPTS) return;
  if (rejoinTimer) clearTimeout(rejoinTimer);
  rejoinTimer = setTimeout(() => {
    rejoinTimer = null;
    rejoinAttempts++;
    sendRejoin(session.code, session.name, session.token);
  }, REJOIN_RETRY_MS);
}

function resetRejoin() {
  rejoinAttempts = 0;
  rejoinPending = false;
  if (rejoinTimer) {
    clearTimeout(rejoinTimer);
    rejoinTimer = null;
  }
}

// Lobby-action watchdog. A create/join must be answered (created / joined /
// error) within a few seconds. If it isn't, the message most likely went out
// on a "zombie" socket — one whose readyState still reads OPEN even though
// the server has already dropped it — so it was silently lost. Rather than
// leaving the user on a dead button, reset the connection (so the next click
// opens a fresh socket via ensureConnected) and surface a real error.
const LOBBY_RESPOND_MS = 8000;
let lobbyWatchdog = null;
let lobbyWatchLabel = '';

function armLobbyWatchdog(label) {
  disarmLobbyWatchdog();
  lobbyWatchLabel = label;
  lobbyWatchdog = setTimeout(() => {
    lobbyWatchdog = null;
    resetConnection();
    showError(`Server didn't respond to "${label}". Connection reset — try again.`);
  }, LOBBY_RESPOND_MS);
}

function disarmLobbyWatchdog() {
  if (lobbyWatchdog) {
    clearTimeout(lobbyWatchdog);
    lobbyWatchdog = null;
  }
}

function onDisconnect() {
  updateConnectionStatus(false);
}

function updateConnectionStatus(connected) {
  const el = document.getElementById('connection-status');
  if (el) {
    el.textContent = connected ? 'Connected' : 'Disconnected';
    el.className = connected ? 'connected' : 'disconnected';
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'created':
      resetRejoin();
      disarmLobbyWatchdog();
      handOrder = null; // fresh deal
      playerId = msg.playerId;
      roomCode = msg.code;
      isPublic = msg.isPublic !== false;
      state = adaptState(msg.state);
      saveSession(roomCode, playerId, resolvePlayerName(playerId, 'You'), msg.token, isPublic);
      updateRejoinMenuItem();
      handlePhase();
      clearLog(); // wipe previous game's entries BEFORE rendering the new log
      render(state);
      break;

    case 'joined':
      resetRejoin();
      disarmLobbyWatchdog();
      handOrder = null; // fresh deal
      playerId = msg.playerId;
      roomCode = msg.code;
      isPublic = loadSession().isPublic === true; // a joiner is never the creator
      state = adaptState(msg.state);
      saveSession(roomCode, playerId, resolvePlayerName(playerId, 'Player'), msg.token, isPublic);
      updateRejoinMenuItem();
      handlePhase();
      clearLog(); // wipe previous game's entries BEFORE rendering the new log
      render(state);
      break;

    case 'rejoined':
      resetRejoin();
      handOrder = null; // fresh deal
      playerId = msg.playerId;
      roomCode = msg.code;
      isPublic = loadSession().isPublic === true;
      state = adaptState(msg.state);
      saveSession(roomCode, playerId, resolvePlayerName(playerId, 'Player'), msg.token);
      updateRejoinMenuItem();
      handlePhase();
      clearLog(); // wipe previous game's entries BEFORE rendering the new log
      render(state);
      break;

    case 'roomList': {
      // fetchAsMessage puts the payload in msg.data; the server returns a
      // bare array of room summaries. (msg.rooms only appears on the
      // fetch-failure fallback path.)
      const rooms = Array.isArray(msg.data) ? msg.data : (msg.data?.rooms || msg.rooms || []);
      renderRoomList(rooms);
      break;
    }

    case 'state':
      state = adaptState(msg.state);
      handlePhase();
      render(state);
      break;

    case 'playerJoined':
      if (state) {
        state.players[msg.playerId] = {
          id: msg.playerId,
          name: msg.name,
          hand: [],
          finished: false,
          isBot: false,
          connected: true,
        };
        handlePhase();
        render(state);
      }
      break;

    case 'playerLeft':
      if (state) {
        if (state.players[msg.playerId]) {
          state.players[msg.playerId].connected = false;
        }
        render(state);
      }
      break;

    case 'seatChanged':
      // Lobby compaction renumbered seats (a player left, survivors shifted
      // down). Follow our stored playerId to its new value, or every future
      // Ready/Play from this tab would land on whoever sits in our OLD
      // slot — and the server would personalise the wrong hand to us.
      {
        const mapping = Array.isArray(msg.renumbered) ? msg.renumbered : [];
        const my = mapping.find(([old]) => old === playerId);
        if (my) {
          playerId = my[1];
          if (roomCode) {
            saveSession(roomCode, playerId, resolvePlayerName(playerId, 'Player'), loadSession().token, isPublic);
          }
        }
      }
      break;

    case 'playerReady':
      if (state) {
        const players = Array.isArray(state.players) ? state.players : Object.values(state.players);
        const idx = players.findIndex(p => p && p.id === msg.playerId);
        if (idx !== -1 && state.ready) {
          state.ready[idx] = msg.ready;
        }
        handlePhase();
        render(state);
      }
      break;

    case 'roomSettings':
      // Host updated play limit / winning point: the server echoes the new
      // values to the whole room. Merge + re-render (the waiting-room
      // settings section reads straight from state).
      if (state) {
        if (msg.playLimitSecs != null) state.playLimitSecs = msg.playLimitSecs;
        if (msg.winningPoint != null) state.winningPoint = msg.winningPoint;
        // Server accepted the change — the pending "Tersimpan…" hint is done.
        const hint = document.getElementById('party-settings-hint');
        if (hint) { hint.textContent = ''; hint.style.display = 'none'; }
        handlePhase();
        render(state);
      }
      break;

    case 'error':
      disarmLobbyWatchdog();
      if (rejoinPending) {
        // "Seat already in use by another window": the saved session's seat
        // is STILL CONNECTED in a second tab / PWA + mobile browser. The
        // room is alive and the seat is ours — don't burn the retry budget
        // and don't clear the session (that would destroy the good state).
        // Surface the hint once; the user closes the other window and clicks
        // Rejoin again, which succeeds immediately.
        if (typeof msg.message === 'string' && msg.message.includes('in use')) {
          rejoinPending = false;
          resetRejoin();
          showError('Seat is in use by another window. Close the other tab and rejoin again.');
          break;
        }
        // Reload race: the old socket's disconnect hadn't landed when we sent
        // the first rejoin. Retry silently until the seat is registered. Once
        // the attempts run out, the seat is genuinely gone (expired / room
        // closed) — surface the error AND drop the stale session so the
        // dead "Rejoin" menu item doesn't linger.
        if (rejoinAttempts >= REJOIN_MAX_ATTEMPTS) {
          resetRejoin();
          clearSession();
          updateRejoinMenuItem();
          showError(msg.message);
        } else {
          retryRejoin();
        }
      } else {
        showError(msg.message);
      }
      break;

    case 'pong':
      break;

    case 'roomStatus': {
      // Answer to a CheckRoom probe. Only act if the CURRENT saved session
      // is still the one we probed (user may have joined a new room in the
      // meantime — a stale answer about the old room must not clobber it).
      const probe = pendingProbes.find(p => p.code === msg.code);
      if (probe) {
        pendingProbes = pendingProbes.filter(p => p !== probe);
        probe.clear();
        rejoinProbeInFlight = false;
        const session = loadSession();
        if (session && session.code === msg.code) {
          if (msg.found === false) {
            // Room genuinely gone: the "Rejoin" item is a lie. Drop the
            // session and hide the button before the user ever clicks it.
            clearSession();
            updateRejoinMenuItem();
          }
          // found === true (regardless of rejoinable): session is live.
          // rejoinable === false is the reload race — the manual rejoin's
          // bounded retry (REJOIN_MAX_ATTEMPTS) owns that path.
        }
      }
      break;
    }
  }
}

function adaptState(serverState) {
  const adapted = { ...serverState };

  adapted._playerId = playerId;
  adapted.playerNames = serverState.players.map(p => p.name);
  adapted.isHuman = serverState.players.map(p => !p.isBot && p.connected);
  // Public hand counts. The server masks other players' `hand` to [] but keeps
  // `handCount` (how many cards they still hold) public — Poker Banting is
  // open information about how many cards remain. We render that many face-down
  // cards per opponent instead of the (empty) masked hand.
  adapted.handCounts = serverState.players.map(p =>
    (p.handCount != null ? p.handCount : (p.hand ? p.hand.length : 0)));
  adapted.hands = serverState.players.map(p => {
    return p.hand.map(c => ({
      ...c,
      suitSymbol: suitSymbol(c.suit),
      rankIndex: rankIndex(c.rank),
      suitOrder: suitOrder(c.suit),
      selected: false,
    }));
  });
  // Persist the user's reorder preference: the server hand is always in deal
  // order, so re-apply the remembered order here so it survives every rebuild.
  if (handOrder && playerId != null) {
    const byKey = {};
    for (const c of adapted.hands[playerId]) byKey[c.rank + ':' + c.suit] = c;
    const reordered = [];
    for (const key of handOrder) if (byKey[key]) { reordered.push(byKey[key]); delete byKey[key]; }
    // Append any cards that weren't in the stored order (new round, redeal) so
    // we never drop a card.
    for (const k of Object.keys(byKey)) reordered.push(byKey[k]);
    if (reordered.length === adapted.hands[playerId].length) {
      adapted.hands[playerId] = reordered;
    }
  }
  adapted.scores = serverState.scores || [0, 0, 0, 0];
  adapted.totalScores = serverState.totalScores || [0, 0, 0, 0];
  adapted.round = serverState.round || 1;
  adapted.finishedOrder = serverState.finishedOrder || [];
  adapted.logEntries = serverState.log || [];
  adapted.gameOver = serverState.phase === 'gameOver';
  adapted.threePhase = serverState.phase === 'threeDiscard';
  // Room settings + match-end state (play limit / winning point are host-set).
  adapted.playLimitSecs = serverState.playLimitSecs ?? 10;
  adapted.winningPoint = serverState.winningPoint ?? 50;
  adapted.gameWinner = serverState.gameWinner ?? null;
  adapted.turnSeq = serverState.turnSeq ?? 0;

  if (serverState.threeDiscard) {
    adapted.threePhaseOrder = serverState.threeDiscard.order;
    adapted.threePhaseIndex = serverState.threeDiscard.index;
    adapted.threePhaseCards = serverState.threeDiscard.playerCards.map(cards =>
      cards.map(c => ({ ...c, suitSymbol: suitSymbol(c.suit),
      rankIndex: rankIndex(c.rank),
      suitOrder: suitOrder(c.suit), selected: false }))
    );
    adapted.threePhaseCounts = serverState.threeDiscard.playerCounts;
    adapted.threePhaseDiscarded = serverState.threeDiscard.discarded;
  }

  if (serverState.trick) {
    adapted.trick = {
      combo: serverState.trick.comboType ? {
        type: serverState.trick.comboType,
        cards: (serverState.trick.cards || []).map(c => ({
          ...c,
          suitSymbol: suitSymbol(c.suit),
      rankIndex: rankIndex(c.rank),
      suitOrder: suitOrder(c.suit),
        })),
      } : null,
      comboPlayer: serverState.trick.comboPlayer ?? -1,
      passed: serverState.trick.passed || [],
      leader: adapted.currentPlayer,
    };
  }

  adapted.selectCard = (pi, ci) => selectCard(pi, ci);
  adapted.updatePlayButton = () => updatePlayButton();
  // Drag & drop to play: the render layer calls this when a card is dropped on
  // the center trick area.
  adapted.dragToPlay = (pi, ci) => dragPlay(pi, ci);
  // A manual drag reorder is the user's explicit intent and becomes the new
  // sticky order (supersedes a prior Sort) so it isn't reverted on the next
  // state rebuild.
  adapted.onManualReorder = (keys) => { handOrder = keys; };

  return adapted;
}

function suitSymbol(suit) {
  const symbols = { diamonds: '♦', clubs: '♣', hearts: '♥', spades: '♠' };
  if (!suit) return '?';
  return symbols[suit.toLowerCase()] || '?';
}

function handlePhase() {
  if (!state) return;

  if (state.phase === 'lobby') {
    showLobby();
    closeLogSheet();
    // The waiting room has its own Leave button on the party screen; the
    // hamburger belongs to the game itself, so it's hidden while we lobby.
    closeMenuDrawer();
    const menuBtn = document.getElementById('menu-toggle-btn');
    if (menuBtn) menuBtn.classList.remove('visible');
    return;
  }

  hideLobby();

  // The room code now lives in the menu drawer (opened from the top-right
  // hamburger), which is visible in every viewport — desktop and mobile.
  const rcHeader = document.getElementById('room-code-header');
  if (rcHeader) rcHeader.style.display = 'none';

  // Top-right menu is the escape hatch: visible in playing AND game-over
  // (you can leave/close from the game-over screen), hidden only while the
  // full-screen 3-phase discard modal is up (it owns the screen, and there's
  // no meaningful "leave" mid-discard anyway).
  renderMenuDrawer();
  const menuBtn = document.getElementById('menu-toggle-btn');
  if (menuBtn) menuBtn.classList.toggle('visible', !state.threePhase);

  if (state.threePhase) {
    closeLogSheet();
    renderThreePhaseOverlay(state);
    return;
  }

  if (state.gameOver) {
    closeLogSheet();
    showGameOver();
    return;
  }

  document.getElementById('three-phase-overlay').classList.remove('show');
  updatePlayButton();
  updateTurnCountdown();
}

function showLobby() {
  const overlay = document.getElementById('lobby-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    renderLobby(state);
  }
  const rcHeader = document.getElementById('room-code-header');
  if (rcHeader) rcHeader.style.display = "none";
  if (roomCode) {
    renderPartyScreen();
    showLobbyScreen('party');
  } else {
    showLobbyScreen('main');
  }
}

export function showLobbyScreen(screen) {
  const screens = ['main', 'new', 'join', 'browse', 'party'];
  screens.forEach(s => {
    const el = document.getElementById('lobby-screen-' + s);
    if (el) el.classList.toggle('active', s === screen);
  });
  // Clear field errors when switching screens
  ['lobby-name-error', 'lobby-code-error', 'lobby-join-name-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  // Prefill join name if empty
  if (screen === 'join') {
    const joinNameInput = document.getElementById('lobby-join-name-input');
    if (joinNameInput && !joinNameInput.value.trim()) {
      const session = loadSession();
      joinNameInput.value = session.name || randomAnimalName();
    }
  }
}

function hideLobby() {
  const overlay = document.getElementById('lobby-overlay');
  if (overlay) overlay.style.display = 'none';
}

function renderPartyScreen() {
  if (!state || !roomCode) return;

  document.getElementById('party-code').textContent = roomCode;

  const table = document.getElementById('party-player-list');
  const tbody = table.querySelector('tbody');
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  const allPlayers = Array.isArray(state.players) ? state.players : Object.values(state.players);
  const seen = new Set();
  const players = allPlayers.filter(p => { if (!p) return false; if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  const totals = (state.totalScores && state.totalScores.length) ? state.totalScores : [0, 0, 0, 0];
  players.forEach((p, i) => {
    if (!p) return;
    const isBot = p.isBot || !p.connected;
    const ready = state.ready && state.ready[i];
    const isMe = p.id === playerId;
    const tr = document.createElement('tr');
    tr.style.cssText = 'border-bottom:1px solid #1a2a4a;' + (isMe ? 'background:#1a2a4a;' : '');
    const tdName = document.createElement('td');
    tdName.style.padding = '10px 0';
    tdName.textContent = p.name + (p.isCreator ? ' 👑' : '') + (isMe ? ' (You)' : isBot ? ' (Bot)' : '');
    const tdScore = document.createElement('td');
    tdScore.style.cssText = 'padding:10px 0;text-align:center;color:#ffd700;font-weight:600;';
    tdScore.textContent = String(totals[i] != null ? totals[i] : 0);
    const tdStatus = document.createElement('td');
    tdStatus.style.cssText = 'padding:10px 0;text-align:center;';
    const chip = document.createElement('span');
    chip.style.cssText = ready
      ? 'display:inline-block;padding:4px 12px;border-radius:12px;background:#2d6a4f;color:#fff;font-size:12px;font-weight:600;'
      : 'display:inline-block;padding:4px 12px;border-radius:12px;background:#3a3a3a;color:#888;font-size:12px;';
    chip.textContent = ready ? 'Ready' : 'Not Ready';
    tdStatus.appendChild(chip);
    tr.appendChild(tdName);
    tr.appendChild(tdScore);
    tr.appendChild(tdStatus);
    tbody.appendChild(tr);
  });

  const myIdx = players.findIndex(p => p && p.id === playerId);
  const isCreator = myIdx !== -1 && players[myIdx].isCreator;
  const myReady = state.ready && state.ready[myIdx];

  // Host-only settings (play limit + winning point). The server only accepts
  // these in lobby / game-over, which is exactly when this screen shows.
  const settingsSection = document.getElementById('party-settings-section');
  if (settingsSection) {
    settingsSection.style.display = isCreator ? 'block' : 'none';
    const plInput = document.getElementById('party-setting-play-limit');
    const wpInput = document.getElementById('party-setting-winning-point');
    // Don't clobber a field the user is typing in; the roomSettings echo
    // lands on the next render pass and settles it.
    if (plInput && document.activeElement !== plInput) plInput.value = state.playLimitSecs;
    if (wpInput && document.activeElement !== wpInput) wpInput.value = state.winningPoint;
  }

  // Always a neutral grey "Leave". For the creator of a public room the
  // server additionally dissolves the room (rooms.rs:leave_room) — that is
  // behaviour, not label: the button reads the same for everyone.
  const leaveBtnEl = document.getElementById('party-leave-btn');
  if (leaveBtnEl) {
    leaveBtnEl.textContent = 'Leave';
    leaveBtnEl.style.background = '#555';
  }

  // Multi-round sessions: the header shows the running round number so the
  // waiting room reads "Round 2 — Waiting" instead of a blank re-lobby.
  const header = document.querySelector('#lobby-screen-party .lobby-header h3');
  if (header) header.textContent = (state.round > 1 ? 'Waiting Room — Round ' + state.round + ' Next' : 'Waiting Room');

  const readyBtn = document.getElementById('party-ready-btn');
  if (readyBtn) {
    readyBtn.style.display = isCreator ? 'none' : 'block';
    readyBtn.textContent = myReady ? 'Cancel' : 'Ready';
    readyBtn.style.background = myReady ? '#555' : '#2d6a4f';
    readyBtn.style.color = '#fff';
    readyBtn.style.boxShadow = 'none';
  }

  const startBtn = document.getElementById('party-start-btn');
  if (startBtn) {
    // After a match winner the server permanently blocks a new start — the
    // button would just bounce an error, so hide it.
    startBtn.style.display = isCreator && state.gameWinner == null ? 'block' : 'none';
  }
}

window.__app_saveRoomSettings = () => {
  if (!state) return;
  const plEl = document.getElementById('party-setting-play-limit');
  const wpEl = document.getElementById('party-setting-winning-point');
  const pl = plEl && plEl.value !== '' ? parseInt(plEl.value, 10) : null;
  const wp = wpEl && wpEl.value !== '' ? parseInt(wpEl.value, 10) : null;
  if (pl != null && (pl < 1 || pl > 120)) { showSettingsHint('Play limit: 1–120 detik'); return; }
  if (wp != null && (wp < 1 || wp > 9999)) { showSettingsHint('Winning point: 1–9999'); return; }
  if (pl == null && wp == null) return;
  sendRoomSettings(pl, wp);
  showSettingsHint('Tersimpan…');
};

function showSettingsHint(text) {
  const hint = document.getElementById('party-settings-hint');
  if (!hint) return;
  hint.textContent = text;
  hint.style.display = 'block';
  clearTimeout(hint.__t);
  hint.__t = setTimeout(() => { hint.textContent = ''; hint.style.display = 'none'; }, 2500);
}

window.__app_copyCode = () => {
  if (!roomCode) return;
  navigator.clipboard.writeText(roomCode).then(() => {
    const btn = document.querySelector('#party-code-row button');
    if (btn) { const old = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = old, 1500); }
  }).catch(() => {});
};

window.__app_startGame = () => {
  sendStartGame();
};

window.__app_toggleReady = () => {
  if (!state) return;
  const players = Array.isArray(state.players) ? state.players : Object.values(state.players);
  const myIdx = players.findIndex(p => p && p.id === playerId);
  const myReady = state.ready && state.ready[myIdx];
  sendReady(!myReady);
};

window.__app_leaveRoom = () => {
  // The drawer's leave/close button (two-tap confirm) also routes through here.
  closeMenuDrawer();
  sendLeaveRoom();
  resetRejoin();
  disarmLobbyWatchdog();
  roomCode = null;
  playerId = null;
  isPublic = false;
  state = null;
  clearSession();
  updateRejoinMenuItem();
  // The escape hatch is gone with the room — hide the hamburger too.
  const menuBtn = document.getElementById('menu-toggle-btn');
  if (menuBtn) menuBtn.classList.remove('visible');
  // showLobbyScreen only swaps the active screen; the overlay itself is
  // hidden during play, so a mid-game leave must re-show it or the user is
  // left staring at an empty table with no UI.
  const overlay = document.getElementById('lobby-overlay');
  if (overlay) overlay.style.display = 'flex';
  showLobbyScreen('main');
};

window.__app_handleCreateRoom = handleCreateRoom;
window.__app_handleJoinRoom = handleJoinRoom;

function showGameOver() {
  const overlay = document.getElementById('gameover-overlay');
  if (!state) return;

  const matchOver = state.gameWinner != null;
  overlay.classList.toggle('match-over', matchOver);

  const ranking = state.finishedOrder.slice(0, 4);
  const loser = ranking.length >= 4 ? ranking[3] : null;
  // Guard against a missing name/score so the heading never reads "undefined"
  const nameOf = (pid) =>
    pid != null && state.playerNames[pid] ? state.playerNames[pid] : (pid != null ? 'Player ' + (pid + 1) : 'Unknown');
  const isHumanLoser = loser !== null && state.isHuman[loser];

  if (matchOver) {
    const champion = state.gameWinner;
    const isMe = champion === playerId;
    document.getElementById('winner-text').textContent = isMe
      ? '🏆 You Win the Match!'
      : '🏆 ' + nameOf(champion) + ' Wins the Match!';
  } else {
    document.getElementById('winner-text').textContent =
      loser === null ? 'Game Over' : (isHumanLoser ? 'You Lost!' : nameOf(loser) + ' Lost!');
  }

  // Session context: which round just ended and the running total.
  const round = state.round || 1;
  const sub = document.getElementById('gameover-round');
  if (sub) {
    sub.textContent = matchOver
      ? 'Match selesai — ' + state.winningPoint + ' poin tercapai'
      : 'Round ' + round + ' complete · target ' + state.winningPoint + ' poin';
  }

  const totals = state.totalScores || [0, 0, 0, 0];
  const fs = document.getElementById('final-scores');
  fs.innerHTML = '';
  const medals = ['1st', '2nd', '3rd', 'Last'];
  ranking.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'final-row rank-' + (idx + 1) + (matchOver && p === state.gameWinner ? ' match-winner' : '');
    // Per-round points first, running total in parentheses.
    div.textContent = medals[idx] + ' ' + nameOf(p) + ' (' + (state.scores[p] ?? 0) + ' pts)  ·  Total ' + (totals[p] ?? 0);
    fs.appendChild(div);
  });

  // After a match win the server blocks a new start permanently — "Main Lagi"
  // would just bounce an error, so hide it and keep only Keluar.
  const playAgainBtn = document.getElementById('go-play-again-btn');
  if (playAgainBtn) playAgainBtn.style.display = matchOver ? 'none' : 'block';

  const totalRow = document.getElementById('gameover-total');
  if (totalRow) {
    totalRow.textContent = 'Session total — ' + state.playerNames
      .map((n, i) => n + ' ' + (totals[i] ?? 0))
      .join('  ·  ');
  }

  overlay.classList.add('show');
}

function showError(message) {
  // Show in lobby error when lobby is visible, otherwise in game error
  const lobbyEl = document.getElementById('lobby-error');
  const gameEl = document.getElementById('error-msg');

  if (lobbyEl && lobbyEl.closest('#lobby-overlay') && lobbyEl.closest('#lobby-overlay').style.display !== 'none') {
    lobbyEl.textContent = message;
    lobbyEl.style.display = 'block';
    setTimeout(() => { lobbyEl.textContent = ''; lobbyEl.style.display = 'none'; }, 3000);
  } else if (gameEl) {
    gameEl.textContent = message;
    setTimeout(() => { gameEl.textContent = ''; }, 3000);
  }
}

// --- Player actions ---

export function handleCreateRoom() {
  const nameInput = document.getElementById('lobby-name-input');
  const nameError = document.getElementById('lobby-name-error');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    if (nameError) nameError.textContent = 'Name is required';
    nameInput.focus();
    return;
  }
  if (nameError) nameError.textContent = '';
  const publicToggle = document.getElementById('lobby-public-toggle');
  const isPublic = publicToggle ? publicToggle.checked : true;
  armLobbyWatchdog('Create Room');
  createRoom(name, isPublic);
}

export function handleJoinRoom() {
  const codeInput = document.getElementById('lobby-code-input');
  const codeError = document.getElementById('lobby-code-error');
  const joinNameInput = document.getElementById('lobby-join-name-input');
  const joinNameError = document.getElementById('lobby-join-name-error');
  const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
  const name = joinNameInput ? joinNameInput.value.trim() : '';
  let hasError = false;
  if (!name) {
    if (joinNameError) joinNameError.textContent = 'Name is required';
    joinNameInput.focus();
    hasError = true;
  } else if (joinNameError) {
    joinNameError.textContent = '';
  }
  if (code.length < 6) {
    if (codeError) codeError.textContent = 'Enter a 6-character room code';
    if (!hasError) codeInput.focus();
    return;
  } else if (codeError) {
    codeError.textContent = '';
  }
  if (!hasError) {
    roomCode = code;
    armLobbyWatchdog('Join ' + code);
    joinRoom(code, name);
  }
}

export function handleBrowseRooms() {
  showLobbyScreen('browse');
  listRooms();
}

export function refreshRoomList() {
  listRooms();
}

export function handleJoinFromList(code) {
  const codeInput = document.getElementById('lobby-code-input');
  if (codeInput) codeInput.value = code;
  showLobbyScreen('join');
}

function renderRoomList(rooms) {
  const container = document.getElementById('lobby-room-list');
  if (!container) return;
  container.innerHTML = '';
  const visible = rooms.filter(r => r.players > 0);
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'room-list-empty';
    empty.textContent = 'No public rooms right now — create one!';
    container.appendChild(empty);
    return;
  }
  visible.forEach(room => {
    const div = document.createElement('div');
    div.className = 'room-item';
    const full = room.players >= room.max_players;
    div.innerHTML = `
      <div class="room-info">
        <div class="room-name">${room.host}</div>
        <div class="room-players">${room.players}/${room.max_players} players · ${room.code}</div>
      </div>
      <button class="room-join-btn" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button>
    `;
    if (!full) {
      div.querySelector('.room-join-btn').onclick = () => handleJoinFromList(room.code);
      div.querySelector('.room-info').onclick = () => handleJoinFromList(room.code);
    }
    container.appendChild(div);
  });
}

export function selectCard(playerIdx, cardIdx) {
  if (!state || state.gameOver || state.threePhase) return;
  if (playerId !== null && state.currentPlayer !== playerId) return;
  if (playerIdx !== playerId) return;

  const card = state.hands[playerIdx][cardIdx];
  if (!card) return;

  card.selected = !card.selected;
  updatePlayButton();
  render(state);
}

export function clearSelections() {
  if (!state) return;
  for (let i = 0; i < 4; i++) {
    (state.hands[i] || []).forEach(c => c.selected = false);
  }
}

export function getSelectedCards() {
  if (!state || playerId === null) return [];
  return (state.hands[playerId] || []).filter(c => c.selected);
}

export function playCards() {
  if (navigator.vibrate) navigator.vibrate(15);
  if (!state || state.gameOver || state.threePhase) return;
  if (playerId === null || state.currentPlayer !== playerId) return;

  const selected = getSelectedCards();
  const tableCombo = state.trick.combo;
  const validation = validatePlay(selected, tableCombo);

  if (!validation.valid) {
    showError(validation.error || 'Invalid play');
    return;
  }

  // Send card identifiers (rank:suit) instead of indices to avoid sort-order mismatch
  const identifiers = selected.map(c => c.rank + ':' + c.suit);
  sendPlay(identifiers);
}

// Drag & drop / swipe to play. If the user has an active selection (the
// yellow "active" group), the gesture plays that WHOLE group — the slide is
// the one-gesture trigger and the group is what goes out. With no selection
// the gesture plays the single card that was dragged/swiped. Either way it
// mirrors playCards() validation: a combo that beats or leads the table is
// sent; anything else shows the reason instead of silently doing nothing.
// (Old behaviour was `card.selected ? others : [card, ...others]` — sliding a
// selected card played the OTHER selected cards and skipped the swiped one,
// so a yellow group could never be played by swiping: "slide only works for a
// single card".)
export function dragPlay(playerIdx, cardIdx) {
  if (navigator.vibrate) navigator.vibrate(15);
  if (!state || state.gameOver || state.threePhase) return;
  if (playerId === null || state.currentPlayer !== playerId) return;
  if (playerIdx !== playerId) return;

  const hand = state.hands[playerIdx] || [];
  const card = hand[cardIdx];
  if (!card) return;

  // Yellow group active -> play the whole group (the slide is the trigger).
  // No selection -> play the single card that was dragged/swiped.
  const selectedCards = hand.filter(c => c.selected);
  const selection = selectedCards.length > 0 ? selectedCards : [card];
  const validation = validatePlay(selection, state.trick.combo);

  if (!validation.valid) {
    showError(validation.error || 'Invalid play');
    return;
  }

  sendPlay(selection.map(c => c.rank + ':' + c.suit));
}

export function passTurn() {
  if (navigator.vibrate) navigator.vibrate(15);
  if (!state || state.gameOver || state.threePhase) return;
  if (playerId === null || state.currentPlayer !== playerId) return;
  if (state.trick.passed.includes(playerId)) return;

  sendPass();
}

export function sortHand() {
  if (navigator.vibrate) navigator.vibrate(15);
  if (!state || state.gameOver || state.threePhase) return;
  if (playerId === null) return;

  // Reorder in place — do NOT clearSelections(). sortCards() returns a new
  // array of the SAME card objects, so each card's `selected` flag (the yellow
  // "active" group) survives the sort. Clearing here was what made the group
  // vanish the moment the user tapped Sort — right before they'd swipe it out.
  state.hands[playerId] = sortCards(state.hands[playerId]);
  handOrder = state.hands[playerId].map(c => c.rank + ':' + c.suit);
  updatePlayButton();
  render(state);
}

export function nextRound() {
  document.getElementById('gameover-overlay').classList.remove('show');
  clearSession();
  updateRejoinMenuItem();
  disconnect();
  handOrder = null;
  state = null;
  playerId = null;
  roomCode = null;
  connect(serverUrl, handleMessage, onConnect, onDisconnect);
  document.getElementById('lobby-overlay').style.display = 'flex';
}

// "Main Lagi": stay in the room — the server already auto-readies everyone,
// so we just drop the game-over overlay and land on the waiting room. The
// creator can press Start Game to continue the session (round 2+, no
// three-discard, cumulative scores).
export function playAgain() {
  document.getElementById('gameover-overlay').classList.remove('show');
  handOrder = null; // fresh deal is coming
  if (state) {
    // Show the waiting room (all auto-ready) behind the table.
    renderPartyScreen();
    showLobbyScreen('party');
    const overlay = document.getElementById('lobby-overlay');
    if (overlay) overlay.style.display = 'flex';
  }
}

export function toggleSidebar() {
  document.getElementById('app').classList.toggle('no-sidebar');
}

function clearLog() {
  // Both the desktop sidebar (#log) and the mobile bottom sheet (#sheet-log)
  // render the same entries, so reset both.
  for (const id of ['log', 'sheet-log']) {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = '';
      el.dataset.renderedCount = '0';
    }
  }
  closeLogSheet();
}

// ── Mobile game-log bottom sheet ──────────────────────────────────────────
// The sidebar's #log is display:none on mobile (media queries), so the log
// content is mirrored into #sheet-log (a bottom sheet) by renderLog(). The
// sheet is a pure info layer: z-index above the game-over/three-phase
// overlays, one-tap dismiss (X or backdrop), auto-closed on new game / lobby.
export function openLogSheet() {
  const sheet = document.getElementById('log-sheet');
  const backdrop = document.getElementById('sheet-backdrop');
  if (!sheet) return;
  sheet.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
  const body = document.getElementById('sheet-log');
  if (body) body.scrollTop = body.scrollHeight;
}

export function closeLogSheet() {
  const sheet = document.getElementById('log-sheet');
  const backdrop = document.getElementById('sheet-backdrop');
  if (sheet) sheet.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

export function toggleLogSheet() {
  const sheet = document.getElementById('log-sheet');
  if (sheet && sheet.classList.contains('open')) closeLogSheet();
  else openLogSheet();
}

// ── Menu drawer (top-right hamburger) ────────────────────────────────────
// A right-side slide-in drawer, present in EVERY viewport (desktop and
// mobile). It is the single place for room "meta" actions: showing + copying
// the room code, and leaving/closing the room. The room code previously lived
// in the header's #room-code-header span; it moved here so it is reachable on
// mobile (where the header is cramped) as well as desktop.
//
// The leave button always reads "Leave Room" in neutral grey. Only the
// subtext differs for the one case the server dissolves the room: the creator
// of a PUBLIC room while still in the lobby (see rooms.rs:leave_room).
// Mid-game a leaving human's seat becomes a bot. A two-tap confirm guards
// against accidental taps near the Play/Pass action bar.
function myIsCreator() {
  if (!state || playerId === null) return false;
  const players = Array.isArray(state.players) ? state.players : Object.values(state.players);
  const me = players.find(p => p && p.id === playerId);
  return !!(me && me.isCreator);
}

function renderMenuDrawer() {
  const codeEl = document.getElementById('menu-drawer-code');
  const leaveBtn = document.getElementById('menu-leave-btn');
  const leaveLabel = document.getElementById('menu-leave-label');
  const leaveSub = document.getElementById('menu-leave-sub');
  if (!codeEl || !leaveBtn) return;

  // Room code + copy availability.
  codeEl.textContent = roomCode || '—';
  document.getElementById('menu-copy-btn').disabled = !roomCode;

  // Always a neutral grey "Leave Room". The subtext explains the one case
  // where the server dissolves the whole room (public-lobby creator).
  const inLobby = state && state.phase === 'lobby';
  const dissolves = inLobby && isPublic && myIsCreator();
  leaveLabel.textContent = 'Leave Room';
  leaveSub.textContent = dissolves
    ? 'Dissolves this room for everyone.'
    : inLobby
      ? 'Your seat is released; others can keep the room.'
      : 'Your seat becomes a bot and the game continues.';
  // Reset the two-tap confirm whenever the context changes.
  leaveBtn.classList.remove('confirming');
}

export function openMenuDrawer() {
  const drawer = document.getElementById('menu-drawer');
  const backdrop = document.getElementById('menu-drawer-backdrop');
  if (!drawer) return;
  renderMenuDrawer(); // refresh label + code on every open
  drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
}

export function closeMenuDrawer() {
  const drawer = document.getElementById('menu-drawer');
  const backdrop = document.getElementById('menu-drawer-backdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

export function toggleMenuDrawer() {
  const drawer = document.getElementById('menu-drawer');
  if (drawer && drawer.classList.contains('open')) closeMenuDrawer();
  else openMenuDrawer();
}

// Copy the room code to the clipboard. `navigator.clipboard` requires a secure
// context + focus; on the dev server (http) we fall back to an execCommand
// textarea so it works in the plain-localhost case too.
window.__app_copyRoomCode = async () => {
  if (!roomCode) return false;
  const btn = document.getElementById('menu-copy-btn');
  const flash = (ok) => {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = ok ? '✓ Copied' : 'Copy';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(roomCode);
      flash(true);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  // Legacy fallback (works over plain http on localhost).
  try {
    const ta = document.createElement('textarea');
    ta.value = roomCode;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    flash(ok);
    return ok;
  } catch {
    flash(false);
    return false;
  }
};

// Two-tap confirm on the leave/close button: first tap arms it ("Confirm?"),
// a second tap within 3s fires. Any re-render or leaving the drawer disarms.
window.__app_confirmLeave = () => {
  const btn = document.getElementById('menu-leave-btn');
  if (!btn) return;
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    document.getElementById('menu-leave-label').textContent = 'Tap Again to Confirm';
    btn.__confirmTimer = setTimeout(() => {
      btn.classList.remove('confirming');
      renderMenuDrawer();
    }, 3000);
    return;
  }
  clearTimeout(btn.__confirmTimer);
  window.__app_leaveRoom();
};


function updatePlayButton() {
  if (!state) return;
  if (playerId === null || state.currentPlayer !== playerId) return;

  const selected = getSelectedCards();
  const btnPlay = document.getElementById('btn-play');
  const btnPass = document.getElementById('btn-pass');
  const errorEl = document.getElementById('error-msg');
  const previewEl = document.getElementById('combo-preview');

  if (errorEl) errorEl.textContent = '';
  if (previewEl) previewEl.textContent = '';

  if (state.gameOver) {
    btnPlay.disabled = true;
    btnPass.disabled = true;
    return;
  }

  btnPass.disabled = state.trick.passed.includes(playerId);

  if (selected.length === 0) {
    btnPlay.disabled = true;
    return;
  }

  const tableCombo = state.trick.combo;
  const validation = validatePlay(selected, tableCombo);
  if (previewEl) previewEl.textContent = validation.comboName || selected.length + ' cards (invalid)';

  if (!validation.valid) {
    btnPlay.disabled = true;
    if (errorEl) errorEl.textContent = validation.error || '';
    return;
  }

  btnPlay.disabled = false;
}

// Play-limit countdown: the server's watchdog auto-moves a human after
// state.playLimitSecs, so mirror that timer while it's our turn. The turn
// identity is (turnSeq, currentPlayer): the server bumps turn_seq on every
// turn advance, so a stale timer for the previous turn dies with it.
let turnCountdownTimer = null;
let turnCountdownKey = null;

function updateTurnCountdown() {
  const el = document.getElementById('turn-countdown');
  if (!state || !el) return;

  const isMyTurn = playerId !== null && state.currentPlayer === playerId &&
    state.phase === 'playing' && !state.gameOver && !state.threePhase;
  const limit = state.playLimitSecs || 10;

  if (!isMyTurn) {
    stopTurnCountdown();
    return;
  }

  const key = state.turnSeq + ':' + state.currentPlayer;
  if (key !== turnCountdownKey) {
    // New turn — restart the full timer.
    turnCountdownKey = key;
    let remaining = limit;
    if (turnCountdownTimer) clearInterval(turnCountdownTimer);
    el.classList.add('visible');
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        // The server will auto-move now; show zero briefly until the
        // next state message flips the turn (turnSeq bump) and hides it.
        el.textContent = '⏱ 0s';
        return;
      }
      el.textContent = '⏱ ' + remaining + 's';
      el.classList.toggle('warning', remaining <= 3);
    };
    el.textContent = '⏱ ' + remaining + 's';
    el.classList.remove('warning');
    turnCountdownTimer = setInterval(tick, 1000);
  }
}

function stopTurnCountdown() {
  if (turnCountdownTimer) { clearInterval(turnCountdownTimer); turnCountdownTimer = null; }
  turnCountdownKey = null;
  const el = document.getElementById('turn-countdown');
  if (el) { el.textContent = ''; el.classList.remove('visible', 'warning'); }
}
