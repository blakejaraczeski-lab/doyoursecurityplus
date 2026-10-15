// What the queue and the forecast share: the exam's shape, what an item and a
// question are worth, and the two lookups into study state.

import { isGraded } from "./content.js";

// The exam's shape: 90 questions in 90 minutes with PBQs front loaded, scored
// 100-900 with 750 to pass. The blocks are fractions of it.
export const FORMATS = {
  full:  { label: "Full exam",   total: 90, pbqCount: 5, minutes: 90 },
  half:  { label: "Half block",  total: 45, pbqCount: 3, minutes: 45 },
  short: { label: "Short block", total: 20, pbqCount: 1, minutes: 20 },
};
export const PBQ_WEIGHT = 3; // a PBQ is worth roughly three multiple choice items

/** Questions in a session. The weak-spot session is shorter: corrections only. */
export const SESSION_SIZE = { drill: 25, weak: 15 };

/**
 * What a block can run against this bank. A bank smaller than the block is
 * honest about it: the count is what exists and the clock keeps the exam's
 * minute per question rather than giving ninety minutes to eleven items.
 */
export function blockFit(content, format) {
  const pbqs = Math.min(format.pbqCount, content.pbqs.length);
  const total = Math.min(format.total, content.items.filter(isGraded).length + pbqs);
  const minutes = total < format.total ? Math.max(5, Math.round(format.minutes * total / format.total)) : format.minutes;
  return { pbqs, total, minutes, short: total < format.total };
}

/**
 * Item weight for scoring. CompTIA says items carry different weights by
 * difficulty and keeps the model confidential, so this is an approximation: a
 * hard item is worth about twice an easy one. A flat count would reward
 * farming easy items, and a run of difficulty-1 recognition would read as
 * readiness.
 */
export const weightOf = (it) => 0.6 + 0.2 * Math.max(1, Math.min(5, it.difficulty || 2));

/**
 * A 0..1 fraction onto CompTIA's 100-900 scale, anchored so that 750, the pass
 * line, sits at 0.75. An estimate, not a predicted score.
 */
export const toScaled = (p) =>
  p <= 0.75 ? Math.round(100 + (650 / 0.75) * p) : Math.round(750 + (150 / 0.25) * (p - 0.75));

/** Scaled points one exam question is worth below the pass line: 650 points over 75% of 90. */
export const POINTS_PER_QUESTION = 650 / 0.75 / 90;
export const EXAM_QUESTIONS = 90;
// Seconds per answer by kind. The real log's median for a graded answer is 39 s
// (62 timed rows, 2026-10-13); recall and PBQ are not timed yet.
export const SECONDS = { mcq: 40, "mcq-multi": 60, recall: 15, pbq: 480, mentor: 60 };
export const SEVERITY = { high: 1, medium: 0.7, low: 0.4 };

export const itemState = (state, id) => state.items[id] || null;
export const seen = (state, id) => !!state.items[id]?.seen;
