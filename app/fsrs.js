// FSRS (Free Spaced Repetition Scheduler), v5 formulation.
//
// Three state variables per scheduled object:
//   stability      S - days until recall probability falls to 90%
//   difficulty     D - 1 to 10, how hard this object is for you specifically
//   retrievability R - probability you would recall it right now
//
// The published default parameters below were trained on a very large public
// review corpus. They are good out of the box; once this user has a few hundred
// reviews logged, `reviews` in the store is exactly the input an optimiser needs.

const DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
  1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
  2.9898, 0.51655, 0.6621,
];

const DECAY = -0.5;
const FACTOR = 19 / 81; // 0.9^(1/DECAY) - 1

export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };
export const DAY_MS = 86400000;

const clampD = (d) => Math.min(Math.max(d, 1), 10);

/** Probability of recall after `elapsedDays` at stability `s`. */
function retrievability(elapsedDays, s) {
  if (s <= 0) return 0;
  return Math.pow(1 + (FACTOR * Math.max(elapsedDays, 0)) / s, DECAY);
}

/** Days until retrievability decays to `desiredRetention`. */
function intervalFor(s, desiredRetention = 0.9) {
  const i = (s / FACTOR) * (Math.pow(desiredRetention, 1 / DECAY) - 1);
  return Math.max(1, Math.round(i));
}

const initStability = (w, g) => Math.max(w[g - 1], 0.1);
const initDifficulty = (w, g) => clampD(w[4] - Math.exp(w[5] * (g - 1)) + 1);

function nextDifficulty(w, d, g) {
  const delta = d - w[6] * (g - 3);
  // mean reversion toward the difficulty an "easy" first answer would imply
  return clampD(w[7] * initDifficulty(w, 4) + (1 - w[7]) * delta);
}

function stabilityOnRecall(w, d, s, r, g) {
  const hard = g === RATING.HARD ? w[15] : 1;
  const easy = g === RATING.EASY ? w[16] : 1;
  const inc =
    Math.exp(w[8]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - r)) - 1) *
    hard *
    easy;
  return s * (1 + inc);
}

function stabilityOnLapse(w, d, s, r) {
  const next =
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - r));
  return Math.min(Math.max(next, 0.1), s); // a lapse never increases stability
}

/** A brand new scheduled object, not yet reviewed. */
export function newCard() {
  return { stability: 0, difficulty: 0, due: 0, lastReview: 0, reps: 0, lapses: 0, state: "new" };
}

/**
 * Apply one review.
 * @param {object} card    previous FSRS state
 * @param {number} grade   RATING.AGAIN | HARD | GOOD | EASY
 * @param {object} opts    { now, w, desiredRetention, maxIntervalDays }
 * @returns {object} the new card state, including the interval used
 */
export function review(card, grade, opts = {}) {
  const w = opts.w || DEFAULT_W;
  const now = opts.now ?? Date.now();
  const retention = opts.desiredRetention ?? 0.9;
  const maxInterval = opts.maxIntervalDays ?? 36500;

  let stability, difficulty, r;

  if (card.state === "new" || card.reps === 0) {
    stability = initStability(w, grade);
    difficulty = initDifficulty(w, grade);
    r = 1;
  } else {
    const elapsed = Math.max(0, (now - card.lastReview) / DAY_MS);
    r = retrievability(elapsed, card.stability);
    difficulty = nextDifficulty(w, card.difficulty, grade);
    stability =
      grade === RATING.AGAIN
        ? stabilityOnLapse(w, difficulty, card.stability, r)
        : stabilityOnRecall(w, difficulty, card.stability, r, grade);
  }

  const days = Math.min(intervalFor(stability, retention), maxInterval);
  return {
    stability,
    difficulty,
    due: now + days * DAY_MS,
    lastReview: now,
    reps: (card.reps || 0) + 1,
    lapses: (card.lapses || 0) + (grade === RATING.AGAIN ? 1 : 0),
    state: grade === RATING.AGAIN ? "relearning" : "review",
    intervalDays: days,
    retrievabilityAtReview: r,
  };
}

/** Current recall probability for a card, right now. */
export function currentRetrievability(card, now = Date.now()) {
  if (!card || card.state === "new" || !card.stability) return 0;
  return retrievability((now - card.lastReview) / DAY_MS, card.stability);
}
