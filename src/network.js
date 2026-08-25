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
function ensureConnected(thenSend) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (thenSend) thenSend();
    return;
  }
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`;
  const origOnOpen = onOpenCb;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const oldWs = ws;
  ws = null;
  // Detach handlers so the dying socket's close event can't trigger
  // scheduleReconnect() and race a duplicate connection.
  if (oldWs) { oldWs.onclose = null; oldWs.onmessage = null; oldWs.onerror = null; }
  // connect() also restores connectUrl (nullified by sendLeaveRoom), so
  // auto-reconnect works again once this socket is open.
  connect(url, onMessageCb, () => {
    if (origOnOpen) origOnOpen();
    if (thenSend) thenSend();
  }, onCloseCb);
}

function fetchAsMessage(url, msgType, fallback) {
  fetch(url)
    .then(res => res.json())
    .then(data => { if (onMessageCb) onMessageCb({ type: msgType, data }); })
    .catch(() => { if (onMessageCb) onMessageCb({ type: msgType, ...fallback }); });
}

export function listRooms() {
  fetchAsMessage('/api/rooms', 'roomList', { rooms: [] });
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

export function sendLeaveRoom() {
  send({ type: 'leaveRoom' });
  connectUrl = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopPing();
  reconnectAttempts = 0;
}

export function sendRejoin(code, name, token) {
  // Also routed through ensureConnected: retryRejoin() fires from a timer
  // and can land while the socket is closing/closed (e.g. right after a
  // leave), which used to drop the rejoin silently.
  ensureConnected(() => send({ type: 'rejoin', code, name, token }));
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
