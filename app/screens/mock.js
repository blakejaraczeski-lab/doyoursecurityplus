import { App, announce, renderApp, save } from "../app.js";
import * as reviews from "../reviews.js";
import { gradePbq } from "../grade.js";
import { blockFit, buildMock, FORMATS, PBQ_WEIGHT, weightOf, toScaled } from "../scheduler.js";
import { mentorCards, pct, pbqAnswered } from "../ui/common.js";
import { recordOutcome, recordPbq } from "../record.js";
import { emptyAnswers } from "./sheet.js";

/** Score a finished mock and turn every miss into a scheduled correction. */
function gradeMock() {
  const m = App.mock;
  const now = Date.now();
  let mcqCorrect = 0, mcqTotal = 0, unanswered = 0, answered = 0;
  let pbqEarned = 0, pbqMax = 0, pbqCount = 0;
  let wCorrect = 0, wTotal = 0;          // difficulty weighted
  const byDomain = {};
  const banked = [];
  const missedObjectives = {};
  const note = (ids) => { for (const id of ids) if (!banked.includes(id)) banked.push(id); };

  for (const d of App.content.objectives.domains) {
    byDomain[d.id] = { id: d.id, title: d.title, weight: d.weight, correct: 0, total: 0 };
  }

  for (const entry of m.items) {
    if (entry.kind === "pbq") {
      const g = gradePbq(entry.pbq, App.answers[entry.pbq.id] || {});
      pbqEarned += g.earned; pbqMax += g.max; pbqCount += 1;
      const pw = PBQ_WEIGHT * weightOf(entry.pbq);
      wTotal += pw;
      wCorrect += pw * (g.max ? g.earned / g.max : 0);
      const dom = App.content.domainOf[entry.pbq.objective];
      if (byDomain[dom]) {
        byDomain[dom].total += PBQ_WEIGHT;
        byDomain[dom].correct += Math.round(PBQ_WEIGHT * (g.max ? g.earned / g.max : 0));
      }
      // A sheet never touched is counted wrong in the score above, but it is
      // not evidence about the person: no attempt, no banking.
      if (pbqAnswered(App.answers[entry.pbq.id])) { answered += 1; note(recordPbq(entry.pbq, g, now, { mock: true })); }
      continue;
    }

    const item = entry.item;
    const chosen = m.answers[item.id];
    const dom = App.content.domainOf[item.objective];
    const w = weightOf(item);
    mcqTotal += 1;
    wTotal += w;
    if (byDomain[dom]) byDomain[dom].total += 1;
    if (!chosen) unanswered += 1;
    // Everything in a mock is answered under exam conditions, so a miss counts
    // as confidently wrong: you committed to it with the clock running.
    // A blank is wrong in the score but never seen: no FSRS review, no row, and
    // so nothing counted toward the day's goal. Only an answer is recorded.
    if (chosen) answered += 1;
    const out = chosen ? recordOutcome(entry, new Set([chosen]), { now, mock: true }) : { correct: false, banked: [] };
    if (out.correct) {
      wCorrect += w;
      mcqCorrect += 1;
      if (byDomain[dom]) byDomain[dom].correct += 1;
    } else {
      missedObjectives[item.objective] = (missedObjectives[item.objective] || 0) + 1;
    }
    note(out.banked);
  }

  const pbqFrac = pbqMax ? pbqEarned / pbqMax : 0;
  const raw = wTotal ? wCorrect / wTotal : 0;
  const flatRaw = (mcqTotal + pbqCount * PBQ_WEIGHT)
    ? (mcqCorrect + pbqFrac * pbqCount * PBQ_WEIGHT) / (mcqTotal + pbqCount * PBQ_WEIGHT)
    : 0;
  const scaled = toScaled(raw);

  const seconds = Math.round((now - m.startedAt) / 1000);
  const notes = [];
  if (unanswered) notes.push(`${unanswered} question${unanswered === 1 ? "" : "s"} left unanswered. On the real exam there is no penalty for a wrong guess, so never leave one blank.`);
  if (pbqCount && pbqFrac < 0.6) notes.push(`You scored ${pct(pbqFrac)} across the performance-based questions. They are worth roughly ${PBQ_WEIGHT} items each, so this is where the scaled score is leaking.`);
  const worst = Object.entries(missedObjectives).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 2) {
    notes.push(`${worst[1]} misses landed in objective ${worst[0]}, ${App.content.objectiveById[worst[0]]?.title || ""}. That is the single highest-value thing to repair before the next block.`);
  }
  if (seconds > m.minutes * 60 * 0.95) notes.push(`You used almost the whole window. Pace is a scoring factor in its own right: practise flagging and moving on rather than finishing a hard item.`);
  if (scaled >= 750) notes.push(`Above the line on this block. Repeat on a different block before treating that as readiness, because a single form can flatter you.`);
  if (Math.abs(raw - flatRaw) >= 0.03) {
    notes.push(`Weighted for item difficulty your raw score is ${pct(raw)}; counted flat it would be ${pct(flatRaw)}. ${
      raw < flatRaw
        ? "You are doing better on the easy items than the hard ones, which is the pattern that passes practice tests and fails the exam."
        : "You are holding up on the harder items, which is the right way round."}`);
  }

  reviews.log({ at: now, kind: "mock", format: m.format, raw, scaled, seconds, unanswered, answered, of: m.items.length, banked: banked.length });
  return {
    at: now, format: m.format, raw, flatRaw, scaled, seconds, minutes: m.minutes,
    unanswered, banked: banked.length,
    byDomain: Object.values(byDomain), notes, mentorHtml: mentorCards(App, banked.slice(0, 6)),
  };
}

function finishMock() {
  if (!["mock-run", "mock-review"].includes(App.screen) || !App.mock || App.mock.result) return;
  App.mock.result = gradeMock();
  App.screen = "mock-result";
  save();
}

/** The mock clock, updated in place on the one second tick. */
export function tickMock() {
  const el = document.getElementById("mock-timer");
  if (!el || !["mock-run", "mock-review"].includes(App.screen)) return;
  const left = Math.max(0, Number(el.dataset.ends) - Date.now());
  const mm = Math.floor(left / 60000), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  // The urgency is words as well as hue: colour alone would be lost on a reader who cannot see it.
  const urgency = left < 5 * 60000 ? ", last 5 min" : left < 15 * 60000 ? ", last 15 min" : "";
  el.textContent = `${mm}:${ss} left${urgency}`;
  el.className = `mono ${left < 5 * 60000 ? "c-bad" : left < 15 * 60000 ? "c-warn" : ""}`;
  if (left === 0) { finishMock(); renderApp(); }
}

export const actions = {
  // Choosing a block only selects it; Start is a separate, deliberate press.
  "mock-select": (el) => { App.mockPick = el.dataset.format; },
  "mock-start": (el) => {
    const fmt = el.dataset.format || App.mockPick;
    if (!fmt || App.mock) return;
    reviews.startSession();
    const fit = blockFit(App.content, FORMATS[fmt]);
    const items = buildMock(App.content, { pbqCount: fit.pbqs, total: fit.total });
    if (!items.length) return;   // the screen already says there is nothing to run
    App.mock = {
      format: fmt, minutes: fit.minutes, items, idx: 0,
      answers: {}, flagged: new Set(),
      startedAt: Date.now(), endsAt: Date.now() + fit.minutes * 60000, result: null,
    };
    for (const e of items) if (e.kind === "pbq") App.answers[e.pbq.id] = emptyAnswers(e.pbq);
    App.screen = "mock-run";
  },
  "mock-answer": (el) => {
    const entry = App.mock.items[App.mock.idx];
    App.mock.answers[entry.item.id] = el.dataset.opt;
  },
  "mock-next": () => { App.mock.idx = Math.min(App.mock.idx + 1, App.mock.items.length - 1); },
  "mock-prev": () => { App.mock.idx = Math.max(0, App.mock.idx - 1); },
  "mock-flag": () => {
    const e = App.mock.items[App.mock.idx];
    const id = e.item?.id || e.pbq?.id;
    App.mock.flagged.has(id) ? App.mock.flagged.delete(id) : App.mock.flagged.add(id);
  },
  "mock-review": () => { App.screen = "mock-review"; },
  "mock-resume": () => { App.screen = "mock-run"; },
  "mock-goto": (el) => { App.mock.idx = Number(el.dataset.i); App.screen = "mock-run"; },
  "mock-first-blank": () => {
    const m = App.mock;
    const blank = m.items.findIndex((e) =>
      e.kind === "pbq" ? !pbqAnswered(App.answers[e.pbq.id]) : !m.answers[e.item.id]);
    if (blank >= 0) { m.idx = blank; App.screen = "mock-run"; }
  },
  "mock-submit": () => {
    const left = App.mock.items.length - Object.keys(App.mock.answers).length;
    if (left > 0 && !confirm(`${left} question${left === 1 ? " is" : "s are"} unanswered. There is no penalty for a wrong guess on the real exam. Submit anyway?`)) return;
    finishMock();
  },
  "mock-done": () => { App.mock = null; App.mockPick = null; App.screen = "mock-home"; },
  // Ending early offers two exits, chosen each time: score what is there, or
  // leave without a score.
  "mock-end": () => { App.mock.ending = true; },
  "mock-end-cancel": () => { App.mock.ending = false; },
  "mock-submit-now": () => { App.mock.ending = false; finishMock(); },
  "mock-abandon": () => {
    const m = App.mock;
    const now = Date.now();
    const answered = m.items.filter((e) => e.kind === "pbq" ? pbqAnswered(App.answers[e.pbq.id]) : !!m.answers[e.item.id]).length;
    // An attempt, kept so the history is honest, but not a measurement: no
    // raw or scaled score, so the forecast and the booking rule never see it,
    // and nothing is banked from a sitting that was not finished.
    reviews.log({ at: now, kind: "mock", format: m.format, abandoned: true, answered, of: m.items.length,
                  seconds: Math.round((now - m.startedAt) / 1000) });
    App.mock = null;
    App.mockPick = null;
    App.screen = "mock-home";
    announce(`Mock abandoned with ${answered} of ${m.items.length} answered. Not scored.`);
  },
};
