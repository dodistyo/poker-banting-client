const SESSION_KEY = 'pocer_session';

function saveSession(code, pid, name, token) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code, pid: String(pid), name, token }));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { code: null, pid: null, name: null, token: null };
    return JSON.parse(raw);
  } catch {
    return { code: null, pid: null, name: null, token: null };
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export { saveSession, loadSession, clearSession };
