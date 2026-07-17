import { validatePlay, comboName, sortCards, rankIndex, suitOrder } from './game.js';
import { render, renderThreePhaseOverlay, updateScoreboard, renderLobby, adjustHandSizing } from './render.js';
import { connect, disconnect, createRoom, joinRoom, rejoinRoom, listRooms, sendPlay, sendPass, isConnected } from './network.js';
import { saveSession, loadSession, clearSession } from './session.js';

let state = null;
let playerId = null;
let roomCode = null;
let serverUrl =
  (location.protocol === "https:" ? "wss://" : "ws://") +
  location.host +
  "/api/ws";
function resolvePlayerName(pid, fallback) {
  return state?.playerNames?.[pid] || fallback;
}

export function getSTATE() { return state; }
export function getPlayerId() { return playerId; }

export function initClient(url) {
  serverUrl = url || serverUrl;

  const session = loadSession();
  if (session.name) {
    const nameInput = document.getElementById('lobby-name-input');
    if (nameInput) nameInput.value = session.name;
  }

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
  if (session.code && session.name) {
    rejoinRoom(session.code, session.name);
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
      playerId = msg.playerId;
      roomCode = msg.code;
      state = adaptState(msg.state);
      saveSession(roomCode, playerId, resolvePlayerName(playerId, 'You'));
      handlePhase();
      render(state);
      clearLog();
      break;

    case 'joined':
      playerId = msg.playerId;
      state = adaptState(msg.state);
      saveSession(roomCode, playerId, resolvePlayerName(playerId, 'Player'));
      handlePhase();
      render(state);
      clearLog();
      break;

    case 'rejoined':
      playerId = msg.playerId;
      roomCode = msg.code;
      state = adaptState(msg.state);
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

    case 'error':
      showError(msg.message);
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
  adapted.hands = serverState.players.map(p => {
    return p.hand.map(c => ({
      ...c,
      suitSymbol: suitSymbol(c.suit),
      rankIndex: rankIndex(c.rank),
      suitOrder: suitOrder(c.suit),
      selected: false,
    }));
  });
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
    if (roomCode) {
      document.getElementById('room-code-display').textContent = roomCode;
    }
    renderLobby(state);
  }
  // name-overlay removed
  // Hide room code in header when in lobby
  const rcHeader = document.getElementById('room-code-header');
  if (rcHeader) rcHeader.style.display = "none";
}

function hideLobby() {
  const overlay = document.getElementById('lobby-overlay');
  if (overlay) overlay.style.display = 'none';
}

function showGameOver() {
  const overlay = document.getElementById('gameover-overlay');
  if (!state) return;

  const ranking = state.finishedOrder.slice(0, 4);
  const loser = ranking[3] ?? null;
  const isHumanLoser = loser !== null && state.isHuman[loser];

  document.getElementById('winner-text').textContent =
    isHumanLoser ? 'You Lost!' : state.playerNames[loser] + ' Lost!';

  const fs = document.getElementById('final-scores');
  fs.innerHTML = '';
  const medals = ['1st', '2nd', '3rd', 'Last'];
  ranking.forEach((p, idx) => {
    const div = document.createElement('div');
    div.textContent = medals[idx] + ' ' + state.playerNames[p] + ' (' + state.scores[p] + ' pts)';
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
    setTimeout(() => { lobbyEl.textContent = ''; }, 3000);
  } else if (gameEl) {
    gameEl.textContent = message;
    setTimeout(() => { gameEl.textContent = ''; }, 3000);
  }
}

// --- Player actions ---

export function handleCreateRoom() {
  console.log('[UI] Create Room clicked');
  const nameInput = document.getElementById('lobby-name-input');
  const name = nameInput ? nameInput.value.trim() || 'You' : 'You';
  const publicToggle = document.getElementById('lobby-public-toggle');
  const isPublic = publicToggle ? publicToggle.checked : true;
  console.log('[UI] Creating room as:', name, 'isPublic:', isPublic);
  createRoom(name, isPublic);
}

export function handleJoinRoom() {
  const codeInput = document.getElementById('lobby-code-input');
  const nameInput = document.getElementById('lobby-name-input');
  const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
  const name = nameInput ? nameInput.value.trim() || 'Player' : 'Player';
  if (code.length < 6) {
    showError('Enter a 6-character room code');
    return;
  }
  joinRoom(code, name);
}

export function handleBrowseRooms() {
  listRooms();
}

export function handleJoinFromList(code) {
  const nameInput = document.getElementById('lobby-name-input');
  const name = nameInput ? nameInput.value.trim() || 'Player' : 'Player';
  joinRoom(code, name);
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
  rooms.forEach(room => {
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
  render(state);
}

export function nextRound() {
  document.getElementById('gameover-overlay').classList.remove('show');
  clearSession();
  disconnect();
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
