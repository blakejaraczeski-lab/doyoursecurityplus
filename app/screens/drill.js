import { App, announce, renderApp, save } from "../app.js";
import * as store from "../state.js";
import * as reviews from "../reviews.js";
import { buildQueue, spaceAfterMiss, SESSION_SIZE } from "../scheduler.js";
import { recordItem, passMc, recordOutcome } from "../record.js";
import { openPbq } from "./sheet.js";

/** Fold one outcome into the running session figures. */
function tally(out, item) {
  const s = App.sessionStats;
  s.answered += 1;
  if (out.correct) s.correct += 1;
  if (out.rushed) s.rushed += 1;
  s.banked += out.banked.length;
  s.retired += out.retired;
  if (!out.correct && item.objective) {
    s.missesByObjective[item.objective] = (s.missesByObjective[item.objective] || 0) + 1;
  }
}

function answerMcq(optId) {
  const entry = App.queue[App.idx];
  const out = recordOutcome(entry, new Set([optId]), {
    confident: !App.markedGuess,
    responseMs: App.questionShownAt ? Date.now() - App.questionShownAt : null,
  });
  tally(out, entry.item);
  spaceAfterMiss(App.queue, App.idx, out.banked);
  App.answer = { chosen: optId, ...out };
  App.markedGuess = false;
  announce(out.correct ? "Correct." : `Not correct. The answer: ${entry.item.options.find((o) => o.correct)?.text || ""}`);
  save();
}

function answerMcqMulti() {
  const entry = App.queue[App.idx];
  const out = recordOutcome(entry, App.multiPicked, {
    confident: !App.markedGuess,
    responseMs: App.questionShownAt ? Date.now() - App.questionShownAt : null,
  });
  tally(out, entry.item);
  spaceAfterMiss(App.queue, App.idx, out.banked);
  App.answer = out;
  App.markedGuess = false;
  announce(out.correct ? "Correct." : "Not correct. The exam scores a choose-two as all or nothing.");
  save();
}

// --- session control ------------------------------------------------------
export function startSession(mode) {
  reviews.startSession();
  App.mode = mode;
  App.queue = buildQueue(App.state, App.content, { mode, size: SESSION_SIZE[mode] });
  App.idx = 0;
  App.answer = null;
  App.graded = null;
  App.pbqStartedAt = null;
  App.multiPicked = new Set();
  App.sessionStats = { answered: 0, correct: 0, banked: 0, retired: 0, rushed: 0, missesByObjective: {} };
  App.questionShownAt = Date.now();
  App.screen = App.queue.length ? "drill-run" : "drill-home";
  if (App.queue[0]?.kind === "pbq") openPbq(App.queue[0].pbq);
}

export function next() {
  App.idx += 1;
  App.answer = null;
  App.markedGuess = false;
  App.multiPicked = new Set();
  App.questionShownAt = Date.now();
  App.graded = null;
  App.pbqStartedAt = null;
  App.screen = App.idx < App.queue.length ? "drill-run" : "drill-done";
  if (App.queue[App.idx]?.kind === "pbq") openPbq(App.queue[App.idx].pbq);
}

export const actions = {
  "start-drill": () => startSession("drill"),
  "start-weak": () => startSession("weak"),
  answer: (el) => answerMcq(el.dataset.opt),
  next,
  reveal: () => { App.answer = { revealed: true }; },
  grade: (el) => {
    recordItem(App.queue[App.idx].item, Number(el.dataset.g), Date.now(),
               { responseMs: App.questionShownAt ? Date.now() - App.questionShownAt : null });
    App.sessionStats.answered += 1;
    if (Number(el.dataset.g) >= 3) App.sessionStats.correct += 1;
    save();
    next();
  },
  "mentor-ack": () => {
    const now = Date.now();
    passMc(App.queue[App.idx].targetMisconception, `mentor:${now}`, now, true,
           App.questionShownAt ? now - App.questionShownAt : null);   // reading the correction is study time
    store.touchStreak(App.state);
    save();
    next();
  },
  // Skip records nothing: a skipped item is not evidence either way. It leaves
  // this session and comes back on its own schedule.
  skip: () => {
    App.queue.splice(App.idx, 1);
    App.answer = null;
    App.markedGuess = false;
    App.multiPicked = new Set();
    App.questionShownAt = Date.now();
    App.screen = App.idx < App.queue.length ? "drill-run" : "drill-done";
    if (App.queue[App.idx]?.kind === "pbq") openPbq(App.queue[App.idx].pbq);
    announce("Skipped. It comes back on its own schedule.");
  },
  "dismiss-intro": () => {
    App.introDismissed = true;
    try { localStorage.setItem("dysp.intro", "1"); } catch {}
  },
  "toggle-guess": () => {
    App.markedGuess = !App.markedGuess;
    announce(App.markedGuess ? "Marked as a guess." : "No longer marked as a guess.");
  },
  "multi-toggle": (el) => {
    const id = el.dataset.opt;
    App.multiPicked.has(id) ? App.multiPicked.delete(id) : App.multiPicked.add(id);
    announce(`${App.multiPicked.size} of ${App.queue[App.idx].item.selectCount || 2} selected.`);
  },
  "multi-submit": answerMcqMulti,
};

/** The drill's own keys: answer, skip, guess, continue. Item questions only; PBQs have their own (screens/pbq.js). */
export function keys(e) {
  if (App.screen !== "drill-run") return;
  const entry = App.queue[App.idx];
  if (!entry || entry.kind !== "item") return;

  if (!App.answer && e.key.toLowerCase() === "s" && entry.item.type !== "recall") {
    e.preventDefault();
    actions.skip();
    return renderApp();
  }

  if (entry.item.type === "mcq-multi") {
    if (App.answer && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); return renderApp(); }
    if (App.answer) return;
    const need = entry.item.selectCount || 2;
    if (e.key === "Enter" && App.multiPicked.size === need) { e.preventDefault(); answerMcqMulti(); return renderApp(); }
    const i = "abcdefghij".indexOf(e.key.toLowerCase());
    if (i >= 0 && entry.item.options[i]) {
      e.preventDefault();
      const id = entry.item.options[i].id;
      App.multiPicked.has(id) ? App.multiPicked.delete(id) : App.multiPicked.add(id);
      renderApp();
    }
    return;
  }

  if (entry.item.type === "mcq") {
    if (App.answer && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); return renderApp(); }
    if (!App.answer && e.key.toLowerCase() === "g") {
      e.preventDefault();
      App.markedGuess = !App.markedGuess;
      return renderApp();
    }
    const i = "abcdefghij".indexOf(e.key.toLowerCase());
    if (!App.answer && i >= 0 && entry.item.options[i]) {
      e.preventDefault();
      answerMcq(entry.item.options[i].id);
      renderApp();
    }
    return;
  }

  if (entry.item.type === "recall") {
    if (!App.answer?.revealed && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      App.answer = { revealed: true };
      return renderApp();
    }
    if (App.answer?.revealed && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      actions.grade({ dataset: { g: e.key } });
      renderApp();
    }
  }
}
