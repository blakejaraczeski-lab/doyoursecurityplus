// The replay harness. Steps through the real review log in order, rebuilds
// the study state as it was before every answer, and asks the real scheduler
// what it would have served. Loaded by scripts/replay.py into a headless page
// on a throwaway server holding a copy of the data; never imported by the app.

import { loadContent, isGraded } from "../app/content.js";
import * as fsrs from "../app/fsrs.js";
import * as mentor from "../app/mentor.js";
import { DEFAULT_STATE } from "../app/state.js";
import { buildQueue, expectedGain, gainContext, SECONDS } from "../app/scheduler.js";

const SESSION_GAP = 30 * 60e3;
const MAX_ANSWER_MS = 5 * 60e3;     // a tab left open is not five hours of study

const seeded = (seed) => () => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function withSeed(seed, fn) {
  const real = Math.random;
  Math.random = seeded(seed);
  try { return fn(); } finally { Math.random = real; }
}

/** Minutes one answer cost: its own timing when logged, else the per-kind estimate. */
const minutesOf = (row, item) =>
  (row.ms != null ? Math.min(row.ms, MAX_ANSWER_MS) : (SECONDS[item?.type] ?? SECONDS.mcq) * 1000) / 60000;

const testsMc = (item, mc) => !!item?.options?.some((o) => o.misconception === mc || o.missedMisconception === mc);

export async function run({ rows, profile }) {
  const content = await loadContent();
  const state = structuredClone(DEFAULT_STATE);
  state.profile = { ...state.profile, ...profile };
  rows = [...rows].sort((a, b) => a.at - b.at);

  const out = {
    rows: rows.length,
    from: rows[0]?.at, to: rows.at(-1)?.at,
    answers: 0, unknownItems: 0, unknownMinutes: 0, minutes: 0, recallAnswers: 0,
    sessions: [],
    waste: {
      overlearned: { n: 0, minutes: 0 },     // R already above 0.95
      recallOverGraded: { n: 0, minutes: 0 }, // a recall card while a graded item would have gained more
      prereqSkipped: { n: 0, minutes: 0 },    // drilled on top of an open prerequisite
      reservedEarly: { n: 0, minutes: 0 },    // a fresh correction tested again before it could be read
    },
    retiredEvents: [], falseRetirements: [],
    fsrsPoints: [],
  };

  let session = null;
  let lastBank = {};          // misconception -> { at, answersSince }
  const rowsAt = new Map();   // at -> misconception rows logged with that answer
  for (const r of rows) if (r.kind === "misconception") (rowsAt.get(r.at) || rowsAt.set(r.at, []).get(r.at)).push(r);

  const closeSession = () => {
    if (!session) return;
    // What would each policy have served from this session's starting state?
    // Compare the points the served answers bought with the minutes the gain
    // policy needed to buy the same points.
    const servedPoints = session.points;
    let minutesForSame = 0, acc = 0;
    for (const e of session.gainQueue) {
      if (acc >= servedPoints) break;
      acc += e.g.points;
      minutesForSame += e.g.minutes;
    }
    const enough = acc >= servedPoints;
    out.sessions.push({
      start: session.start, answers: session.answers, minutes: session.minutes,
      policyMinutes: session.policyMinutes || 0, policyAnswers: session.policyAnswers,
      points: servedPoints, gainPolicyPoints: session.gainQueue.slice(0, session.policyAnswers).reduce((a, e) => a + e.g.points, 0),
      minutesForSame: enough ? minutesForSame : null,
      overlapCurrent: session.overlapCurrent, overlapGain: session.overlapGain,
    });
    session = null;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind !== "item") {
      if (r.kind === "misconception" && content.misconceptions[r.id]) {
        if (r.grade <= 1) {
          if (state.misconceptions[r.id]?.retiredAt) out.falseRetirements.push({ id: r.id, retiredAt: state.misconceptions[r.id].retiredAt, missedAt: r.at });
          mentor.bank(state, r.id, r.item, r.at);
          lastBank[r.id] = { at: r.at, answersSince: 0 };
        } else {
          const res = mentor.pass(state, r.id, r.item, content, r.at);
          if (res?.retired) out.retiredEvents.push({ id: r.id, at: r.at });
        }
      }
      continue;
    }

    const item = content.itemsById[r.id];
    const mins = minutesOf(r, item);
    out.answers += 1;
    out.minutes += mins;
    if (!session || r.at - session.last > SESSION_GAP) {
      closeSession();
      const served = rows.slice(i).filter((x) => x.kind === "item");
      const size = 25;
      const cur = withSeed(r.at, () => buildQueue(state, content, { size, now: r.at, policy: "current" }));
      const gain = withSeed(r.at, () => buildQueue(state, content, { size, now: r.at, policy: "gain" }));
      const ctx = gainContext(state, content, r.at);
      const ids = (q) => new Set(q.map((e) => e.item?.id).filter(Boolean));
      // the session's own served ids, to measure overlap
      const end = served.findIndex((x, k) => k > 0 && x.at - served[k - 1].at > SESSION_GAP);
      const mine = new Set(served.slice(0, end < 0 ? undefined : end).map((x) => x.id));
      const overlap = (q) => [...ids(q)].filter((id) => mine.has(id)).length;
      session = {
        start: r.at, last: r.at, answers: 0, minutes: 0, points: 0,
        // Correction slots are filled the same way by both policies, so only
        // the slots where they differ are compared: plain items, item gain only.
        gainQueue: gain.filter((e) => e.item && !e.targetMisconception)
          .map((e) => ({ id: e.item.id, g: expectedGain({ item: e.item }, state, content, ctx) }))
          .sort((a, b) => b.g.perMinute - a.g.perMinute),
        policyAnswers: 0,
        overlapCurrent: overlap(cur), overlapGain: overlap(gain),
      };
    }
    session.last = r.at;
    session.answers += 1;
    session.minutes += mins;

    if (!item) { out.unknownItems += 1; out.unknownMinutes += mins; continue; }
    if (item.type === "recall") out.recallAnswers += 1;

    const ctx = gainContext(state, content, r.at);
    const g = expectedGain({ item }, state, content, ctx);
    // A correction slot: the answer tests a misconception that was open and due when it was served.
    const isCorrection = mentor.due(state, content, r.at).some((d) => testsMc(item, d.id));
    if (!isCorrection) { session.points += g.points; session.policyAnswers += 1; session.policyMinutes = (session.policyMinutes || 0) + mins; }
    const rec = state.items[item.id];

    // (a) overlearned: retrievability already above 0.95 when served
    if (rec?.fsrs?.stability && fsrs.currentRetrievability(rec.fsrs, r.at) > 0.95) {
      out.waste.overlearned.n += 1; out.waste.overlearned.minutes += mins;
    }
    // (b) a recall card while some graded item would have gained more per minute
    if (item.type === "recall") {
      const better = content.items.some((x) => isGraded(x) && x.objective && !state.items[x.id]?.seen &&
        expectedGain({ item: x }, state, content, ctx).perMinute > g.perMinute);
      if (better) { out.waste.recallOverGraded.n += 1; out.waste.recallOverGraded.minutes += mins; }
    }
    // (c) served as the correction for a due misconception whose prerequisite
    //     was still open, on an item that does not test the prerequisite: the
    //     queue drilled the symptom instead of routing backward.
    const dueNow = mentor.due(state, content, r.at).filter((d) => testsMc(item, d.id));
    if (dueNow.some((d) => { const b = mentor.blockedBy(d.id, state, content); return b.length && !b.some((x) => testsMc(item, x.id)); })) {
      out.waste.prereqSkipped.n += 1; out.waste.prereqSkipped.minutes += mins;
    }
    // (d) a correction banked within the last two answers tested again
    for (const [mc, b] of Object.entries(lastBank)) {
      if (b.at < r.at && b.answersSince < 2 && testsMc(item, mc)) {
        out.waste.reservedEarly.n += 1; out.waste.reservedEarly.minutes += mins;
      }
      b.answersSince += 1;
    }

    // the FSRS evidence: a prediction exists only when the item has a prior review
    if (rec?.fsrs?.stability) {
      out.fsrsPoints.push({ elapsed: (r.at - rec.fsrs.lastReview) / fsrs.DAY_MS, card: { ...rec.fsrs }, recalled: r.grade > 1 });
    }

    // apply the answer exactly as the app records it
    const s = (state.items[item.id] ||= { seen: 0, correct: 0, wrong: 0, lastSeen: 0, fsrs: fsrs.newCard() });
    s.seen += 1; s.lastSeen = r.at;
    if (r.grade >= fsrs.RATING.HARD) s.correct += 1; else s.wrong += 1;
    s.fsrs = fsrs.review(s.fsrs, r.grade, { now: r.at, desiredRetention: state.profile.desiredRetention,
                                            maxIntervalDays: mentor.daysUntilExam(state, r.at) });
  }
  closeSession();
  out.state = state;
  return out;
}
