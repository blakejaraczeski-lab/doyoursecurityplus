// The scheduler under a seeded Math.random.
import { isGraded } from "../app/content.js";
import { buildQueue, readiness, studyPlan } from "../app/scheduler.js";
import { DEFAULT_STATE, applyItemReview } from "../app/state.js";
import * as mentor from "../app/mentor.js";
import * as fsrs from "../app/fsrs.js";
import { say, check, content } from "./harness.js";

say("");
say("<b>The scheduler, under a seeded Math.random</b>");
say('  <span class="dim">the same seed builds the same queue, so a failure here reproduces</span>');
{
  // mulberry32, swapped in for Math.random only while a check runs.
  const seeded = (seed) => () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const realRandom = Math.random;
  const withSeed = (seed, fn) => { Math.random = seeded(seed); try { return fn(); } finally { Math.random = realRandom; } };
  const now = new Date(2026, 9, 12, 12, 0, 0).getTime();
  const MIN = 60000;
  const fresh = () => structuredClone(DEFAULT_STATE);
  const pairId = Object.keys(content.misconceptions).find((id) => mentor.contrastPair(id, content, fresh()));
  const pairItem = mentor.itemsFor(pairId, content, fresh()).mcqs[0].id;
  const adjacent = (q, i) =>
    [q[i - 1], q[i + 1]].some((n) => n?.contrastDrill && n.targetMisconception === q[i].targetMisconception);

  // A contrast pair survives the shuffle: adjacent, and 1 of 2 before 2 of 2.
  let missing = 0, split = 0, reversed = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = fresh();
    for (let k = 0; k < 3; k++) mentor.bank(s, pairId, pairItem, now - 10 * MIN);
    const q = withSeed(seed, () => buildQueue(s, content, { mode: "drill", size: 25, now }));
    const at = q.map((e, i) => (e.contrastDrill && e.targetMisconception === pairId ? i : -1)).filter((i) => i >= 0);
    if (at.length !== 2) missing++;
    else if (at[1] !== at[0] + 1) split++;
    else if (q[at[0]].contrastDrill.index !== 0) reversed++;
  }
  check(missing === 0 && split === 0 && reversed === 0,
        `"${pairId}" at tier 3 is served as an adjacent, ordered pair in 12 of 12 shuffles`,
        `(${missing} without a pair, ${split} split, ${reversed} reversed)`);

  // With one slot left in a weak-spot session, the pair is not pushed past the
  // end and cut in half by the final slice.
  {
    const s = fresh();
    const others = Object.keys(content.misconceptions).filter((id) => id !== pairId).slice(0, 14);
    for (const id of others) mentor.bank(s, id, "x", now - 30 * fsrs.DAY_MS);
    for (let k = 0; k < 3; k++) mentor.bank(s, pairId, pairItem, now - 10 * MIN);
    const q = withSeed(7, () => buildQueue(s, content, { mode: "weak", size: 15, now }));
    const drills = q.map((e, i) => (e.contrastDrill ? i : -1)).filter((i) => i >= 0);
    check(q.length === 15 && drills.every((i) => adjacent(q, i)),
          `a weak-spot session of 15 with 14 corrections ahead never ends on half a pair (${drills.length} drill entries)`,
          `(${q.length} entries)`);
  }

  // A due misconception with an open prerequisite routes to the prerequisite.
  {
    const [blockedId, reqs] = Object.entries(content.prerequisites)
      .find(([, rs]) => rs.some((r) => mentor.itemsFor(r.id, content, fresh()).mcqs.length >= 2));
    const req = reqs.find((r) => mentor.itemsFor(r.id, content, fresh()).mcqs.length >= 2);
    const exposedBy = mentor.itemsFor(req.id, content, fresh()).mcqs[0].id;
    const s = fresh();
    mentor.bank(s, req.id, exposedBy, now - 10 * MIN);
    mentor.bank(s, blockedId, "y", now - 10 * MIN);
    const q = withSeed(3, () => buildQueue(s, content, { mode: "weak", size: 15, now }));
    const repair = q.find((e) => e.prereqRepair);
    const served = repair?.item?.id || repair?.pbq?.id;
    const testsReq = !!served && (
      content.itemsById[served]?.options?.some((o) => o.misconception === req.id) ||
      content.pbqsById[served]?.subtasks?.some((t) => t.misconception === req.id));
    check(!!repair && repair.targetMisconception === req.id && repair.prereqRepair.why === req.why &&
          repair.reason.startsWith("Dependency first"),
          `"${blockedId}" due while "${req.id}" is open routes to the prerequisite and says why`);
    check(testsReq && served !== exposedBy,
          `the item served tests the prerequisite and is not the one that exposed it (${served})`);
    check(!q.some((e) => e.targetMisconception === blockedId && !e.prereqRepair),
          `the blocked misconception is not drilled on its own while the prerequisite is open`);
  }

  // With an exam date set: a correction is always retested before it, and an
  // item scheduled past it is still above target on exam day, so it costs no
  // review. The plan states the daily load and introduces the weakest first.
  {
    const examOn = (days) => new Date(now + days * fsrs.DAY_MS).toISOString().slice(0, 10);
    const horizons = [60, 30, 14, 7, 3, 2];
    let corrPast = 0, itemsBelow = 0, itemsPast = 0;
    for (const days of horizons) {
      const s = fresh();
      s.profile.examDate = examOn(days);
      s.profile.desiredRetention = 0.92;
      const examMs = new Date(s.profile.examDate).getTime();
      mentor.bank(s, pairId, pairItem, now);
      s.misconceptions[pairId].step = 2;
      mentor.pass(s, pairId, "z", content, now);
      const rec = s.misconceptions[pairId];
      if (rec.due > examMs || rec.fsrs.due > examMs) corrPast++;
      for (let k = 0; k < 6; k++) applyItemReview(s, pairItem, fsrs.RATING.GOOD, now - (6 - k) * 9 * fsrs.DAY_MS);
      applyItemReview(s, pairItem, fsrs.RATING.GOOD, now);
      const card = s.items[pairItem].fsrs;
      if (card.due > examMs) {
        itemsPast++;
        if (fsrs.currentRetrievability(card, examMs) < 0.92 - 0.005) itemsBelow++;
      }
    }
    check(corrPast === 0, `a correction is always retested before the exam at ${horizons.join(", ")} days out`, `(${corrPast} landed past it)`);
    check(itemsPast > 0 && itemsBelow === 0,
          `an item scheduled past the exam is still above its 0.92 target on exam day (${itemsPast} of ${horizons.length} horizons)`,
          `(${itemsBelow} below target)`);

    const s = fresh();
    s.profile.examDate = examOn(30);
    const plan = studyPlan(s, content, now);
    const firstWeek = plan.plan.slice(0, 7).reduce((a, d) => a + d.fresh, 0);
    check(plan && plan.perDay > 0 && plan.minutesPerDay > 0 && plan.plan.length === plan.days && firstWeek > 0
          && plan.plan.slice(-7).every((d) => d.fresh === 0),
          `the plan states a daily load (${plan.perDay} answers, ${plan.minutesPerDay} min) and keeps the last week for review`);
    const peak = Math.max(...plan.plan.slice(-7).map((d) => d.answers));
    check(peak <= Math.max(...plan.plan.slice(0, -7).map((d) => d.answers)) * 1.5,
          `the last week is not overloaded: its busiest day is ${peak} answers`);
    s.profile.examDate = examOn(14);
    check(readiness(s, content, now).daysLeft === mentor.daysUntilExam(s, now),
          `readiness reports the horizon the scheduler uses (${mentor.daysUntilExam(s, now)} days)`);
  }

  // Recall competes on its merits: no floor forces a card in, the cap bounds it.
  {
    const cap = (size) => Math.max(1, Math.round(size * 0.12));   // bootcamp maxRecallShare
    let served = 0;
    for (const size of [4, 8, 12, 25, 40]) {
      for (let seed = 1; seed <= 4; seed++) {
        const q = withSeed(seed, () => buildQueue(fresh(), content, { mode: "drill", size, now }));
        served += q.filter((e) => e.item?.type === "recall").length;
      }
    }
    check(served === 0, `while graded questions are available, no recall card is forced into a session (${served} served over 20 builds)`);
    // Every graded item held and not due: recall is what is left, and it fills in up to the cap.
    const held = fresh();
    for (const it of content.items.filter(isGraded)) {
      held.items[it.id] = { seen: 3, correct: 3, wrong: 0, lastSeen: now,
        fsrs: { stability: 300, difficulty: 3, due: now + 200 * fsrs.DAY_MS, lastReview: now, reps: 3, lapses: 0, state: "review" } };
    }
    const q = withSeed(1, () => buildQueue(held, content, { mode: "drill", size: 25, now }));
    const n = q.filter((e) => e.item?.type === "recall").length;
    check(n > 0 && n <= cap(25), `with every graded item held, recall fills in and stays within the cap (${n} of at most ${cap(25)})`);
  }
}
