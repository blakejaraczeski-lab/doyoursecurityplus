// The mentor engine. This is the part that makes the app different from a
// flashcard deck: the scheduled object is the MISCONCEPTION, not the card.
//
// Miss a question -> the distractor you chose names the specific wrong belief ->
// that belief is banked and scheduled -> its next review pulls a DIFFERENT item
// testing the same discrimination -> N clean passes on DISTINCT items retires it.
//
// You cannot retire a misconception by memorising the question that exposed it.

import * as fsrs from "./fsrs.js";
import { isGraded } from "./content.js";

// Relearning steps for an open misconception.
//
// FSRS schedules in days, which is right for long term retention and wrong for
// a correction you made 30 seconds ago. A freshly banked misconception must come
// back inside the same session, on a different question, while the explanation
// is still warm. Once it survives that, it moves onto the day scale.
//
// The FSRS card keeps accumulating stability and difficulty throughout, so when
// the misconception retires, the underlying items are already correctly paced.
const RELEARN_STEPS = {
  bootcamp: [8 * 60e3, 20 * 3600e3, 3 * 86400e3],
  balanced: [15 * 60e3, 24 * 3600e3, 4 * 86400e3],
  longhaul: [30 * 60e3, 2 * 86400e3, 6 * 86400e3],
};

function stepsFor(state) {
  return RELEARN_STEPS[state.profile.pace] || RELEARN_STEPS.bootcamp;
}

/** When should this open misconception next be put in front of the user? */
function scheduleStep(state, rec, now) {
  const steps = stepsFor(state);
  const at = Math.min(rec.step ?? 0, steps.length - 1);
  const examCap = now + daysUntilExam(state, now) * fsrs.DAY_MS;
  rec.due = Math.min(now + steps[at], examCap);
  return rec.due;
}

function ensure(state, mcId) {
  return (state.misconceptions[mcId] ||= {
    fsrs: fsrs.newCard(),
    cleanPasses: [],
    hits: 0,
    banked: Date.now(),
    retired: false,
    lastItem: null,
    firstItem: null,
    step: 0,
    due: 0,
  });
}

/**
 * Record a wrong answer that exposed this misconception.
 *
 * `detail` is optional and carries the specific pair you confused, for the
 * terminology misconceptions where the useful correction is "you picked X, and
 * X is actually this". A generic table of every term in the objective teaches
 * nothing; the two terms you just mixed up teach a lot.
 */
export function bank(state, mcId, itemId, now = Date.now(), detail = null, confident = true) {
  const rec = ensure(state, mcId);
  rec.hits += 1;
  // Confidently wrong is the dangerous state. You are not missing information,
  // you are holding the wrong information and have no reason to look it up.
  // It escalates faster than an admitted guess.
  if (confident) rec.confidentMisses = (rec.confidentMisses || 0) + 1;
  rec.retired = false;
  rec.cleanPasses = [];            // a fresh miss resets progress toward retirement
  rec.step = 0;                    // and drops it back to the shortest step
  rec.lastItem = itemId;
  rec.firstItem ||= itemId;
  if (detail?.picked && detail?.answer) {
    rec.confusions = (rec.confusions || []).filter(
      (c) => !(c.picked === detail.picked && c.answer === detail.answer)
    );
    rec.confusions.push({ ...detail, at: now });   // bounded: sliced to the last six
    rec.confusions = rec.confusions.slice(-6);
  }
  rec.fsrs = fsrs.review(rec.fsrs, fsrs.RATING.AGAIN, {
    now,
    desiredRetention: state.profile.desiredRetention,
    maxIntervalDays: daysUntilExam(state, now),
  });
  scheduleStep(state, rec, now);
  return rec;
}

/**
 * Record a correct answer on an item that tests this misconception.
 * Only counts toward retirement if it is a DIFFERENT item from previous passes.
 */
export function pass(state, mcId, itemId, content, now = Date.now(), confident = true) {
  const rec = state.misconceptions[mcId];
  if (!rec || rec.retired) return null;

  // A guessed right answer is not evidence that the misconception is gone. It
  // still counts as a review, it just does not count toward retirement.
  const distinct = confident && !rec.cleanPasses.includes(itemId);
  if (distinct) rec.cleanPasses.push(itemId);   // bounded: distinct items only, reset on every miss
  if (!confident) rec.luckyPasses = (rec.luckyPasses || 0) + 1;

  rec.fsrs = fsrs.review(rec.fsrs, confident ? fsrs.RATING.GOOD : fsrs.RATING.HARD, {
    now,
    desiredRetention: state.profile.desiredRetention,
    maxIntervalDays: daysUntilExam(state, now),
  });
  // Only a pass on a NEW item advances the step. Re-answering the same question
  // correctly proves you remember that question, not that you fixed the belief.
  if (distinct) rec.step = (rec.step ?? 0) + 1;
  scheduleStep(state, rec, now);

  const needed = content.misconceptions[mcId]?.retireAfter ?? 2;
  if (rec.cleanPasses.length >= needed) {
    rec.retired = true;
    rec.retiredAt = now;
    return { retired: true, needed, have: rec.cleanPasses.length, distinct };
  }
  return { retired: false, needed, have: rec.cleanPasses.length, distinct };
}

export function daysUntilExam(state, now = Date.now()) {
  if (!state.profile.examDate) return 36500;
  const days = Math.ceil((new Date(state.profile.examDate).getTime() - now) / fsrs.DAY_MS);
  // A correction is never scheduled for after the exam: its relearning steps
  // and its card compress to fit inside the time left. Items are not capped;
  // see applyItemReview in state.js.
  return Math.max(1, days - 1);
}

/**
 * How many times have you now been wrong about this?
 *
 * Tier 1  first miss        read the full correction
 * Tier 2  second miss       you have read it once and it did not take: lead with
 *                           the rule, demote the prose
 * Tier 3  third miss on     stop explaining. Reading it again is demonstrably
 *         (or a lapse after  not working, so switch to a contrast drill: two
 *          it was retired)   questions that look alike with opposite answers
 */
export function tierFor(rec) {
  if (!rec) return 1;
  const h = rec.hits || 0;
  const confident = rec.confidentMisses || 0;
  // Two confident misses is worth three hesitant ones: the belief is held, not absent.
  if (h >= 3 || confident >= 2 || (h >= 2 && rec.retiredAt)) return 3;
  if (h === 2 || confident >= 1 && h >= 1 && rec.luckyPasses) return 2;
  return 1;
}

/**
 * Two items testing this same discrimination whose CORRECT answers differ.
 *
 * This is the move that beats memorisation. If every question you have seen
 * about WPA3 has "Enterprise" as the answer, you learn to pick Enterprise, not
 * to tell the modes apart. Showing a pair back to back where the right answer
 * flips forces the actual discrimination, and it is the thing a human tutor
 * does when explaining twice has not worked.
 */
export function contrastPair(mcId, content, state) {
  const { mcqs } = itemsFor(mcId, content, state);
  const byAnswer = new Map();
  for (const it of mcqs) {
    const correct = it.options?.find((o) => o.correct);
    if (!correct) continue;
    const key = correct.text.trim().toLowerCase();
    if (!byAnswer.has(key)) byAnswer.set(key, []);
    byAnswer.get(key).push(it);
  }
  if (byAnswer.size < 2) return null;
  const groups = [...byAnswer.entries()].sort((a, b) => b[1].length - a[1].length);
  return {
    items: [groups[0][1][0], groups[1][1][0]],
    answers: [groups[0][0], groups[1][0]],
  };
}

/**
 * Prerequisites of `mcId` that are themselves still open.
 *
 * Three unrelated-looking misses can share one broken dependency underneath. A
 * tutor repairs the dependency; a flashcard deck re-explains all three. This is
 * what lets the queue route backward instead of drilling the symptom.
 */
export function blockedBy(mcId, state, content) {
  const reqs = content.prerequisites?.[mcId] || [];
  return reqs
    .map((r) => ({ ...r, rec: state.misconceptions[r.id], def: content.misconceptions[r.id] }))
    .filter((r) => r.def && r.rec && !r.rec.retired);
}

/**
 * Misses that look unrelated but share one open prerequisite. Surfaced in
 * readiness so the root cause is visible rather than inferred.
 */
export function sharedRootCauses(state, content) {
  const counts = {};
  for (const [id, rec] of Object.entries(state.misconceptions)) {
    if (rec.retired) continue;
    for (const r of content.prerequisites?.[id] || []) {
      const prereq = state.misconceptions[r.id];
      if (!prereq || prereq.retired) continue;
      (counts[r.id] ||= { id: r.id, blocks: [], def: content.misconceptions[r.id] }).blocks.push(id);
    }
  }
  return Object.values(counts)
    .filter((c) => c.def && c.blocks.length >= 2)
    .sort((a, b) => b.blocks.length - a.blocks.length);
}

/** Misconceptions that are open and due, most urgent first. */
export function due(state, content, now = Date.now()) {
  const sevWeight = { high: 1.0, medium: 0.75, low: 0.5 };
  const out = [];
  for (const [id, rec] of Object.entries(state.misconceptions)) {
    if (rec.retired) continue;
    const def = content.misconceptions[id];
    if (!def) continue;
    const dueAt = rec.due || rec.fsrs.due;
    if (now < dueAt) continue;
    const overdueDays = (now - dueAt) / fsrs.DAY_MS;
    const objective = content.objectiveById[def.objective];
    const urgency =
      (1 + Math.min(overdueDays, 30) / 10) *
      (sevWeight[def.severity] ?? 0.75) *
      (1 + (objective?.weight ?? 0.1) * 2) *
      (1 + Math.min(rec.hits, 5) * 0.25);
    out.push({ id, rec, def, overdueDays, urgency });
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

/** All open misconceptions, due or not. */
export function open(state, content) {
  return Object.entries(state.misconceptions)
    .filter(([, r]) => !r.retired)
    .map(([id, rec]) => ({ id, rec, def: content.misconceptions[id] }))
    .filter((x) => x.def);
}

/**
 * Items that test a given misconception, excluding ones already used for a
 * clean pass on it. This is the retargeting query.
 */
export function itemsFor(mcId, content, state, excludeItemId = null) {
  const rec = state.misconceptions[mcId];
  const used = new Set(rec?.cleanPasses || []);
  if (excludeItemId) used.add(excludeItemId);

  // Single and multiple select alike: a choose-two item tests the same
  // discrimination and the exam asks it the same way.
  const mcqs = content.items.filter(
    (it) => isGraded(it) && it.options?.some((o) => o.misconception === mcId) && !used.has(it.id)
  );
  const pbqs = content.pbqs.filter(
    (p) => p.subtasks?.some((s) => s.misconception === mcId) && !used.has(p.id)
  );
  return { mcqs, pbqs };
}

/**
 * Build the contrast table from the pairs this user actually confused, rather
 * than from a fixed list. Definitions are shown in full: a truncated definition
 * is exactly the part you needed.
 */
function personalContrast(rec) {
  if (!rec?.confusions?.length) return null;
  const rows = [["Term", "What it actually means"]];
  const seen = new Set();
  const pairs = [];
  for (const c of rec.confusions.slice(-4)) {
    pairs.push(`${c.picked} for ${c.answer}`);
    for (const [term, definition] of [[c.picked, c.pickedDef], [c.answer, c.answerDef]]) {
      if (term && definition && !seen.has(term)) {
        seen.add(term);
        rows.push([term, definition]);
      }
    }
  }
  return rows.length > 1 ? { rows, pairs } : null;
}

/** Everything the UI needs to render the correction for one miss. */
export function card(mcId, content, state) {
  const def = content.misconceptions[mcId];
  if (!def) return null;
  const rec = state.misconceptions[mcId];
  const notes = (content.notesByObjective?.[def.objective] || []).slice(0, 3);
  const needed = def.retireAfter ?? 2;

  const tier = tierFor(rec);
  let mentorBody = def.mentor;
  const personal = personalContrast(rec);
  if (personal) {
    const list = personal.pairs.join("; ");
    mentorBody = {
      ...def.mentor,
      diagnosis: `You picked ${list}. ${def.mentor.diagnosis}`,
      contrast: personal.rows,
    };
  }

  const blockers = blockedBy(mcId, state, content);

  return {
    ...def,
    mentor: mentorBody,
    tier,
    blockers,
    progress: { have: rec?.cleanPasses.length || 0, needed, hits: rec?.hits || 0, retired: !!rec?.retired },
    objectiveTitle: content.objectiveById[def.objective]?.fullTitle,
    reviewIn: notes,
  };
}
