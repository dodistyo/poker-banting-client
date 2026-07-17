const SESSION_KEY = 'pocer_session';

function saveSession(code, pid, name) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code, pid: String(pid), name }));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { code: null, pid: null, name: null };
    return JSON.parse(raw);
  } catch {
    return { code: null, pid: null, name: null };
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export { saveSession, loadSession, clearSession };
