// Mirrors study state to the local server so it survives the browser.
//
// Conflict rule: last write wins by `updatedAt`, decided at start-up. Mid
// session the browser is always authoritative, because it is the only thing
// making changes. Every push is a conditional replace: it names the server
// version it was built on (If-Match), and the server answers 412 with its
// newer copy if another tab or browser has saved since. An unconditional
// replace is what resolving that conflict in this browser's favour means.

import { SCRATCH } from "./state.js";

const ENDPOINT = "/api/state";
const DEBOUNCE_MS = 1500;

let timer = null;
let inFlight = false;
let pending = null;
// The server's updatedAt as last seen, the base of the next conditional put.
// null means nobody has asked yet, or the last ask failed; 0 means the server
// answered and holds nothing. A save never goes out on null: it would carry no
// precondition, and a stale tab could replace newer progress.
let version = null;

const SYNC = {
  UNKNOWN: "unknown",
  SAVED: "saved",
  SAVING: "saving",
  OFFLINE: "offline",
  CONFLICT: "conflict",
};

// The UI polls this once a second for its status dot; nothing subscribes.
let status = SYNC.UNKNOWN;
const setStatus = (s) => { status = s; };
export const getStatus = () => status;

/** Read the durable copy. Returns null when the server has nothing or is down. */
export async function pull() {
  if (SCRATCH) { setStatus(SYNC.SAVED); return null; }
  try {
    const res = await fetch(ENDPOINT, { cache: "no-store" });
    if (res.status === 404) { version = 0; setStatus(SYNC.SAVED); return null; }
    if (!res.ok) { setStatus(SYNC.OFFLINE); return null; }
    const { state } = await res.json();
    version = state.updatedAt || 0;
    setStatus(SYNC.SAVED);
    return state;
  } catch {
    setStatus(SYNC.OFFLINE);
    return null;
  }
}

async function put(state, { unconditional = false } = {}) {
  const res = await fetch(ENDPOINT, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(unconditional ? {} : { "If-Match": String(version) }),
    },
    body: JSON.stringify(state),
  });
  if (res.status === 412) {
    setStatus(SYNC.CONFLICT);
    return false;
  }
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
  version = state.updatedAt;
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
    if (version == null) {
      // Never saved against a server we have not heard from. Ask first; if it
      // still cannot be reached, hold the state for the next push. If it holds
      // newer work than this tab, that is a conflict, not a save.
      const remote = await pull();
      if (version == null) { pending = pending || state; return; }
      if (remote && (remote.updatedAt || 0) > (state.updatedAt || 0)) { setStatus(SYNC.CONFLICT); return; }
    }
    await put(state);
  } catch {
    setStatus(SYNC.OFFLINE);
  } finally {
    inFlight = false;
    if (pending && version != null) drain();
  }
}

/** Queue a debounced mirror of the current state. */
export function push(state) {
  if (SCRATCH) return;
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(drain, DEBOUNCE_MS);
}

/** Resolve a conflict by declaring this browser the winner: an unconditional replace. */
export async function forcePush(state) {
  try { return await put(state, { unconditional: true }); } catch { setStatus(SYNC.OFFLINE); return false; }
}

/**
 * Write now rather than on the debounce. Called when the tab is hidden, which
 * is the last moment a normal request is still reliable. Not a keepalive fetch
 * on beforeunload: keepalive bodies are capped at 64 KB by the spec, this state
 * grows past that with every review, and a rejected keepalive is never awaited,
 * so a session's last writes would vanish with the status dot reading "saved".
 */
export function flushNow(state) {
  if (SCRATCH) return;
  clearTimeout(timer);
  pending = state;
  return drain();
}

/**
 * Genuine last resort, on pagehide, when there is no time left for a normal
 * request. Subject to the same 64 KB cap, so it is only attempted when the body
 * actually fits, and it is explicitly best effort. It carries the same
 * precondition as every other save: a tab that was already refused as stale
 * must not win on its way out just because nobody is left to read the 412.
 */
export function flushBeacon(state) {
  if (SCRATCH || status === SYNC.CONFLICT || version == null) return false;
  clearTimeout(timer);
  try {
    const body = JSON.stringify(state);
    if (body.length > 60_000) return false;
    const blob = new Blob([body], { type: "application/json" });
    fetch(ENDPOINT, { method: "PUT", body: blob, keepalive: true,
                      headers: { "Content-Type": "application/json",
                                 "If-Match": String(version) } })
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
