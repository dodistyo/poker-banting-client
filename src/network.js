let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let pingTimer = null;
let pongTimer = null;
let onMessageCb = null;
let onOpenCb = null;
let onCloseCb = null;
let connectUrl = null;
const MAX_RECONNECT_DELAY = 8000;
const PING_INTERVAL = 25000;
const PONG_TIMEOUT = 10000;
import { wsUrl, restUrl } from './config.js';

export function connect(url, onMessage, onOpen, onClose) {
  connectUrl = url;
  onMessageCb = onMessage;
  onOpenCb = onOpen;
  onCloseCb = onClose;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectAttempts = 0;
    if (onOpenCb) onOpenCb();
    startPing();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'pong') {
        clearTimeout(pongTimer);
        pongTimer = null;
        return;
      }
      if (onMessageCb) onMessageCb(data);
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };

  ws.onclose = (event) => {
    if (onCloseCb) onCloseCb();
    stopPing();
    scheduleReconnect();
  };

  ws.onerror = (event) => {
    console.error('[WS] Connection error');
  };

  return ws;
}

export function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopPing();
  reconnectAttempts = 0;
  onMessageCb = null;
  onOpenCb = null;
  onCloseCb = null;
  connectUrl = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

export function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function createRoom(name, isPublic = true) {
  // ensureConnected: the socket may be dead here. leaveRoom is the usual
  // case — the server closes the connection on LeaveRoom and
  // sendLeaveRoom() nulls connectUrl to stop auto-reconnect — so a plain
  // send() would drop the message silently and every lobby action
  // (create/join/rejoin) would be dead until a full page reload.
  ensureConnected(() => send({ type: 'create', name, isPublic }));
}

export function joinRoom(code, name) {
  ensureConnected(() => send({ type: 'join', code, name }));
}

// Reuse-or-reconnect the socket, then fire `thenSend`. This is the single
// reconnection path for user-initiated lobby actions; the location-derived
// URL mirrors what app.js uses for the initial connect.
//
// The pending one-shot "send on open" is tracked so it can be cancelled if
// the socket is replaced before it opens (a rapid second lobby click while
// the first is still CONNECTING). Leaving a stale one-shot listener on the
// old socket would re-fire an earlier create/join after a new socket is
// already open — the server would open two rooms and the first becomes an
// orphan.
let pendingOpenSend = null;

function cancelPendingOpenSend() {
  if (pendingOpenSend) {
    pendingOpenSend.ws.removeEventListener('open', pendingOpenSend.listener);
    pendingOpenSend = null;
  }
}

function ensureConnected(thenSend) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (thenSend) thenSend();
    return;
  }
  cancelPendingOpenSend();
  // Resolved from config.js: same-origin in dev, cross-origin (Cloud Run)
  // in production. The path mirrors app.js's initial connect.
  const url = wsUrl();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const oldWs = ws;
  ws = null;
  // Detach handlers so the dying socket's close event can't trigger
  // scheduleReconnect() and race a duplicate connection.
  if (oldWs) { oldWs.onclose = null; oldWs.onmessage = null; oldWs.onerror = null; }
  // connect() also restores connectUrl (nullified by sendLeaveRoom), so
  // auto-reconnect works again once this socket is open.
  const newWs = connect(url, onMessageCb, onOpenCb, onCloseCb);
  // Fire thenSend exactly once, on THIS socket, via a one-shot listener.
  // We deliberately do NOT bake thenSend into onOpenCb: wrapping it there
  // meant the next reconnect would re-invoke the previous wrapper's
  // thenSend, so rapid create→leave→create cycles re-fired stale "create"
  // messages on one socket — the server opened two rooms and the first
  // became an orphan (its session was never removed).
  if (thenSend) {
    const listener = () => {
      if (pendingOpenSend && pendingOpenSend.ws === newWs) pendingOpenSend = null;
      thenSend();
    };
    pendingOpenSend = { ws: newWs, listener };
    newWs.addEventListener('open', listener, { once: true });
  }
}

function fetchAsMessage(url, msgType, fallback) {
  fetch(url)
    .then(res => res.json())
    .then(data => { if (onMessageCb) onMessageCb({ type: msgType, data }); })
    .catch(() => { if (onMessageCb) onMessageCb({ type: msgType, ...fallback }); });
}

export function listRooms() {
  fetchAsMessage(restUrl('/api/rooms'), 'roomList', { rooms: [] });
}

export function sendPlay(cardIdentifiers) {
  send({ type: 'play', cards: cardIdentifiers });
}

export function sendPass() {
  send({ type: 'pass' });
}

export function sendReady(isReady) {
  send({ type: 'ready', ready: isReady });
}

export function sendStartGame() {
  send({ type: 'startGame' });
}

// Host-only: update play limit (1..120s) and/or winning point (1..9999).
// The server rejects out-of-range values with an error message.
export function sendRoomSettings(playLimitSecs, winningPoint) {
  const msg = { type: 'setRoomSettings' };
  if (playLimitSecs != null && Number.isFinite(playLimitSecs)) msg.playLimitSecs = playLimitSecs;
  if (winningPoint != null && Number.isFinite(winningPoint)) msg.winningPoint = winningPoint;
  if (Object.keys(msg).length === 1) return; // nothing to send
  send(msg);
}

export function sendLeaveRoom() {
  send({ type: 'leaveRoom' });
  connectUrl = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopPing();
  reconnectAttempts = 0;
  // The server closes the connection in response to leaveRoom (ws.rs sets
  // cleaned_up and breaks the read loop). Drop the socket locally right
  // away instead of waiting for the close event: readyState lags the
  // server-side teardown, so a fast-path reuse of this "still OPEN" socket
  // would silently drop the next lobby message (create/join) with no
  // response, no close, no error. The detached handlers mean this close
  // can't also trigger scheduleReconnect() (connectUrl is null anyway).
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
}

// Close and drop the current socket without reconnecting, so the next
// user-initiated action (create/join/rejoin via ensureConnected) opens a
// fresh one. Used by the create watchdog when the server never responds.
export function resetConnection() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopPing();
  reconnectAttempts = 0;
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
}

export function sendRejoin(code, name, token) {
  // Also routed through ensureConnected: retryRejoin() fires from a timer
  // and can land while the socket is closing/closed (e.g. right after a
  // leave), which used to drop the rejoin silently.
  ensureConnected(() => send({ type: 'rejoin', code, name, token }));
}

export function sendCheckRoom(code, token) {
  // Read-only probe (server: rooms.check_room) — no seat is touched, the
  // answer only tells the client whether its saved session is still live.
  ensureConnected(() => send({ type: 'checkRoom', code, token }));
}

export function isConnected() {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function getWs() {
  return ws;
}

function scheduleReconnect() {
  if (!connectUrl) return;
  const jitter = Math.random() * 500;
  const delay = Math.min(MAX_RECONNECT_DELAY, 1000 * Math.pow(2, reconnectAttempts)) + jitter;
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    connect(connectUrl, onMessageCb, onOpenCb, onCloseCb);
  }, delay);
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    clearTimeout(pongTimer);
    pongTimer = setTimeout(() => {
      if (ws) ws.close(4000, 'pong timeout');
    }, PONG_TIMEOUT);
    send({ type: 'ping' });
  }, PING_INTERVAL);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (pongTimer) {
    clearTimeout(pongTimer);
    pongTimer = null;
  }
}
