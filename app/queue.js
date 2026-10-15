// The learning queue: what to serve next, in what order, and how a miss
// reshapes the rest of the session. Also the gain model that ranks candidates
// (expected exam points per minute), which the forecast reuses.
//
// Two ideas drive everything here:
//   1. Exam weight. Domain 4 is 28% of the exam and domain 1 is 12%. Study time
//      follows the weights, not the alphabet.
//   2. Retargeting. A due misconception does not re-show the item you failed. It
//      pulls a different item that tests the same discrimination.

import * as fsrs from "./fsrs.js";
import * as mentor from "./mentor.js";
import { isGraded } from "./content.js";
import { PBQ_WEIGHT, POINTS_PER_QUESTION, EXAM_QUESTIONS, SECONDS, SEVERITY, itemState, seen } from "./schedule-core.js";

// `maxRecallShare` caps plain vocabulary cards as a fraction of a session.
// The exam is multiple choice and PBQs, never free text, so a card you reveal
// and grade yourself trains an operation the exam never asks for. Vocabulary
// still has to get in the door, hence a small share rather than none. New
// coverage takes whatever the misconception and review slots leave.
const PACE = {
  bootcamp:  { mixMisconception: 0.5, mixReview: 0.2, maxRecallShare: 0.12 },
  balanced:  { mixMisconception: 0.4, mixReview: 0.3, maxRecallShare: 0.15 },
  longhaul:  { mixMisconception: 0.3, mixReview: 0.4, maxRecallShare: 0.20 },
};

/**
 * A contrast drill only works if the two halves arrive together. Shuffling is
 * good for everything else, so shuffle first and then pull each pair back into
 * adjacency, anchored on whichever half landed earlier.
 */
function keepPairsAdjacent(queue) {
  const out = [];
  const taken = new Set();
  for (const entry of queue) {
    if (taken.has(entry)) continue;
    const group = entry.contrastDrill
      ? queue.filter((e) => !taken.has(e) && e.contrastDrill && e.targetMisconception === entry.targetMisconception)
             .sort((a, b) => a.contrastDrill.index - b.contrastDrill.index)
      : [entry];
    for (const e of group) { out.push(e); taken.add(e); }
  }
  return out;
}

function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * How far each domain's study is behind where the exam weights say it should be.
 *
 * Only graded practice counts: the exam never asks you to reveal anything, so a
 * revealed vocabulary card covers nothing. And a domain with nothing unseen
 * left reports no deficit, because a deficit the queue cannot spend would send
 * it after material that does not exist.
 */
export function coverageDeficit(state, content) {
  const byDomain = {};
  for (const d of content.objectives.domains) {
    byDomain[d.id] = { weight: d.weight, available: 0, seen: 0, remaining: 0 };
  }
  for (const it of content.items) {
    const dom = content.domainOf[it.objective];
    if (!dom || !byDomain[dom] || !isGraded(it)) continue;
    byDomain[dom].available += 1;
    if (seen(state, it.id)) byDomain[dom].seen += 1;
    else byDomain[dom].remaining += 1;
  }
  const totalSeen = Object.values(byDomain).reduce((a, b) => a + b.seen, 0) || 1;
  for (const d of Object.values(byDomain)) {
    d.share = d.seen / totalSeen;
    // A deficit you cannot spend is not a deficit. With nothing left unseen in
    // the domain, the honest reading is that the bank is exhausted here, which
    // is a content gap to report rather than a routing instruction.
    d.deficit = d.remaining ? d.weight - d.share : 0;
    d.exhausted = d.remaining === 0 && d.available > 0;
  }
  return byDomain;
}

/** Pick the next unseen items, biased toward the most under-studied domains. */
function pickNewItems(state, content, n, recallBudget = Infinity) {
  const deficit = coverageDeficit(state, content);
  const unseen = content.items.filter((it) => !seen(state, it.id) && it.objective);

  const score = (it) => {
    const d = deficit[content.domainOf[it.objective]] || { deficit: 0, weight: 0.1 };
    return d.deficit * 10 + d.weight * 2 + Math.random() * 0.25;
  };
  const recall = unseen.filter((it) => it.type === "recall").sort((a, b) => score(b) - score(a));
  const core = unseen.filter((it) => it.type !== "recall").sort((a, b) => score(b) - score(a));

  // A floor as well as a cap, or vocabulary never appears while any exam-shaped
  // item is left unseen. 8% of the new slots, and at least one card in any
  // session with room for new coverage at all: vocabulary gets in the door
  // once a session, and never more than the pace profile's share.
  const out = [];
  const take = (pool, k) => { for (let i = 0; i < k && pool.length && out.length < n; i++) out.push(pool.shift()); };
  take(recall, Math.min(recallBudget, Math.max(n >= 4 ? 1 : 0, Math.floor(n * 0.08))));
  take(core, n - out.length);
  take(recall, Math.max(0, recallBudget - out.filter((it) => it.type === "recall").length));
  return out;
}

/** Previously seen items whose own FSRS card is due. */
function pickDueItems(state, content, n, now) {
  const due = content.items
    .filter((it) => {
      const s = itemState(state, it.id);
      return s?.fsrs && s.fsrs.due <= now;
    })
    .map((it) => ({ it, overdue: now - state.items[it.id].fsrs.due }));
  due.sort((a, b) => b.overdue - a.overdue);
  return due.slice(0, n).map((d) => d.it);
}

/**
 * Build a study queue.
 * @param {string} mode drill | weak | pbq | mock
 */
/**
 * `ablate` turns single behaviours of the gain policy back to the old ones, so
 * the replay can price each disagreement on its own. Empty in the app.
 *   interleave  no diminishing return per objective
 *   balance     no nudge toward the exam's domain weights
 *   accuracy    every item's base rate is the same, ignoring difficulty and
 *               this person's accuracy on the objective
 *   quotas      a fixed share of the session for due reviews, the rest new
 *   domains     with quotas: new items taken from the domain with the largest
 *               share deficit, as the old policy did
 */
export function buildQueue(state, content, { mode = "drill", size = 25, now = Date.now(), policy = "gain", ablate = [] } = {}) {
  const pace = PACE[state.profile.pace] || PACE.bootcamp;
  const queue = [];

  if (mode === "pbq") {
    const attempted = (id) => state.pbq[id]?.attempts || 0;
    return shuffle(content.pbqs)
      .sort((a, b) => attempted(a.id) - attempted(b.id))
      .slice(0, size)
      .map((p) => ({ kind: "pbq", pbq: p, reason: "PBQ lab" }));
  }

  // 1. Due misconceptions, each retargeted onto a DIFFERENT item.
  const dueMc = mentor.due(state, content, now);
  const mcSlots = mode === "weak" ? size : Math.round(size * pace.mixMisconception);
  const routedBackward = new Set();
  for (const d of dueMc) {
    if (queue.length >= mcSlots) break;

    // Repair backward. If this correction sits on top of a dependency that is
    // itself still open, drilling the symptom is wasted: fix the thing holding
    // it up first, and say so.
    const blockers = mentor.blockedBy(d.id, state, content);
    if (blockers.length) {
      // Any open prerequisite not yet routed this session, not only the first.
      const b = blockers.find((x) => !routedBackward.has(x.id));
      if (b) {
        routedBackward.add(b.id);
        // Exclude the item that exposed the dependency, same rule as every other
        // path: being re-served the question you just failed teaches the question.
        const pool = mentor.itemsFor(b.id, content, state, b.rec?.lastItem);
        const pick = [...pool.mcqs, ...pool.pbqs][0];
        const repair = { blocked: d.def.label, blocker: b.def.label, why: b.why };
        // With no unused question left on the prerequisite, its correction is
        // served directly: the repair still comes before the symptom.
        queue.push(pick
          ? { kind: pick.subtasks ? "pbq" : "item", item: pick.subtasks ? undefined : pick,
              pbq: pick.subtasks ? pick : undefined, targetMisconception: b.id, prereqRepair: repair,
              reason: `Dependency first: ${b.def.label}` }
          : { kind: "mentor", targetMisconception: b.id, prereqRepair: repair,
              reason: `Dependency first: ${b.def.label}` });
      }
      // Every open prerequisite is being repaired this session already, or was
      // just queued: this correction waits for a later session rather than
      // being drilled on top of something still open.
      continue;
    }

    // Third strike: stop re-serving the explanation and force the distinction.
    // A pair needs two whole slots: pushed past the end, the final slice would
    // serve half of it, which teaches the answer rather than the difference.
    if (mentor.tierFor(d.rec) >= 3) {
      const pair = mentor.contrastPair(d.id, content, state);
      if (pair && queue.length + 2 <= mcSlots) {
        pair.items.forEach((item, i) => {
          queue.push({
            kind: "item",
            item,
            targetMisconception: d.id,
            contrastDrill: { index: i, of: pair.items.length, label: d.def.label },
            reason: `Contrast drill: ${d.def.label}`,
          });
        });
        continue;
      }
    }

    const { mcqs, pbqs } = mentor.itemsFor(d.id, content, state, d.rec.lastItem);
    const pool = [...mcqs, ...pbqs];
    if (pool.length) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      queue.push({
        kind: pick.subtasks ? "pbq" : "item",
        item: pick.subtasks ? undefined : pick,
        pbq: pick.subtasks ? pick : undefined,
        targetMisconception: d.id,
        reason: `Retargeting: ${d.def.label}`,
      });
    } else {
      // No other item covers this discrimination yet. Teach it directly.
      queue.push({
        kind: "mentor",
        targetMisconception: d.id,
        reason: `Review the correction: ${d.def.label}`,
      });
    }
  }

  if (mode === "weak") return queue.slice(0, size);

  // 2 and 3 under the gain policy: one pool of due and unseen items, ranked by
  // expected exam points per minute. Recall cards compete in the same pool and
  // are served only when one out-ranks the graded alternatives; there is no
  // floor forcing one in, and the pace profile's cap still bounds them.
  if (policy === "gain") {
    const taken = new Set(queue.map((e) => e.item?.id).filter(Boolean));
    const off = new Set(ablate);
    if (off.has("domains")) off.add("quotas");
    const ctx = gainContext(state, content, now, off.has("accuracy"));
    const pool = content.items
      .filter((it) => it.objective && !taken.has(it.id) &&
        (!seen(state, it.id) || (itemState(state, it.id)?.fsrs?.due ?? Infinity) <= now))
      .map((it) => ({ it, g: expectedGain({ item: it }, state, content, ctx).perMinute + Math.random() * 1e-6 }));
    const slots = Math.max(0, size - queue.length);
    const cap = Math.max(0, Math.max(1, Math.round(size * pace.maxRecallShare)) - queue.filter((e) => e.item?.type === "recall").length);
    // Greedy, with a diminishing return per objective: each item already
    // picked from an objective discounts the next by 30%. Items in one
    // objective share what they teach, so the fourth is worth less than the
    // first, and the session interleaves instead of drilling one drawer.
    const fromObjective = {};
    for (const q of queue) { const o = (q.item || q.pbq)?.objective; if (o) fromObjective[o] = (fromObjective[o] || 0) + 1; }
    // The model splits a domain's exam questions evenly over its objectives, so
    // an item in a thin objective stands for more of the exam than one in a
    // thick one, and a fresh session fills with the thin ones whatever their
    // domain's weight. Each pick also nudges the next toward the domains that
    // are under their exam weight in this session, by up to +-BALANCE of its
    // worth: enough to bend the mix, not enough to outrank a due review.
    const weightOf = Object.fromEntries(content.objectives.domains.map((d) => [d.id, d.weight]));
    const fromDomain = {};
    let inSession = 0;
    const count = (o) => { if (!o) return; const d = content.domainOf[o]; fromDomain[d] = (fromDomain[d] || 0) + 1; inSession += 1; };
    for (const q of queue) count((q.item || q.pbq)?.objective);
    const balance = (x) => {
      if (off.has("balance")) return 1;
      const d = content.domainOf[x.it.objective];
      const share = (fromDomain[d] || 0) / Math.max(1, inSession);
      return Math.max(0.25, 1 + BALANCE * ((weightOf[d] ?? 0) - share));
    };
    const worth = (x) => (off.has("interleave") ? x.g : x.g * Math.pow(0.7, fromObjective[x.it.objective] || 0)) * balance(x);
    const take = (x) => { picked.push(x.it); fromObjective[x.it.objective] = (fromObjective[x.it.objective] || 0) + 1; count(x.it.objective); };
    const picked = [];
    let left = pool;
    if (off.has("quotas")) {
      // The old split: a fixed share for due reviews, the rest new.
      const due = left.filter((x) => seen(state, x.it.id));
      let fresh = left.filter((x) => !seen(state, x.it.id));
      if (off.has("domains")) {
        // The old order for new items: the most under-studied domain first.
        const deficit = coverageDeficit(state, content);
        const score = (x) => { const d = deficit[content.domainOf[x.it.objective]] || { deficit: 0, weight: 0.1 }; return d.deficit * 10 + d.weight * 2; };
        fresh = fresh.map((x) => ({ ...x, g: score(x) + Math.random() * 1e-6 }));
      }
      const fill = (list, n) => {
        while (n > 0 && list.length && picked.length < slots) {
          const recallFull = picked.filter((x) => x.type === "recall").length >= cap;
          let best = null;
          for (const x of list) if (!(recallFull && x.it.type === "recall") && (!best || worth(x) > worth(best))) best = x;
          if (!best) break;
          take(best);
          list.splice(list.indexOf(best), 1);
          n -= 1;
        }
      };
      fill(due, Math.round(size * pace.mixReview));
      fill(fresh, slots - picked.length);
      left = [];
    }
    while (picked.length < slots && left.length) {
      const recallFull = picked.filter((x) => x.type === "recall").length >= cap;
      let best = null;
      for (const x of left) if (!(recallFull && x.it.type === "recall") && (!best || worth(x) > worth(best))) best = x;
      if (!best) break;
      take(best);
      left = left.filter((x) => x !== best);
    }
    for (const it of picked) {
      queue.push({ kind: "item", item: it, reason: seen(state, it.id) ? "Due for review" : it.type === "recall" ? "Vocabulary" : "New coverage" });
    }
    return keepPairsAdjacent(shuffle(queue)).slice(0, size);
  }

  // 2. Items already seen whose own card is due.
  const reviewSlots = Math.round(size * pace.mixReview);
  for (const it of pickDueItems(state, content, reviewSlots, now)) {
    queue.push({ kind: "item", item: it, reason: "Due for review" });
  }

  // 3. New coverage, weighted toward the under-studied heavy domains, with
  //    plain vocabulary capped so it cannot crowd out exam-shaped practice.
  const newSlots = Math.max(0, size - queue.length);
  const recallBudget = Math.max(1, Math.round(size * pace.maxRecallShare));
  const alreadyRecall = queue.filter((e) => e.item?.type === "recall").length;
  for (const it of pickNewItems(state, content, newSlots, Math.max(0, recallBudget - alreadyRecall))) {
    queue.push({ kind: "item", item: it, reason: it.type === "recall" ? "Vocabulary" : "New coverage" });
  }

  return keepPairsAdjacent(shuffle(queue)).slice(0, size);
}

/** How hard a session leans toward the exam's domain weights, as a share of an item's worth per unit of share. */
const BALANCE = 2;

/** Does this queue entry test misconception `mc`? */
const entryTests = (e, mc) =>
  e.targetMisconception === mc ||
  !!e.item?.options?.some((o) => o.misconception === mc || o.missedMisconception === mc) ||
  !!e.pbq?.subtasks?.some((t) => t.misconception === mc);

/** How many answers must pass before a fresh correction is tested again. */
export const RESERVE_GAP = 3;

/**
 * A miss just banked these misconceptions. The session queue was built before
 * the miss, so it can hold another question on the same belief right behind
 * the one just failed, which tests whether the correction was read seconds
 * ago, not whether it took. Any such entry within the next RESERVE_GAP
 * positions moves to just past the gap, or leaves the session if there is no
 * room: it is not lost, its misconception is scheduled on its own relearning
 * step. A contrast pair is left alone; arriving together is its purpose.
 * Returns how many entries moved or left.
 */
export function spaceAfterMiss(queue, idx, banked) {
  if (!banked?.length) return 0;
  const tests = (e) => !e.contrastDrill && banked.some((mc) => entryTests(e, mc));
  // One pass, rebuilding what follows the current question: the first
  // RESERVE_GAP places go to entries that do not test the fresh correction,
  // in their original order; anything that does waits, then follows them.
  const rest = queue.slice(idx + 1);
  const ahead = [], waiting = [];
  let k = 0;
  while (ahead.length < RESERVE_GAP && k < rest.length) {
    if (tests(rest[k])) waiting.push(rest[k]); else ahead.push(rest[k]);
    k += 1;
  }
  if (!waiting.length) return 0;
  // With nothing left to put between them, the waiting entries leave the
  // session rather than coming straight back.
  const after = ahead.length < RESERVE_GAP ? [] : waiting;
  queue.splice(idx + 1, rest.length, ...ahead, ...after, ...rest.slice(k));
  return waiting.length;
}

/**
 * Build a mock exam: PBQs front loaded, then multiple choice, up to 90 items.
 *
 * The blueprint holds in points, not just in item count. PBQs are drawn by
 * domain weight, not uniformly: the bank holds 14 of its 21 in domain 4, and a
 * uniform draw gave that domain 34% of a mock's points against an exam weight
 * of 28%. Each domain's multiple choice is then sized so its items plus its
 * PBQs, at PBQ_WEIGHT each, come to its share of the whole.
 */
export function buildMock(content, { pbqCount = 5, total = 90 } = {}) {
  const domains = content.objectives.domains;
  const pbqPool = {};
  for (const p of shuffle(content.pbqs)) (pbqPool[content.domainOf[p.objective]] ||= []).push(p);
  const pbqs = [];
  const pbqIn = {};
  while (pbqs.length < Math.min(pbqCount, content.pbqs.length)) {
    // the domain furthest below its weight in PBQ points so far, among those with one left
    const open = domains.filter((d) => pbqPool[d.id]?.length);
    if (!open.length) break;
    const d = open.sort((a, b) => ((pbqIn[a.id] || 0) - a.weight * (pbqs.length + 1)) - ((pbqIn[b.id] || 0) - b.weight * (pbqs.length + 1))
      || Math.random() - 0.5)[0];
    pbqs.push(pbqPool[d.id].shift());
    pbqIn[d.id] = (pbqIn[d.id] || 0) + 1;
  }

  // The real exam is single-select, multi-select and PBQs, so a mock that draws
  // only plain "mcq" is narrower than the thing it is imitating. Multi-select
  // and the derived discrimination items are exam-shaped and belong in the pool.
  const mcqs = content.items.filter(isGraded);
  const byDomain = {};
  for (const m of mcqs) (byDomain[content.domainOf[m.objective]] ||= []).push(m);

  const want = total - pbqs.length;
  const points = want + PBQ_WEIGHT * pbqs.length;
  const picked = [];
  for (const d of domains) {
    const n = Math.max(0, Math.round(points * d.weight - PBQ_WEIGHT * (pbqIn[d.id] || 0)));
    picked.push(...shuffle(byDomain[d.id] || []).slice(0, n));
  }
  const filler = shuffle(mcqs.filter((m) => !picked.includes(m)));
  while (picked.length < want && filler.length) picked.push(filler.pop());
  while (picked.length > want) picked.pop();

  return [
    ...pbqs.map((p) => ({ kind: "pbq", pbq: p })),
    ...shuffle(picked).map((i) => ({ kind: "item", item: i })),
  ];
}

// --- what the queue optimises ------------------------------------------------
//
// Two functions, kept side by side so the difference is a diff and not a
// paragraph. `currentPriority` is what the queue builder has always done,
// written down as one score. `expectedGain` is what it should maximise:
// expected scaled-score points at the exam date, per minute of study.

const PBQS_ON_EXAM = 4;
// A revealed vocabulary card never appears on the exam. It is credited with a
// quarter of a graded item's transfer: it helps you read a stem, it is not one.
const RECALL_TRANSFER = 0.25;

/**
 * What the queue builder maximises today, as one number per candidate. It is
 * lexicographic: a tier, then a score inside the tier. Quotas sit outside it:
 * the pace profile gives misconceptions 50% of a session, due items 20%, and
 * new coverage the rest, with recall held between a floor of one and a cap.
 */
export function currentPriority(entry, state, content, now = Date.now()) {
  const tier = entry.prereqRepair ? 5 : entry.contrastDrill ? 4 : entry.targetMisconception ? 3
    : entry.item && state.items[entry.item.id]?.fsrs?.due <= now ? 2 : 1;
  let score = 0;
  if (tier >= 3) {
    const d = mentor.due(state, content, now).find((x) => x.id === entry.targetMisconception);
    score = d ? d.urgency : 0;                                   // overdue x severity x objective weight x hits
  } else if (tier === 2) {
    score = (now - state.items[entry.item.id].fsrs.due) / fsrs.DAY_MS;   // most overdue first
  } else if (entry.item) {
    const d = coverageDeficit(state, content)[content.domainOf[entry.item.objective]] || { deficit: 0, weight: 0.1 };
    score = d.deficit * 10 + d.weight * 2;                         // under-studied heavy domain first
  }
  return tier * 1e6 + score;
}

/** Everything expectedGain needs that does not change between candidates. */
export function gainContext(state, content, now = Date.now(), flatBase = false) {
  const days = state.profile.examDate ? Math.max(1, mentor.daysUntilExam(state, now)) : 30;
  const examAt = now + days * fsrs.DAY_MS;
  const perObjective = {};
  for (const d of content.objectives.domains) {
    for (const o of d.objectives) {
      perObjective[o.id] = { questions: EXAM_QUESTIONS * d.weight / d.objectives.length, graded: 0, recall: 0, seen: 0, correct: 0 };
    }
  }
  for (const it of content.items) {
    const o = perObjective[it.objective];
    if (!o) continue;
    if (isGraded(it)) o.graded += 1; else o.recall += 1;
    const s = state.items[it.id];
    if (s?.seen && isGraded(it)) { o.seen += s.seen; o.correct += s.correct || 0; }
  }
  return { now, examAt, days, perObjective, pbqs: content.pbqs.length, flatBase };
}

/**
 * What this person would get right on this item's slice of the exam without
 * remembering this item: their smoothed accuracy on the objective, lowered for
 * a harder item. Memory of the item adds to it, it does not replace it.
 */
export function baseRate(it, ctx) {
  if (ctx.flatBase) return 0.5;   // the ablation: no difficulty, no accuracy
  const o = ctx.perObjective[it.objective];
  const prior = (o.correct + 2) / (o.seen + 4);
  return Math.max(0.05, Math.min(0.9, prior * (1.15 - 0.075 * (it.difficulty || 3))));
}

/** Right on exam day either from understanding or from retained memory of the item. */
export const examProb = (base, memory) => 1 - (1 - base) * (1 - memory);

/**
 * Expected scaled-score points gained at the exam date by serving this
 * candidate now, and the minutes it costs. An item stands for its share of
 * its objective's exam questions; serving it moves the chance of getting that
 * share right on exam day from where it would decay to, to where one more
 * review leaves it, weighted by the chance of answering right now. Myopic on
 * purpose: it assumes no further review, which is what ranks the item you are
 * about to forget above the one you already hold.
 */
export function expectedGain(entry, state, content, ctx = gainContext(state, content)) {
  const { now, examAt } = ctx;
  let points = 0;
  let seconds = SECONDS.mcq;
  const it = entry.item;
  if (it) {
    const o = ctx.perObjective[it.objective];
    if (o) {
      const graded = isGraded(it);
      // A graded item stands for its share of the objective's exam questions.
      // A recall card is measured against all the objective's material and
      // credited a quarter of that, so a lone card cannot stand for a whole objective.
      const share = graded ? o.questions / Math.max(1, o.graded)
        : (o.questions / Math.max(1, o.graded + o.recall)) * RECALL_TRANSFER;
      const s = state.items[it.id];
      const base = baseRate(it, ctx);
      const studied = !!s?.fsrs?.stability;
      const card = studied ? s.fsrs : fsrs.newCard();
      const memNow = studied ? fsrs.currentRetrievability(card, now) : 0;
      const memExam = studied ? fsrs.currentRetrievability(card, examAt) : 0;
      const pNow = examProb(base, memNow);                         // the chance of answering right now
      const opts = { now, desiredRetention: state.profile.desiredRetention };
      const memAfter = pNow * fsrs.currentRetrievability(fsrs.review(card, fsrs.RATING.GOOD, opts), examAt)
        + (1 - pNow) * fsrs.currentRetrievability(fsrs.review(card, fsrs.RATING.AGAIN, opts), examAt);
      points += share * Math.max(0, examProb(base, memAfter) - examProb(base, memExam)) * POINTS_PER_QUESTION;
      seconds = SECONDS[it.type] || SECONDS.mcq;
    }
  }
  if (entry.pbq) {
    const best = (state.pbq[entry.pbq.id]?.best || 0) / 100;
    points += (PBQS_ON_EXAM / Math.max(1, ctx.pbqs)) * PBQ_WEIGHT * (1 - best) * 0.3 * POINTS_PER_QUESTION;
    seconds = entry.pbq.targetSeconds || SECONDS.pbq;
  }
  if (entry.kind === "mentor") seconds = SECONDS.mentor;
  const mc = entry.targetMisconception && state.misconceptions[entry.targetMisconception];
  if (mc && !mc.retired) {
    // An open misconception drags its objective by up to 12% per unit of
    // severity until it retires; one clean pass is one step of `needed`.
    const def = content.misconceptions[entry.targetMisconception];
    const o = def && ctx.perObjective[def.objective];
    if (o) points += o.questions * POINTS_PER_QUESTION * 0.12 * (SEVERITY[def.severity] ?? 0.7) / (def.retireAfter ?? 2);
  }
  const minutes = seconds / 60;
  return { points, minutes, perMinute: points / minutes };
}
