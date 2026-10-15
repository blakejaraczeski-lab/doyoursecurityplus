// Study state: what you know, what you got wrong, and when you studied.
//
// Two tiers on purpose. localStorage is the fast tier the UI reads and writes
// synchronously. The server (see serve.py) is the durable tier, written a couple
// of seconds behind. localStorage is keyed to an origin and can be cleared by a
// browser setting; the durable tier is a file on disk with snapshots.

// Scratch mode: open the app with ?scratch=1 and it keeps its progress under a
// separate key and never talks to the server. It exists because driving the real
// app to test it writes real reviews into real study data.
import { newCard, review, RATING } from "./fsrs.js";

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
  streak: { days: [], current: 0, best: 0, lastStudied: null },
};
// Nothing above grows per answer. The review log is its own resource, see
// reviews.js; streak.days is capped at 120 entries.

export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const dayBefore = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return today(d);
};

// Whole calendar days from one date to another, noon to noon so a clock change
// never turns two days into one or three.
const daysBetween = (fromIso, toIso) =>
  Math.round((new Date(`${toIso}T12:00:00`) - new Date(`${fromIso}T12:00:00`)) / 86400000);

// A short break does not end a streak: studying again within this many days of
// the last study day carries it on. A longer gap starts a new one; the best stays.
const REST_DAYS = 3;

/**
 * Record that studying happened today and recompute the streak.
 * Called on every review; cheap and idempotent within a day.
 */
export function touchStreak(state, now = new Date()) {
  const t = today(now);
  const s = (state.streak ||= structuredClone(DEFAULT_STATE.streak));
  if (s.lastStudied === t) return s;

  const gap = s.lastStudied ? daysBetween(s.lastStudied, t) : Infinity;
  s.current = gap >= 1 && gap <= REST_DAYS ? (s.current || 0) + 1 : 1;
  s.best = Math.max(s.best || 0, s.current);
  s.lastStudied = t;
  s.days = [...new Set([...(s.days || []), t])].slice(-120);
  return s;
}

/**
 * Where the streak stands. It stays intact for REST_DAYS after the last study
 * day, so a day or two away is a rest and not a loss: restDay is true then, the
 * streak still counts and today has not extended it. Past that it reads 0, and
 * best is kept.
 */
export function streakStatus(state, now = new Date()) {
  const s = state.streak || {};
  const t = today(now);
  if (!s.lastStudied) return { current: 0, best: s.best || 0, studiedToday: false, alive: false, restDay: false };
  const gap = daysBetween(s.lastStudied, t);
  const alive = gap >= 0 && gap <= REST_DAYS;
  const studiedToday = s.lastStudied === t;
  return {
    current: alive ? s.current || 0 : 0,
    best: s.best || 0,
    studiedToday,
    alive,
    restDay: alive && !studiedToday,
  };
}

/**
 * Bring any saved document, from localStorage, the server, an import or a
 * restored backup, up to the shape every reader assumes. A misconception
 * record from an older or hand-edited document may lack its card or its
 * pass list; filling those in here is cheaper than guarding every reader,
 * and a missing field must never take the whole app down at boot.
 */
export function migrate(parsed) {
  const s = { ...structuredClone(DEFAULT_STATE), ...parsed };
  s.profile = { ...DEFAULT_STATE.profile, ...(parsed.profile || {}) };
  s.streak = { ...DEFAULT_STATE.streak, ...(parsed.streak || {}) };
  s.version = DEFAULT_STATE.version;
  for (const rec of Object.values(s.misconceptions || {})) {
    rec.fsrs ||= newCard();
    rec.cleanPasses ||= [];
    rec.hits ??= 0;
    rec.step ??= 0;
    rec.due ??= 0;
    rec.retired = !!rec.retired;
  }
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

/**
 * Record one answer on an item: counts, and its FSRS card. The one place an
 * item review is applied, used by the app and by the replay of the log.
 *
 * No exam cap on the interval. FSRS sets it as the time until retrievability
 * falls to the target, so a due date past the exam means the item is still
 * above target on exam day without another minute spent on it. Capping it
 * forced a redundant review of every long-interval card onto the day before
 * the exam: 618 answers on one day in the plan for the real state.
 */
export function applyItemReview(state, itemId, grade, now = Date.now()) {
  const rec = (state.items[itemId] ||= { seen: 0, correct: 0, wrong: 0, lastSeen: 0, fsrs: newCard() });
  rec.seen += 1;
  rec.lastSeen = now;
  if (grade >= RATING.HARD) rec.correct += 1; else rec.wrong += 1;
  rec.fsrs = review(rec.fsrs || newCard(), grade, { now, desiredRetention: state.profile.desiredRetention });
  return rec;
}

// An export is the whole record: the state document and every answer in the log.
const EXPORT_FORMAT = "doyoursecurityplus-export";
const validRow = (r) => r && typeof r === "object" && typeof r.at === "number" && typeof r.kind === "string";

export const exportState = (state, rows = []) =>
  JSON.stringify({ format: EXPORT_FORMAT, version: 3, exportedAt: Date.now(), state, reviews: rows });

/**
 * Read an export. Takes the current file ({format, state, reviews}) and the
 * older one, which was the bare state document. Returns the migrated state,
 * the log rows it carries and how many rows were not rows.
 */
export function importState(json) {
  let parsed;
  try { parsed = JSON.parse(json); } catch { parsed = null; }
  const doc = parsed && typeof parsed === "object" && parsed.format === EXPORT_FORMAT ? parsed.state : parsed;
  if (!doc || typeof doc !== "object" || !("misconceptions" in doc)) {
    throw new Error("That file is not a doyoursecurityplus progress export");
  }
  const all = parsed.format === EXPORT_FORMAT && Array.isArray(parsed.reviews) ? parsed.reviews : [];
  const rows = all.filter(validRow);
  return { state: migrate(doc), rows, skipped: all.length - rows.length };
}

export function resetState() {
  localStorage.removeItem(KEY);
  return structuredClone(DEFAULT_STATE);
}

const EXAM_MAX_MONTHS = 18;

/**
 * Why an exam date cannot be used, or null. An empty date is allowed: it clears
 * the date. Today is allowed (the exam is today); the past and a date more than
 * 18 months out are typos far more often than plans.
 */
export function examDateProblem(value, now = new Date()) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00`))) {
    return "That is not a date. Use the date picker.";
  }
  const t = today(now);
  if (value < t) return "That date has already passed. Pick today or a later day.";
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() + EXAM_MAX_MONTHS);
  if (value > today(limit)) return `That is more than ${EXAM_MAX_MONTHS} months away. Pick a nearer date.`;
  return null;
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
  for (const m of Object.values(state.misconceptions || {})) {
    if (m.cleanPasses) m.cleanPasses = m.cleanPasses.map(map);
    if (m.lastItem) m.lastItem = map(m.lastItem);
    if (m.firstItem) m.firstItem = map(m.firstItem);
  }
  return moved;
}

/**
 * Drop progress records whose item, PBQ or misconception no longer exists in the bank.
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
  // A misconception whose definition is gone can never be served or retired,
  // and an open one would count against you forever.
  for (const id of Object.keys(state.misconceptions || {})) {
    if (!content.misconceptions[id]) { delete state.misconceptions[id]; n += 1; }
  }
  return n;
}
