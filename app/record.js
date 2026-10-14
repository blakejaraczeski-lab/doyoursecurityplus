import { App } from "./app.js";
import * as store from "./state.js";
import * as reviews from "./reviews.js";
import * as fsrs from "./fsrs.js";
import * as mentor from "./mentor.js";

// Under this, on a question of real difficulty, you did not read the stem. The
// exam punishes exactly this: the options are written to be pattern matched.
const RUSHED_MS = 6000;

// --- recording ------------------------------------------------------------
export function recordItem(item, grade, now = Date.now(), { responseMs = null, conf = null, mock = false } = {}) {
  store.applyItemReview(App.state, item.id, grade, now);
  reviews.log({ at: now, kind: "item", id: item.id, grade,
                ...(responseMs != null ? { ms: responseMs } : {}),
                ...(conf != null ? { conf: conf ? "sure" : "guess" } : {}),
                ...(mock ? { mock: true } : {}) });
  store.touchStreak(App.state);
}

/** Bank or pass a misconception, and log the event. The one place both happen. */
function bankMc(mc, itemId, now, detail = null, confident = true) {
  mentor.bank(App.state, mc, itemId, now, detail, confident);
  reviews.log({ at: now, kind: "misconception", id: mc, item: itemId, grade: 1 });
}
export function passMc(mc, itemId, now, confident = true, ms = null) {
  const res = mentor.pass(App.state, mc, itemId, App.content, now, confident);
  if (res) reviews.log({ at: now, kind: "misconception", id: mc, item: itemId, grade: 3, ...(ms != null ? { ms } : {}) });
  return res;
}

/**
 * Record one answered multiple choice item, single or multiple select, in a
 * drill or a mock: FSRS on the item, bank or pass on every misconception it
 * tests, one review row. Multiple select is all or nothing, the way the exam
 * scores it: the picked set must equal the correct set exactly, and every
 * wrongly picked option still banks its own misconception, so a near miss
 * teaches as much as a clean miss. Returns what the caller shows or tallies.
 */
export function recordOutcome(entry, picked, { confident = true, responseMs = null, mock = false, now = Date.now() } = {}) {
  const item = entry.item;
  const correctIds = new Set(item.options.filter((o) => o.correct).map((o) => o.id));
  const correct = picked.size === correctIds.size && [...picked].every((id) => correctIds.has(id));
  const rushed = !correct && responseMs != null && responseMs < RUSHED_MS && (item.difficulty || 2) >= 3;

  // A confident right answer earns a longer interval than a lucky one, and a
  // guess that happened to land earns a short one. A mock answer is committed
  // under exam conditions, so it is treated as confident for the mentor but
  // not counted in calibration, which only you can declare.
  const grade = correct ? (confident ? fsrs.RATING.GOOD : fsrs.RATING.HARD) : fsrs.RATING.AGAIN;
  recordItem(item, grade, now, { responseMs, conf: mock ? null : confident, mock });

  const banked = [];
  const retired = [];
  const bank = (mc, detail = null) => {
    bankMc(mc, item.id, now, detail, confident);
    if (!banked.includes(mc)) banked.push(mc);
  };

  if (correct) {
    const tested = new Set(item.options.filter((o) => o.misconception).map((o) => o.misconception));
    if (entry.targetMisconception) tested.add(entry.targetMisconception);
    for (const mc of tested) {
      const res = passMc(mc, item.id, now, confident);
      if (res?.retired) retired.push({ id: mc, have: res.have });
    }
  } else {
    const right = item.options.find((o) => o.correct);
    for (const o of item.options) {
      if (picked.has(o.id) && !o.correct && o.misconception) {
        // For terminology items the useful correction is the exact pair you
        // confused, so both definitions travel with the bank.
        bank(o.misconception, o.definition && right?.definition
          ? { picked: o.text, pickedDef: o.definition, answer: right.text, answerDef: right.definition }
          : null);
      }
      // Missing a required option is its own error.
      if (o.correct && !picked.has(o.id) && o.missedMisconception) bank(o.missedMisconception);
    }
    if (entry.targetMisconception && !banked.includes(entry.targetMisconception)) bank(entry.targetMisconception);
  }

  return {
    correct, rushed, confident, responseMs, banked,
    retired: retired.length,
    retiredNote: retired.length
      ? `"${App.content.misconceptions[retired[0].id].label}" cleared after ${retired[0].have} correct answers on different questions.`
      : null,
    overconfident: confident && !correct,
    lucky: !confident && correct,
  };
}

/**
 * Record a graded PBQ attempt and bank or pass every subtask. The state keeps
 * a bounded summary per PBQ; the attempt itself is a row in the review log.
 * Returns the banked ids.
 */
export function recordPbq(pbq, g, now, { seconds = null, mock = false } = {}) {
  const rec = (App.state.pbq[pbq.id] ||= { attempts: 0, best: 0, lastAt: 0 });
  rec.attempts += 1;
  rec.best = Math.max(rec.best, g.percent);
  rec.lastAt = now;
  reviews.log({ at: now, kind: "pbq", id: pbq.id, percent: g.percent, earned: g.earned, max: g.max,
                ...(seconds != null ? { seconds } : {}), ...(mock ? { mock: true } : {}) });
  const banked = [];
  for (const r of g.results) {
    if (!r.misconception) continue;
    if (r.pass) passMc(r.misconception, pbq.id, now);
    else {
      bankMc(r.misconception, pbq.id, now);
      if (!banked.includes(r.misconception)) banked.push(r.misconception);
    }
  }
  store.touchStreak(App.state);
  return banked;
}
