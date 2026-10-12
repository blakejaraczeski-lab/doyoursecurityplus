// Study state: what you know, what you got wrong, and when you studied.
//
// Two tiers on purpose. localStorage is the fast tier the UI reads and writes
// synchronously. The server (see serve.py) is the durable tier, written a couple
// of seconds behind. localStorage is keyed to an origin and can be cleared by a
// browser setting; the durable tier is a file on disk with snapshots.

// Scratch mode: open the app with ?scratch=1 and it keeps its progress under a
// separate key and never talks to the server. It exists because driving the real
// app to test it writes real reviews into real study data.
export const SCRATCH =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("scratch");
const KEY = SCRATCH ? "dysp.scratch" : "dysp.v1";

export const DEFAULT_STATE = {
  version: 2,
  updatedAt: 0,
  profile: {
    examDate: null,
    pace: "bootcamp",
    desiredRetention: 0.92,
    dailyReviewGoal: 40,
  },
  items: {},
  misconceptions: {},
  pbq: {},
  reviews: [],
  streak: { days: [], current: 0, best: 0, lastStudied: null },
};

export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const dayBefore = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return today(d);
};

/**
 * Record that studying happened today and recompute the streak.
 * Called on every review; cheap and idempotent within a day.
 */
export function touchStreak(state, now = new Date()) {
  const t = today(now);
  const s = (state.streak ||= structuredClone(DEFAULT_STATE.streak));
  if (s.lastStudied === t) return s;

  s.current = s.lastStudied === dayBefore(t) ? (s.current || 0) + 1 : 1;
  s.best = Math.max(s.best || 0, s.current);
  s.lastStudied = t;
  s.days = [...new Set([...(s.days || []), t])].slice(-120);
  return s;
}

/** Is the streak still alive, or was the last session before yesterday? */
export function streakStatus(state, now = new Date()) {
  const s = state.streak || {};
  const t = today(now);
  if (!s.lastStudied) return { current: 0, best: s.best || 0, studiedToday: false, alive: false };
  const alive = s.lastStudied === t || s.lastStudied === dayBefore(t);
  return {
    current: alive ? s.current || 0 : 0,
    best: s.best || 0,
    studiedToday: s.lastStudied === t,
    alive,
  };
}

/**
 * Confidence calibration.
 *
 * Two numbers matter and they are not symmetrical. Confident-and-wrong is the
 * dangerous quadrant: you will not look it up, because you do not know you are
 * wrong. Guessed-and-right is the fragile quadrant: the score says you know it
 * and you do not.
 */
export function calibration(state) {
  let sureRight = 0, sureWrong = 0, guessRight = 0, guessWrong = 0;
  for (const r of state.reviews || []) {
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
    // Well calibrated means you are right when you say you are sure, and you
    // say you are guessing when you are. Perfect is 0.
    error: sure || guess ? (sure ? sureWrong / sure : 0) * 0.7 + (guess ? guessRight / guess : 0) * 0.3 : null,
  };
}

/** Reviews logged today, for the daily goal ring. */
export function reviewsToday(state, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  return (state.reviews || []).reduce((n, r) => n + (r.at >= from ? 1 : 0), 0);
}

function migrate(parsed) {
  const s = { ...structuredClone(DEFAULT_STATE), ...parsed };
  s.profile = { ...DEFAULT_STATE.profile, ...(parsed.profile || {}) };
  s.streak = { ...DEFAULT_STATE.streak, ...(parsed.streak || {}) };
  s.version = DEFAULT_STATE.version;
  // Fields that earlier versions wrote and nothing reads.
  delete s.session;
  delete s.profile.dailyNewTarget;
  return s;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : structuredClone(DEFAULT_STATE);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

let saveTimer = null;

/** Debounced write to the fast tier. The controller mirrors to the server. */
export function save(state) {
  state.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Could not persist study state locally", e);
    }
  }, 120);
}

/** Write through immediately, used before unload. */
export function flush(state) {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export const exportState = (state) => JSON.stringify(state, null, 2);

export function importState(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || !("misconceptions" in parsed)) {
    throw new Error("That file is not a doyoursecurityplus progress export");
  }
  return migrate(parsed);
}

export function resetState() {
  localStorage.removeItem(KEY);
  return structuredClone(DEFAULT_STATE);
}

/**
 * Derived questions used to be filed under their source card's Anki note
 * number (d-1748014780429); they are filed under the term now (d-hot-site).
 * Progress recorded against the old id moves to the new one, everywhere an
 * item id is kept, so a rename never costs a review. Idempotent and cheap.
 */
export function migrateIds(state, content) {
  const renames = {};
  for (const it of content.items) {
    if (it.sourceItem?.startsWith("anki-")) {
      const old = `d-${it.sourceItem.slice(5)}`;
      if (old !== it.id) renames[old] = it.id;
    }
  }
  const map = (id) => renames[id] || id;
  let moved = 0;
  for (const [oldId, newId] of Object.entries(renames)) {
    if (state.items[oldId] && !state.items[newId]) {
      state.items[newId] = state.items[oldId];
      delete state.items[oldId];
      moved += 1;
    }
  }
  if (!moved) return 0;
  for (const r of state.reviews || []) {
    if (r.kind === "item") r.id = map(r.id);
    if (r.item) r.item = map(r.item);
  }
  for (const m of Object.values(state.misconceptions || {})) {
    if (m.cleanPasses) m.cleanPasses = m.cleanPasses.map(map);
    if (m.lastItem) m.lastItem = map(m.lastItem);
    if (m.firstItem) m.firstItem = map(m.firstItem);
  }
  return moved;
}

/**
 * Drop progress records whose item or PBQ no longer exists in the bank.
 * Regenerating derived content can change ids, and a record pointing at
 * nothing is dead weight: the scheduler cannot serve it and readiness cannot
 * see it. Reviews are kept, because they are history and nothing looks them up
 * by id. Returns how many records were dropped.
 */
export function pruneOrphans(state, content) {
  let n = 0;
  for (const id of Object.keys(state.items || {})) {
    if (!content.itemsById[id]) { delete state.items[id]; n += 1; }
  }
  for (const id of Object.keys(state.pbq || {})) {
    if (!content.pbqsById[id]) { delete state.pbq[id]; n += 1; }
  }
  return n;
}
