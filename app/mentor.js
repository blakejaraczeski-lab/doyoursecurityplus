// The mentor engine. This is the part that makes the app different from a
// flashcard deck: the scheduled object is the MISCONCEPTION, not the card.
//
// Miss a question -> the distractor you chose names the specific wrong belief ->
// that belief is banked and scheduled -> its next review pulls a DIFFERENT item
// testing the same discrimination -> N clean passes on DISTINCT items retires it.
//
// You cannot retire a misconception by memorizing the question that exposed it,
// and you cannot retire one by reading about it: only answered questions count,
// and the passes that retire it are at least one relearn step apart.

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

// The id the drill gives a read of the correction card (see the mentor-ack action).
const READ_PREFIX = "mentor:";

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
    countAfter: 0,   // a pass counts toward retirement only at or after this time
    reads: 0,        // times the card was read with no question to answer; never a pass
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
  rec.countAfter = 0;              // the spacing clock starts over with the first pass
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
  // Third strike: the card promises a contrast drill, so the correction is due
  // now and the next queue built leads with it, not the shortest step from now.
  if (tierFor(rec) >= 3) rec.due = now;
  return rec;
}

/**
 * Record a correct answer on an item that tests this misconception.
 * Only counts toward retirement if it is a DIFFERENT item from previous passes.
 */
export function pass(state, mcId, itemId, content, now = Date.now(), confident = true) {
  const rec = state.misconceptions[mcId];
  if (!rec || rec.retired) return null;
  const needed = content.misconceptions[mcId]?.retireAfter ?? 2;

  // Reading the card is study time, not evidence. The drill's "Got it" arrives
  // here with a synthetic id; it is recorded and rescheduled and nothing more,
  // so the belief stays open until real questions are answered.
  if (itemId.startsWith(READ_PREFIX)) {
    rec.reads = (rec.reads || 0) + 1;
    scheduleStep(state, rec, now);
    return { retired: false, needed, have: rec.cleanPasses.length, distinct: false, read: true };
  }

  // A guessed right answer is not evidence that the misconception is gone. It
  // still counts as a review, it just does not count toward retirement. Neither
  // does a pass that comes sooner than one relearn step after the last counted
  // one: that proves you remember the explanation you just read.
  const spaced = now >= (rec.countAfter || 0);
  const distinct = confident && !rec.cleanPasses.includes(itemId) && spaced;
  if (distinct) rec.cleanPasses.push(itemId);   // bounded: distinct items only, reset on every miss

  rec.fsrs = fsrs.review(rec.fsrs, confident ? fsrs.RATING.GOOD : fsrs.RATING.HARD, {
    now,
    desiredRetention: state.profile.desiredRetention,
    maxIntervalDays: daysUntilExam(state, now),
  });
  // Only a counted pass advances the step. Re-answering the same question, or a
  // second question a minute later, proves nothing about the belief. A pass that
  // came too early leaves the schedule alone so it cannot push the due date out.
  if (distinct) {
    rec.step = (rec.step ?? 0) + 1;
    scheduleStep(state, rec, now);
    rec.countAfter = rec.due;
  } else if (spaced) {
    scheduleStep(state, rec, now);
  }

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
 * Tier 2  second miss       you have read it once and it did not take: start
 *                           from the rule, not the prose
 * Tier 3  third miss on     stop explaining. Reading it again is demonstrably
 *         (or a lapse after  not working, so switch to a contrast drill: two
 *          it was retired)   questions that look alike with opposite answers
 *
 * The tier follows the count of misses and nothing else. It used to jump to 3
 * on a second "confident" miss, and every miss is confident unless the learner
 * pressed guess, so the second tier was unreachable and the banner lied.
 */
export function tierFor(rec) {
  if (!rec) return 1;
  const h = rec.hits || 0;
  if (h >= 3 || (h >= 2 && rec.retiredAt)) return 3;
  return h === 2 ? 2 : 1;
}

/**
 * Two items testing this same discrimination whose CORRECT answers differ.
 *
 * This is the move that beats memorization. If every question you have seen
 * about WPA3 has "Enterprise" as the answer, you learn to pick Enterprise, not
 * to tell the modes apart. Showing a pair back to back where the right answer
 * flips forces the actual discrimination, and it is the thing a human tutor
 * does when explaining twice has not worked.
 *
 * The question you just missed is never one of the pair (re-serving it teaches
 * the question), and the pair turns with every miss: the same two items on
 * every third strike would teach those two items.
 */
export function contrastPair(mcId, content, state) {
  const rec = state.misconceptions[mcId];
  const { mcqs } = itemsFor(mcId, content, state, rec?.lastItem);
  const byAnswer = new Map();
  for (const it of mcqs) {
    const correct = it.options?.find((o) => o.correct);
    if (!correct) continue;
    const key = correct.text.trim().toLowerCase();
    if (!byAnswer.has(key)) byAnswer.set(key, []);
    byAnswer.get(key).push(it);
  }
  if (byAnswer.size < 2) return null;
  const groups = [...byAnswer.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const turn = rec?.hits || 0;
  const pick = (g, k) => g[1][k % g[1].length];
  const first = groups[turn % groups.length];
  const second = groups[(turn + 1) % groups.length];
  return {
    items: [pick(first, turn), pick(second, turn)],
    answers: [first[0], second[0]],
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
 * The terminology cards (one per objective, generated) cannot say anything
 * specific about a family, so the useful card is built from the pair this
 * learner just confused: both terms named, both definitions in full, one
 * instruction. With no recorded pair it falls back to a plain card.
 */
function terminologyCard(def, rec) {
  const last = rec?.confusions?.[rec.confusions.length - 1];
  const rows = personalContrast(rec)?.rows;
  if (!last || !rows) {
    return {
      label: `Easily confused terms in ${def.objective}`,
      mentor: {
        ...def.mentor,
        diagnosis: `You picked a term that sounds like the right one. Terms in ${def.objective} are close neighbors, and each pair differs by one attribute.`,
        rule: "Name the one attribute that separates the two terms before you choose.",
        tell: "Look for the single detail in the scenario that only one of the terms fits.",
        trap: "",
      },
    };
  }
  return {
    label: `${last.picked} vs ${last.answer}`,
    mentor: {
      ...def.mentor,
      diagnosis: `You picked ${last.picked}; the answer was ${last.answer}. They sound alike and mean different things.`,
      contrast: rows,
      rule: `Name the one attribute that separates ${last.picked} from ${last.answer}, then pick the term that has it.`,
      tell: `The scenario holds one detail that fits ${last.answer} and not ${last.picked}. Find it before you read the options.`,
      trap: "",
    },
  };
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

/**
 * What the banner above a repeat card says, stated from the count of misses and
 * from what the queue will actually do, never from a layout promise.
 */
function bannerFor(tier, rec, pair) {
  if (tier === 2) {
    return {
      kind: "again",
      title: "Second miss on this one",
      text: "Reading it once did not make it stick. Start from the rule of thumb; the table shows the difference.",
    };
  }
  if (tier < 3) return null;
  const back = rec?.retiredAt && (rec.hits || 0) < 3;
  return {
    kind: "third",
    title: back ? "Back after clearing it" : "Third miss on this one",
    text: pair
      ? "Reading is not working, so the next practice starts with two paired questions that have different answers."
      : "Reading is not working. No paired questions exist for this yet, so it comes back as single questions on different items.",
  };
}

/** Everything the UI needs to render the correction for one miss. */
export function card(mcId, content, state) {
  const def = content.misconceptions[mcId];
  if (!def) return null;
  const rec = state.misconceptions[mcId];
  const notes = (content.notesByObjective?.[def.objective] || []).slice(0, 3);
  const needed = def.retireAfter ?? 2;

  const tier = tierFor(rec);
  let label = def.label;
  let mentorBody = def.mentor;
  if (mcId.startsWith("terminology-")) {
    const t = terminologyCard(def, rec);
    label = t.label;
    mentorBody = t.mentor;
  } else {
    // An authored table is never replaced: the learner's own pairs only add the
    // opening line. Authored cards carry no definitions, so no table is built.
    const list = personalContrast(rec)?.pairs.join("; ");
    if (list) mentorBody = { ...def.mentor, diagnosis: `You picked ${list}. ${def.mentor.diagnosis}` };
  }

  const blockers = blockedBy(mcId, state, content);

  return {
    ...def,
    label,
    mentor: mentorBody,
    tier,
    banner: bannerFor(tier, rec, tier >= 3 ? contrastPair(mcId, content, state) : null),
    blockers,
    progress: { have: rec?.cleanPasses.length || 0, needed, hits: rec?.hits || 0, retired: !!rec?.retired },
    objectiveTitle: content.objectiveById[def.objective]?.fullTitle,
    reviewIn: notes,
  };
}
