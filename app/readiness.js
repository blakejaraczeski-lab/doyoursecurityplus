// The forecast and the plan: what score to expect on exam day, when to book,
// how many hours remain, the day by day study plan, and the per-objective
// picture the Readiness screen draws.

import * as fsrs from "./fsrs.js";
import * as mentor from "./mentor.js";
import { isGraded } from "./content.js";
import { FORMATS, EXAM_QUESTIONS, SECONDS, SEVERITY, POINTS_PER_QUESTION, itemState, seen, toScaled, weightOf } from "./schedule-core.js";
import { baseRate, examProb, expectedGain, gainContext } from "./queue.js";

// --- the plan to the exam date ----------------------------------------------------

const REVIEW_WEEK = 7;   // the last week before the exam is for review and mocks, not new material

/**
 * Every day from now to the exam: how many answers it takes, and how many
 * minutes. Seen cards are reviewed on their due day and advanced as if
 * recalled; a card due after the exam is above target on exam day and costs
 * nothing. Unseen graded items are introduced at an even
 * rate over the days before the review week, highest expected gain first,
 * which is what front-loads the weakest heavily weighted objectives. A
 * projection, not a promise: misses add reviews the plan does not foresee.
 */
export function studyPlan(state, content, now = Date.now()) {
  if (!state.profile.examDate) return null;
  const days = Math.max(1, mentor.daysUntilExam(state, now));
  const examAt = now + days * fsrs.DAY_MS;
  const opts = (t) => ({ now: t, desiredRetention: state.profile.desiredRetention });
  const ctx = gainContext(state, content, now);
  const unseen = content.items.filter((it) => isGraded(it) && it.objective && !seen(state, it.id))
    .map((it) => ({ it, g: expectedGain({ item: it }, state, content, ctx).perMinute }))
    .sort((a, b) => b.g - a.g).map((x) => x.it);
  const learnDays = Math.max(1, days - REVIEW_WEEK);
  const newPerDay = Math.ceil(unseen.length / learnDays);

  const cards = Object.values(state.items).filter((s) => s.fsrs?.stability).map((s) => ({ ...s.fsrs }));
  const plan = [];
  let next = 0;
  for (let d = 0; d < days; d++) {
    const dayEnd = now + (d + 1) * fsrs.DAY_MS;
    let reviews = 0;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].due < dayEnd && cards[i].due < examAt) { cards[i] = fsrs.review(cards[i], fsrs.RATING.GOOD, opts(Math.max(cards[i].due, dayEnd - fsrs.DAY_MS))); reviews += 1; }
    }
    const fresh = d < learnDays ? unseen.slice(next, next + newPerDay) : [];
    next += fresh.length;
    for (let k = 0; k < fresh.length; k++) cards.push(fsrs.review(fsrs.newCard(), fsrs.RATING.GOOD, opts(dayEnd - fsrs.DAY_MS)));
    const answers = reviews + fresh.length;
    plan.push({ day: d, reviews, fresh: fresh.length, answers, minutes: Math.round(answers * SECONDS.mcq / 60),
                objectives: fresh.map((it) => it.objective) });
  }
  const peak = Math.max(...plan.map((p) => p.answers));
  const total = plan.reduce((a, p) => a + p.answers, 0);
  const reviews = plan.reduce((a, p) => a + p.reviews, 0);
  return { days, unseen: unseen.length, newPerDay, peak, reviews, perDay: Math.ceil(total / days),
           minutesPerDay: Math.round(total / days * SECONDS.mcq / 60), totalMinutes: Math.round(total * SECONDS.mcq / 60), plan };
}

// --- the forecast and the stopping rule ---------------------------------------------

const MOCK_WEIGHT = { full: 1, half: 0.5, short: 0.25 };
const MODEL_SD = 0.08;      // raw-score error of the model before any mock calibrates it
const Z = 1.28;             // one-sided 10%

const MIN_ANSWERED = 0.8;   // a mock ended with less than this answered is not a sitting

/**
 * Does a mock row measure anything? An abandoned attempt has no score, and a
 * block submitted after a few questions scores blanks as wrong: a low number,
 * but not a measurement of the exam, and it must not count as one of the two
 * full mocks the booking rule asks for. Rows from before `answered` was
 * logged have no `of` and count.
 */
const countsAsMock = (m) => !m.abandoned && (!m.of || m.answered / m.of >= MIN_ANSWERED);

/**
 * The scaled score expected on exam day, and its band. Built from what the
 * person is likely to remember then, not from how much of the bank they have
 * seen: every graded item's chance of being right on the day (understanding,
 * or memory decayed to the date), averaged per objective, dragged by open
 * corrections, weighted by the exam's questions per objective. Mocks are the
 * only thing that resembles the exam, so as they arrive they pull the
 * estimate toward their own result and narrow the model's share of the band.
 */
export function examForecast(state, content, now = Date.now(), mocks = []) {
  const ctx = gainContext(state, content, now);
  const per = {};
  for (const it of content.items) {
    if (!isGraded(it) || !ctx.perObjective[it.objective]) continue;
    const s = state.items[it.id];
    const mem = s?.fsrs?.stability ? fsrs.currentRetrievability(s.fsrs, ctx.examAt) : 0;
    (per[it.objective] ||= []).push(examProb(baseRate(it, ctx), mem));
  }
  const drag = {};
  for (const [id, r] of Object.entries(state.misconceptions || {})) {
    const def = content.misconceptions[id];
    if (r.retired || !def) continue;
    drag[def.objective] = (drag[def.objective] || 0) +
      0.12 * (SEVERITY[def.severity] ?? 0.7) * (1 - fsrs.currentRetrievability(r.fsrs, ctx.examAt));
  }
  let model = 0, variance = 0;
  for (const [o, v] of Object.entries(ctx.perObjective)) {
    const ps = per[o] || [];
    const p = (ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0.5) * (1 - Math.min(0.4, drag[o] || 0));
    model += v.questions * p / EXAM_QUESTIONS;
    variance += v.questions * p * (1 - p);
  }
  const recent = mocks.filter((m) => m.at >= now - 30 * fsrs.DAY_MS && typeof m.raw === "number" && countsAsMock(m));
  const w = recent.reduce((a, m) => a + (MOCK_WEIGHT[m.format] ?? 0.25), 0);
  const mockRaw = w ? recent.reduce((a, m) => a + m.raw * (MOCK_WEIGHT[m.format] ?? 0.25), 0) / w : null;
  const k = w / (w + 2);
  const raw = mockRaw == null ? model : k * mockRaw + (1 - k) * model;
  const sd = Math.sqrt(variance / EXAM_QUESTIONS ** 2 + (MODEL_SD ** 2) / (1 + w));
  const clamp = (x) => Math.max(0, Math.min(1, x));

  // The stopping rule: book the exam when all three hold.
  const fulls = mocks.filter((m) => m.format === "full" && countsAsMock(m) && m.at >= now - 14 * fsrs.DAY_MS);
  const heavyOpen = Object.entries(state.misconceptions || {}).filter(([id, r]) => {
    const def = content.misconceptions[id];
    return def && !r.retired && def.severity === "high" && (content.objectiveById[def.objective]?.weight ?? 0) >= 0.2;
  }).map(([id]) => id);
  const rules = [
    { met: toScaled(clamp(raw - Z * sd)) >= 750, text: `the low end of the band is at or above 750 (it is ${toScaled(clamp(raw - Z * sd))})` },
    { met: fulls.length >= 2 && fulls.slice(-2).every((m) => m.scaled >= 750),
      text: `two full mocks in the last 14 days, both at or above 750 (${fulls.length ? fulls.slice(-2).map((m) => m.scaled).join(" and ") : "none taken"})` },
    { met: heavyOpen.length === 0, text: `no high-severity correction open in a domain worth 20% or more (${heavyOpen.length} open)` },
  ];
  return {
    raw, model, mockRaw, mocks: recent.length, sd,
    scaled: toScaled(clamp(raw)), low: toScaled(clamp(raw - Z * sd)), high: toScaled(clamp(raw + Z * sd)),
    stop: { ready: rules.every((r) => r.met), rules },
  };
}

/**
 * Study hours from here to the stopping rule, its two full mocks included.
 *
 * Each item is valued as studied properly, not once: reviewed on every due
 * day until the exam, and costed per review. That is its rise in the chance
 * of being right on exam day, against the minutes all those reviews take.
 * The bank is walked in order of points per minute until the forecast's low
 * end would clear 750, measured with the uncertainty the two required mocks
 * will leave rather than today's, because the rule cannot pass without them.
 * The high end of the range allows 2.5 times as long, the ratio the replay of
 * the real log measured between what was served and the gain order. When the
 * whole bank cannot close the gap, the gap is content, not hours.
 */
export function hoursToReady(state, content, now = Date.now(), mocks = []) {
  const f = examForecast(state, content, now, mocks);
  const fullMocks = mocks.filter((m) => m.format === "full" && countsAsMock(m) && m.at >= now - 30 * fsrs.DAY_MS).length;
  const sdAfter = Math.sqrt(f.sd ** 2 - (MODEL_SD ** 2) / (1 + fullMocks) + (MODEL_SD ** 2) / (1 + Math.max(2, fullMocks)));
  const gap = Math.max(0, 0.75 + Z * sdAfter - f.raw) * (650 / 0.75);
  const mockMinutes = Math.max(0, 2 - fullMocks) * FORMATS.full.minutes;
  const ctx = gainContext(state, content, now);
  const ranked = [];
  for (const it of content.items) {
    const o = ctx.perObjective[it.objective];
    if (!isGraded(it) || !o) continue;
    const base = baseRate(it, ctx);
    const s = state.items[it.id];
    let card = s?.fsrs?.stability ? { ...s.fsrs } : fsrs.newCard();
    const before = examProb(base, card.stability ? fsrs.currentRetrievability(card, ctx.examAt) : 0);
    let at = card.stability ? Math.max(now, card.due) : now, reviews = 0;
    while (at < ctx.examAt && reviews < 12) {
      card = fsrs.review(card, fsrs.RATING.GOOD, { now: at, desiredRetention: state.profile.desiredRetention });
      reviews += 1;
      at = card.due;
    }
    if (!reviews) continue;
    const points = (o.questions / Math.max(1, o.graded)) * (examProb(base, fsrs.currentRetrievability(card, ctx.examAt)) - before) * POINTS_PER_QUESTION;
    const minutes = reviews * (SECONDS[it.type] || SECONDS.mcq) / 60;
    if (points > 0) ranked.push({ points, minutes });
  }
  ranked.sort((a, b) => b.points / b.minutes - a.points / a.minutes);
  let points = 0, minutes = 0;
  for (const g of ranked) {
    if (points >= gap) break;
    points += g.points;
    minutes += g.minutes;
  }
  if (points < gap) return { reachable: false, gap: Math.round(gap), available: Math.round(points) };
  return { reachable: true, low: (minutes + mockMinutes) / 60, high: (minutes * 2.5 + mockMinutes) / 60, gap: Math.round(gap) };
}

// --- readiness -------------------------------------------------------------

const laplace = (correct, seenCount) => (correct + 2) / (seenCount + 4);

/**
 * Mastery 0..1 per objective for the per-objective picture, and the exam-day
 * forecast for the headline (examForecast). `mocks` are the mock rows from the
 * review log; `reviewCount` only qualifies how much evidence there is.
 */
export function readiness(state, content, now = Date.now(), reviewCount = 0, mocks = []) {
  const perObjective = {};
  for (const d of content.objectives.domains) {
    for (const o of d.objectives) {
      perObjective[o.id] = {
        objective: o.id, title: o.title, domain: d.id, weight: d.weight,
        topics: o.topics.length, topicsCovered: 0,
        itemsAvailable: 0, pbqAvailable: 0, itemsSeen: 0, itemsCorrect: 0, attempts: 0,
        openMisconceptions: 0, retiredMisconceptions: 0, severityDrag: 0,
      };
    }
  }

  // How much graded material exists per objective, and how much of the
  // objective's blueprint it reaches. Both are properties of the bank, not of
  // the learner, and keeping them apart is the whole point: an objective with
  // two items is not an objective you are bad at.
  // Topic tags resolve through aliases; this is the one place that does it.
  // A canonical topic id always wins over another topic's alias: "segmentation"
  // is 2.5's own topic and only an alias of 3.3's segmentation-2, so the bare
  // word must credit 2.5. Canonical ids are seeded first for that reason.
  const canonical = {};
  const ownTopics = {};
  for (const d of content.objectives.domains) {
    for (const o of d.objectives) {
      ownTopics[o.id] = new Set(o.topics.map((t) => t.id));
      for (const t of o.topics) canonical[t.id] = t.id;
    }
  }
  for (const d of content.objectives.domains) {
    for (const o of d.objectives) {
      for (const t of o.topics) {
        for (const a of t.aliases || []) if (!(a in canonical)) canonical[a] = t.id;
      }
    }
  }
  // A topic is covered when some graded item tests it, wherever that item is
  // filed. Items legitimately reach across objective boundaries, and the
  // question this answers is whether the blueprint topic gets examined at all,
  // not whose drawer it was filed in.
  const touched = new Set();
  const credit = (topics) => {
    for (const raw of topics || []) {
      const t = canonical[raw];
      if (t) touched.add(t);
    }
  };
  for (const it of content.items) {
    const rec = perObjective[it.objective];
    if (!isGraded(it)) continue;
    if (rec) rec.itemsAvailable += 1;
    credit(it.topics);
  }
  // A PBQ is graded material too. It is scored separately from the item queue,
  // so it covers blueprint ground without entering the itemsSeen denominator.
  for (const pq of content.pbqs) {
    const rec = perObjective[pq.objective];
    if (rec) rec.pbqAvailable += 1;
    credit(pq.topics);
  }
  for (const rec of Object.values(perObjective)) {
    rec.topicsCovered = [...ownTopics[rec.objective]].filter((t) => touched.has(t)).length;
  }

  // Mastery is built from graded practice only. A recall card is revealed and
  // self-graded, so folding it in here would let "I knew that" raise a number
  // that is supposed to predict a scored exam.
  for (const it of content.items) {
    const s = itemState(state, it.id);
    const rec = perObjective[it.objective];
    if (!rec || !s?.seen || !isGraded(it)) continue;
    const w = weightOf(it);
    rec.itemsSeen += 1;
    rec.attempts += s.seen * w;
    rec.itemsCorrect += (s.correct || 0) * w;
  }

  const sev = { high: 1, medium: 0.7, low: 0.4 };
  for (const [id, r] of Object.entries(state.misconceptions)) {
    const def = content.misconceptions[id];
    const rec = def && perObjective[def.objective];
    if (!rec) continue;
    if (r.retired) rec.retiredMisconceptions += 1;
    else {
      rec.openMisconceptions += 1;
      const decay = fsrs.currentRetrievability(r.fsrs, now);
      rec.severityDrag += (sev[def.severity] ?? 0.7) * (1 - decay);
    }
  }

  // PBQ performance folds into the objective the PBQ belongs to.
  for (const p of content.pbqs) {
    const done = state.pbq[p.id];
    const rec = perObjective[p.objective];
    if (!rec || !done?.attempts) continue;
    rec.pbqBest = done.best / 100;
  }

  const totals = { itemsSeen: 0, weightedMastery: 0, sampled: 0 };
  for (const rec of Object.values(perObjective)) {
    const accuracy = rec.attempts ? laplace(rec.itemsCorrect, rec.attempts) : 0;

    // The denominator is what this objective can actually offer you, not a
    // constant: with a flat one, an objective holding two items could never
    // reach full coverage, and the size of the bank read as a weakness in you.
    // Twelve is the sample size worth having; an objective that cannot supply
    // twelve is scored out of what it has, and the shortfall is reported
    // separately as bank depth.
    const sample = Math.min(rec.itemsAvailable, 12);
    const coverage = sample ? Math.min(1, rec.itemsSeen / sample) : 0;
    const drag = Math.min(0.4, rec.severityDrag * 0.12);
    let mastery = accuracy * (0.5 + 0.5 * coverage) - drag;
    if (rec.pbqBest != null) mastery = mastery * 0.7 + rec.pbqBest * 0.3;
    rec.accuracy = accuracy;
    rec.coverage = coverage;

    // Bank depth is the blueprint question: of this objective's topics, how many
    // does any graded item touch? A high mastery over a shallow bank is a real
    // result on an unrepresentative sample, so it is labelled rather than
    // silently discounted.
    rec.bankDepth = rec.topics ? rec.topicsCovered / rec.topics : 0;
    // Thin: under 35% of the blueprint reached, or fewer than four graded units.
    const units = rec.itemsAvailable + rec.pbqAvailable;
    rec.thin = units > 0 && (rec.bankDepth < 0.35 || units < 4);

    rec.mastery = Math.max(0, Math.min(1, mastery));
    rec.status = units === 0 ? "no-items"
      : rec.itemsSeen === 0 ? "untouched"
      : rec.mastery >= 0.85 ? "strong"
      : rec.mastery >= 0.7 ? "ok"
      : rec.mastery >= 0.5 ? "shaky"
      : "weak";
    totals.itemsSeen += rec.itemsSeen;
    totals.weightedMastery += rec.mastery * (rec.weight / 
      content.objectives.domains.find((d) => d.id === rec.domain).objectives.length);
    if (rec.itemsSeen) totals.sampled += 1;
  }

  const p = Math.max(0, Math.min(1, totals.weightedMastery));
  const n = reviewCount;
  // Blueprint depth, aggregated rather than averaged per objective. Averaging the ratios
  // weights a 10-topic objective the same as a 41-topic one and reads several
  // points higher than the truth, which is the identical mistake one level up.
  const recs = Object.values(perObjective);
  const topicsTotal = recs.reduce((a, r) => a + r.topics, 0);
  const topicsHitTotal = recs.reduce((a, r) => a + r.topicsCovered, 0);
  const meanDepth = topicsTotal ? topicsHitTotal / topicsTotal : 0;

  // The headline is the exam-day forecast. The coverage-weighted mastery above
  // still paints the per-objective picture; it no longer sets the score.
  const forecast = examForecast(state, content, now, mocks);
  return {
    perObjective,
    mastery: p,
    forecast,
    scaled: forecast.scaled,
    band: Math.round((forecast.high - forecast.low) / 2),
    low: forecast.low,
    high: forecast.high,
    passLine: 750,
    confident: n >= 150 && totals.sampled >= 20 && meanDepth >= 0.8,
    reviewCount: n,
    objectivesSampled: totals.sampled,
    bankDepth: meanDepth,
    topicsCovered: topicsHitTotal,
    topicsTotal,
    thinObjectives: recs.filter((r) => r.thin).length,
    emptyObjectives: recs.filter((r) => r.itemsAvailable === 0).length,
    daysLeft: state.profile.examDate ? mentor.daysUntilExam(state, now) : null,
  };
}
