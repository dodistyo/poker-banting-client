import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);
const PROXY_TARGET = process.env.PROXY_TARGET || "localhost:8080";
const ENABLE_PROXY = process.env.PROXY !== "false";
const wss = new WebSocketServer({ noServer: true });

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const stats = fs.statSync(filePath);
  // PWA: the service worker (sw.js) can only store cacheable responses, so
  // the shell needs storable headers (no-store would silently skip the
  // precache and break offline). Freshness is still guaranteed: the SW
  // serves navigations network-first and SWR-refreshes static assets, and
  // the shell is versioned by CACHE_VERSION in sw.js (bump on release).
  // HTML stays no-cache (revalidate) so the lobby always re-checks the
  // server before trusting a cached page.
  const isHtml = ext === ".html";
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stats.size,
    "Cache-Control": isHtml ? "no-cache" : "public, max-age=3600",
  });
  fs.createReadStream(filePath).pipe(res);
}

function stripApiPrefix(pathname) {
  return pathname.startsWith("/api/") ? pathname.slice(4) : pathname === "/api" ? "/" : pathname;
}

function proxyRequest(req, res) {
  const url = new URL(req.url, `http://${PROXY_TARGET}`);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: stripApiPrefix(url.pathname) + url.search,
    method: req.method,
    headers: { ...req.headers, host: PROXY_TARGET },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.setTimeout(30000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Backend timeout" }));
    }
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Backend unavailable" }));
    }
  });

  req.pipe(proxyReq, { end: true });
}

function proxyWebSocket(req, socket, head) {
  const url = new URL(req.url, `ws://${PROXY_TARGET}`);
  url.pathname = stripApiPrefix(url.pathname);

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    const targetWs = new WebSocket(url, {
      headers: { ...req.headers, host: PROXY_TARGET },
    });

    // Buffer client messages until the backend WS handshake completes.
    // Without this, a message arriving before targetWs is OPEN is silently
    // dropped (e.g. the browser's instant `rejoin` after a reload).
    const pending = [];

    targetWs.on("open", () => {
      console.log("[ws proxy] backend connected");
      while (pending.length) {
        const { data, isBinary } = pending.shift();
        targetWs.send(isBinary ? data : data.toString());
      }
    });

    clientWs.on("message", (data, isBinary) => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(isBinary ? data : data.toString());
      } else if (targetWs.readyState === WebSocket.CONNECTING) {
        pending.push({ data, isBinary });
      }
    });

    targetWs.on("message", (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(isBinary ? data : data.toString());
      }
    });

    clientWs.on("close", () => targetWs.close());
    targetWs.on("close", () => clientWs.close());
    targetWs.on("error", (e) => {
      console.log("[ws proxy] error:", e.message);
      clientWs.close();
    });
  });
}

const server = http.createServer((req, res) => {
  if (ENABLE_PROXY && req.url.startsWith("/api")) {
    return proxyRequest(req, res);
  }

  let filePath = path.join(__dirname, req.url === "/" ? "index.html" : req.url);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  serveFile(res, filePath);
});

server.on("upgrade", (req, socket, head) => {
  if (ENABLE_PROXY && req.url.startsWith("/api")) {
    return proxyWebSocket(req, socket, head);
  }
  socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dev server → http://localhost:${PORT}`);
  console.log(
    ENABLE_PROXY
      ? `Proxy /api → ${PROXY_TARGET}`
      : "Proxy disabled (PROXY=false)"
  );
});
