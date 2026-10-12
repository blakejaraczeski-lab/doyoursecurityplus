// The review log: one row per answer, append only, its own resource on the
// server (~/.doyoursecurityplus/reviews.jsonl behind GET and POST /api/reviews).
// The state document holds nothing that grows per answer; this does, here.
//
// What the app needs from the log is recent: today's count for the goal ring,
// the last month for calibration and the mock history. Rows written this
// session wait in an outbox until the server has accepted them, and the outbox
// survives a reload. In scratch mode the outbox is the whole log, in the
// browser only, bounded.

import { SCRATCH } from "./state.js";

const ENDPOINT = "/api/reviews";
const KEY = SCRATCH ? "dysp.scratch.reviews" : "dysp.v1.outbox";
const WINDOW_MS = 30 * 86400000;
const DEBOUNCE_MS = 1500;
const SCRATCH_CAP = 2000;

let recent = [];   // rows inside the window, oldest first
let outbox = [];   // rows the server has not accepted yet
let timer = null;
let inFlight = false;

const readKey = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const writeKey = () => { try { localStorage.setItem(KEY, JSON.stringify(SCRATCH ? outbox.slice(-SCRATCH_CAP) : outbox)); } catch {} };
const inWindow = (r, now) => r.at >= now - WINDOW_MS;

/** Load the recent window from the server and merge whatever is still unsent. */
export async function load(now = Date.now()) {
  outbox = readKey();
  let rows = [];
  if (!SCRATCH) {
    try {
      const res = await fetch(`${ENDPOINT}?since=${now - WINDOW_MS}`, { cache: "no-store" });
      if (res.ok) rows = (await res.json()).reviews || [];
    } catch {}
  }
  recent = [...rows, ...outbox].filter((r) => inWindow(r, now)).sort((a, b) => a.at - b.at);
  if (outbox.length) schedule();
}

/** Append one row. */
export function log(row) {
  recent.push(row);
  outbox.push(row);
  writeKey();
  schedule();
}

/**
 * Move everything in a pre-resource state document that grew per answer into
 * the log: the review array, the mock history, and each PBQ's attempt list,
 * which becomes a bounded summary. Returns how many rows moved.
 */
export function absorb(state, now = Date.now()) {
  const rows = [];
  if (Array.isArray(state.reviews)) { rows.push(...state.reviews); delete state.reviews; }
  if (Array.isArray(state.mockHistory)) {
    rows.push(...state.mockHistory.map((m) => ({ kind: "mock", ...m })));
    delete state.mockHistory;
  }
  for (const [id, rec] of Object.entries(state.pbq || {})) {
    if (!Array.isArray(rec.attempts)) continue;
    for (const a of rec.attempts) rows.push({ kind: "pbq", id, ...a });
    state.pbq[id] = {
      attempts: rec.attempts.length,
      best: Math.max(0, ...rec.attempts.map((a) => a.percent || 0)),
      lastAt: rec.attempts.at(-1)?.at || 0,
    };
  }
  if (!rows.length) return 0;
  outbox.push(...rows);
  recent = [...recent, ...rows.filter((r) => inWindow(r, now))].sort((a, b) => a.at - b.at);
  writeKey();
  schedule();
  return rows.length;
}

function schedule() {
  if (SCRATCH) return;
  clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

/** Send the outbox now. Safe to call on visibilitychange: the body is small. */
export async function flush() {
  clearTimeout(timer);
  if (SCRATCH || inFlight || !outbox.length) return;
  const batch = outbox.slice();
  inFlight = true;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch), keepalive: batch.length < 50,
    });
    if (res.ok) { outbox = outbox.slice(batch.length); writeKey(); }
  } catch {} finally {
    inFlight = false;
    if (outbox.length) schedule();
  }
}

export const rows = (kind = null) => (kind ? recent.filter((r) => r.kind === kind) : recent);
export const count = (kind = "item") => rows(kind).length;

/** Answers logged today, for the daily goal ring. A correction event is not an answer. */
export const todayOf = (list, now = new Date()) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  return list.reduce((n, r) => n + (r.kind === "item" && r.at >= from ? 1 : 0), 0);
};
export const today = (now = new Date()) => todayOf(recent, now);

/**
 * Confidence calibration over the recent window.
 *
 * Two numbers matter and they are not symmetrical. Confident-and-wrong is the
 * dangerous quadrant: you will not look it up, because you do not know you are
 * wrong. Guessed-and-right is the fragile quadrant: the score says you know it
 * and you do not. Only answers where confidence was declared count, so a mock
 * answer, committed under the clock, is not in here.
 */
export function calibrationOf(list) {
  let sureRight = 0, sureWrong = 0, guessRight = 0, guessWrong = 0;
  for (const r of list) {
    if (r.kind !== "item" || !r.conf) continue;
    const right = r.grade >= 2;
    if (r.conf === "sure") right ? sureRight++ : sureWrong++;
    else right ? guessRight++ : guessWrong++;
  }
  const sure = sureRight + sureWrong;
  const guess = guessRight + guessWrong;
  return {
    sureRight, sureWrong, guessRight, guessWrong,
    answered: sure + guess,
    overconfidence: sure ? sureWrong / sure : 0,   // claimed sure, got it wrong
    fragile: guess ? guessRight / guess : 0,       // guessed, got it right
  };
}
export const calibration = () => calibrationOf(recent);
