// API origin resolution.
//
// The frontend (Firebase Hosting) and the backend (Cloud Run) live on
// DIFFERENT origins in production:
//   https://poker-banting.dodistyo.com  -> static frontend (this app)
//   https://api.poker-banting.dodistyo.com -> Rust backend (Cloud Run)
//
// In local dev (dev-server.js on :3000) the proxy keeps everything
// same-origin, so the API origin is just `location.origin`. The same is true
// when dev is reached through the Cloudflare tunnel (app.dodistyo.*), which
// forwards to the local dev-server proxy.
//
// Rule: only when the page itself is served from the production host do we
// point cross-origin at the prod API; everywhere else stay same-origin.
//
// Functions take an optional `hostname` override so unit tests can run them
// under Node (where `location` doesn't exist).

export const PROD_HOST = "poker-banting.dodistyo.com";
export const PROD_API_ORIGIN = "https://api.poker-banting.dodistyo.com";

function currentLocation() {
  if (typeof location !== "undefined") return location;
  return { origin: "", hostname: "", protocol: "http:" };
}

export function apiOrigin(hostname) {
  const loc = currentLocation();
  const host = hostname != null ? hostname : loc.hostname;
  if (host === PROD_HOST) return PROD_API_ORIGIN;
  return loc.origin;
}

// WebSocket URL: ws(s)://<api origin>/api/ws
export function wsUrl(hostname) {
  const origin = apiOrigin(hostname);
  if (hostname == null && origin === "" ) return "";
  const scheme = origin.startsWith("https") ? "wss" : "ws";
  return `${scheme}://${origin.replace(/^https?:\/\//, "")}/api/ws`;
}

// REST URL: <api origin>/<path>
export function restUrl(path, hostname) {
  return apiOrigin(hostname) + path;
}
