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

/**
 * Write now rather than on the debounce. Called when the tab is hidden, which
 * is the last moment a normal request is still reliable.
 *
 * This used to be a keepalive fetch on beforeunload, and keepalive bodies are
 * capped at 64 KB by the spec. State passed that a while ago (it grows with
 * every review), so the browser rejected the request and the rejection was
 * never awaited: the last writes of every session were being dropped in
 * silence, with the status dot still reading "saved".
 */
export function flushNow(state) {
  clearTimeout(timer);
  pending = state;
  return drain();
}

/**
 * Genuine last resort, on pagehide, when there is no time left for a normal
 * request. Subject to the same 64 KB cap, so it is only attempted when the body
 * actually fits, and it is explicitly best effort.
 */
export function flushBeacon(state) {
  clearTimeout(timer);
  try {
    const body = JSON.stringify(state);
    if (body.length > 60_000) return false;
    const blob = new Blob([body], { type: "application/json" });
    fetch(ENDPOINT, { method: "PUT", body: blob, keepalive: true,
                      headers: { "Content-Type": "application/json" } })
      .catch(() => {});
    return true;
  } catch { return false; }
}

export async function health() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return res.ok ? res.json() : null;
  } catch { return null; }
}
