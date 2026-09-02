const SESSION_KEY = 'poker-banting_session';

function saveSession(code, pid, name, token, isPublic = false) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code, pid: String(pid), name, token, isPublic }));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { code: null, pid: null, name: null, token: null, isPublic: false };
    return JSON.parse(raw);
  } catch {
    return { code: null, pid: null, name: null, token: null, isPublic: false };
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export { saveSession, loadSession, clearSession };
