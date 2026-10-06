// Mirrors study state to the local server so it survives the browser.
//
// Conflict rule: last write wins by `updatedAt`, decided at start-up. Mid
// session the browser is always authoritative, because it is the only thing
// making changes. The server refuses a push that would overwrite something
// newer, which only happens if two tabs or two browsers were both studying.

const ENDPOINT = "/api/state";
const DEBOUNCE_MS = 1500;

let timer = null;
let inFlight = false;
let pending = null;
let listener = () => {};

export const SYNC = {
  UNKNOWN: "unknown",
  SAVED: "saved",
  SAVING: "saving",
  OFFLINE: "offline",
  CONFLICT: "conflict",
};

let status = SYNC.UNKNOWN;
const setStatus = (s, detail) => {
  status = s;
  listener(s, detail);
};
export const getStatus = () => status;
export const onStatusChange = (fn) => { listener = fn; };

/** Read the durable copy. Returns null when the server has nothing or is down. */
export async function pull() {
  try {
    const res = await fetch(ENDPOINT, { cache: "no-store" });
    if (res.status === 404) { setStatus(SYNC.SAVED); return null; }
    if (!res.ok) { setStatus(SYNC.OFFLINE); return null; }
    const { state } = await res.json();
    setStatus(SYNC.SAVED);
    return state;
  } catch {
    setStatus(SYNC.OFFLINE);
    return null;
  }
}

async function put(state, force = false) {
  const res = await fetch(ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(force ? { "X-Dysp-Force": "1" } : {}) },
    body: JSON.stringify(state),
  });
  if (res.status === 409) {
    const body = await res.json();
    setStatus(SYNC.CONFLICT, body);
    return false;
  }
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
  setStatus(SYNC.SAVED);
  return true;
}

async function drain() {
  if (inFlight || !pending) return;
  const state = pending;
  pending = null;
  inFlight = true;
  setStatus(SYNC.SAVING);
  try {
    await put(state);
  } catch {
    setStatus(SYNC.OFFLINE);
  } finally {
    inFlight = false;
    if (pending) drain();
  }
}

/** Queue a debounced mirror of the current state. */
export function push(state) {
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(drain, DEBOUNCE_MS);
}

/** Resolve a conflict by declaring this browser the winner. */
export async function forcePush(state) {
  try { return await put(state, true); } catch { setStatus(SYNC.OFFLINE); return false; }
}

/** Best-effort final write when the tab closes. */
export function flushBeacon(state) {
  clearTimeout(timer);
  try {
    const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
    // sendBeacon cannot issue PUT, so the server also accepts this path via POST-like
    // semantics is not available; fall back to a keepalive fetch instead.
    fetch(ENDPOINT, { method: "PUT", body: blob, keepalive: true,
                      headers: { "Content-Type": "application/json" } });
  } catch {}
}

export async function health() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return res.ok ? res.json() : null;
  } catch { return null; }
}
