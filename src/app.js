import { validatePlay, comboName, sortCards, rankIndex, suitOrder } from './game.js';
import { render, renderThreePhaseOverlay, updateScoreboard, renderLobby, adjustHandSizing } from './render.js';
import { connect, disconnect, createRoom, joinRoom, listRooms, sendPlay, sendPass, sendReady, sendStartGame, sendLeaveRoom, sendRejoin, isConnected, resetConnection } from './network.js';
import { saveSession, loadSession, clearSession } from './session.js';

let state = null;
let playerId = null;
let roomCode = null;
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
  const session = loadSession();
  if (session.code && session.name && session.token) {
    rejoinAttempts = 1;
    rejoinPending = true;
    sendRejoin(session.code, session.name, session.token);
  }
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
      state = adaptState(msg.state);
      saveSession(roomCode, playerId, resolvePlayerName(playerId, 'You'), msg.token);
      handlePhase();
      render(state);
      clearLog();
      break;

    case 'joined':
      resetRejoin();
      disarmLobbyWatchdog();
      handOrder = null; // fresh deal
      playerId = msg.playerId;
      roomCode = msg.code;
      state = adaptState(msg.state);
      saveSession(roomCode, playerId, resolvePlayerName(playerId, 'Player'), msg.token);
      handlePhase();
      render(state);
      clearLog();
      break;

    case 'rejoined':
      resetRejoin();
      handOrder = null; // fresh deal
      playerId = msg.playerId;
      roomCode = msg.code;
      state = adaptState(msg.state);
      saveSession(roomCode, playerId, resolvePlayerName(playerId, 'Player'), msg.token);
      handlePhase();
      render(state);
      clearLog();
      break;

    case 'roomList':
      renderRoomList(msg.rooms || []);
      break;

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

    case 'error':
      disarmLobbyWatchdog();
      if (rejoinPending) {
        // Reload race: the old socket's disconnect hadn't landed when we sent
        // the first rejoin. Retry silently until the seat is registered. Once
        // the attempts run out, surface the error (seat expired / room gone).
        if (rejoinAttempts >= REJOIN_MAX_ATTEMPTS) {
          resetRejoin();
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
  }
}

function adaptState(serverState) {
  const adapted = { ...serverState };

  adapted._playerId = playerId;
  adapted.playerNames = serverState.players.map(p => p.name);
  adapted.isHuman = serverState.players.map(p => !p.isBot && p.connected);
  // Public hand counts. The server masks other players' `hand` to [] but keeps
  // `handCount` (how many cards they still hold) public — Capsa is played with
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
  adapted.finishedOrder = serverState.finishedOrder || [];
  adapted.logEntries = serverState.log || [];
  adapted.gameOver = serverState.phase === 'gameOver';
  adapted.threePhase = serverState.phase === 'threeDiscard';

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
    return;
  }

  hideLobby();

  // Show room code in header
  const rcHeader = document.getElementById('room-code-header');
  if (rcHeader && roomCode) {
    rcHeader.textContent = "Room: " + roomCode;
    rcHeader.style.display = "inline";
  }

  if (state.threePhase) {
    renderThreePhaseOverlay(state);
    return;
  }

  if (state.gameOver) {
    showGameOver();
    return;
  }

  document.getElementById('three-phase-overlay').classList.remove('show');
  updatePlayButton();
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
  const screens = ['main', 'new', 'join', 'party'];
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
    const tdStatus = document.createElement('td');
    tdStatus.style.cssText = 'padding:10px 0;text-align:center;';
    const chip = document.createElement('span');
    chip.style.cssText = ready
      ? 'display:inline-block;padding:4px 12px;border-radius:12px;background:#2d6a4f;color:#fff;font-size:12px;font-weight:600;'
      : 'display:inline-block;padding:4px 12px;border-radius:12px;background:#3a3a3a;color:#888;font-size:12px;';
    chip.textContent = ready ? 'Ready' : 'Not Ready';
    tdStatus.appendChild(chip);
    tr.appendChild(tdName);
    tr.appendChild(tdStatus);
    tbody.appendChild(tr);
  });

  const myIdx = players.findIndex(p => p && p.id === playerId);
  const isCreator = myIdx !== -1 && players[myIdx].isCreator;
  const myReady = state.ready && state.ready[myIdx];

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
    startBtn.style.display = isCreator ? 'block' : 'none';
  }
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
  sendLeaveRoom();
  resetRejoin();
  disarmLobbyWatchdog();
  roomCode = null;
  playerId = null;
  state = null;
  clearSession();
  showLobbyScreen('main');
};

window.__app_handleCreateRoom = handleCreateRoom;
window.__app_handleJoinRoom = handleJoinRoom;

function showGameOver() {
  const overlay = document.getElementById('gameover-overlay');
  if (!state) return;

  const ranking = state.finishedOrder.slice(0, 4);
  const loser = ranking.length >= 4 ? ranking[3] : null;
  // Guard against a missing name/score so the heading never reads "undefined"
  const nameOf = (pid) =>
    pid != null && state.playerNames[pid] ? state.playerNames[pid] : (pid != null ? 'Player ' + (pid + 1) : 'Unknown');
  const isHumanLoser = loser !== null && state.isHuman[loser];

  document.getElementById('winner-text').textContent =
    loser === null ? 'Game Over' : (isHumanLoser ? 'You Lost!' : nameOf(loser) + ' Lost!');

  const fs = document.getElementById('final-scores');
  fs.innerHTML = '';
  const medals = ['1st', '2nd', '3rd', 'Last'];
  ranking.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'final-row rank-' + (idx + 1);
    div.textContent = medals[idx] + ' ' + nameOf(p) + ' (' + (state.scores[p] ?? 0) + ' pts)';
    fs.appendChild(div);
  });

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
  if (rooms.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  rooms.filter(r => r.players > 0).forEach(room => {
    const div = document.createElement('div');
    div.className = 'room-item';
    div.innerHTML = `
      <div class="room-info">
        <div class="room-name">${room.name}</div>
        <div class="room-players">${room.players}/4 players · ${room.code}</div>
      </div>
      <button class="room-join-btn">Join</button>
    `;
    div.querySelector('.room-join-btn').onclick = () => handleJoinFromList(room.code);
    div.querySelector('.room-info').onclick = () => handleJoinFromList(room.code);
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

  clearSelections();
  state.hands[playerId] = sortCards(state.hands[playerId]);
  handOrder = state.hands[playerId].map(c => c.rank + ':' + c.suit);
  render(state);
}

export function nextRound() {
  document.getElementById('gameover-overlay').classList.remove('show');
  clearSession();
  disconnect();
  handOrder = null;
  state = null;
  playerId = null;
  roomCode = null;
  connect(serverUrl, handleMessage, onConnect, onDisconnect);
  document.getElementById('lobby-overlay').style.display = 'flex';
}

export function toggleSidebar() {
  document.getElementById('app').classList.toggle('no-sidebar');
}

function clearLog() {
  const logEl = document.getElementById('log');
  if (logEl) {
    logEl.innerHTML = '';
    logEl.dataset.renderedCount = '0';
  }
}

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
    // Explain why Play is greyed out instead of leaving a dead button.
    if (previewEl) previewEl.textContent = 'Pick 1 or 2 cards to play';
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
