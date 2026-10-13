// The replay harness. Steps through the real review log in order, rebuilds
// the study state as it was before every answer, and asks the real scheduler
// what it would have served. Loaded by scripts/replay.py into a headless page
// on a throwaway server holding a copy of the data; never imported by the app.

import { loadContent, isGraded } from "../app/content.js";
import * as fsrs from "../app/fsrs.js";
import * as mentor from "../app/mentor.js";
import { DEFAULT_STATE, applyItemReview } from "../app/state.js";
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

    // apply the answer through the app's own recording
    applyItemReview(state, item.id, r.grade, r.at);
  }
  closeSession();
  out.state = state;
  return out;
}

// --- FSRS parameters against this person's log --------------------------------
//
// Every item review that has a prior review is a prediction FSRS made: the
// retrievability at that moment, against whether the answer was recalled. A
// fit moves the 19 weights to lower the log-loss of those predictions. With
// few predictions a fit learns the noise, so it is judged out of sample:
// five folds by item, fitted on four, scored on the fifth.

const DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
  1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
  2.9898, 0.51655, 0.6621,
];

/** Each item's reviews in order: [{ at, grade }]. */
function histories(rows) {
  const by = {};
  for (const r of [...rows].sort((a, b) => a.at - b.at)) if (r.kind === "item") (by[r.id] ||= []).push(r);
  return Object.values(by).filter((h) => h.length >= 2);
}

function logLoss(hists, w) {
  let loss = 0, n = 0;
  for (const h of hists) {
    let card = fsrs.newCard();
    for (const r of h) {
      if (card.reps) {
        const p = Math.min(1 - 1e-4, Math.max(1e-4, fsrs.currentRetrievability(card, r.at)));
        loss -= r.grade > 1 ? Math.log(p) : Math.log(1 - p);
        n += 1;
      }
      card = fsrs.review(card, r.grade, { now: r.at, w });
    }
  }
  return { loss: n ? loss / n : 0, n };
}

/** Coordinate descent on multiplicative steps, a few passes. Small, honest, stdlib-browser. */
function fit(hists, start = DEFAULT_W) {
  let w = [...start];
  let best = logLoss(hists, w).loss;
  for (const step of [0.5, 0.2, 0.08]) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < w.length; i++) {
        for (const f of [1 + step, 1 - step]) {
          const t = [...w]; t[i] = Math.max(1e-3, w[i] * f);
          const l = logLoss(hists, t).loss;
          if (l < best - 1e-6) { best = l; w = t; }
        }
      }
    }
  }
  return { w, loss: best };
}

export function fitFsrs({ rows }) {
  const hists = histories(rows);
  const all = logLoss(hists, DEFAULT_W);
  const folds = 5;
  const crossValidate = (hs) => {
    // The third yardstick ignores memory entirely: it always predicts the
    // training folds' recall rate. A model that cannot beat it has learned
    // how often this person is right, not how they forget.
    let def = 0, fitted = 0, base = 0, n = 0;
    for (let k = 0; k < folds; k++) {
      const train = hs.filter((_, i) => i % folds !== k);
      const test = hs.filter((_, i) => i % folds === k);
      const t = logLoss(test, DEFAULT_W);
      if (!t.n) continue;
      const { w } = fit(train);
      const seen = train.flatMap((h) => h.slice(1));
      const rate = Math.min(0.999, Math.max(0.001, seen.filter((r) => r.grade > 1).length / Math.max(1, seen.length)));
      for (const r of test.flatMap((h) => h.slice(1))) base -= r.grade > 1 ? Math.log(rate) : Math.log(1 - rate);
      def += t.loss * t.n; fitted += logLoss(test, w).loss * t.n; n += t.n;
    }
    return { n, defaults: def / n, fitted: fitted / n, baseRate: base / n };
  };
  // The learning curve: the same test on growing shares of the items.
  const curve = [0.5, 0.75, 1].map((share) => ({ share, ...crossValidate(hists.slice(0, Math.max(folds, Math.round(hists.length * share)))) }));
  const full = fit(hists);
  const days = (w) => {
    const c = fsrs.review(fsrs.newCard(), fsrs.RATING.GOOD, { now: 0, w, desiredRetention: 0.92 });
    const c2 = fsrs.review(c, fsrs.RATING.GOOD, { now: c.due, w, desiredRetention: 0.92 });
    return [c.intervalDays, c2.intervalDays];
  };
  return {
    items: hists.length, predictions: all.n, defaultLoss: all.loss,
    inSample: full.loss, fitted: full.w, curve,
    intervals: { defaults: days(DEFAULT_W), fitted: days(full.w) },
    recalledShare: hists.flatMap((h) => h.slice(1)).filter((r) => r.grade > 1).length / Math.max(1, all.n),
  };
}

// --- retirement, audited ----------------------------------------------------------
//
// A misconception retires on clean passes over distinct items, never the one
// that exposed it. So it can only retire if the bank holds retireAfter items
// testing it besides that one. Anything short of that is a content gap, and
// the gaps that matter most sit in the heaviest domains.

const SEV = { high: 3, medium: 2, low: 1 };

export async function retirementAudit({ rows }) {
  const content = await loadContent();
  const res = await fetch("/api/state");
  const state = res.ok ? (await res.json()).state : structuredClone(DEFAULT_STATE);
  state.misconceptions ||= {};
  const weightOf = (mc) => content.objectiveById[content.misconceptions[mc]?.objective]?.weight ?? 0;
  const now = rows.length ? rows.at(-1).at : Date.now();

  const open = Object.entries(state.misconceptions).filter(([id, r]) => !r.retired && content.misconceptions[id]).map(([id, r]) => {
    const def = content.misconceptions[id];
    const needed = def.retireAfter ?? 2;
    const have = r.cleanPasses?.length || 0;
    const pool = mentor.itemsFor(id, content, state, r.lastItem);
    const left = pool.mcqs.length + pool.pbqs.length;
    const lastMiss = rows.filter((x) => x.kind === "misconception" && x.id === id && x.grade <= 1).at(-1)?.at;
    return { id, objective: def.objective, weight: weightOf(id), severity: def.severity, needed, have, left,
             path: left >= needed - have, quietDays: lastMiss ? (now - lastMiss) / 86400000 : null };
  });

  // Across the whole bank: after a miss on any one of its items, can it still retire?
  const gaps = Object.entries(content.misconceptions).map(([id, def]) => {
    const { mcqs, pbqs } = mentor.itemsFor(id, content, { misconceptions: {} });
    const needed = def.retireAfter ?? 2;
    return { id, objective: def.objective, weight: weightOf(id), severity: def.severity,
             items: mcqs.length + pbqs.length, toAuthor: Math.max(0, needed + 1 - (mcqs.length + pbqs.length)) };
  }).filter((g) => g.toAuthor > 0)
    .sort((a, b) => b.weight - a.weight || (SEV[b.severity] || 0) - (SEV[a.severity] || 0) || a.objective.localeCompare(b.objective));

  const ghosts = Object.entries(state.misconceptions).filter(([id, r]) => !r.retired && !content.misconceptions[id]).map(([id]) => id);
  return { open, gaps, ghosts };
}

// --- the plan on the real state ----------------------------------------------------

export async function planReport({ rows }) {
  const { studyPlan, examForecast, readiness, toScaled, hoursToReady } = await import("../app/scheduler.js");
  const { minutesOf } = await import("../app/reviews.js");
  const { migrate } = await import("../app/state.js");
  const content = await loadContent();
  const res = await fetch("/api/state");
  const state = migrate(res.ok ? (await res.json()).state : {});
  const now = rows.length ? rows.at(-1).at : Date.now();
  const p = studyPlan(state, content, now);
  if (!p) return null;
  const weeks = [];
  for (let w = 0; w * 7 < p.plan.length; w++) {
    const days = p.plan.slice(w * 7, w * 7 + 7);
    const objs = days.flatMap((d) => d.objectives);
    // How weak are the objectives this week introduces? Accuracy so far, exam weight attached.
    const acc = {};
    for (const it of content.items) {
      const s = state.items[it.id];
      if (!s?.seen || !isGraded(it)) continue;
      (acc[it.objective] ||= { c: 0, n: 0 }).c += s.correct || 0; acc[it.objective].n += s.seen;
    }
    const rate = (o) => ((acc[o]?.c || 0) + 2) / ((acc[o]?.n || 0) + 4);
    weeks.push({
      week: w + 1, answers: days.reduce((a, d) => a + d.answers, 0), minutes: days.reduce((a, d) => a + d.minutes, 0),
      fresh: objs.length, meanAccuracy: objs.length ? objs.reduce((a, o) => a + rate(o), 0) / objs.length : null,
      meanWeight: objs.length ? objs.reduce((a, o) => a + (content.objectiveById[o]?.weight || 0), 0) / objs.length : null,
    });
  }
  const item = rows.filter((r) => r.kind === "item");
  const pace = item.filter((r) => r.at >= now - 30 * 86400000).length / 30;
  const f = examForecast(state, content, now, rows.filter((r) => r.kind === "mock"));
  const coverageHeadline = toScaled(readiness(state, content, now).mastery);   // what Readiness used to headline
  const hours = hoursToReady(state, content, now, rows.filter((r) => r.kind === "mock"));
  const time = minutesOf(rows);
  return { coverageHeadline, hours, studied: { total: time.total, sessions: time.sessions.length,
           median: time.sessions.map((x) => x.minutes).sort((a, b) => a - b)[Math.floor(time.sessions.length / 2)] || 0 },
           forecast: { scaled: f.scaled, low: f.low, high: f.high, raw: f.raw, sd: f.sd, mocks: f.mocks, rules: f.stop.rules },
           days: p.days, unseen: p.unseen, newPerDay: p.newPerDay, perDay: p.perDay, peak: p.peak,
           minutesPerDay: p.minutesPerDay, totalMinutes: p.totalMinutes, reviews: p.reviews, pace, weeks };
}
