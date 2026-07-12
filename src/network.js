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

  ws.onclose = () => {
    if (onCloseCb) onCloseCb();
    stopPing();
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror
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
    console.log('[WS] Sent:', msg.type);
  } else {
    console.error('[WS] Cannot send — not connected. readyState:', ws ? ws.readyState : 'null');
  }
}

export function createRoom(name) {
  send({ type: 'create', name });
}

export function joinRoom(code, name) {
  send({ type: 'join', code, name });
}

export function sendPlay(cardIdentifiers) {
  send({ type: 'play', cards: cardIdentifiers });
}

export function sendPass() {
  send({ type: 'pass' });
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
