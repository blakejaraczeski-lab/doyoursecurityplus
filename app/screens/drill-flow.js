import { App, announce } from "../app.js";
import * as reviews from "../reviews.js";
import { buildQueue, SESSION_SIZE } from "../scheduler.js";
import { openPbq } from "./sheet.js";

/** Fold one outcome into the running session figures. */
export function tally(out, item) {
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

/**
 * Skip records nothing: a skipped item is not evidence either way. It leaves
 * this session and comes back on its own schedule.
 */
export function skip() {
  App.queue.splice(App.idx, 1);
  App.answer = null;
  App.markedGuess = false;
  App.multiPicked = new Set();
  App.questionShownAt = Date.now();
  App.screen = App.idx < App.queue.length ? "drill-run" : "drill-done";
  if (App.queue[App.idx]?.kind === "pbq") openPbq(App.queue[App.idx].pbq);
  announce("Skipped. It comes back on its own schedule.");
}
