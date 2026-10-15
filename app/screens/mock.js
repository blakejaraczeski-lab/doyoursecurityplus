import { App, announce, renderApp, save } from "../app.js";
import * as reviews from "../reviews.js";
import { gradePbq } from "../grade.js";
import { blockFit, buildMock, examForecast, FORMATS, PBQ_WEIGHT, weightOf, toScaled } from "../scheduler.js";
import { pct, pbqAnswered } from "../ui/common.js";
import { answerState, clockClass, clockText, needOf, pickedOf } from "../ui/mock.js";
import { countsWord } from "../ui/mock-result.js";
import { recordOutcome, recordPbq } from "../record.js";
import { emptyAnswers } from "./sheet.js";
import { revive, stash } from "./mock-store.js";

/** Score a finished mock and turn every miss into a scheduled correction. */
function gradeMock(endedBy, away) {
  const m = App.mock;
  const now = Date.now();
  const used = Math.min(now, m.endsAt);   // a mock that ran out is scored at the end of its window, not when it was found
  let mcqCorrect = 0, mcqTotal = 0, unanswered = 0, answered = 0;
  let pbqEarned = 0, pbqMax = 0, pbqCount = 0;
  let wCorrect = 0, wTotal = 0;          // difficulty weighted
  const byDomain = {};
  const banked = [];
  const review = [];
  const missedObjectives = {};
  const note = (ids) => { for (const id of ids) if (!banked.includes(id)) banked.push(id); };

  for (const d of App.content.objectives.domains) {
    byDomain[d.id] = { id: d.id, title: d.title, weight: d.weight, correct: 0, total: 0 };
  }

  for (const [n0, entry] of m.items.entries()) {
    const n = n0 + 1;
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
      const touched = pbqAnswered(App.answers[entry.pbq.id]);
      if (touched) { answered += 1; note(recordPbq(entry.pbq, g, now, { mock: true })); }
      review.push({ n, id: entry.pbq.id, pbq: true, touched, earned: g.earned, max: g.max, flagged: m.flagged.has(entry.pbq.id) });
      continue;
    }

    const item = entry.item;
    const picked = pickedOf(m, item);
    const dom = App.content.domainOf[item.objective];
    const w = weightOf(item);
    mcqTotal += 1;
    wTotal += w;
    if (byDomain[dom]) byDomain[dom].total += 1;
    if (!picked.length) unanswered += 1;
    // Everything in a mock is answered under exam conditions, so a miss counts
    // as confidently wrong: you committed to it with the clock running.
    // A blank is wrong in the score but never seen: no FSRS review, no row, and
    // so nothing counted toward the day's goal. Only an answer is recorded.
    if (picked.length) answered += 1;
    // A choose-N is scored on the whole set, all or nothing, as the exam does.
    const out = picked.length ? recordOutcome(entry, new Set(picked), { now, mock: true }) : { correct: false, banked: [] };
    review.push({ n, id: item.id, picked, correct: out.correct, flagged: m.flagged.has(item.id) });
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

  const seconds = Math.round((used - m.startedAt) / 1000);
  const notes = [];
  if (unanswered) notes.push(`${unanswered} question${unanswered === 1 ? " was" : "s were"} left unanswered and scored wrong. On the real exam a guess costs nothing, so a guess always beats a blank.`);
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

  const row = { at: now, kind: "mock", format: m.format, raw, scaled, seconds, unanswered, answered, of: m.items.length, banked: banked.length };
  reviews.log(row);
  // Where the sitting stands against the booking rule, in the forecast's own words.
  const rule = examForecast(App.state, App.content, now, reviews.rows("mock")).stop.rules[1].text;
  return {
    at: now, format: m.format, raw, flatRaw, scaled, seconds, minutes: m.minutes,
    unanswered, banked: banked.length, bankedIds: banked, review,
    counts: countsWord(row, now).key, rule,
    endedBy, endedAt: m.idx + 1, away: !!away,
    byDomain: Object.values(byDomain), notes,
  };
}

/**
 * Score the mock once, however it ends. A submit works from the exam screens
 * only; the clock running out scores it wherever the learner is, and takes
 * them to the result only if they are on a mock screen.
 */
function finishMock(by = "submit", { away = false } = {}) {
  const m = App.mock;
  if (!m || m.result) return;
  const here = ["mock-run", "mock-review"].includes(App.screen);
  if (!here && by === "submit") return;
  m.ending = false;
  m.result = gradeMock(by, away);
  if (here) App.screen = "mock-result";
  save();
  stash();
  if (by === "time") {
    announce(away ? "Time ran out while you were away. The mock was scored; questions you had not answered were scored wrong."
      : `Time ran out at question ${m.result.endedAt}. The mock was scored; questions you had not answered were scored wrong.`);
  }
}

/**
 * A mock that was running when the page went away comes back with its clock
 * still running. Content loads after this module does, so the first tick after
 * the first render does it; if the learner has already started something in
 * the drill, the mock waits behind the Mock button instead of taking over.
 */
let revived = false;
function reviveOnce() {
  if (revived || !App.content || !document.getElementById("main")) return;
  revived = true;
  if (App.mock) return;
  const saved = revive();
  if (!saved) return;
  App.mock = saved.mock;
  const idle = App.screen.startsWith("drill") && App.sessionStats.answered === 0;
  if (App.mock.result) {
    if (idle) App.screen = "mock-result";
  } else if (Date.now() >= App.mock.endsAt) {
    if (idle) App.screen = "mock-run";
    finishMock("time", { away: true });
  } else {
    if (idle) App.screen = saved.screen;
    const mins = Math.ceil((App.mock.endsAt - Date.now()) / 60000);
    announce(`Mock exam resumed with ${mins} minute${mins === 1 ? "" : "s"} left.`);
  }
  stash();
  renderApp();
}

/** The mock clock, updated in place on the one second tick. */
export function tickMock() {
  reviveOnce();
  const m = App.mock;
  if (!m || m.result) return;
  const el = document.getElementById("mock-timer");
  const onMock = !!el && ["mock-run", "mock-review"].includes(App.screen);
  const ends = el ? Number(el.dataset.ends) : m.endsAt;
  const left = Math.max(0, ends - Date.now());
  if (onMock) {
    el.textContent = clockText(left);
    el.className = clockClass(left);
  }
  if (left === 0) {
    finishMock("time");
    if (onMock) renderApp();
    return;
  }
  stash();   // keeps PBQ edits, which this file does not see, in the saved copy
}

// The keys of the exam screen: the drill's letters, plus next, back, flag and
// review. Registered here because the mock owns them; a held key does nothing.
function onKey(e) {
  const m = App.mock;
  if (!m || m.result || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!["mock-run", "mock-review"].includes(App.screen)) return;
  const active = document.activeElement;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(active?.tagName)) return;
  if (e.repeat) return;
  const go = () => { e.preventDefault(); stash(); renderApp(); };

  if (e.key === "Escape" && m.ending) { m.ending = false; return go(); }
  if (App.screen !== "mock-run" || m.ending) return;

  const entry = m.items[m.idx];
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "n" || key === "ArrowRight") { actions["mock-next"](); return go(); }
  if (key === "p" || key === "ArrowLeft") { actions["mock-prev"](); return go(); }
  if (key === "f") { actions["mock-flag"](); return go(); }
  if (key === "r") { actions["mock-review"](); return go(); }
  if (entry.kind !== "item") return;

  if (key === "Enter") {
    // On a button, Enter is that button's click; on an option it moves on.
    if (active?.tagName === "BUTTON" && !active.classList.contains("opt")) return;
    if (answerState(App, entry) !== "answered") return;
    actions["mock-next"]();
    return go();
  }
  const i = "abcdefghij".indexOf(key);
  if (i >= 0 && key.length === 1 && entry.item.options[i]) {
    choose(entry.item, entry.item.options[i].id);
    go();
  }
}
document.addEventListener("keydown", onKey);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") stash(); });
window.addEventListener("pagehide", stash);

/** Pick an option. A choose-N toggles, holds at N, and a single answer replaces. */
function choose(item, id) {
  const m = App.mock;
  if (item.type !== "mcq-multi") { m.answers[item.id] = id; return; }
  const now = pickedOf(m, item);
  const next = now.includes(id) ? now.filter((x) => x !== id) : now.length < needOf(item) ? [...now, id] : now;
  if (next.length) m.answers[item.id] = next; else delete m.answers[item.id];
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
    stash();
  },
  "mock-answer": (el) => {
    choose(App.mock.items[App.mock.idx].item, el.dataset.opt);
    stash();
  },
  "mock-next": () => { App.mock.idx = Math.min(App.mock.idx + 1, App.mock.items.length - 1); stash(); },
  "mock-prev": () => { App.mock.idx = Math.max(0, App.mock.idx - 1); stash(); },
  "mock-flag": () => {
    const e = App.mock.items[App.mock.idx];
    const id = e.item?.id || e.pbq?.id;
    App.mock.flagged.has(id) ? App.mock.flagged.delete(id) : App.mock.flagged.add(id);
    stash();
  },
  "mock-review": () => { App.screen = "mock-review"; stash(); },
  "mock-resume": () => { App.screen = "mock-run"; stash(); },
  "mock-goto": (el) => { App.mock.idx = Number(el.dataset.i); App.screen = "mock-run"; stash(); },
  "mock-first-blank": () => {
    const m = App.mock;
    const blank = m.items.findIndex((e) => answerState(App, e) === "blank");
    if (blank >= 0) { m.idx = blank; App.screen = "mock-run"; stash(); }
  },
  // The review screen has just said how many are blank, so Submit is the
  // decision; End early is the path with both exits spelled out.
  "mock-submit": () => { finishMock(); },
  "mock-done": () => { App.mock = null; App.mockPick = null; App.screen = "mock-home"; stash(); },
  // Ending early offers two exits, chosen each time: score what is there, or
  // leave without a score.
  "mock-end": () => { App.mock.ending = true; },
  "mock-end-cancel": () => { App.mock.ending = false; },
  "mock-submit-now": () => { finishMock(); },
  "mock-abandon": () => {
    const m = App.mock;
    const now = Date.now();
    const answered = m.items.filter((e) => answerState(App, e) !== "blank").length;
    // An attempt, kept so the history is honest, but not a measurement: no
    // raw or scaled score, so the forecast and the booking rule never see it,
    // and nothing is banked from a sitting that was not finished.
    reviews.log({ at: now, kind: "mock", format: m.format, abandoned: true, answered, of: m.items.length,
                  seconds: Math.round((now - m.startedAt) / 1000) });
    App.mock = null;
    App.mockPick = null;
    App.screen = "mock-home";
    stash();
    announce(`Mock abandoned with ${answered} of ${m.items.length} answered. Not scored.`);
  },
};
